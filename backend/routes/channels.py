from flask import Blueprint, request, jsonify, session
from models import Channel, Permission, Server
from app import db
from routes.servers import login_required
channels_bp = Blueprint('channels', __name__)

def is_admin(user_id, server_id):
    """Vérifie si l'utilisateur est admin ou propriétaire du serveur."""
    server = Server.query.get(server_id)
    if server and server.proprietaire_id == user_id:
        return True
    perm = Permission.query.filter_by(
    utilisateur_id=user_id, serveur_id=server_id
    ).first()
    return perm and perm.role == 'admin'

@channels_bp.route('/api/servers/<int:server_id>/channels', methods=['GET'])
@login_required
def get_channels(server_id):
    channels = Channel.query.filter_by(serveur_id=server_id).all()
    return jsonify([{
    'id': c.id,
    'nom': c.nom,
    'type': c.type,
    'created_at': c.created_at.isoformat()
    } for c in channels]), 200

@channels_bp.route('/api/servers/<int:server_id>/channels', methods=['POST'])
@login_required
def create_channel(server_id):
    if not is_admin(session['user_id'], server_id):
        return jsonify({'error': 'Permissions insuffisantes'}), 403
    data = request.get_json()
    channel = Channel(
        nom=data.get('nom', 'nouveau-salon'),
        serveur_id=server_id,
        type=data.get('type', 'publique')
    )
    db.session.add(channel)
    db.session.commit()
    return jsonify({'message': 'Salon créé', 'channel_id': channel.id}), 201

@channels_bp.route('/api/channels/<int:channel_id>', methods=['PUT'])
@login_required
def update_channel(channel_id):
    channel = Channel.query.get_or_404(channel_id)
    if not is_admin(session['user_id'], channel.serveur_id):
        return jsonify({'error': 'Permissions insuffisantes'}), 403
    data = request.get_json()
    if 'nom' in data:
        channel.nom = data['nom']
    if 'type' in data:
        channel.type = data['type']
    db.session.commit()
    return jsonify({'message': 'Salon modifié'}), 200

@channels_bp.route('/api/channels/<int:channel_id>', methods=['DELETE'])
@login_required
def delete_channel(channel_id):
    channel = Channel.query.get_or_404(channel_id)
    if not is_admin(session['user_id'], channel.serveur_id):
        return jsonify({'error': 'Permissions insuffisantes'}), 403
    db.session.delete(channel)
    db.session.commit()
    return jsonify({'message': 'Salon supprimé'}), 200
