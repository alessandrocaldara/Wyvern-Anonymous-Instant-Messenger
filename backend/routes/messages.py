from flask import Blueprint, request, jsonify, session
from sqlalchemy import or_, and_, case
from extensions import db
from models import Message, Channel, Permission, User
from routes.auth import login_required
from routes.channels import is_admin, is_member

messages_bp = Blueprint('messages', __name__)

@messages_bp.route('/api/dms', methods=['GET'])
@login_required
def get_dm_list():
    """Liste des conversations DM triées par activité récente."""
    uid = session['user_id']

    other_user_id = case(
        (Message.auteur_id == uid, Message.destinataire_id),
        else_=Message.auteur_id
    )

    latest_rows = db.session.query(
        other_user_id.label('other_user_id'),
        db.func.max(Message.horodatage).label('last_message_at')
    ).filter(
        Message.salon_id.is_(None),
        or_(Message.auteur_id == uid, Message.destinataire_id == uid)
    ).group_by(other_user_id).order_by(db.text('last_message_at DESC')).all()

    conversations = []
    for row in latest_rows:
        if row.other_user_id is None:
            continue

        user = db.session.get(User, row.other_user_id)
        if not user:
            continue

        conversations.append({
            'user_id': user.id,
            'pseudo': user.pseudo,
            'photo_profil': user.photo_profil,
            'last_message_at': row.last_message_at.isoformat() if row.last_message_at else None
        })

    return jsonify(conversations), 200

@messages_bp.route('/api/channels/<int:channel_id>/messages', methods=['GET'])
@login_required
def get_messages(channel_id):
    """Historique des messages d'un salon."""
    channel = Channel.query.get_or_404(channel_id)
    if not is_member(session['user_id'], channel.serveur_id):
        return jsonify({'error': 'Accès refusé'}), 403

    #vérifier l'accès aux salons privés
    perm = Permission.query.filter_by(
        utilisateur_id=session['user_id'],
        serveur_id=channel.serveur_id
    ).first()
    if channel.type == 'prive' and perm and perm.role != 'admin':
        from models import Server
        server = Server.query.get(channel.serveur_id)
        if not server or server.proprietaire_id != session['user_id']:
            return jsonify({'error': 'Accès refusé au salon privé'}), 403

    limit = request.args.get('limit', 50, type=int)
    offset = request.args.get('offset', 0, type=int)

    messages = Message.query.filter_by(salon_id=channel_id)\
        .order_by(Message.horodatage.asc())\
        .offset(offset).limit(limit).all()

    return jsonify([{
        'id': m.id,
        'contenu_chiffre': m.contenu_chiffre,
        'auteur_id': m.auteur_id,
        'auteur_pseudo': m.auteur.pseudo,
        'horodatage': m.horodatage.isoformat(),
        'est_epingle': bool(m.est_epingle)
    } for m in messages]), 200


@messages_bp.route('/api/dm/<int:other_user_id>/messages', methods=['GET'])
@login_required
def get_dm(other_user_id):
    """Historique des messages privés entre l'utilisateur connecté et un autre."""
    uid = session['user_id']
    messages = Message.query.filter(
        Message.salon_id.is_(None),
        or_(
            and_(Message.auteur_id == uid, Message.destinataire_id == other_user_id),
            and_(Message.auteur_id == other_user_id, Message.destinataire_id == uid)
        )
    ).order_by(Message.horodatage.asc()).all()

    return jsonify([{
        'id': m.id,
        'contenu_chiffre': m.contenu_chiffre,
        'auteur_id': m.auteur_id,
        'auteur_pseudo': m.auteur.pseudo,
        'destinataire_id': m.destinataire_id,
        'horodatage': m.horodatage.isoformat()
    } for m in messages]), 200


