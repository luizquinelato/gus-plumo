"""
Database configuration and session management.
Provides SQLAlchemy engine and session factory for the application.
"""

import os
import logging
from pathlib import Path
from typing import Any, Type
from urllib.parse import quote_plus

import psycopg2
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
from fastapi import HTTPException

logger = logging.getLogger(__name__)

project_root = Path(__file__).resolve().parent.parent.parent.parent
_environment = os.environ.get("APP_ENV", os.environ.get("ENVIRONMENT", "prod"))
env_path = project_root / f".env.{_environment}"
if not env_path.exists():
    env_path = project_root / ".env"
if env_path.exists():
    load_dotenv(env_path, override=True)
else:
    load_dotenv(override=True)

def _password_needs_url_encode(password: str) -> bool:
    return any(ch in password for ch in "/@%:+?#")


def resolve_database_url() -> str:
    """
    Monta DATABASE_URL com senha percent-encoded quando DB_PASSWORD está definida.
    Senhas com /, +, @ etc. quebram URLs montadas só com interpolação (Docker Compose).
    """
    explicit = os.getenv("DATABASE_URL")
    db_password = os.getenv("DB_PASSWORD")
    db_host = os.getenv("DB_HOST")
    if db_password and (db_host or _password_needs_url_encode(db_password)):
        user = os.getenv("DB_USER") or "plumo"
        host = db_host or "localhost"
        port = os.getenv("DB_PORT") or "5432"
        name = os.getenv("DB_NAME") or "plumo"
        return (
            f"postgresql://{quote_plus(user)}:{quote_plus(db_password)}"
            f"@{host}:{port}/{quote_plus(name)}"
        )
    if explicit:
        return explicit
    return "postgresql://plumo:plumo@localhost:5432/plumo"


DATABASE_URL = resolve_database_url()


def psycopg2_connect(cursor_factory: Type[Any] | None = None):
    """Conexão DB-API compartilhando o mesmo DATABASE_URL do SQLAlchemy."""
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=cursor_factory)
    return conn

_sql_echo = os.getenv("SQL_ECHO", "false").lower() in ("true", "1", "yes")

# Create SQLAlchemy engine
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,  # Verify connections before using
    pool_size=10,  # Connection pool size
    max_overflow=20,  # Max connections beyond pool_size
    echo=_sql_echo  # Controlled by SQL_ECHO env var (true in dev, false in prod)
)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """
    Dependency function to get database session.
    Yields a database session and ensures it's closed after use.

    Usage:
        @app.get("/items")
        def get_items(db: Session = Depends(get_db)):
            return db.query(Item).all()
    """
    db = SessionLocal()
    try:
        yield db
    except HTTPException:
        # HTTPExceptions são erros de validação esperados, não logar como erro
        raise
    except Exception as e:
        # Apenas logar exceptions inesperadas
        logger.exception("Erro na sessão DB:")
        raise
    finally:
        db.close()

