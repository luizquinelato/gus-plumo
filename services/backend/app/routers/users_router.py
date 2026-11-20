"""
Router para gerenciamento do perfil do usuário logado e cadastro de usuários (admin).
"""
import hashlib
import os
import re
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator

from app.database import get_db
from app.models.auth_models import Usuario, Permissao
from app.dependencies.auth import get_current_user, require_admin
from app.schemas.bulk_ops import BulkDeleteResponse, BulkIdsRequest

ADMIN_PERMISSION_RESOURCES = [
    "tags",
    "subtags",
    "credit_cards",
    "credit_card_invoices",
    "bank_statements",
    "users",
    "system_settings",
    "import",
    "export",
    "dashboard",
]
ADMIN_PERMISSION_ACTIONS = ["create", "read", "update", "delete"]

# Diretório para salvar avatares
AVATARS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads", "avatars")

router = APIRouter(prefix="/api/users", tags=["users"])


class UserUpdateName(BaseModel):
    first_name: str
    last_name: str | None = None


class UserUpdatePassword(BaseModel):
    current_password: str
    new_password: str


class UserResponse(BaseModel):
    id: int
    email: str
    first_name: str | None
    last_name: str | None
    role: str
    is_admin: bool

    class Config:
        from_attributes = True


class TenantUserListItem(BaseModel):
    id: int
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: str
    is_admin: bool
    active: bool
    last_login_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class TenantUserDetail(TenantUserListItem):
    pass


