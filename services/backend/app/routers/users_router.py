"""
Router para gerenciamento do perfil do usuário logado.
"""
import hashlib
import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.auth_models import Usuario
from app.dependencies.auth import get_current_user

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
