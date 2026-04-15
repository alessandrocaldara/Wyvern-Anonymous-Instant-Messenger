import os


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'wyvern-secret-key-dev')
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        'DATABASE_URL',
        'mysql+pymysql://wyvern_user:wyvern_user@db:3306/db_wyvern'
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
