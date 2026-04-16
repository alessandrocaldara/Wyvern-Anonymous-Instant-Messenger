import random
import string
from flask import Blueprint, request, jsonify, session
from models import Server, Permission, Channel, ServerBan
from app import db

from backend.models import Server

servers_bp = Blueprint('servers', __name__)
def login_required(f):
    """Pour vérifier que l'utilisateur est connecté"""
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'non-authentifié'}), 401
        return f(*args, **kwargs)
    return decorated

def generate_invite_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))

@servers_bp.route('/api/servers', methods=['POST'])
@login_required
def create_server():
    data = request.get_json()
    nom = data.get('nom')
    if not nom:
        return jsonify({'error': 'nom est requis'}), 400
    server = Server(
        nom = nom,
        code = generate_invite_code(),
        proprietaire_id=session['user_id'],
    )
    db.session.add(server)
    db.session.flush() #pour avoir l'id
    perm = Permission(
        utilisateur_id=session['user_id'],
        serveur_id=server.id,
        role='admin'
    )
    db.session.add(perm)

    general = Channel(nom='general', serveur_id=server.id, type='publique')
    db.session.add(general)

    db.session.commit()

    return jsonify({'message': 'serveur créé', server_id: server.id, 'code_invitation': server.code_invitation}), 201

@servers_bp.route('/api/servers/join', methods=['POST'])
@login_required
def join_server():
    data = request.get_json()
    code = data.get('code_invitation')
    server = Server.query.filter_by(code_invitation=code).first()
    if not server:
        return jsonify({'error': 'code d\'invitation invalide'}), 404
    ban = ServerBan.query.filter_by( #verifier si banni
        serveur_id=server.id,
        utilisateur_id=session['user_id']
    ).first()
    if ban and (ban.date_fin is None or ban.date_fin > db.func.now()):
        return jsonify({'error': 'Vous êtes banni de ce serveur'}), 403
    existing = Permission.query.filter_by( #verifier si déjà membre
        utilisateur_id=session['user_id'],
        serveur_id=server.id
    ).first()
    if existing:
        return jsonify({'error': 'Vous êtes déjà membre'}), 409
    perm = Permission(
        utilisateur_id=session['user_id'],
        serveur_id=server.id,
        role='normal'
    )
    db.session.add(perm)
    db.session.commit()
    return jsonify({'message': f'Vous avez rejoint {server.nom}'}), 200

@servers_bp.route('/api/servers', methods=['GET'])
@login_required
def get_my_servers():
    """liste les serveurs dont l'utilisateur est membre"""
    perms = Permission.query.filter_by(utilisateur_id=session['user_id']).all()
    servers = []
    for p in perms:
        s = Server.query.get(p.serveur_id)
        servers.append({
            'id': s.id,
            'nom': s.nom,
            'role': p.role,
            'is_owner': s.proprietaire_id == session['user_id'],
            'code_invitation': s.code_invitation if s.proprietaire_id == session['user_id'] else None
        })
    return jsonify(servers), 200

@servers_bp.route('/api/servers/<int:server_id>', methods=['DELETE'])
@login_required
def delete_server(server_id):
    server = Server.query.get_or_404(server_id)
    if server.proprietaire_id != session['user_id']:
        return jsonify({'error': 'Seul le propriétaire peut supprimer le serveur'}), 403
    db.session.delete(server)
    db.session.commit()
    return jsonify({'message': 'Serveur supprimé'}), 200