@messages_bp.route('/api/messages/<int:message_id>', methods=['PUT'])
@login_required
def edit_message(message_id):
    """Modifier son propre message."""
    message = Message.query.get_or_404(message_id)
    if message.auteur_id != session['user_id']:
        return jsonify({'error': 'Vous ne pouvez modifier que vos messages'}), 403

    data = request.get_json()
    nouveau = data.get('contenu_chiffre')
    if not nouveau:
        return jsonify({'error': 'Contenu requis'}), 400

    message.contenu_chiffre = nouveau
    db.session.commit()
    return jsonify({'message': 'Message modifié'}), 200


@messages_bp.route('/api/messages/<int:message_id>', methods=['DELETE'])
@login_required
def delete_message(message_id):
    """Supprimer un message (auteur ou admin du serveur)."""
    message = Message.query.get_or_404(message_id)

    # L'auteur peut toujours supprimer son message
    if message.auteur_id == session['user_id']:
        db.session.delete(message)
        db.session.commit()
        return jsonify({'message': 'Message supprimé'}), 200

    # Sinon, il faut être admin du serveur (pour les messages en salon)
    if message.salon_id:
        channel = Channel.query.get(message.salon_id)
        if channel and is_admin(session['user_id'], channel.serveur_id):
            db.session.delete(message)
            db.session.commit()
            return jsonify({'message': 'Message supprimé'}), 200

    return jsonify({'error': 'Permissions insuffisantes'}), 403


@messages_bp.route('/api/messages/<int:message_id>/pin', methods=['POST'])
@login_required
def toggle_pin(message_id):
    """Épingler/désépingler un message (admin uniquement pour les salons)."""
    message = Message.query.get_or_404(message_id)
    if not message.salon_id:
        return jsonify({'error': 'Seuls les messages en salon peuvent être épinglés'}), 400

    channel = Channel.query.get(message.salon_id)
    if not is_admin(session['user_id'], channel.serveur_id):
        return jsonify({'error': 'Permissions insuffisantes'}), 403

    message.est_epingle = not bool(message.est_epingle)
    db.session.commit()
    return jsonify({
        'message': 'Épinglé' if message.est_epingle else 'Désépinglé',
        'est_epingle': bool(message.est_epingle)
    }), 200


@messages_bp.route('/api/channels/<int:channel_id>/pinned', methods=['GET'])
@login_required
def get_pinned(channel_id):
    """Liste les messages épinglés d'un salon."""
    channel = Channel.query.get_or_404(channel_id)
    if not is_member(session['user_id'], channel.serveur_id):
        return jsonify({'error': 'Accès refusé'}), 403

    messages = Message.query.filter_by(
        salon_id=channel_id, est_epingle=True
    ).order_by(Message.horodatage.desc()).all()

    return jsonify([{
        'id': m.id,
        'contenu_chiffre': m.contenu_chiffre,
        'auteur_id': m.auteur_id,
        'auteur_pseudo': m.auteur.pseudo,
        'horodatage': m.horodatage.isoformat()
    } for m in messages]), 200


@messages_bp.route('/api/channels/<int:channel_id>/search', methods=['GET'])
@login_required
def search_messages(channel_id):
    """Recherche de messages par mots-clés côté serveur.
    Note : avec E2E, la recherche réelle se fera côté client sur les messages
    déchiffrés localement. Ici, c'est un fallback sur le ciphertext."""
    channel = Channel.query.get_or_404(channel_id)
    if not is_member(session['user_id'], channel.serveur_id):
        return jsonify({'error': 'Accès refusé'}), 403

    query = request.args.get('q', '').strip()
    if not query:
        return jsonify([]), 200

    messages = Message.query.filter(
        Message.salon_id == channel_id,
        Message.contenu_chiffre.like(f'%{query}%')
    ).order_by(Message.horodatage.desc()).limit(20).all()

    return jsonify([{
        'id': m.id,
        'contenu_chiffre': m.contenu_chiffre,
        'auteur_id': m.auteur_id,
        'auteur_pseudo': m.auteur.pseudo,
        'horodatage': m.horodatage.isoformat()
    } for m in messages]), 200