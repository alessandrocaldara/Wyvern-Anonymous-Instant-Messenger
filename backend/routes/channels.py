from flask import Blueprint, request, jsonify, session
from extensions import db
from models import Channel, Permission, Server
from routes.auth import login_required

channels_bp = Blueprint('channels', __name__)


def is_admin(user_id, server_id):
    """Retourne True si user est propriétaire ou admin du serveur."""
    server = Server.query.get(server_id)
    if server and server.proprietaire_id == user_id:
        return True
    perm = Permission.query.filter_by(
        utilisateur_id=user_id, serveur_id=server_id
    ).first()
    return perm is not None and perm.role == 'admin'


def is_member(user_id, server_id):
    """Retourne True si user est membre du serveur."""
    perm = Permission.query.filter_by(
        utilisateur_id=user_id, serveur_id=server_id
    ).first()
    return perm is not None


@channels_bp.route('/api/servers/<int:server_id>/channels', methods=['GET'])
@login_required
def get_channels(server_id):
    """Liste les salons d'un serveur."""
    user_id = session['user_id']

    #vérifier si l'utilisateur a le droit d'être ici
    if not is_member(user_id, server_id):
        return jsonify({'error': 'Accès refusé'}), 403
    #filtrer les salons selon le rôle de l'utilisateur
    if is_admin(user_id, server_id):
        #les admins voient TOUT
        channels = Channel.query.filter_by(serveur_id=server_id).all()
    else:
        #les membres normaux ne voient QUE les salons publics
        channels = Channel.query.filter_by(serveur_id=server_id, type='publique').all()
    #renvoyer les données filtrées au frontend
    return jsonify([{
        'id': c.id,
        'nom': c.nom,
        'type': c.type,
        'serveur_id': c.serveur_id,
        'created_at': c.created_at.isoformat()
    } for c in channels]), 200


@channels_bp.route('/api/servers/<int:server_id>/channels', methods=['POST'])
@login_required
def create_channel(server_id):
    """Crée un salon dans un serveur (admin uniquement)."""
    if not is_admin(session['user_id'], server_id):
        return jsonify({'error': 'Permissions insuffisantes'}), 403

    data = request.get_json()
    nom = data.get('nom', '').strip()
    type_ = data.get('type', 'publique')

    if not nom:
        return jsonify({'error': 'Nom du salon requis'}), 400
    if len(nom) > 70:
        return jsonify({'error': 'Le nom ne doit pas dépasser 70 caractères'}), 400
    if type_ not in ('publique', 'prive'):
        return jsonify({'error': 'Type invalide'}), 400

    channel = Channel(nom=nom, serveur_id=server_id, type=type_)
    db.session.add(channel)
    db.session.commit()
    return jsonify({
        'message': 'Salon créé',
        'channel_id': channel.id,
        'nom': channel.nom,
        'type': channel.type
    }), 201


@channels_bp.route('/api/channels/<int:channel_id>', methods=['PUT'])
@login_required
def update_channel(channel_id):
    """Modifie un salon (admin uniquement)."""
    channel = Channel.query.get_or_404(channel_id)
    if not is_admin(session['user_id'], channel.serveur_id):
        return jsonify({'error': 'Permissions insuffisantes'}), 403

    data = request.get_json()
    if 'nom' in data:
        nom = data['nom'].strip()
        if not nom or len(nom) > 70:
            return jsonify({'error': 'Nom invalide'}), 400
        channel.nom = nom
    if 'type' in data:
        if data['type'] not in ('publique', 'prive'):
            return jsonify({'error': 'Type invalide'}), 400
        channel.type = data['type']
    db.session.commit()
    return jsonify({'message': 'Salon modifié'}), 200


@channels_bp.route('/api/channels/<int:channel_id>', methods=['DELETE'])
@login_required
def delete_channel(channel_id):
    """Supprime un salon (admin uniquement)."""
    channel = Channel.query.get_or_404(channel_id)
    if not is_admin(session['user_id'], channel.serveur_id):
        return jsonify({'error': 'Permissions insuffisantes'}), 403
    db.session.delete(channel)
    db.session.commit()
    return jsonify({'message': 'Salon supprimé'}), 200