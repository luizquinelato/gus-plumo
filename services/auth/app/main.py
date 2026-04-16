"""
Serviço de Autenticação - Gus Expenses Platform
Serviço centralizado para autenticação, autorização e gerenciamento de sessões
"""

from fastapi import FastAPI, HTTPException, status, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any
import jwt
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import psycopg2
from psycopg2.extras import RealDictCursor

# Importa configurações
from app.core.config import get_settings
from app.core.rbac import RBAC
from app.core.logging_config import setup_logging, get_logger
from app.providers.local_provider import LocalProvider

# Inicializa logging ANTES de qualquer outra coisa
setup_logging()
logger = get_logger(__name__)

settings = get_settings()

# ============================================================================
# TIMEZONE UTILITIES
# ============================================================================

def datetime_default() -> datetime:
    """
    Retorna o datetime atual no timezone configurado.
    Similar ao health-pulse para manter consistência.
    """
    return datetime.now(ZoneInfo(settings.TZ))

# Inicializa FastAPI
app = FastAPI(
    title="Plumo - Serviço de Autenticação",
    description="Serviço de autenticação e autorização para Plumo - Finanças leves, vida plena",
    version="1.0.0"
)

# Configuração CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ============================================================================
# MODELOS PYDANTIC
# ============================================================================

class LoginRequest(BaseModel):
    email: str
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    user: Dict[str, Any]

class TokenValidationResponse(BaseModel):
    valid: bool
    user: Optional[Dict[str, Any]] = None

class PermissionCheckRequest(BaseModel):
    recurso: str
    acao: str

class PermissionCheckResponse(BaseModel):
    permitido: bool

# ============================================================================
# FUNÇÕES UTILITÁRIAS
# ============================================================================

def gerar_token_jwt(user_data: Dict[str, Any], account_id: Optional[int] = None) -> str:
    """Gera token JWT para usuário autenticado."""
    now = datetime_default()
    exp = now + timedelta(minutes=settings.JWT_EXPIRY_MINUTES)

    payload = {
        "user_id": user_data["id"],
        "tenant_id": user_data["tenant_id"],
        "email": user_data["email"],
        "is_admin": user_data["is_admin"],
        "exp": int(exp.timestamp())
    }

    # Adiciona account_id se fornecido
    if account_id is not None:
        payload["account_id"] = account_id

    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

def validar_token_jwt(token: str) -> Optional[Dict[str, Any]]:
    """Valida token JWT e retorna payload."""
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

def get_database_connection():
    """Obtém conexão com o banco de dados."""
    return psycopg2.connect(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        database=settings.DB_NAME,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        cursor_factory=RealDictCursor
    )

# ============================================================================
# ENDPOINTS
# ============================================================================

@app.get("/")
async def root():
    """Endpoint raiz."""
    return {
        "service": "Gus Expenses - Serviço de Autenticação",
        "version": "1.0.0",
        "status": "online"
    }

@app.post("/api/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """
    Endpoint de login.
    Valida credenciais e retorna token JWT.
    """
    # Valida credenciais
    user_data = LocalProvider.validar_credenciais(request.email, request.password)

    if not user_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou senha inválidos"
        )

    # Gera token JWT
    access_token = gerar_token_jwt(user_data)

    # Salva sessão no banco
    conn = get_database_connection()
    try:
        cursor = conn.cursor()
        token_hash = LocalProvider.hash_password(access_token)
        expires_at = datetime_default() + timedelta(minutes=settings.JWT_EXPIRY_MINUTES)

        cursor.execute("""
            INSERT INTO users_sessions (
                tenant_id, user_id, token_hash, expires_at, active, created_at, last_updated_at
            )
            VALUES (%s, %s, %s, %s, TRUE, NOW(), NOW());
        """, (user_data['tenant_id'], user_data['id'], token_hash, expires_at))
        conn.commit()
    finally:
        conn.close()

    return LoginResponse(
        access_token=access_token,
        expires_in=settings.JWT_EXPIRY_MINUTES * 60,
        user=user_data
    )

@app.post("/api/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    """
    Endpoint de logout.
    Invalida a sessão do usuário.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token não fornecido"
        )

    token = authorization.replace("Bearer ", "")
    token_hash = LocalProvider.hash_password(token)

    # Invalida sessão no banco
    conn = get_database_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE users_sessions
            SET active = FALSE, last_updated_at = NOW()
            WHERE token_hash = %s;
        """, (token_hash,))
        conn.commit()
    finally:
        conn.close()

    return {"message": "Logout realizado com sucesso"}

@app.get("/api/auth/verify", response_model=TokenValidationResponse)
async def verify_token(authorization: Optional[str] = Header(None)):
    """
    Endpoint de verificação de token.
    Valida token JWT e retorna dados do usuário.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return TokenValidationResponse(valid=False)

    token = authorization.replace("Bearer ", "")

    # Valida token JWT
    payload = validar_token_jwt(token)
    if not payload:
        return TokenValidationResponse(valid=False)

    # Verifica se sessão está ativa
    token_hash = LocalProvider.hash_password(token)

    conn = get_database_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT active FROM users_sessions
            WHERE token_hash = %s AND expires_at > NOW();
        """, (token_hash,))
        session = cursor.fetchone()

        if not session or not session['active']:
            return TokenValidationResponse(valid=False)
    finally:
        conn.close()

    # Busca dados atualizados do usuário
    user_data = LocalProvider.obter_usuario_por_id(payload['user_id'], payload['tenant_id'])
    if not user_data:
        return TokenValidationResponse(valid=False)

    # Adiciona account_id do payload do JWT se presente
    if 'account_id' in payload:
        user_data['account_id'] = payload['account_id']

    return TokenValidationResponse(valid=True, user=user_data)

@app.post("/api/auth/check-permission", response_model=PermissionCheckResponse)
async def check_permission(
    request: PermissionCheckRequest,
    authorization: Optional[str] = Header(None)
):
    """
    Endpoint de verificação de permissão.
    Verifica se o usuário tem permissão para executar uma ação em um recurso.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token não fornecido"
        )

    token = authorization.replace("Bearer ", "")
    payload = validar_token_jwt(token)

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido"
        )

    # Verifica permissão
    permitido = RBAC.verificar_permissao(
        user_id=payload['user_id'],
        tenant_id=payload['tenant_id'],
        recurso=request.recurso,
        acao=request.acao
    )

    return PermissionCheckResponse(permitido=permitido)

