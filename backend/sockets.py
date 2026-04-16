from flask_socketio import emit, join_room, leave_room
from flask import session
from app import socketio, db
from models import Message

@socketio.on('connect')
def handle_connect():
    if 'user_id' not in session:
        return False # Refuse la connexion
    print(f"Utilisateur {session['pseudo']} connecté (WebSocket)")
    
@socketio.on('join_channel')
def handle_join(data):
    channel_id = data.get('channel_id')
    room = f'channel_{channel_id}'
    join_room(room)
    emit('status', {
        'message': f"{session['pseudo']} a rejoint le salon!!"
    }, room=room)
    
@socketio.on('leave_channel')
def handle_leave(data):
    channel_id = data.get('channel_id')
    room = f'channel_{channel_id}'
    leave_room(room)

@socketio.on('send_message')
def handle_message(data):
    """Envoie un message dans un salon."""
    contenu = data.get('contenu_chiffre')
    channel_id = data.get('channel_ id')
    
    msg = Message(
        contenu_chiffre=contenu,
        auteur_id=session['user_id'],
        salon_id=channel_id
    )
    db.session.add(msg)
    db.session.commit()
    
    room = f'channel_{channel_id}'
    emit('new_message', {
        'id': msg.id,
        'contenu_chiffre': msg.contenu_chiffre,
        'auteur_id': msg.auteur_id,
        'auteur_pseudo': session['pseudo'],
        'horodatage': msg.horodatage.isoformat(),
        'est_epingle': False
    }, room=room)
    
@socketio.on('send_dm')
def handle_dm(data):
    """Envoie un message privé"""
    contenu = data.get('contenu_chiffre')
    destinataire_id = data.get('destinataire_id')
    msg = Message(
        contenu_chiffre=contenu,
        auteur_id=session['user_id'],
        destinataire_id=destinataire_id
    )
    db.session.add(msg)
    db.session.commit()
    
    #Envoyer à l'expéditeur et au destinataire
    msg_data = {
        'id': msg.id,
        'contenu_chiffre': msg.contenu_chiffre,
        'auteur_id': msg.auteur_id,
        'auteur_pseudo': session['pseudo'],
        'horodatage': msg.horodatage.isoformat()
    }
    emit('new_dm', msg_data, room=f'user_{destinataire_id}')
    emit('new_dm', msg_data, room=f'user_{session["user_id"]}')
    
@socketio.on('join_user_room')
def handle_join_user(data=None):
    """Chaque utilisateur rejoint sa propre room pour les DM"""
    join_room(f'user_{session["user_id"]}')