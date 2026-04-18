"""
routes/polls.py — Sondages
POST   /api/channels/<id>/polls   — créer un sondage
GET    /api/polls/<id>            — récupérer détails + résultats
POST   /api/polls/<id>/vote       — voter
DELETE /api/polls/<id>/vote       — retirer son vote
"""
from datetime import datetime
from flask import Blueprint, request, jsonify, session
from extensions import db, socketio
from models import Poll, PollOption, PollVote, Message, Channel
from routes.auth import login_required
from routes.channels import is_member

polls_bp = Blueprint('polls', __name__)


def poll_to_dict(poll, user_id):
    """Sérialise un sondage avec options, votes et pourcentages."""
    total = sum(len(o.votes) for o in poll.options)
    user_vote = None
    options = []
    for opt in poll.options:
        count = len(opt.votes)
        if any(v.utilisateur_id == user_id for v in opt.votes):
            user_vote = opt.id
        options.append({
            'id': opt.id,
            'texte': opt.texte_option_chiffree,
            'votes': count,
            'percent': round(count / total * 100) if total > 0 else 0
        })
    return {
        'id': poll.id,
        'message_id': poll.message_id,
        'question': poll.question_chiffree,
        'date_fin': poll.date_fin.isoformat() if poll.date_fin else None,
        'options': options,
        'total_votes': total,
        'user_vote': user_vote
    }


def get_channel_for_poll(poll):
    """Retourne le Channel associé au message du sondage."""
    msg = Message.query.get(poll.message_id)
    if not msg or not msg.salon_id:
        return None
    return Channel.query.get(msg.salon_id)


@polls_bp.route('/api/channels/<int:channel_id>/polls', methods=['POST'])
@login_required
def create_poll(channel_id):
    channel = Channel.query.get_or_404(channel_id)
    if not is_member(session['user_id'], channel.serveur_id):
        return jsonify({'error': 'Accès refusé'}), 403

    data = request.get_json() or {}
    question = (data.get('question') or '').strip()
    options_raw = data.get('options', [])
    options_texts = [o.strip() for o in options_raw if str(o).strip()]

    if not question:
        return jsonify({'error': 'La question est requise'}), 400
    if len(options_texts) < 2 or len(options_texts) > 5:
        return jsonify({'error': 'Entre 2 et 5 options requises'}), 400

    date_fin_dt = None
    if data.get('date_fin'):
        try:
            date_fin_dt = datetime.fromisoformat(data['date_fin'])
        except ValueError:
            pass

    # Message conteneur
    msg = Message(
        contenu_chiffre=f'[SONDAGE] {question}',
        auteur_id=session['user_id'],
        salon_id=channel_id
    )
    db.session.add(msg)
    db.session.flush()

    poll = Poll(message_id=msg.id, question_chiffree=question, date_fin=date_fin_dt)
    db.session.add(poll)
    db.session.flush()

    for text in options_texts:
        db.session.add(PollOption(poll_id=poll.id, texte_option_chiffree=text))

    db.session.commit()

    poll_data = poll_to_dict(poll, session['user_id'])
    poll_data.update({
        'auteur_id': session['user_id'],
        'auteur_pseudo': session['pseudo'],
        'horodatage': msg.horodatage.isoformat(),
        'channel_id': channel_id
    })

    socketio.emit('new_poll', poll_data, room=f'channel_{channel_id}')
    return jsonify(poll_data), 201


@polls_bp.route('/api/polls/<int:poll_id>', methods=['GET'])
@login_required
def get_poll(poll_id):
    poll = Poll.query.get_or_404(poll_id)
    channel = get_channel_for_poll(poll)
    if not channel or not is_member(session['user_id'], channel.serveur_id):
        return jsonify({'error': 'Accès refusé'}), 403
    return jsonify(poll_to_dict(poll, session['user_id'])), 200


@polls_bp.route('/api/polls/<int:poll_id>/vote', methods=['POST'])
@login_required
def vote(poll_id):
    poll = Poll.query.get_or_404(poll_id)
    channel = get_channel_for_poll(poll)
    if not channel or not is_member(session['user_id'], channel.serveur_id):
        return jsonify({'error': 'Accès refusé'}), 403

    if poll.date_fin and poll.date_fin < datetime.utcnow():
        return jsonify({'error': 'Ce sondage est terminé'}), 400

    data = request.get_json() or {}
    option_id = data.get('option_id')
    option = PollOption.query.filter_by(id=option_id, poll_id=poll_id).first()
    if not option:
        return jsonify({'error': 'Option invalide'}), 404

    # Supprimer vote précédent sur ce sondage si existant
    old_vote = PollVote.query.join(PollOption).filter(
        PollVote.utilisateur_id == session['user_id'],
        PollOption.poll_id == poll_id
    ).first()
    if old_vote:
        db.session.delete(old_vote)

    db.session.add(PollVote(utilisateur_id=session['user_id'], option_id=option_id))
    db.session.commit()

    poll_data = poll_to_dict(poll, session['user_id'])
    socketio.emit('poll_updated', poll_data, room=f'channel_{channel.id}')
    return jsonify(poll_data), 200


@polls_bp.route('/api/polls/<int:poll_id>/vote', methods=['DELETE'])
@login_required
def unvote(poll_id):
    poll = Poll.query.get_or_404(poll_id)
    channel = get_channel_for_poll(poll)
    if not channel or not is_member(session['user_id'], channel.serveur_id):
        return jsonify({'error': 'Accès refusé'}), 403

    old_vote = PollVote.query.join(PollOption).filter(
        PollVote.utilisateur_id == session['user_id'],
        PollOption.poll_id == poll_id
    ).first()
    if not old_vote:
        return jsonify({'error': 'Aucun vote à retirer'}), 404

    db.session.delete(old_vote)
    db.session.commit()

    poll_data = poll_to_dict(poll, session['user_id'])
    socketio.emit('poll_updated', poll_data, room=f'channel_{channel.id}')
    return jsonify(poll_data), 200


@polls_bp.route('/api/messages/<int:message_id>/poll', methods=['GET'])
@login_required
def get_poll_by_message(message_id):
    """Récupérer le sondage associé à un message (utilisé au chargement de l'historique)."""
    poll = Poll.query.filter_by(message_id=message_id).first()
    if not poll:
        return jsonify({'error': 'Aucun sondage pour ce message'}), 404
    channel = get_channel_for_poll(poll)
    if not channel or not is_member(session['user_id'], channel.serveur_id):
        return jsonify({'error': 'Accès refusé'}), 403

    # Inclure les métadonnées du message (auteur, horodatage) pour l'affichage
    msg = Message.query.get(message_id)
    data = poll_to_dict(poll, session['user_id'])
    data.update({
        'auteur_id': msg.auteur_id,
        'auteur_pseudo': msg.auteur.pseudo,
        'horodatage': msg.horodatage.isoformat(),
        'channel_id': channel.id
    })
    return jsonify(data), 200