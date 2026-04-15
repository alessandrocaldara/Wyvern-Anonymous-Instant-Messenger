"""
Extensions partagées par toute l'application.
Ce fichier évite les imports circulaires : models.py et app.py
importent tous les deux depuis ici, sans dépendre l'un de l'autre.
"""
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO

db = SQLAlchemy()
socketio = SocketIO(cors_allowed_origins="*")
