"""
Router para gerenciamento de preferências do usuário
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models.auth_models import Usuario
from app.dependencies.auth import get_current_user

router = APIRouter(prefix="/api/user/preferences", tags=["user-preferences"])


class ThemePreferenceUpdate(BaseModel):
    """Schema para atualizar preferência de tema"""
    theme_mode: str  # 'light' ou 'dark'


class ThemePreferenceResponse(BaseModel):
    """Schema de resposta de preferência de tema"""
    theme_mode: str
    
    class Config:
        from_attributes = True


@router.patch("/theme", response_model=ThemePreferenceResponse)
async def update_theme_preference(
    theme_data: ThemePreferenceUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Atualiza a preferência de tema do usuário.
    
    Args:
        theme_data: Dados do tema ('light' ou 'dark')
        db: Sessão do banco de dados
        current_user: Usuário autenticado
    
    Returns:
        Preferência de tema atualizada
    """
    # O serviço de auth retorna 'id', não 'user_id'
    user_id = current_user.get("id") or current_user.get("user_id")

    # Valida o tema
    if theme_data.theme_mode not in ['light', 'dark']:
        raise HTTPException(
            status_code=400,
            detail="theme_mode deve ser 'light' ou 'dark'"
        )

    # Busca o usuário
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Atualiza o tema
    user.theme_mode = theme_data.theme_mode
    db.commit()
    db.refresh(user)

    return ThemePreferenceResponse(theme_mode=user.theme_mode)


@router.get("/theme", response_model=ThemePreferenceResponse)
async def get_theme_preference(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Obtém a preferência de tema do usuário.
    
    Args:
        db: Sessão do banco de dados
        current_user: Usuário autenticado
    
    Returns:
        Preferência de tema do usuário
    """
    # O serviço de auth retorna 'id', não 'user_id'
    user_id = current_user.get("id") or current_user.get("user_id")

    # Busca o usuário
    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    return ThemePreferenceResponse(theme_mode=user.theme_mode or 'light')

