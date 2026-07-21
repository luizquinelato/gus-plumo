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


class SidebarPreferenceUpdate(BaseModel):
    """Schema para atualizar preferência do sidebar"""
    sidebar_collapsed: bool


class SidebarPreferenceResponse(BaseModel):
    """Schema de resposta de preferência do sidebar"""
    sidebar_collapsed: bool

    class Config:
        from_attributes = True


class BalanceVisibilityPreferenceUpdate(BaseModel):
    """Schema para atualizar preferência de visibilidade de saldos"""
    hide_balance_values: bool


class BalanceVisibilityPreferenceResponse(BaseModel):
    """Schema de resposta de preferência de visibilidade de saldos"""
    hide_balance_values: bool

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


@router.patch("/sidebar", response_model=SidebarPreferenceResponse)
async def update_sidebar_preference(
    sidebar_data: SidebarPreferenceUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Atualiza a preferência de sidebar colapsado do usuário."""
    user_id = current_user.get("id") or current_user.get("user_id")

    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    user.sidebar_collapsed = sidebar_data.sidebar_collapsed
    db.commit()
    db.refresh(user)

    return SidebarPreferenceResponse(sidebar_collapsed=user.sidebar_collapsed)


@router.get("/sidebar", response_model=SidebarPreferenceResponse)
async def get_sidebar_preference(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Obtém a preferência de sidebar colapsado do usuário."""
    user_id = current_user.get("id") or current_user.get("user_id")

    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    return SidebarPreferenceResponse(sidebar_collapsed=user.sidebar_collapsed or False)


@router.patch("/balance-visibility", response_model=BalanceVisibilityPreferenceResponse)
async def update_balance_visibility_preference(
    preference_data: BalanceVisibilityPreferenceUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Atualiza a preferência de ocultar valores financeiros do usuário."""
    user_id = current_user.get("id") or current_user.get("user_id")

    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    user.hide_balance_values = preference_data.hide_balance_values
    db.commit()
    db.refresh(user)

    return BalanceVisibilityPreferenceResponse(hide_balance_values=user.hide_balance_values)


@router.get("/balance-visibility", response_model=BalanceVisibilityPreferenceResponse)
async def get_balance_visibility_preference(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Obtém a preferência de ocultar valores financeiros do usuário."""
    user_id = current_user.get("id") or current_user.get("user_id")

    user = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    return BalanceVisibilityPreferenceResponse(hide_balance_values=user.hide_balance_values or False)

