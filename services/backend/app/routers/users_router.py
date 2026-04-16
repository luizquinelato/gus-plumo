"""
Router para gerenciamento do perfil do usuário logado.
"""
import hashlib
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.auth_models import Usuario
from app.dependencies.auth import get_current_user

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


def _hash(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


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
