"""
Database configuration and session management.
Provides SQLAlchemy engine and session factory for the application.
"""

import os
import logging
from pathlib import Path
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

# Get database URL from environment
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://plumo:plumo@localhost:5432/plumo')

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

