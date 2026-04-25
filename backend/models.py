"""
Modèles SQLAlchemy pour Wyvern.
Chaque classe correspond à une table dans db_wyvern.sql.
"""
from datetime import datetime
from extensions import db


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    pseudo = db.Column(db.String(50), unique=True, nullable=False)
    mot_de_passe_hash = db.Column(db.String(255), nullable=False)
    code_16_chiffres = db.Column(db.String(16), unique=True, nullable=False)
    email = db.Column(db.String(100), nullable=True)
    photo_profil = db.Column(db.String(255), nullable=True)
    cle_publique = db.Column(db.Text, nullable=True)
    cle_privee_chiffree = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f'<User {self.pseudo}>'


class Server(db.Model):
    __tablename__ = 'servers'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    nom = db.Column(db.String(100), nullable=False)
    code_invitation = db.Column(db.String(10), unique=True, nullable=False)
    proprietaire_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relations
    proprietaire = db.relationship('User', backref='owned_servers')
    channels = db.relationship('Channel', backref='server', cascade='all, delete-orphan')
    permissions = db.relationship('Permission', backref='server', cascade='all, delete-orphan')
    bans = db.relationship('ServerBan', backref='server', cascade='all, delete-orphan')

    def __repr__(self):
        return f'<Server {self.nom}>'


class Channel(db.Model):
    __tablename__ = 'channels'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    nom = db.Column(db.String(70), nullable=False)
    serveur_id = db.Column(
        db.Integer,
        db.ForeignKey('servers.id', ondelete='CASCADE'),
        nullable=False
    )
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    type = db.Column(db.Enum('publique', 'prive'), nullable=False)

    # Relations
    messages = db.relationship('Message', backref='salon', cascade='all, delete-orphan')

    def __repr__(self):
        return f'<Channel #{self.nom}>'


class Message(db.Model):
    __tablename__ = 'messages'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    contenu_chiffre = db.Column(db.Text, nullable=False)
    auteur_id = db.Column(
        db.Integer,
        db.ForeignKey('users.id'),
        nullable=False
    )
    salon_id = db.Column(
        db.Integer,
        db.ForeignKey('channels.id', ondelete='CASCADE'),
        nullable=True
    )
    destinataire_id = db.Column(
        db.Integer,
        db.ForeignKey('users.id', ondelete='CASCADE'),
        nullable=True
    )
    horodatage = db.Column(db.DateTime, default=datetime.utcnow)
    est_epingle = db.Column(db.Boolean, default=False)
    iv_chiffrement = db.Column(db.String(24), nullable=True)
    cle_symetrique_chiffree = db.Column(db.Text, nullable=True)

    # Relations
    auteur = db.relationship(
        'User', foreign_keys=[auteur_id], backref='messages_envoyes'
    )
    destinataire = db.relationship(
        'User', foreign_keys=[destinataire_id], backref='messages_recus'
    )

    def __repr__(self):
        return f'<Message {self.id} by {self.auteur_id}>'


class Permission(db.Model):
    __tablename__ = 'permissions'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    utilisateur_id = db.Column(
        db.Integer,
        db.ForeignKey('users.id', ondelete='CASCADE'),
        nullable=False
    )
    serveur_id = db.Column(
        db.Integer,
        db.ForeignKey('servers.id', ondelete='CASCADE'),
        nullable=False
    )
    role = db.Column(db.Enum('admin', 'normal'), nullable=False)

    # Relations
    utilisateur = db.relationship('User', backref='permissions')

    # Contrainte d'unicité (un user = un rôle par serveur)
    __table_args__ = (
        db.UniqueConstraint('utilisateur_id', 'serveur_id'),
    )

    def __repr__(self):
        return f'<Permission user={self.utilisateur_id} role={self.role}>'


class ServerBan(db.Model):
    __tablename__ = 'server_bans'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    serveur_id = db.Column(
        db.Integer,
        db.ForeignKey('servers.id', ondelete='CASCADE'),
        nullable=False
    )
    utilisateur_id = db.Column(
        db.Integer,
        db.ForeignKey('users.id', ondelete='CASCADE'),
        nullable=False
    )
    raison_chiffree = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    date_fin = db.Column(db.DateTime, nullable=True)

    # Relations
    utilisateur = db.relationship('User', backref='bans')

    def __repr__(self):
        return f'<Ban user={self.utilisateur_id} server={self.serveur_id}>'


class Poll(db.Model):
    __tablename__ = 'polls'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    message_id = db.Column(
        db.Integer,
        db.ForeignKey('messages.id', ondelete='CASCADE'),
        nullable=False
    )
    question_chiffree = db.Column(db.Text, nullable=False)
    date_fin = db.Column(db.DateTime, nullable=True)

    # Relations
    message = db.relationship('Message', backref='poll')
    options = db.relationship('PollOption', backref='poll', cascade='all, delete-orphan')

    def __repr__(self):
        return f'<Poll {self.id}>'


class PollOption(db.Model):
    __tablename__ = 'poll_options'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    poll_id = db.Column(
        db.Integer,
        db.ForeignKey('polls.id', ondelete='CASCADE'),
        nullable=False
    )
    texte_option_chiffree = db.Column(db.Text, nullable=False)

    # Relations
    votes = db.relationship('PollVote', backref='option', cascade='all, delete-orphan')

    def __repr__(self):
        return f'<PollOption {self.id}>'


class PollVote(db.Model):
    __tablename__ = 'poll_votes'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    utilisateur_id = db.Column(
        db.Integer,
        db.ForeignKey('users.id', ondelete='CASCADE'),
        nullable=False
    )
    option_id = db.Column(
        db.Integer,
        db.ForeignKey('poll_options.id', ondelete='CASCADE'),
        nullable=False
    )

    # Contrainte : un user ne peut voter qu'une fois par option
    __table_args__ = (
        db.UniqueConstraint('utilisateur_id', 'option_id'),
    )

    def __repr__(self):
        return f'<PollVote user={self.utilisateur_id} option={self.option_id}>'