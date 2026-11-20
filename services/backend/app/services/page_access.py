# -*- coding: utf-8 -*-
"""Resolução de acesso a páginas por usuário (admin bypass + grants)."""

from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.page_catalog import PLUMO_APP_PAGES, GRANTABLE_PAGE_KEYS
from app.models.auth_models import AppPage


def pages_map_for_admin(db: Session) -> Dict[str, Dict[str, bool]]:
    del db  # catálogo fixo; admin tem leitura/escrita em todas as páginas cadastradas
    return {p["page_key"]: {"can_read": True, "can_write": True} for p in PLUMO_APP_PAGES}


def resolve_user_pages(
    db: Session, tenant_id: int, user_id: int, is_admin: bool, role: str = "user"
) -> Dict[str, Dict[str, bool]]:
    if is_admin:
        return pages_map_for_admin(db)
    from app.services.role_access import pages_map_for_role

    return pages_map_for_role(db, tenant_id, role)


def list_grantable_pages(db: Session) -> List[AppPage]:
    return (
        db.query(AppPage)
        .filter(AppPage.active.is_(True), AppPage.admin_only.is_(False))
        .order_by(AppPage.sort_order.asc(), AppPage.page_key.asc())
        .all()
    )


def validate_page_grants_payload(
    page_grants: List[dict],
) -> List[dict]:
    """Normaliza e valida grants; levanta ValueError em chaves inválidas."""
    normalized: List[dict] = []
    seen: set[str] = set()
    for item in page_grants:
        page_key = (item.get("page_key") or "").strip()
        if not page_key or page_key in seen:
            continue
        if page_key not in GRANTABLE_PAGE_KEYS:
            raise ValueError(f"Página inválida ou restrita: {page_key}")
        can_write = bool(item.get("can_write"))
        can_read = bool(item.get("can_read")) or can_write
        if not can_read:
            continue
        seen.add(page_key)
        normalized.append(
            {"page_key": page_key, "can_read": can_read, "can_write": can_write}
        )
    return normalized


def user_has_page_access(
    pages: Optional[Dict[str, Dict[str, bool]]],
    page_key: str,
    *,
    write: bool = False,
    is_admin: bool = False,
) -> bool:
    if is_admin:
        return True
    if not pages:
        return False
    entry = pages.get(page_key)
    if not entry or not entry.get("can_read"):
        return False
    if write:
        return bool(entry.get("can_write"))
    return True