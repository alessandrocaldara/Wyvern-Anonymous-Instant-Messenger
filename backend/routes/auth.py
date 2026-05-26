"""
Routes d'authentification pour Wyvern
Inscription avec génération de code 16 chiffres (style Mullvad)
Login par pseudo OU par code 16 chiffres
logout
/me pour test
"""
import random
import string
from functools import wraps
from flask import Blueprint, request, jsonify, session, render_template
from werkzeug.security import generate_password_hash, check_password_hash
from extensions import db
from models import User

auth_bp = Blueprint('auth', __name__)


#Décorateur réutilisable 
def login_required(f):
    """Décorateur : refuse l'accès si l'utilisateur n'est pas connecté."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Non authentifié'}), 401
        return f(*args, **kwargs)
    return decorated


#Helpers
def generate_code_16():
    """Génère un code unique de 16 chiffres"""
    while True:
        code = ''.join(random.choices(string.digits, k=16))
        if not User.query.filter_by(code_16_chiffres=code).first():
            return code


# ── Routes ───────────────────────────────────────────────────────────

@auth_bp.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'GET':
        return render_template('register.html')

    data = request.get_json()
    pseudo = data.get('pseudo', '').strip()
    password = data.get('password', '')
    email = (data.get('email') or '').strip() or None #email est optionnel

    # Validation
    if not pseudo or not password:
        return jsonify({'error': 'Pseudo et mot de passe requis'}), 400

    if len(pseudo) < 3 or len(pseudo) > 50:
        return jsonify({'error': 'Le pseudo doit faire entre 3 et 50 caracteres'}), 400

    if len(password) < 6:
        return jsonify({'error': 'Le mot de passe doit faire au moins 6 caracteres'}), 400

    if User.query.filter_by(pseudo=pseudo).first():
        return jsonify({'error': 'Ce pseudo est déjà pris'}), 409

    #clés E2E (générées côté client, transmises à l'inscription)
    cle_publique = data.get('cle_publique')
    cle_privee_chiffree = data.get('cle_privee_chiffree')

    #création du compte
    code = generate_code_16()
    user = User(
        pseudo=pseudo,
        mot_de_passe_hash=generate_password_hash(password),
        code_16_chiffres=code,
        email=email,
        cle_publique=cle_publique,
        cle_privee_chiffree=cle_privee_chiffree
    )
    db.session.add(user)
    db.session.commit()

    return jsonify({
        'message': 'Compte créé avec succès!!',
        'code_16_chiffres': code,
        'user_id': user.id
    }), 201


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        return render_template('login.html')

    data = request.get_json()
    identifier = data.get('identifier', '').strip()
    password = data.get('password', '')

    if not identifier or not password:
        return jsonify({'error': 'identifiant et mot de passe requis'}), 400

    # Chercher par pseudo d'abord, puis par code 16 chiffres
    user = User.query.filter_by(pseudo=identifier).first()
    if not user:
        user = User.query.filter_by(code_16_chiffres=identifier).first()

    if not user or not check_password_hash(user.mot_de_passe_hash, password):
        return jsonify({'error': 'Identifiants incorrects'}), 401

    # Stocker en session
    session['user_id'] = user.id
    session['pseudo'] = user.pseudo

    return jsonify({
        'message': 'Connexion réussie!!',
        'user_id': user.id,
        'pseudo': user.pseudo,
        'cle_privee_chiffree': user.cle_privee_chiffree
    }), 200


@auth_bp.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': 'Déconnexion réussie!!'}), 200


@auth_bp.route('/me', methods=['GET'])
@login_required
def me():
    """Retourne les infos de l'utilisateur connecté."""
    user = User.query.get(session['user_id'])
    if not user:
        session.clear()
        return jsonify({'error': 'Utilisateur introuvable'}), 404

    return jsonify({
        'user_id': user.id,
        'pseudo': user.pseudo,
        'code_16_chiffres': user.code_16_chiffres,
        'email': user.email,
        'photo_profil': user.photo_profil,
        'created_at': user.created_at.isoformat()
    }), 200
