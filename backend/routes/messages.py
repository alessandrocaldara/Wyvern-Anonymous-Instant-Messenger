from flask import Blueprint, request, jsonify, session
from models import Message, Channel, Permission
from app import db
from routes.servers import login_required
from routes.channels import is_admin

messages_bp = Blueprint('messages', __name__)

@messages_bp.route('/api/channels/<int:channel_id>/messages', methods=['GET'])
@login_required

def get_messages(channel_id):
    """Récupère l'historique des messages d'un salon."""
    limit = request.args.get('limit', 50, type=int)
    offset = request.args.get('offset', 0, type=int)
    
    messages = Message.query.filter_by(salon_id=channel_id)\
        .order_by(Message.horodatage.asc())\
        .offset(offset).limit(limit).all()
    return jsonify([{
        'id': m.id,
        'contenuchiffre': m.contenu_chiffre,
        'auteur_id': m.auteur_id,
        'auteur_pseudo': m.auteur.pseudo,
        'horodatage': m.horodatage.isoformat(),
        'est_epingle': m.est_epingle
    } for m in messages]), 200
        
@messages_bp.route('/api/dm/<int:other_user_id>/messages', methods=['GET'])
@login_required

def get_dm(other_user_id):
    """Récupère les messages privés entre deux utilisateurs."""
    uid = session['user_id']
    messages = Message.query.filter(
        Message.salon_id.is_(None),
        db.or_(
            db.and_(Message.auteur_id == uid, Message.destinataire_id == other_user_id),
            db.and_(Message.auteur_id == other_user_id, Message.destinataire_id == uid)
        )
    ).order_by(Message.horodatage.asc()).all()

    return jsonify([{
        'id': m.id,
        'contenuchiffre': m.contenu_chiffre,
        'auteur_id': m.auteur_id,
        'auteur_pseudo': m.auteur.pseudo,
        'horodatage': m.horodatage.isoformat()
    } for m in messages]), 200
    
@messages_bp.route('/api/messages/<int:message_id>', methods=['PUT'])
@login_required
def edit_message(message_id):
    message = Message.query.get_or_404(message_id)
    if message.auteur_id != session['user_id']:
        return jsonify({'error': 'Vous ne pouvez modifier que vos propres messages'}), 403
    data = request.get_json()
    message.contenu_chiffre = data.get('contenuchiffre', message.contenu_chiffre)
    db.session.commit()
    return jsonify({'message': 'Message modifié avec succès'}), 200

@messages_bp.route('/api/messages/<int:message_id>', methods=['DELETE'])
@login_required
def delete_message(message_id):
    message = Message.query.get_or_404(message_id)
    #L'auteur ou un admin peut supprimer le message
    if message.auteur_id != session['user_id']:
        if message.salon_id:
            channel = Channel.query.get(message.salon_id)
            if not is_admin(session['user_id'], channel.serveur_id):    
                return jsonify({'error': 'Vous ne pouvez supprimer que vos propres messages'}), 403
        
        else: 
            return jsonify({'error': 'Vous ne pouvez supprimer que vos propres messages'}), 403
        
    db.session.delete(message)
    db.session.commit()
    return jsonify({'message': 'Message supprimé avec succès'}), 200


@messages_bp.route('/api/messages/<int:message_id>/pin', methods=['POST'])
@login_required
def toggle_pin(message_id):
    message = Message.query.get_or_404(message_id)
    if message.salon_id:
        channel = Channel.query.get(message.salon_id)
        if not is_admin(session['user_id'], channel.serveur_id):
            return jsonify({'error': 'Permissions insuffisantes'}), 403
    message.est_epingle = not message.est_epingle
    db.session.commit()
    return jsonify({
        'message': 'Épinglé' if message.est_epingle else 'Désépinglé',
        'est_epingle': message.est_epingle
    }), 200

@messages_bp.route('/api/channels/<int:channel_id>/search', methods=['GET'])
@login_required
def search_messages(channel_id):
    query = request.args.get('q', '')
    if not query:
        return jsonify([]), 200
        #avec End-to-end on cherche coté client
    messages = Message.query.filter(
        Message.salon_id == channel_id,
        Message.contenu_chiffre.like(f'%{query}%')
    ).order_by(Message.horodatage.desc()).limit(20).all()
    
    return jsonify([{
        'id': m.id,
        'contenuchiffre': m.contenu_chiffre,
        'auteur_id': m.auteur_id,
        'auteur_pseudo': m.auteur.pseudo,
        'horodatage': m.horodatage.isoformat(),
    } for m in messages]), 200