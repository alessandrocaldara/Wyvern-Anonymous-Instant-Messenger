from flask import Flask, session, redirect
from flask_cors import CORS
from config import Config
from extensions import db, socketio


def create_app():
    """Factory pattern pour créer l'application Flask."""
    app = Flask(
        __name__,
        template_folder='../frontend/templates',
        static_folder='../frontend/static'
    )
    app.config.from_object(Config)

    # Initialiser les extensions
    db.init_app(app)
    CORS(app)
    socketio.init_app(app)

    # Importer les modèles pour que SQLAlchemy les connaisse
    import models  # noqa: F401

    # Enregistrer les blueprints
    from routes.auth import auth_bp
    from routes.servers import servers_bp
    from routes.channels import channels_bp
    from routes.messages import messages_bp
    app.register_blueprint(auth_bp)
    app.register_blueprint(servers_bp)
    app.register_blueprint(channels_bp)
    app.register_blueprint(messages_bp)

    # Importer les événements WebSocket (enregistrement par décorateurs)
    import sockets  # noqa: F401

    # Routes principales
    @app.route('/')
    def index():
        if 'user_id' in session:
            return redirect('/chat')
        return redirect('/login')

    @app.route('/chat')
    def chat():
        if 'user_id' not in session:
            return redirect('/login')
        return f'<h1>Bienvenue {session["pseudo"]} !</h1><p>Le chat arrive bientôt...</p>'

    @app.route('/health')
    def health():
        try:
            db.session.execute(db.text('SELECT 1'))
            return {'status': 'ok', 'database': 'connected'}, 200
        except Exception as e:
            return {'status': 'error', 'database': str(e)}, 500

    return app


# Créer l'instance globale
app = create_app()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5555, debug=True)