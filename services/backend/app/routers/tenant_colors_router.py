"""
Router para gerenciamento de cores customizadas do tenant
Permite personalização completa da paleta de cores com validação WCAG
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict
import re

from ..database import get_db
from ..models.auth_models import TenantCores, Tenant
from ..services.color_calculation_service import ColorCalculationService
from ..dependencies.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/tenant/colors", tags=["Cores do Tenant"])


# ============================================================================
# SCHEMAS PYDANTIC
# ============================================================================

class ColorSchemeBase(BaseModel):
    """Schema base para esquema de cores."""
    color1: Optional[str] = Field(None, description="Cor principal 1")
    color2: Optional[str] = Field(None, description="Cor principal 2")
    color3: Optional[str] = Field(None, description="Cor principal 3")
    color4: Optional[str] = Field(None, description="Cor principal 4")
    color5: Optional[str] = Field(None, description="Cor principal 5")
    on_color1: Optional[str] = Field(None, description="Cor de texto sobre color1")
    on_color2: Optional[str] = Field(None, description="Cor de texto sobre color2")
    on_color3: Optional[str] = Field(None, description="Cor de texto sobre color3")
    on_color4: Optional[str] = Field(None, description="Cor de texto sobre color4")
    on_color5: Optional[str] = Field(None, description="Cor de texto sobre color5")
    on_gradient_1_2: Optional[str] = Field(None, description="Cor de texto sobre gradiente 1-2")
    on_gradient_2_3: Optional[str] = Field(None, description="Cor de texto sobre gradiente 2-3")
    on_gradient_3_4: Optional[str] = Field(None, description="Cor de texto sobre gradiente 3-4")
    on_gradient_4_5: Optional[str] = Field(None, description="Cor de texto sobre gradiente 4-5")
    on_gradient_5_1: Optional[str] = Field(None, description="Cor de texto sobre gradiente 5-1")

    @validator('color1', 'color2', 'color3', 'color4', 'color5',
               'on_color1', 'on_color2', 'on_color3', 'on_color4', 'on_color5',
               'on_gradient_1_2', 'on_gradient_2_3', 'on_gradient_3_4', 'on_gradient_4_5', 'on_gradient_5_1')
    def validate_hex_color(cls, v):
        """Valida se a cor está em formato hexadecimal válido."""
        if v is None:
            return v
        if not isinstance(v, str):
            raise ValueError(f'Cor deve ser uma string, recebido: {type(v)}')
        if not re.match(r'^#[0-9A-Fa-f]{6}$', v):
            raise ValueError(f'Cor inválida: {v}. Use formato hexadecimal #RRGGBB')
        return v.upper()


class ColorSchemeUpdate(ColorSchemeBase):
    """Schema para atualização de cores."""
    pass


class ColorSchemeResponse(ColorSchemeBase):
    """Schema de resposta com cores do tenant."""
    id: int
    tenant_id: int
    color_schema_mode: str
    accessibility_level: str
    theme_mode: str
    active: bool

    class Config:
        from_attributes = True


# ============================================================================
# ENDPOINTS
# ============================================================================

@router.get("/", response_model=ColorSchemeResponse)
def get_tenant_colors(
    theme_mode: str = "light",
    accessibility_level: str = "regular",
    db: Session = Depends(get_db)
):
    """
    Retorna as cores customizadas do tenant.
    
    Args:
        theme_mode: Modo do tema (light ou dark)
        accessibility_level: Nível de acessibilidade (regular, high_contrast, colorblind_safe)
        db: Sessão do banco de dados
    
    Returns:
        Esquema de cores do tenant
    """
    # TODO: Obter tenant_id do token JWT quando autenticação estiver implementada
    tenant_id = 1

    # Busca cores customizadas do tenant
    colors = db.query(TenantCores).filter(
        TenantCores.tenant_id == tenant_id,
        TenantCores.theme_mode == theme_mode,
        TenantCores.accessibility_level == accessibility_level,
        TenantCores.active == True
    ).first()

    if not colors:
        raise HTTPException(
            status_code=404,
            detail=f"Esquema de cores não encontrado para tema '{theme_mode}' e nível '{accessibility_level}'"
        )

    return colors


@router.put("/", response_model=ColorSchemeResponse)
def update_tenant_colors(
    colors_data: ColorSchemeUpdate,
    theme_mode: str = "light",
    accessibility_level: str = "regular",
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin)
):
    """
    Atualiza as cores customizadas do tenant.
    Requer permissões de administrador.

    Args:
        colors_data: Dados das cores a serem atualizadas
        theme_mode: Modo do tema (light ou dark)
        accessibility_level: Nível de acessibilidade
        db: Sessão do banco de dados
        current_user: Usuário autenticado (admin)

    Returns:
        Esquema de cores atualizado
    """
    tenant_id = current_user.get("tenant_id", 1)

    # Busca cores existentes
    colors = db.query(TenantCores).filter(
        TenantCores.tenant_id == tenant_id,
        TenantCores.theme_mode == theme_mode,
        TenantCores.accessibility_level == accessibility_level,
        TenantCores.active == True
    ).first()

    if not colors:
        raise HTTPException(status_code=404, detail="Esquema de cores não encontrado")

    # Atualiza apenas os campos fornecidos
    update_data = colors_data.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(colors, field, value)

    # Marca como customizado
    colors.color_schema_mode = "custom"

    db.commit()
    db.refresh(colors)

    return colors


# ============================================================================
# UNIFIED ENDPOINTS (New Architecture)
# ============================================================================

class UnifiedColorUpdate(BaseModel):
    """Schema for updating colors in unified mode"""
    light_colors: Dict[str, str] = Field(..., description="Light theme colors (color1-5)")
    dark_colors: Dict[str, str] = Field(..., description="Dark theme colors (color1-5)")


class ColorModeUpdate(BaseModel):
    """Schema for updating color schema mode"""
    mode: str = Field(..., description="Color schema mode: 'default' or 'custom'")


@router.get("/unified")
async def get_unified_colors(
    mode: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Get all color combinations for the tenant (unified endpoint).
    Returns all 12 combinations: 2 modes × 2 themes × 3 accessibility levels

    This endpoint loads everything at once to prevent multiple API calls
    and enable instant theme switching without flash.

    Args:
        mode: Optional color schema mode filter ('default' or 'custom')
        db: Database session
        current_user: Authenticated user from JWT token

    Returns:
        {
            "success": true,
            "color_schema_mode": "custom",
            "colors": [
                { mode, theme, level, color1-5, on_color1-5, on_gradient_* },
                ...
            ]
        }
    """
    try:
        # Get tenant_id from authenticated user
        tenant_id = current_user.get("tenant_id", 1)

        # Get tenant's current color schema mode
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")

        color_mode = mode if mode and mode in ['default', 'custom'] else tenant.color_schema_mode

        # Get all color combinations for this tenant
        colors = db.query(TenantCores).filter(
            TenantCores.tenant_id == tenant_id,
            TenantCores.active == True
        ).order_by(
            TenantCores.color_schema_mode,
            TenantCores.theme_mode,
            TenantCores.accessibility_level
        ).all()

        if not colors:
            raise HTTPException(
                status_code=404,
                detail=f"No color configurations found for tenant {tenant_id}"
            )
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error loading colors: {str(e)}")

    # Convert to array format expected by frontend
    colors_array = []
    for row in colors:
        colors_array.append({
            'color_schema_mode': row.color_schema_mode,
            'theme_mode': row.theme_mode,
            'accessibility_level': row.accessibility_level,
            'color1': row.color1,
            'color2': row.color2,
            'color3': row.color3,
            'color4': row.color4,
            'color5': row.color5,
            'on_color1': row.on_color1,
            'on_color2': row.on_color2,
            'on_color3': row.on_color3,
            'on_color4': row.on_color4,
            'on_color5': row.on_color5,
            'on_gradient_1_2': row.on_gradient_1_2,
            'on_gradient_2_3': row.on_gradient_2_3,
            'on_gradient_3_4': row.on_gradient_3_4,
            'on_gradient_4_5': row.on_gradient_4_5,
            'on_gradient_5_1': row.on_gradient_5_1,
        })

    return {
        "success": True,
        "color_schema_mode": color_mode,
        "colors": colors_array
    }


