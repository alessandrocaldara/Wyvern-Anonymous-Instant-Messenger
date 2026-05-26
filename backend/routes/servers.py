import random
import string
from datetime import datetime
from flask import Blueprint, request, jsonify, session
from extensions import db
from models import Server, Permission, Channel, ServerBan, User
from routes.auth import login_required

servers_bp = Blueprint('servers', __name__)


def generate_invite_code():
    """Génère un code d'invitation alphanumérique de 8 caractères."""
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
        if not Server.query.filter_by(code_invitation=code).first():
            return code


@servers_bp.route('/api/servers', methods=['POST'])
@login_required
def create_server():
    """Crée un nouveau serveur. Le créateur devient propriétaire et admin."""
    data = request.get_json()
    nom = data.get('nom', '').strip()

    if not nom:
        return jsonify({'error': 'Nom du serveur requis'}), 400
    if len(nom) > 100:
        return jsonify({'error': 'Le nom ne doit pas dépasser 100 caractères'}), 400

    # Créer le serveur
    server = Server(
        nom=nom,
        code_invitation=generate_invite_code(),
        proprietaire_id=session['user_id']
    )
    db.session.add(server)
    db.session.flush()  # Pour obtenir l'ID avant le commit

    # Le créateur devient admin automatiquement
    perm = Permission(
        utilisateur_id=session['user_id'],
        serveur_id=server.id,
        role='admin'
    )
    db.session.add(perm)

    # Créer un salon "général" par défaut
    general = Channel(nom='général', serveur_id=server.id, type='publique')
    db.session.add(general)

    db.session.commit()

    return jsonify({
        'message': 'Serveur créé',
        'server_id': server.id,
        'nom': server.nom,
        'code_invitation': server.code_invitation
    }), 201


@servers_bp.route('/api/servers/join', methods=['POST'])
@login_required
def join_server():
    """Rejoindre un serveur via son code d'invitation."""
    data = request.get_json()
    code = data.get('code_invitation', '').strip().upper()

    server = Server.query.filter_by(code_invitation=code).first()
    if not server:
        return jsonify({'error': "Code d'invitation invalide"}), 404

    # Vérifier si l'utilisateur est banni
    ban = ServerBan.query.filter_by(
        serveur_id=server.id,
        utilisateur_id=session['user_id']
    ).first()
    if ban and (ban.date_fin is None or ban.date_fin > datetime.utcnow()):
        return jsonify({'error': 'Vous êtes banni de ce serveur'}), 403

    # Vérifier si déjà membre
    existing = Permission.query.filter_by(
        utilisateur_id=session['user_id'],
        serveur_id=server.id
    ).first()
    if existing:
        return jsonify({'error': 'Vous êtes déjà membre de ce serveur'}), 409

    # Ajouter comme membre normal
    perm = Permission(
        utilisateur_id=session['user_id'],
        serveur_id=server.id,
        role='normal'
    )
    db.session.add(perm)
    db.session.commit()

    return jsonify({
        'message': f'Vous avez rejoint {server.nom}',
        'server_id': server.id,
        'nom': server.nom
    }), 200


@servers_bp.route('/api/servers', methods=['GET'])
@login_required
def get_my_servers():
    """Liste les serveurs dont l'utilisateur est membre."""
    perms = Permission.query.filter_by(utilisateur_id=session['user_id']).all()
    servers = []
    for p in perms:
        s = Server.query.get(p.serveur_id)
        if s:
            servers.append({
                'id': s.id,
                'nom': s.nom,
                'role': p.role,
                'is_owner': s.proprietaire_id == session['user_id'],
                'code_invitation': s.code_invitation if s.proprietaire_id == session['user_id'] or p.role == 'admin' else None,
                'created_at': s.created_at.isoformat()
            })
    return jsonify(servers), 200


@servers_bp.route('/api/servers/<int:server_id>', methods=['GET'])
@login_required
def get_server(server_id):
    """Retourne les détails d'un serveur."""
    server = Server.query.get_or_404(server_id)

    # Vérifier que l'utilisateur est membre
    perm = Permission.query.filter_by(
        utilisateur_id=session['user_id'],
        serveur_id=server_id
    ).first()
    if not perm:
        return jsonify({'error': 'Vous n\'êtes pas membre de ce serveur'}), 403

    return jsonify({
        'id': server.id,
        'nom': server.nom,
        'proprietaire_id': server.proprietaire_id,
        'code_invitation': server.code_invitation if perm.role == 'admin' else None,
        'role': perm.role,
        'is_owner': server.proprietaire_id == session['user_id']
    }), 200


