"""
Wyvern — Point d'entrée de l'application Flask.
"""
from flask import Flask 
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

    # Route de test
    @app.route('/')
    def index():
        return '<h1>Wyvern is alive!</h1>'

    # Route de vérification de la BDD
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