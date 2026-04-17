"""
routes pour profil utilisateur
"""
from flask import Blueprint, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash
from extensions import db
from models import User
from routes.auth import login_required

users_bp = Blueprint('users', __name__)

@users_bp.route('/api/users/me', methods=['PUT'])
@login_required
def update_profile():
    """Modifier son profil. Tous les champs sont optionnels.
    Pour changer le mot de passe, il faut aussi fournir current_password"""
    user = User.query.get(session['user_id'])
    if not user:
        return jsonify({'error': 'Utilisateur introuvable'}), 404

    data = request.get_json() or {}

    #modifier username
    if 'pseudo' in data:
        new_pseudo = data['pseudo'].strip()
        if not new_pseudo:
            return jsonify({'error': 'Le pseudo ne peut pas être vide'}), 400
        if len(new_pseudo) < 3 or len(new_pseudo) > 50:
            return jsonify({'error': 'Le pseudo doit faire entre 3 et 50 caractères'}), 400
        if new_pseudo != user.pseudo:
            # Vérifier l'unicité
            if User.query.filter_by(pseudo=new_pseudo).first():
                return jsonify({'error': 'Ce pseudo est déjà pris'}), 409
            user.pseudo = new_pseudo
            session['pseudo'] = new_pseudo  # Mettre à jour la session

    #modifier ou ajouter ou supprimer email
    if 'email' in data:
        new_email = data['email']
        if new_email is None or new_email == '':
            user.email = None  # Permet de retirer l'email
        else:
            new_email = new_email.strip()
            if len(new_email) > 100:
                return jsonify({'error': 'Email trop long (max 100)'}), 400
            #validation basique
            if '@' not in new_email or '.' not in new_email:
                return jsonify({'error': 'Email invalide'}), 400
            user.email = new_email

    #changement pdp
    if 'photo_profil' in data:
        photo = data['photo_profil']
        if photo is None or photo == '':
            user.photo_profil = None
        else:
            photo = photo.strip()
            if len(photo) > 255:
                return jsonify({'error': 'URL de photo trop longue (max 255)'}), 400
            user.photo_profil = photo

    #changement mdp
    if 'new_password' in data:
        new_password = data.get('new_password', '')
        current_password = data.get('current_password', '')

        if len(new_password) < 6:
            return jsonify({'error': 'Le nouveau mot de passe doit faire au moins 6 caractères'}), 400
        if not current_password:
            return jsonify({'error': 'Mot de passe actuel requis pour le changer'}), 400
        if not check_password_hash(user.mot_de_passe_hash, current_password):
            return jsonify({'error': 'Mot de passe actuel incorrect'}), 401

        user.mot_de_passe_hash = generate_password_hash(new_password)

    db.session.commit()

    return jsonify({
        'message': 'Profil mis à jour',
        'user_id': user.id,
        'pseudo': user.pseudo,
        'email': user.email,
        'photo_profil': user.photo_profil
    }), 200


@users_bp.route('/api/users/search', methods=['GET'])
@login_required
def search_users():
    """chercher un utilisateur par pseudo pour mp"""
    query = request.args.get('q', '').strip()
    if not query or len(query) < 2:
        return jsonify([]), 200

    #chercher jusqu'à 10 résultats, exclure self
    users = User.query\
        .filter(User.pseudo.like(f'%{query}%'))\
        .filter(User.id != session['user_id'])\
        .limit(10).all()
    return jsonify([{
        'id': u.id,
        'pseudo': u.pseudo,
        'photo_profil': u.photo_profil
    } for u in users]), 200

@users_bp.route('/api/users/<int:user_id>', methods=['GET'])
@login_required
def get_user(user_id):
    """infos publiques d'un user"""
    user = User.query.get_or_404(user_id)
    return jsonify({
        'id': user.id,
        'pseudo': user.pseudo,
        'photo_profil': user.photo_profil,
        'created_at': user.created_at.isoformat()
    }), 200