@servers_bp.route('/api/servers/<int:server_id>', methods=['DELETE'])
@login_required
def delete_server(server_id):
    """Supprime un serveur (propriétaire uniquement)."""
    server = Server.query.get_or_404(server_id)
    if server.proprietaire_id != session['user_id']:
        return jsonify({'error': 'Seul le propriétaire peut supprimer le serveur'}), 403

    db.session.delete(server)
    db.session.commit()
    return jsonify({'message': 'Serveur supprimé'}), 200


@servers_bp.route('/api/servers/<int:server_id>/members', methods=['GET'])
@login_required
def get_members(server_id):
    """Liste les membres d'un serveur."""
    # Vérifier que l'utilisateur est membre
    perm = Permission.query.filter_by(
        utilisateur_id=session['user_id'],
        serveur_id=server_id
    ).first()
    if not perm:
        return jsonify({'error': 'Accès refusé'}), 403

    perms = Permission.query.filter_by(serveur_id=server_id).all()
    members = []
    for p in perms:
        members.append({
            'user_id': p.utilisateur.id,
            'pseudo': p.utilisateur.pseudo,
            'role': p.role
        })
    return jsonify(members), 200


@servers_bp.route('/api/servers/<int:server_id>/members_keys', methods=['GET'])
@login_required
def get_members_keys(server_id):
    """Liste des clés publiques de tous les membres (pour chiffrement E2E salon)."""
    perm = Permission.query.filter_by(
        utilisateur_id=session['user_id'],
        serveur_id=server_id
    ).first()
    if not perm:
        return jsonify({'error': 'Accès refusé'}), 403

    perms = Permission.query.filter_by(serveur_id=server_id).all()
    members_keys = []
    for p in perms:
        user = User.query.get(p.utilisateur_id)
        if user and user.cle_publique:
            members_keys.append({
                'user_id': user.id,
                'cle_publique': user.cle_publique
            })
    return jsonify(members_keys), 200


@servers_bp.route('/api/servers/<int:server_id>/members/<int:user_id>/role', methods=['PUT'])
@login_required
def change_role(server_id, user_id):
    """Nommer ou destituer un admin (propriétaire uniquement)."""
    server = Server.query.get_or_404(server_id)
    if server.proprietaire_id != session['user_id']:
        return jsonify({'error': 'Seul le propriétaire peut changer les rôles'}), 403

    data = request.get_json()
    new_role = data.get('role')
    if new_role not in ('admin', 'normal'):
        return jsonify({'error': 'Rôle invalide'}), 400

    perm = Permission.query.filter_by(
        utilisateur_id=user_id,
        serveur_id=server_id
    ).first()
    if not perm:
        return jsonify({'error': 'Utilisateur non membre du serveur'}), 404

    perm.role = new_role
    db.session.commit()
    return jsonify({'message': f'Rôle mis à jour : {new_role}'}), 200


@servers_bp.route('/api/servers/<int:server_id>/members/<int:user_id>', methods=['DELETE'])
@login_required
def kick_member(server_id, user_id):
    """Expulser un membre (admin/propriétaire uniquement)."""
    # Vérifier permissions
    my_perm = Permission.query.filter_by(
        utilisateur_id=session['user_id'],
        serveur_id=server_id
    ).first()
    if not my_perm or my_perm.role != 'admin':
        return jsonify({'error': 'Permissions insuffisantes'}), 403

    server = Server.query.get_or_404(server_id)
    if user_id == server.proprietaire_id:
        return jsonify({'error': 'Impossible d\'expulser le propriétaire'}), 403

    perm = Permission.query.filter_by(
        utilisateur_id=user_id,
        serveur_id=server_id
    ).first()
    if not perm:
        return jsonify({'error': 'Utilisateur non membre'}), 404

    db.session.delete(perm)
    db.session.commit()
    return jsonify({'message': 'Membre expulsé'}), 200


@servers_bp.route('/api/servers/<int:server_id>/ban/<int:user_id>', methods=['POST'])
@login_required
def ban_member(server_id, user_id):
    """Bannir un membre (admin/propriétaire uniquement)."""
    my_perm = Permission.query.filter_by(
        utilisateur_id=session['user_id'],
        serveur_id=server_id
    ).first()
    if not my_perm or my_perm.role != 'admin':
        return jsonify({'error': 'Permissions insuffisantes'}), 403

    server = Server.query.get_or_404(server_id)
    if user_id == server.proprietaire_id:
        return jsonify({'error': 'Impossible de bannir le propriétaire'}), 403

    data = request.get_json() or {}
    raison = data.get('raison', '')

    # Supprimer d'abord la permission (kick)
    perm = Permission.query.filter_by(
        utilisateur_id=user_id,
        serveur_id=server_id
    ).first()
    if perm:
        db.session.delete(perm)

    # Ajouter le ban
    ban = ServerBan(
        serveur_id=server_id,
        utilisateur_id=user_id,
        raison_chiffree=raison
    )
    db.session.add(ban)
    db.session.commit()
    return jsonify({'message': 'Membre banni'}), 200