@app.get("/api/auth/permissions")
async def get_permissions(authorization: Optional[str] = Header(None)):
    """
    Endpoint para obter todas as permissões do usuário.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token não fornecido"
        )

    token = authorization.replace("Bearer ", "")
    payload = validar_token_jwt(token)

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido"
        )

    # Obtém permissões
    permissions = RBAC.obter_permissoes_usuario(
        user_id=payload['user_id'],
        tenant_id=payload['tenant_id']
    )

    return {"permissions": permissions}


@app.get("/api/users/me/accounts")
async def get_user_accounts(authorization: Optional[str] = Header(None)):
    """
    Endpoint para obter todas as contas do usuário autenticado.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token não fornecido"
        )

    token = authorization.replace("Bearer ", "")
    payload = validar_token_jwt(token)

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido"
        )

    # Busca contas do usuário
    conn = get_database_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT
                a.id,
                a.user_id,
                a.name,
                a.description,
                a.account_type,
                a.bank_id,
                a.agency,
                a.account_number,
                b.code as bank_code,
                b.name as bank_name
            FROM accounts a
            LEFT JOIN banks b ON a.bank_id = b.id
            WHERE a.user_id = %s
              AND a.tenant_id = %s
              AND a.active = TRUE
            ORDER BY a.name;
        """, (payload['user_id'], payload['tenant_id']))

        accounts = cursor.fetchall()
        return {"accounts": [dict(acc) for acc in accounts]}
    finally:
        conn.close()


class SelectAccountRequest(BaseModel):
    account_id: int


@app.post("/api/auth/select-account", response_model=LoginResponse)
async def select_account(
    request: SelectAccountRequest,
    authorization: Optional[str] = Header(None)
):
    """
    Endpoint para selecionar uma conta e gerar novo token com account_id.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token não fornecido"
        )

    token = authorization.replace("Bearer ", "")
    payload = validar_token_jwt(token)

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido"
        )

    # Verifica se a conta pertence ao usuário
    conn = get_database_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id FROM accounts
            WHERE id = %s
              AND user_id = %s
              AND tenant_id = %s
              AND active = TRUE;
        """, (request.account_id, payload['user_id'], payload['tenant_id']))

        account = cursor.fetchone()
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conta não encontrada ou não pertence ao usuário"
            )

        # Busca dados do usuário
        user_data = LocalProvider.obter_usuario_por_id(payload['user_id'], payload['tenant_id'])
        if not user_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Usuário não encontrado"
            )

        # Gera novo token com account_id
        new_token = gerar_token_jwt(user_data, account_id=request.account_id)

        # Salva nova sessão no banco
        token_hash = LocalProvider.hash_password(new_token)
        expires_at = datetime_default() + timedelta(minutes=settings.JWT_EXPIRY_MINUTES)

        cursor.execute("""
            INSERT INTO users_sessions (
                tenant_id, user_id, token_hash, expires_at,
                created_at, last_updated_at, active
            )
            VALUES (%s, %s, %s, %s, NOW(), NOW(), TRUE);
        """, (user_data['tenant_id'], user_data['id'], token_hash, expires_at))
        conn.commit()

        # Adiciona account_id ao user_data para retornar no response
        user_data_with_account = {**user_data, 'account_id': request.account_id}

        return LoginResponse(
            access_token=new_token,
            expires_in=settings.JWT_EXPIRY_MINUTES * 60,
            user=user_data_with_account
        )
    finally:
        conn.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.HOST, port=settings.PORT)

