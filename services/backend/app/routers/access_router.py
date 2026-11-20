"""Configuração de acesso por página e perfil (role)."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_admin
from app.services.role_access import grantable_pages, role_page_grants_list, sync_role_page_grants

router = APIRouter(prefix="/api/access", tags=["access"])


class PageGrantPayload(BaseModel):
    page_key: str
    can_read: bool = False
    can_write: bool = False


class PageOption(BaseModel):
    page_key: str
    route: str
    label: str
    group_label: str
    sort_order: int

    class Config:
        from_attributes = True


class RolePagesResponse(BaseModel):
    role: str
    configurable: bool
    page_options: List[PageOption]
    page_grants: List[PageGrantPayload] = Field(default_factory=list)


class RolePagesUpdate(BaseModel):
    page_grants: List[PageGrantPayload] = Field(default_factory=list)


def _parse_role(role: str) -> str:
    r = role.strip().lower()
    if r not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Perfil inválido; use admin ou user")
    return r


@router.get("/roles/{role}/pages", response_model=RolePagesResponse)
async def get_role_pages(
    role: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    tenant_id = current_user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant não identificado")
    r = _parse_role(role)
    options = grantable_pages(db)
    if r == "admin":
        return RolePagesResponse(
            role=r,
            configurable=False,
            page_options=options,
            page_grants=[
                PageGrantPayload(page_key=p.page_key, can_read=True, can_write=True)
                for p in options
            ],
        )
    return RolePagesResponse(
        role=r,
        configurable=True,
        page_options=options,
        page_grants=role_page_grants_list(db, tenant_id, r),
    )


@router.put("/roles/{role}/pages")
async def put_role_pages(
    role: str,
    body: RolePagesUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    tenant_id = current_user.get("tenant_id")
    granted_by = current_user.get("id") or current_user.get("user_id")
    if not tenant_id or not granted_by:
        raise HTTPException(status_code=400, detail="Sessão inválida")
    r = _parse_role(role)
    if r != "user":
        raise HTTPException(status_code=400, detail="Somente o perfil usuário pode ser editado")
    try:
        sync_role_page_grants(
            db,
            tenant_id,
            r,
            granted_by,
            [g.model_dump() for g in body.page_grants],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    return {"detail": "Páginas do perfil atualizadas"}