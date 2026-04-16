"""
Configurações do Serviço de Autenticação
"""

import os
from pathlib import Path
from pydantic_settings import BaseSettings
from typing import List
from dotenv import load_dotenv

project_root = Path(__file__).resolve().parent.parent.parent.parent.parent
_environment = os.environ.get("APP_ENV", os.environ.get("ENVIRONMENT", "prod"))
env_path = project_root / f".env.{_environment}"
if not env_path.exists():
    env_path = project_root / ".env"
if env_path.exists():
    load_dotenv(env_path, override=True)


class Settings(BaseSettings):
    """Configurações do serviço de autenticação."""

    # Configurações do servidor
    HOST: str = "0.0.0.0"
    PORT: int = 8001

    # Configurações do banco de dados (usa variáveis globais DB_*)
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_NAME: str = "plumo"
    DB_USER: str = "plumo"
    DB_PASSWORD: str = "plumo"

    # Configurações JWT
    JWT_SECRET_KEY: str = "gus-expenses-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_MINUTES: int = 60 * 24  # 24 horas

    # Timezone
    TZ: str = "America/New_York"

    # CORS
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origins_list(self) -> List[str]:
        """Retorna lista de origens permitidas para CORS."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    @property
    def database_url(self) -> str:
        """Retorna URL de conexão com o banco de dados."""
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    class Config:
        env_file = ".env"
        case_sensitive = True


def get_settings() -> Settings:
    """Retorna instância das configurações."""
    return Settings()

