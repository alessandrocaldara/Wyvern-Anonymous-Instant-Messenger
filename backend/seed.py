import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from app import app
from extensions import db
from models import User, Server, Channel, Message, Permission, ServerBan, Poll, PollOption, PollVote
from werkzeug.security import generate_password_hash
import random
import string
from datetime import datetime, timedelta


def generate_code_16():
    while True:
        code = ''.join(random.choices(string.digits, k=16))
        if not User.query.filter_by(code_16_chiffres=code).first():
            return code


def generate_invite_code():
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
        if not Server.query.filter_by(code_invitation=code).first():
            return code


def seed():
    with app.app_context():
        print("Nettoyage de la base de données...")
        # Supprimer dans l'ordre pour respecter les FK
        PollVote.query.delete()
        PollOption.query.delete()
        Poll.query.delete()
        Message.query.delete()
        Channel.query.delete()
        ServerBan.query.delete()
        Permission.query.delete()
        Server.query.delete()
        User.query.delete()
        db.session.commit()
        print("Base nettoyée.")

        # ── Utilisateurs ────────────────────────────────────────────────
        print("\nCréation des utilisateurs...")

        mattias = User(
            pseudo='Mattias',
            mot_de_passe_hash=generate_password_hash('password123'),
            code_16_chiffres=generate_code_16(),
            email='mattias@wyvern.dev'
        )
        alessandro = User(
            pseudo='Alessandro',
            mot_de_passe_hash=generate_password_hash('password123'),
            code_16_chiffres=generate_code_16(),
            email='alessandro@wyvern.dev'
        )
        alice = User(
            pseudo='Alice',
            mot_de_passe_hash=generate_password_hash('password123'),
            code_16_chiffres=generate_code_16(),
        )
        bob = User(
            pseudo='Bob',
            mot_de_passe_hash=generate_password_hash('password123'),
            code_16_chiffres=generate_code_16(),
        )
        db.session.add_all([mattias, alessandro, alice, bob])
        db.session.flush()
        print(f"  Mattias (id={mattias.id})  code: {mattias.code_16_chiffres}")
        print(f"  Alessandro (id={alessandro.id})  code: {alessandro.code_16_chiffres}")
        print(f"  Alice (id={alice.id})  code: {alice.code_16_chiffres}")
        print(f"  Bob (id={bob.id})  code: {bob.code_16_chiffres}  [sera banni]")

        # ── Serveur ──────────────────────────────────────────────────────
        print("\nCréation du serveur...")
        server = Server(
            nom='Wyvern Dev Server',
            code_invitation='WYVERN01',
            proprietaire_id=mattias.id
        )
        db.session.add(server)
        db.session.flush()
        print(f"  Serveur '{server.nom}' (id={server.id})  invite: {server.code_invitation}")

        # ── Permissions ──────────────────────────────────────────────────
        print("\nAttribution des rôles...")
        perm_mattias = Permission(utilisateur_id=mattias.id, serveur_id=server.id, role='admin')
        perm_alessandro = Permission(utilisateur_id=alessandro.id, serveur_id=server.id, role='admin')
        perm_alice = Permission(utilisateur_id=alice.id, serveur_id=server.id, role='normal')
        db.session.add_all([perm_mattias, perm_alessandro, perm_alice])
        db.session.flush()
        print("  Mattias → propriétaire + admin")
        print("  Alessandro → admin")
        print("  Alice → normal")

        # ── Ban Bob ──────────────────────────────────────────────────────
        ban = ServerBan(
            serveur_id=server.id,
            utilisateur_id=bob.id,
            raison_chiffree='Comportement inapproprié (test)'
        )
        db.session.add(ban)
        db.session.flush()
        print("  Bob → banni du serveur")

        # ── Salons ───────────────────────────────────────────────────────
        print("\nCréation des salons...")
        ch_general = Channel(nom='général', serveur_id=server.id, type='publique')
        ch_dev = Channel(nom='développement', serveur_id=server.id, type='publique')
        ch_admins = Channel(nom='privé-admins', serveur_id=server.id, type='prive')
        db.session.add_all([ch_general, ch_dev, ch_admins])
        db.session.flush()
        print(f"  #général (id={ch_general.id})")
        print(f"  #développement (id={ch_dev.id})")
        print(f"  #privé-admins (id={ch_admins.id})")

        # ── Messages ─────────────────────────────────────────────────────
        print("\nCréation des messages...")
        now = datetime.utcnow()

        # #général
        msgs_general = [
            Message(contenu_chiffre="Bienvenue sur Wyvern Dev Server! ", auteur_id=mattias.id, salon_id=ch_general.id, horodatage=now - timedelta(hours=3)),
            Message(contenu_chiffre="Salut tout le monde! Content d'être là.", auteur_id=alice.id, salon_id=ch_general.id, horodatage=now - timedelta(hours=2, minutes=45)),
            Message(contenu_chiffre="Le backend Flask est opérationnel, on peut commencer les tests.", auteur_id=alessandro.id, salon_id=ch_general.id, horodatage=now - timedelta(hours=2, minutes=30)),
            Message(contenu_chiffre="Super ! J'ai testé le WebSocket, ça répond bien en temps réel.", auteur_id=mattias.id, salon_id=ch_general.id, horodatage=now - timedelta(hours=2)),
            Message(contenu_chiffre="La latence est bien en dessous des 200ms requis", auteur_id=alice.id, salon_id=ch_general.id, horodatage=now - timedelta(hours=1, minutes=30)),
        ]
        db.session.add_all(msgs_general)
        db.session.flush()

        # Épingler le premier message
        msgs_general[0].est_epingle = True
        print(f"  {len(msgs_general)} messages dans #général (1 épinglé)")

        # #développement
        msgs_dev = [
            Message(contenu_chiffre="SQLAlchemy + MySQL 8.0 configurés avec Docker Compose.", auteur_id=alessandro.id, salon_id=ch_dev.id, horodatage=now - timedelta(hours=5)),
            Message(contenu_chiffre="Flask-SocketIO gère bien les rooms, la logique de permissions est propre.", auteur_id=mattias.id, salon_id=ch_dev.id, horodatage=now - timedelta(hours=4)),
            Message(contenu_chiffre="J'ai ajouté la route PUT /api/users/me pour la gestion du profil.", auteur_id=mattias.id, salon_id=ch_dev.id, horodatage=now - timedelta(hours=1)),
            Message(contenu_chiffre="Les sondages sont prêts côté API, il reste l'UI.", auteur_id=alessandro.id, salon_id=ch_dev.id, horodatage=now - timedelta(minutes=30)),
        ]
        db.session.add_all(msgs_dev)
        db.session.flush()
        print(f"  {len(msgs_dev)} messages dans #développement")

        # #privé-admins
        msgs_admins = [
            Message(contenu_chiffre="On garde ce salon pour la coordination interne.", auteur_id=mattias.id, salon_id=ch_admins.id, horodatage=now - timedelta(hours=6)),
            Message(contenu_chiffre="Vu. Je m'occupe du seed et des sondages pour le CKPT 2.", auteur_id=alessandro.id, salon_id=ch_admins.id, horodatage=now - timedelta(hours=5, minutes=50)),
        ]
        db.session.add_all(msgs_admins)
        db.session.flush()
        print(f"  {len(msgs_admins)} messages dans #privé-admins")

        # ── DMs ──────────────────────────────────────────────────────────
        print("\nCréation des messages privés...")
        dm1 = Message(
            contenu_chiffre="Hey Alice, tu peux tester le code d'invitation WYVERN01?",
            auteur_id=mattias.id,
            destinataire_id=alice.id,
            horodatage=now - timedelta(hours=1, minutes=15)
        )
        dm2 = Message(
            contenu_chiffre="Oui c'est bon, j'ai réussi à rejoindre le serveur!",
            auteur_id=alice.id,
            destinataire_id=mattias.id,
            horodatage=now - timedelta(hours=1, minutes=10)
        )
        db.session.add_all([dm1, dm2])
        db.session.flush()
        print(" 2 DMs entre Mattias et Alice")

        # ── Sondage ──────────────────────────────────────────────────────
        print("\nCréation du sondage...")
        # Le sondage est lié à un message dans #général
        poll_msg = Message(
            contenu_chiffre="[SONDAGE] Quel framework frontend utiliser pour Wyvern v2 ?",
            auteur_id=mattias.id,
            salon_id=ch_general.id,
            horodatage=now - timedelta(minutes=45)
        )
        db.session.add(poll_msg)
        db.session.flush()

        poll = Poll(
            message_id=poll_msg.id,
            question_chiffree="Quel framework frontend utiliser pour Wyvern v2 ?",
            date_fin=now + timedelta(days=7)
        )
        db.session.add(poll)
        db.session.flush()

        opt1 = PollOption(poll_id=poll.id, texte_option_chiffree="React")
        opt2 = PollOption(poll_id=poll.id, texte_option_chiffree="Vue.js")
        opt3 = PollOption(poll_id=poll.id, texte_option_chiffree="Vanilla JS (garder l'actuel)")
        db.session.add_all([opt1, opt2, opt3])
        db.session.flush()

        # Votes : Mattias → React, Alessandro → Vue.js, Alice → Vanilla JS
        vote1 = PollVote(utilisateur_id=mattias.id, option_id=opt1.id)
        vote2 = PollVote(utilisateur_id=alessandro.id, option_id=opt2.id)
        vote3 = PollVote(utilisateur_id=alice.id, option_id=opt3.id)
        db.session.add_all([vote1, vote2, vote3])
        db.session.flush()
        print(f"Sondage créé (id={poll.id}) avec 3 options et 3 votes")

        # ── Commit final ─────────────────────────────────────────────────
        db.session.commit()

        print("\n" + "="*55)
        print("SEED TERMINÉ — Résumé :")
        print("="*55)
        print(f" 4 utilisateurs créés")
        print(f" 1 serveur : '{server.nom}'  (invite: {server.code_invitation})")
        print(f" 3 salons : #général, #développement, #privé-admins")
        print(f" {len(msgs_general)+len(msgs_dev)+len(msgs_admins)+1} messages en salon (1 épinglé)")
        print(f"  2 DMs (Mattias ↔ Alice)")
        print(f"  1 sondage avec 3 options et 3 votes")
        print(f"  Bob est banni du serveur")
        print("\nComptes de test (mot de passe : password123) :")
        print(f"  Mattias    (propriétaire+admin)   code: {mattias.code_16_chiffres}")
        print(f"  Alessandro (admin)                 code: {alessandro.code_16_chiffres}")
        print(f"  Alice      (normal)                code: {alice.code_16_chiffres}")
        print(f"  Bob        (banni)                 code: {bob.code_16_chiffres}")
        print("="*55)


if __name__ == '__main__':
    seed()