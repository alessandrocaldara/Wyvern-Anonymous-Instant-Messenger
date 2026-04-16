from flask import session
from flask_socketio import emit, join_room, leave_room
from extensions import socketio, db
from models import Message, Permission, Channel


@socketio.on('connect')
def handle_connect():
    """Refuse la connexion si l'utilisateur n'est pas authentifié."""
    if 'user_id' not in session:
        return False
    print(f"[WS] {session.get('pseudo')} connecté")
    # Chaque utilisateur rejoint sa propre room (pour les DM)
    join_room(f'user_{session["user_id"]}')


@socketio.on('disconnect')
def handle_disconnect():
    print(f"[WS] {session.get('pseudo', 'anonyme')} déconnecté")


@socketio.on('join_channel')
def handle_join_channel(data):
    """Rejoindre un salon pour recevoir ses messages en temps réel."""
    channel_id = data.get('channel_id')
    if not channel_id:
        return
    channel = Channel.query.get(channel_id)
    if not channel:
        return
    # Vérifier que l'utilisateur est membre du serveur
    perm = Permission.query.filter_by(
        utilisateur_id=session['user_id'],
        serveur_id=channel.serveur_id
    ).first()
    if not perm:
        emit('error', {'message': 'Accès refusé au salon'})
        return

    room = f'channel_{channel_id}'
    join_room(room)
    emit('joined_channel', {'channel_id': channel_id})


@socketio.on('leave_channel')
def handle_leave_channel(data):
    channel_id = data.get('channel_id')
    if channel_id:
        leave_room(f'channel_{channel_id}')


@socketio.on('send_message')
def handle_send_message(data):
    """Envoi d'un message dans un salon (broadcast à tous les membres du salon)."""
    contenu = data.get('contenu_chiffre')
    channel_id = data.get('channel_id')

    if not contenu or not channel_id:
        emit('error', {'message': 'Données manquantes'})
        return

    channel = Channel.query.get(channel_id)
    if not channel:
        emit('error', {'message': 'Salon introuvable'})
        return

    # Vérifier l'appartenance au serveur
    perm = Permission.query.filter_by(
        utilisateur_id=session['user_id'],
        serveur_id=channel.serveur_id
    ).first()
    if not perm:
        emit('error', {'message': 'Accès refusé'})
        return

    # Enregistrer en BDD
    msg = Message(
        contenu_chiffre=contenu,
        auteur_id=session['user_id'],
        salon_id=channel_id
    )
    db.session.add(msg)
    db.session.commit()

    # Broadcast aux membres du salon
    emit('new_message', {
        'id': msg.id,
        'contenu_chiffre': msg.contenu_chiffre,
        'auteur_id': msg.auteur_id,
        'auteur_pseudo': session['pseudo'],
        'channel_id': channel_id,
        'horodatage': msg.horodatage.isoformat(),
        'est_epingle': False
    }, room=f'channel_{channel_id}')


@socketio.on('send_dm')
def handle_send_dm(data):
    """Envoi d'un message privé (DM) à un autre utilisateur."""
    contenu = data.get('contenu_chiffre')
    destinataire_id = data.get('destinataire_id')

    if not contenu or not destinataire_id:
        emit('error', {'message': 'Données manquantes'})
        return

    msg = Message(
        contenu_chiffre=contenu,
        auteur_id=session['user_id'],
        destinataire_id=destinataire_id
    )
    db.session.add(msg)
    db.session.commit()

    # Envoyer à l'expéditeur ET au destinataire (chacun a sa propre room)
    payload = {
        'id': msg.id,
        'contenu_chiffre': msg.contenu_chiffre,
        'auteur_id': msg.auteur_id,
        'auteur_pseudo': session['pseudo'],
        'destinataire_id': destinataire_id,
        'horodatage': msg.horodatage.isoformat()
    }
    emit('new_dm', payload, room=f'user_{destinataire_id}')
    emit('new_dm', payload, room=f'user_{session["user_id"]}')


@socketio.on('typing')
def handle_typing(data):
    """Indicateur 'en train d'écrire' (non persistant)."""
    channel_id = data.get('channel_id')
    if channel_id:
        emit('user_typing', {
            'pseudo': session.get('pseudo'),
            'user_id': session['user_id']
        }, room=f'channel_{channel_id}', include_self=False)