@router.post("/unified")
async def update_unified_colors(
    colors_data: UnifiedColorUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin)
):
    """
    Update colors in unified mode (updates both light and dark themes).
    Automatically calculates variants for all accessibility levels.
    Requer permissões de administrador.

    This endpoint:
    1. Takes light_colors and dark_colors (color1-5 only)
    2. Calculates on_colors and gradient colors automatically
    3. Creates variants for regular, AA, and AAA accessibility levels
    4. Updates 6 rows total (2 themes × 3 levels) in custom mode

    Args:
        colors_data: Light and dark theme colors
        db: Database session
        current_user: Authenticated user from JWT token

    Returns:
        {"success": true, "message": "..."}
    """
    # Get tenant_id from authenticated user
    tenant_id = current_user.get("tenant_id", 1)

    calc_service = ColorCalculationService()

    try:
        # Process both light and dark themes
        for theme_mode in ['light', 'dark']:
            base_colors = colors_data.light_colors if theme_mode == 'light' else colors_data.dark_colors

            # Validate base colors
            for i in range(1, 6):
                color_key = f'color{i}'
                if color_key not in base_colors:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Missing {color_key} in {theme_mode}_colors"
                    )

            # Process each accessibility level
            for accessibility_level in ['regular', 'AA', 'AAA']:
                # Apply accessibility enhancement if needed
                enhanced_colors = {}
                for i in range(1, 6):
                    color_key = f'color{i}'
                    enhanced_colors[color_key] = calc_service.apply_accessibility_enhancement(
                        base_colors[color_key],
                        accessibility_level
                    )

                # Calculate variants (on-colors and gradients)
                variants = calc_service.calculate_all_variants(enhanced_colors)

                # Find or create color row
                color_row = db.query(TenantCores).filter(
                    TenantCores.tenant_id == tenant_id,
                    TenantCores.color_schema_mode == 'custom',
                    TenantCores.theme_mode == theme_mode,
                    TenantCores.accessibility_level == accessibility_level
                ).first()

                if not color_row:
                    color_row = TenantCores(
                        tenant_id=tenant_id,
                        color_schema_mode='custom',
                        theme_mode=theme_mode,
                        accessibility_level=accessibility_level,
                        active=True
                    )
                    db.add(color_row)

                # Update base colors
                color_row.color1 = enhanced_colors.get('color1')
                color_row.color2 = enhanced_colors.get('color2')
                color_row.color3 = enhanced_colors.get('color3')
                color_row.color4 = enhanced_colors.get('color4')
                color_row.color5 = enhanced_colors.get('color5')

                # Update calculated variants
                color_row.on_color1 = variants.on_colors.get('on_color1')
                color_row.on_color2 = variants.on_colors.get('on_color2')
                color_row.on_color3 = variants.on_colors.get('on_color3')
                color_row.on_color4 = variants.on_colors.get('on_color4')
                color_row.on_color5 = variants.on_colors.get('on_color5')

                color_row.on_gradient_1_2 = variants.gradient_colors.get('on_gradient_1_2')
                color_row.on_gradient_2_3 = variants.gradient_colors.get('on_gradient_2_3')
                color_row.on_gradient_3_4 = variants.gradient_colors.get('on_gradient_3_4')
                color_row.on_gradient_4_5 = variants.gradient_colors.get('on_gradient_4_5')
                color_row.on_gradient_5_1 = variants.gradient_colors.get('on_gradient_5_1')

        db.commit()

        return {
            "success": True,
            "message": "Unified color schema updated successfully"
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Error updating unified color schema: {str(e)}"
        )


@router.post("/mode")
async def update_color_mode(
    mode_data: ColorModeUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Update the color schema mode (default or custom).

    Args:
        mode_data: Mode to set ('default' or 'custom')
        db: Database session
        current_user: Authenticated user from JWT token

    Returns:
        {"success": true, "mode": "custom"}
    """
    # Get tenant_id from authenticated user
    tenant_id = current_user.get("tenant_id", 1)

    # Validate mode
    if mode_data.mode not in ['default', 'custom']:
        raise HTTPException(
            status_code=400,
            detail="Mode must be 'default' or 'custom'"
        )

    # Update tenant's color schema mode
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    tenant.color_schema_mode = mode_data.mode
    db.commit()

    return {
        "success": True,
        "message": f"Color schema mode updated to '{mode_data.mode}'",
        "mode": mode_data.mode
    }