class TenantUserCreate(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    role: str = Field(default="user", pattern=r"^(admin|user)$")

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        email = value.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise ValueError("E-mail inválido")
        return email


class TenantUserUpdate(BaseModel):
    email: Optional[str] = Field(None, min_length=3, max_length=255)
    password: Optional[str] = Field(None, min_length=8, max_length=128)
    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    role: Optional[str] = Field(None, pattern=r"^(admin|user)$")

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        email = value.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise ValueError("E-mail inválido")
        return email


def _hash(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def _grant_admin_permissions(db: Session, tenant_id: int, user_id: int) -> None:
    for resource in ADMIN_PERMISSION_RESOURCES:
        for action in ADMIN_PERMISSION_ACTIONS:
            db.add(
                Permissao(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    resource=resource,
                    action=action,
                    granted=True,
                    active=True,
                )
            )


def _revoke_admin_permissions(db: Session, tenant_id: int, user_id: int) -> None:
    (
        db.query(Permissao)
        .filter(Permissao.tenant_id == tenant_id, Permissao.user_id == user_id)
        .delete(synchronize_session=False)
    )


def _sync_admin_permissions(
    db: Session, tenant_id: int, user_id: int, is_admin: bool
) -> None:
    if is_admin:
        existing = (
            db.query(Permissao)
            .filter(Permissao.tenant_id == tenant_id, Permissao.user_id == user_id)
            .count()
        )
        if existing == 0:
            _grant_admin_permissions(db, tenant_id, user_id)
    else:
        _revoke_admin_permissions(db, tenant_id, user_id)


def _role_to_is_admin(role: str) -> bool:
    return role == "admin"


def _get_tenant_user(db: Session, tenant_id: int, user_id: int) -> Usuario:
    user = (
        db.query(Usuario)
        .filter(Usuario.id == user_id, Usuario.tenant_id == tenant_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    return user


@router.get("/tenant/{user_id}", response_model=TenantUserDetail)
async def get_tenant_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    tenant_id = current_user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant não identificado")
    user = _get_tenant_user(db, tenant_id, user_id)
    return TenantUserDetail(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=user.role,
        is_admin=user.is_admin,
        active=user.active,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
    )


@router.get("/tenant", response_model=List[TenantUserListItem])
async def list_tenant_users(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Lista usuários do tenant (somente administradores)."""
    tenant_id = current_user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant não identificado")

    users = (
        db.query(Usuario)
        .filter(Usuario.tenant_id == tenant_id)
        .order_by(Usuario.id.asc())
        .all()
    )
    return users


@router.post("/tenant", response_model=TenantUserListItem, status_code=201)
async def create_tenant_user(
    data: TenantUserCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Cadastra um novo usuário no tenant (somente administradores)."""
    tenant_id = current_user.get("tenant_id")
    created_by = current_user.get("id") or current_user.get("user_id")
    if not tenant_id or not created_by:
        raise HTTPException(status_code=400, detail="Sessão inválida")

    existing = (
        db.query(Usuario)
        .filter(Usuario.tenant_id == tenant_id, Usuario.email == data.email)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Já existe um usuário com este e-mail")

    is_admin = _role_to_is_admin(data.role)
    user = Usuario(
        tenant_id=tenant_id,
        email=data.email,
        first_name=data.first_name.strip(),
        last_name=data.last_name.strip() if data.last_name else None,
        role=data.role,
        is_admin=is_admin,
        auth_provider="local",
        password_hash=_hash(data.password),
        active=True,
    )
    db.add(user)
    db.flush()

    _sync_admin_permissions(db, tenant_id, user.id, is_admin)

    db.commit()
    db.refresh(user)
    return user


@router.patch("/tenant/{user_id}/active", response_model=TenantUserListItem)
async def set_tenant_user_active(
    user_id: int,
    active: bool,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Ativa ou inativa um usuário do tenant (somente administradores)."""
    tenant_id = current_user.get("tenant_id")
    actor_id = current_user.get("id") or current_user.get("user_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant não identificado")

    if not active and user_id == actor_id:
        raise HTTPException(status_code=400, detail="Você não pode inativar sua própria conta")

    user = _get_tenant_user(db, tenant_id, user_id)
    user.active = active
    db.commit()
    db.refresh(user)
    return user


@router.patch("/tenant/{user_id}", response_model=TenantUserListItem)
async def update_tenant_user(
    user_id: int,
    data: TenantUserUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Atualiza dados de um usuário do tenant (somente administradores)."""
    tenant_id = current_user.get("tenant_id")
    actor_id = current_user.get("id") or current_user.get("user_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant não identificado")

    user = _get_tenant_user(db, tenant_id, user_id)
    fields_set = data.model_fields_set

    if "email" in fields_set and data.email is not None:
        existing = (
            db.query(Usuario)
            .filter(
                Usuario.tenant_id == tenant_id,
                Usuario.email == data.email,
                Usuario.id != user_id,
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=409, detail="Já existe um usuário com este e-mail")
        user.email = data.email

    if "first_name" in fields_set and data.first_name is not None:
        user.first_name = data.first_name.strip()
    if "last_name" in fields_set:
        user.last_name = data.last_name.strip() if data.last_name else None

    if "password" in fields_set and data.password:
        user.password_hash = _hash(data.password)

    if "role" in fields_set and data.role is not None:
        new_admin = _role_to_is_admin(data.role)
        if user_id == actor_id and not new_admin:
            raise HTTPException(
                status_code=400,
                detail="Você não pode remover seu próprio perfil de administrador",
            )
        user.role = data.role
        user.is_admin = new_admin
        _sync_admin_permissions(db, tenant_id, user_id, new_admin)

    db.commit()
    db.refresh(user)
    return user


@router.delete("/tenant/{user_id}", status_code=204)
async def delete_tenant_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Exclui permanentemente um usuário do tenant."""
    tenant_id = current_user.get("tenant_id")
    actor_id = current_user.get("id") or current_user.get("user_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant não identificado")

    if user_id == actor_id:
        raise HTTPException(status_code=400, detail="Você não pode excluir sua própria conta")

    user = _get_tenant_user(db, tenant_id, user_id)
    db.delete(user)
    db.commit()


@router.post("/tenant/bulk-delete", response_model=BulkDeleteResponse)
async def bulk_delete_tenant_users(
    body: BulkIdsRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """Exclui permanentemente vários usuários do tenant."""
    if not body.ids:
        raise HTTPException(status_code=400, detail="Nenhum usuário selecionado")

    tenant_id = current_user.get("tenant_id")
    actor_id = current_user.get("id") or current_user.get("user_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant não identificado")

    unique_ids = [i for i in dict.fromkeys(body.ids) if i != actor_id]
    skipped_self = len(body.ids) - len(unique_ids)

    users = (
        db.query(Usuario)
        .filter(Usuario.id.in_(unique_ids), Usuario.tenant_id == tenant_id)
        .all()
    )
    for user in users:
        db.delete(user)

    db.commit()
    deleted = len(users)
    skipped = len(body.ids) - deleted
    if skipped_self and skipped == skipped_self and deleted == 0:
        raise HTTPException(
            status_code=400,
            detail="Não é possível excluir sua própria conta",
        )
    return BulkDeleteResponse(deleted=deleted, skipped=skipped)


@router.patch("/me", response_model=UserResponse)
async def update_profile(
    data: UserUpdateName,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Atualiza nome do usuário logado."""
    user_id = current_user.get("id") or current_user.get("user_id")
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    user.first_name = data.first_name.strip()
    if data.last_name is not None:
        user.last_name = data.last_name.strip()
    db.commit()
    db.refresh(user)
    return user


@router.patch("/me/password")
async def change_password(
    data: UserUpdatePassword,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Altera a senha do usuário logado."""
    user_id = current_user.get("id") or current_user.get("user_id")
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    if user.password_hash != _hash(data.current_password):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")

    user.password_hash = _hash(data.new_password)
    db.commit()
    return {"detail": "Senha alterada com sucesso"}


@router.get("/me-info")
async def get_me_info(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Retorna dados do usuário logado incluindo avatar_url."""
    user_id = current_user.get("id") or current_user.get("user_id")
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    avatar_url = None
    if user.profile_image_filename:
        avatar_url = f"/uploads/avatars/{user.profile_image_filename}"

    return {
        "id": user.id,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "avatar_url": avatar_url,
    }


@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Faz upload do avatar do usuário logado."""
    user_id = current_user.get("id") or current_user.get("user_id")
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Validar tipo do arquivo
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Arquivo deve ser uma imagem (jpg, png, etc.)")

    # Criar diretório se não existir
    os.makedirs(AVATARS_DIR, exist_ok=True)

    # Remover avatar antigo se existir
    if user.profile_image_filename:
        old_path = os.path.join(AVATARS_DIR, user.profile_image_filename)
        if os.path.exists(old_path):
            try:
                os.remove(old_path)
            except OSError:
                pass

    # Salvar novo avatar com nome único
    ext = (file.filename or "avatar").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "jpg"
    if ext not in {"jpg", "jpeg", "png", "webp", "gif"}:
        ext = "jpg"
    filename = f"{user_id}_{uuid.uuid4().hex[:10]}.{ext}"
    file_path = os.path.join(AVATARS_DIR, filename)

    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)

    # Atualizar banco
    user.profile_image_filename = filename
    db.commit()

    return {"avatar_url": f"/uploads/avatars/{filename}"}


@router.delete("/me/avatar")
async def delete_avatar(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Remove o avatar do usuário logado."""
    user_id = current_user.get("id") or current_user.get("user_id")
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    if user.profile_image_filename:
        file_path = os.path.join(AVATARS_DIR, user.profile_image_filename)
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        user.profile_image_filename = None
        db.commit()

    return {"detail": "Avatar removido com sucesso"}
