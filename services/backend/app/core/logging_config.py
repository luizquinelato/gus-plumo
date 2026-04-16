"""
Sistema de logging para Gus Expenses Platform.
Configuração centralizada com suporte a arquivos rotativos e níveis de log.
"""

import logging
import sys
import os
from pathlib import Path
from logging.handlers import RotatingFileHandler
from typing import Optional

# ============================================================
# 🔧 CONFIGURAÇÃO DE LOGGING
# ============================================================
# Controlado pela variável de ambiente LOG_LEVEL (DEBUG em dev, INFO em prod)
_log_level_str = os.environ.get("LOG_LEVEL", "INFO").upper()
LOG_LEVEL = getattr(logging, _log_level_str, logging.INFO)

# Nome do serviço (usado nos arquivos de log)
SERVICE_NAME = "gus-expenses-backend"

# Flag global para evitar reconfiguração
_logging_configured = False


def setup_logging(force_reconfigure: bool = False):
    """
    Configura o sistema de logging da aplicação.

    Características:
    - Console: Logs coloridos no terminal
    - Arquivo: Rotação automática (50MB, 10 backups)
    - Níveis: DEBUG, INFO, WARNING, ERROR, CRITICAL
    - Silencia bibliotecas ruidosas (SQLAlchemy, Uvicorn, etc.)

    Args:
        force_reconfigure: Se True, reconfigura mesmo que já tenha sido configurado
    """
    global _logging_configured
    
    if _logging_configured and not force_reconfigure:
        return
    
    # Limpa handlers existentes
    root_logger = logging.getLogger()
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Formatter padrão
    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # ============================================================
    # CONSOLE HANDLER (Terminal)
    # ============================================================
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(LOG_LEVEL)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # ============================================================
    # FILE HANDLER (Arquivo com rotação)
    # ============================================================
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)

    # File — separate file per env, INFO+ only (DEBUG stays console-only)
    # Rotação: 10MB por arquivo, 5 backups = ~50MB total
    app_env = os.environ.get("APP_ENV", "prod")
    log_filename = f"logs/{SERVICE_NAME}.{app_env}.log"

    file_handler = RotatingFileHandler(
        log_filename,
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
        encoding='utf-8'
    )
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)
    
    # Define nível do root logger
    root_logger.setLevel(LOG_LEVEL)
    
    # Silencia bibliotecas ruidosas
    _silence_third_party_loggers()
    
    _logging_configured = True
    
    # Log de inicialização
    logger = logging.getLogger(__name__)
    logger.info(f"✅ Sistema de logging configurado (Nível: {logging.getLevelName(LOG_LEVEL)})")


def _silence_third_party_loggers():
    """Reduz verbosidade de bibliotecas de terceiros."""

    # SQLAlchemy (muito verboso em DEBUG)
    logging.getLogger("sqlalchemy").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)

    # HTTP libraries
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("httpcore.connection").setLevel(logging.WARNING)
    logging.getLogger("httpcore.http11").setLevel(logging.WARNING)

    # Uvicorn (WARNING para suprimir logs de requisições HTTP)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(logging.WARNING)

    # FastAPI
    logging.getLogger("fastapi").setLevel(logging.WARNING)


def get_logger(name: Optional[str] = None) -> logging.Logger:
    """
    Obtém um logger configurado.
    
    Args:
        name: Nome do logger. Se None, usa o nome do módulo chamador.
    
    Returns:
        Logger configurado
    
    Exemplo:
        logger = get_logger(__name__)
        logger.debug("Mensagem de debug")
        logger.info("Mensagem informativa")
        logger.warning("Aviso")
        logger.error("Erro")
        logger.critical("Erro crítico")
    """
    if name is None:
        # Obtém nome do módulo chamador
        import inspect
        frame = inspect.currentframe()
        if frame and frame.f_back:
            name = frame.f_back.f_globals.get('__name__', 'unknown')
        else:
            name = 'unknown'
    
    return logging.getLogger(name)


class LoggerMixin:
    """
    Mixin para adicionar logging a classes.
    
    Uso:
        class MinhaClasse(LoggerMixin):
            def meu_metodo(self):
                self.logger.info("Mensagem de log")
    """
    
    @property
    def logger(self) -> logging.Logger:
        """Retorna logger para a classe."""
        return get_logger(f"{self.__class__.__module__}.{self.__class__.__name__}")

