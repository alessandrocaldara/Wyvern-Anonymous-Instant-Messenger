# Wyvern, Messagerie Instantanée Sécurisée

Wyvern est une messagerie instantanée de type Discord, conçue autour de la confidentialité: chiffrement de bout en bout (E2E), identification anonyme par un code à 16 chiffres (inspiré de Mullvad VPN), et stockage minimal de métadonnées. Le serveur route et persiste les messages sans jamais pouvoir les lire.

Projet académique, Projet Transverse I, par Mattias Hansen et Alessandro Caldara.

---

## Fonctionnalités

- Authentification anonyme: inscription avec pseudo + mot de passe (e‑mail facultatif) ; connexion par pseudo **ou** par code unique à 16 chiffres.
- Serveurs et salons: création de serveurs (le créateur devient propriétaire), codes d'invitation, salons publics et privés.
- Messagerie temps réel (WebSockets) en salon et en messages privés (DM).
- Sondages (2 à 5 options, résultats en temps réel), **épinglage**, **édition/suppression** de ses messages.
- Recherche de messages par mots‑clés (côté client).
- Modération: rôles propriétaire / admin / normal, expulsion et bannissement.
- Chiffrement de bout en bout: schéma hybride EC‑ElGamal (courbe secp256k1) + AES‑256‑GCM, exécuté entièrement dans le navigateur.
- Interface type Discord, avec mode sombre.

## Stack technique

| Couche | Technologies |
|---|---|
| Front‑end | HTML / CSS / Jinja2, JavaScript vanilla, Socket.IO (client), Fetch API |
| Crypto | Module `crypto.js` maison (secp256k1, AES‑256‑GCM, SHA‑256, PBKDF2) |
| Back‑end | Flask 3.1, Flask‑SocketIO + eventlet, SQLAlchemy (ORM), Werkzeug, Flask‑CORS |
| Base de données | MySQL 8.0 |
| Conteneurisation | Docker / Docker Compose (+ phpMyAdmin) |

---

## Prérequis

- Docker et Docker Compose (Docker Desktop sous Windows/macOS, ou Docker Engine + plugin Compose sous Linux).
- Les ports 5555, 8080 et 6033 doivent être libres sur la machine hôte.

Aucune installation de Python, Node ou MySQL n'est nécessaire en local: tout tourne dans des conteneurs.

## Démarrage rapide

À la racine du projet (là où se trouve `docker-compose.yml`):

```bash
docker compose up --build
```

Au premier lancement, le conteneur de base de données exécute automatiquement `database/sql/db_wyvern.sql` pour créer les 9 tables. Patientez jusqu'à ce que le backend affiche qu'il écoute sur le port 5555.

Pour lancer en arrière‑plan: `docker compose up --build -d`. Pour arrêter: `docker compose down` (ajouter `-v` pour supprimer aussi les données persistées).

## Accès

| Service | URL / Adresse | Identifiants |
|---|---|---|
| Application Wyvern | http://localhost:5555 | — (créez un compte) |
| phpMyAdmin | http://localhost:8080 | utilisateur `wyvern_user` / mot de passe `wyvern_user` (serveur : `db`) |
| MySQL (accès direct) | `localhost:6033` | `wyvern_user` / `wyvern_user`, base `db_wyvern` |

> Ces identifiants sont des valeurs de **développement** définies dans `docker-compose.yml`. À changer impérativement pour tout déploiement réel.

---

## Première utilisation

1. Ouvrez http://localhost:5555 et créez un compte. À l'inscription, votre navigateur génère votre paire de clés E2E; notez bien le code à 16 chiffres affiché (il sert d'identifiant de connexion alternatif).
2. Créez un serveur (vous en devenez propriétaire), ajoutez des salons, et invitez d'autres comptes via le code d'invitation.
3. Pour tester le temps réel et le chiffrement, ouvrez un second compte dans une autre fenêtre (ou un autre navigateur) et échangez des messages.

> Important (E2E) : le chiffrement repose sur des clés générées et déchiffrées dans le navigateur. Seuls les comptes créés via l'interface possèdent une paire de clés et peuvent donc envoyer/lire des messages chiffrés. De plus, un membre qui rejoint un salon ne peut pas déchiffrer les messages antérieurs à son arrivée (les clés n'ont été chiffrées que pour les membres présents au moment de l'envoi).

## Données de test (seed)

Un script peuple la base avec un environnement de démonstration (utilisateurs, serveur, salons, permissions, bannissement, sondage). Les conteneurs doivent être démarrés :

```bash
docker exec -it wyvern_backend python seed.py
```

Il crée notamment :

- 4 comptes — mot de passe commun `password123` :
  - `Mattias` (propriétaire + admin), `Alessandro` (admin), `Alice` (normal), `Bob` (banni du serveur).
  - Les codes à 16 chiffres sont aléatoires et **affichés dans la sortie du script**.
- Un serveur **« Wyvern Dev Server »**, code d'invitation **`WYVERN01`**.
- Trois salons : `#général`, `#développement` (publics) et `#privé-admins` (privé), avec des messages d'exemple (dont un épinglé), un échange privé et un sondage à 3 options.

> Limite du seed: le chiffrement s'exécutant côté navigateur, le script ne peut pas produire de vrais messages chiffrés- les comptes générés n'ont pas de clés E2E et les messages insérés sont des marque‑places en clair. Le seed sert donc à tester la structure et l'interface; pour valider le chiffrement, créez des comptes via l'interface et échangez des messages connecté

---

## Structure du projet

```
.
├── docker-compose.yml          # 3 services : db (MySQL), phpmyadmin, backend
├── backend/
│   ├── Dockerfile
│   ├── app.py                  # factory Flask ; routes / , /chat , /health
│   ├── config.py               # configuration (URI base, clé secrète)
│   ├── extensions.py           # instances partagées (db, socketio)
│   ├── models.py               # 9 modèles SQLAlchemy
│   ├── sockets.py              # événements WebSocket (messages, DM, typing…)
│   ├── seed.py                 # données de test
│   └── routes/                 # blueprints REST : auth, servers, channels,
│                               #                    messages, polls, users
├── frontend/
│   ├── templates/              # login.html, register.html, chat.html, base.html
│   └── static/
│       ├── js/                 # app.js, crypto.js, socket.js, commands.js
│       └── css/style.css
└── database/sql/db_wyvern.sql  # schéma initial (exécuté au 1er démarrage)
```

## Sécurité — notes et limites

- Les mots de passe sont stockés hachés et salés (`pbkdf2:sha256`, Werkzeug). La clé privée E2E est stockée chiffrée par une clé dérivée du mot de passe (PBKDF2, 100 000 itérations) et n'est déchiffrée qu'en mémoire, le temps de la session.
- La cryptographie est réimplémentée à des fins pédagogiques: non auditée, non constant‑time, et sans forward secrecy. Ne pas utiliser en production sans s'appuyer sur des primitives éprouvées (WebCrypto, libsodium).
- La recherche s'effectue côté client (le serveur ne peut pas indexer des messages qu'il ne lit pas).

## Commandes utiles

```bash
docker compose logs -f backend     # suivre les logs du serveur
docker compose ps                  # état des conteneurs
docker exec -it wyvern_backend bash  # shell dans le conteneur backend
curl http://localhost:5555/health   # vérifier la connexion à la base
```

## Auteurs

Mattias Hansen, Alessandro Caldara
