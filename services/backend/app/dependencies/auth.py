# -*- coding: utf-8 -*-
"""
Authentication dependencies for FastAPI endpoints
"""
import os
from pathlib import Path
from fastapi import Header, HTTPException, status
from typing import Optional
import httpx
import jwt
import logging
from dotenv import load_dotenv

project_root = Path(__file__).resolve().parent.parent.parent.parent.parent
_environment = os.environ.get("APP_ENV", os.environ.get("ENVIRONMENT", "prod"))
env_path = project_root / f".env.{_environment}"
if not env_path.exists():
    env_path = project_root / ".env"
if env_path.exists():
    load_dotenv(env_path, override=True)

logger = logging.getLogger(__name__)

AUTH_SERVICE_URL = os.environ.get("AUTH_SERVICE_URL", "http://localhost:8001")
JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "gus-expenses-secret-key-change-in-production")
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """
    Dependency to get current authenticated user.
    Does NOT check for admin privileges - use require_admin for that.

    Args:
        authorization: Bearer token from Authorization header

    Returns:
        User data from auth service (includes account_id if selected)

    Raises:
        HTTPException: If token is invalid or user is not authenticated
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticação não fornecido",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        # Decode token locally to get payload
        token = authorization.replace("Bearer ", "")

        # Verificar se o token tem o formato correto (3 partes separadas por ponto)
        token_parts = token.split('.')

        if len(token_parts) != 3:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Token malformado (partes: {len(token_parts)})",
                headers={"WWW-Authenticate": "Bearer"},
            )

        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])

        # Verify token with auth service
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{AUTH_SERVICE_URL}/api/auth/verify",
                headers={"Authorization": authorization},
                timeout=10.0
            )

            if response.status_code == 200:
                data = response.json()

                if data.get("valid") and data.get("user"):
                    # Add account_id from token payload if present
                    user_data = data["user"]
                    if "account_id" in payload:
                        user_data["account_id"] = payload["account_id"]

                    return user_data

            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token inválido ou expirado",
                headers={"WWW-Authenticate": "Bearer"},
            )

    except httpx.RequestError as e:
        logger.error(f"Erro de conexão com auth service: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Serviço de autenticação indisponível"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Erro inesperado em get_current_user:")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao validar token: {str(e)}"
        )


async def require_account(authorization: Optional[str] = Header(None)) -> dict:
    """
    Dependency to require that user has selected an account.

    Args:
        authorization: Bearer token from Authorization header

    Returns:
        User data with account_id

    Raises:
        HTTPException: If token is invalid, user is not authenticated, or no account is selected
    """
    user_data = await get_current_user(authorization)

    if "account_id" not in user_data or user_data["account_id"] is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nenhuma conta selecionada. Por favor, selecione uma conta primeiro."
        )

    return user_data


async def require_admin(authorization: Optional[str] = Header(None)) -> dict:
    """
    Dependency to require that user is an admin (tenant-level access).
    Admins have access to tenant-wide configurations like:
    - User management
    - Permissions management
    - Session management
    - System settings
    - Tenant colors

    Args:
        authorization: Bearer token from Authorization header

    Returns:
        User data (admin user)

    Raises:
        HTTPException: If token is invalid, user is not authenticated, or user is not admin
    """
    user_data = await get_current_user(authorization)

    if not user_data.get("is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso negado. Apenas administradores podem acessar este recurso."
        )

    return user_data

