# -*- coding: utf-8 -*-
"""
Auth Router - Endpoints para autenticação via serviço de auth
"""
import os
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional, List, Any
from sqlalchemy.orm import Session
import httpx

from ..database import get_db
from ..models.auth_models import Tenant, TenantCores

router = APIRouter(prefix="/api/auth", tags=["auth"])

# URL do serviço de autenticação (lê de variável de ambiente)
AUTH_SERVICE_URL = os.environ.get("AUTH_SERVICE_URL", "http://localhost:8001")


class LoginRequest(BaseModel):
    """Modelo de requisição de login."""
    email: str
    password: str


class LoginResponse(BaseModel):
    """Modelo de resposta de login."""
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    user: dict


class TokenValidationResponse(BaseModel):
    """Modelo de resposta de validação de token."""
    valid: bool
    user: Optional[dict] = None
    color_schema_mode: Optional[str] = None
    colors: Optional[List[Any]] = None


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """
    Endpoint de login que se comunica com o serviço de autenticação.
    Apenas usuários admin podem fazer login.
    
    Args:
        request: Dados de login (email e senha)
        
    Returns:
        Token de acesso e dados do usuário
        
    Raises:
        HTTPException: Se as credenciais forem inválidas ou o usuário não for admin
    """
    try:
        # Fazer requisição para o serviço de auth
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{AUTH_SERVICE_URL}/api/auth/login",
                json={
                    "email": request.email,
                    "password": request.password
                },
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Verificar se o usuário é admin
                if not data.get("user", {}).get("is_admin", False):
                    raise HTTPException(
                        status_code=403,
                        detail="Acesso negado: apenas administradores podem fazer login"
                    )
                
                return LoginResponse(
                    access_token=data["access_token"],
                    token_type=data.get("token_type", "Bearer"),
                    expires_in=data["expires_in"],
                    user=data["user"]
                )
            elif response.status_code == 401:
                raise HTTPException(
                    status_code=401,
                    detail="Email ou senha inválidos"
                )
            else:
                raise HTTPException(
                    status_code=response.status_code,
                    detail="Erro ao autenticar com o serviço de auth"
                )
                
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Serviço de autenticação indisponível: {str(e)}"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erro interno ao processar login: {str(e)}"
        )


@router.get("/verify", response_model=TokenValidationResponse)
async def verify_token(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Endpoint de verificação de token que se comunica com o serviço de autenticação.
    Também retorna as cores do tenant para sincronização.

    Args:
        authorization: Header de autorização com o token Bearer
        db: Sessão do banco de dados

    Returns:
        Validação do token, dados do usuário e cores do tenant
    """
    if not authorization or not authorization.startswith("Bearer "):
        return TokenValidationResponse(valid=False)

    try:
        # Fazer requisição para o serviço de auth
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{AUTH_SERVICE_URL}/api/auth/verify",
                headers={"Authorization": authorization},
                timeout=10.0
            )

            if response.status_code == 200:
                data = response.json()
                user_data = data.get("user")

                # Se o token é válido e temos dados do usuário, buscar cores do tenant
                color_schema_mode = None
                colors_array = None

                if data.get("valid", False) and user_data:
                    tenant_id = user_data.get("tenant_id", 1)

                    try:
                        # Buscar tenant para obter color_schema_mode
                        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
                        if tenant:
                            color_schema_mode = tenant.color_schema_mode

                        # Buscar todas as cores do tenant
                        colors = db.query(TenantCores).filter(
                            TenantCores.tenant_id == tenant_id,
                            TenantCores.active == True
                        ).order_by(
                            TenantCores.color_schema_mode,
                            TenantCores.theme_mode,
                            TenantCores.accessibility_level
                        ).all()

                        if colors:
                            colors_array = []
                            for c in colors:
                                colors_array.append({
                                    "color_schema_mode": c.color_schema_mode,
                                    "theme_mode": c.theme_mode,
                                    "accessibility_level": c.accessibility_level,
                                    "color1": c.color1,
                                    "color2": c.color2,
                                    "color3": c.color3,
                                    "color4": c.color4,
                                    "color5": c.color5,
                                    "on_color1": c.on_color1,
                                    "on_color2": c.on_color2,
                                    "on_color3": c.on_color3,
                                    "on_color4": c.on_color4,
                                    "on_color5": c.on_color5,
                                    "on_gradient_1_2": c.on_gradient_1_2,
                                    "on_gradient_2_3": c.on_gradient_2_3,
                                    "on_gradient_3_4": c.on_gradient_3_4,
                                    "on_gradient_4_5": c.on_gradient_4_5,
                                    "on_gradient_5_1": c.on_gradient_5_1
                                })
                    except Exception as color_error:
                        # Se falhar ao buscar cores, continua sem elas
                        print(f"⚠️ Erro ao buscar cores do tenant: {color_error}")

                return TokenValidationResponse(
                    valid=data.get("valid", False),
                    user=user_data,
                    color_schema_mode=color_schema_mode,
                    colors=colors_array
                )
            else:
                return TokenValidationResponse(valid=False)

    except httpx.RequestError:
        return TokenValidationResponse(valid=False)
    except Exception:
        return TokenValidationResponse(valid=False)


@router.get("/users/me/accounts")
async def get_user_accounts(authorization: Optional[str] = Header(None)):
    """
    Endpoint para obter todas as contas do usuário autenticado.
    Proxy para o serviço de autenticação.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Token não fornecido"
        )

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{AUTH_SERVICE_URL}/api/users/me/accounts",
                headers={"Authorization": authorization},
                timeout=10.0
            )

            if response.status_code == 200:
                return response.json()
            else:
                raise HTTPException(
                    status_code=response.status_code,
                    detail="Erro ao buscar contas do usuário"
                )
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Serviço de autenticação indisponível: {str(e)}"
        )


class SelectAccountRequest(BaseModel):
    """Modelo de requisição para seleção de conta."""
    account_id: int


@router.post("/select-account", response_model=LoginResponse)
async def select_account(
    request: SelectAccountRequest,
    authorization: Optional[str] = Header(None)
):
    """
    Endpoint para selecionar uma conta e gerar novo token com account_id.
    Proxy para o serviço de autenticação.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Token não fornecido"
        )

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{AUTH_SERVICE_URL}/api/auth/select-account",
                json={"account_id": request.account_id},
                headers={"Authorization": authorization},
                timeout=10.0
            )

            if response.status_code == 200:
                data = response.json()
                return LoginResponse(
                    access_token=data["access_token"],
                    token_type=data.get("token_type", "Bearer"),
                    expires_in=data["expires_in"],
                    user=data["user"]
                )
            elif response.status_code == 404:
                raise HTTPException(
                    status_code=404,
                    detail="Conta não encontrada ou não pertence ao usuário"
                )
            else:
                raise HTTPException(
                    status_code=response.status_code,
                    detail="Erro ao selecionar conta"
                )
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Serviço de autenticação indisponível: {str(e)}"
        )

