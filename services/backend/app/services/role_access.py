# -*- coding: utf-8 -*-
"""Concessões de páginas por role no tenant."""

from typing import Dict, List

from sqlalchemy.orm import Session

from app.models.auth_models import RolePageGrant
from app.services.page_access import list_grantable_pages, pages_map_for_admin, validate_page_grants_payload


def pages_map_for_role(db: Session, tenant_id: int, role: str) -> Dict[str, Dict[str, bool]]:
    if role == "admin":
        return pages_map_for_admin(db)

    rows = (
        db.query(RolePageGrant)
        .filter(
            RolePageGrant.tenant_id == tenant_id,
            RolePageGrant.role == role,
            RolePageGrant.active.is_(True),
            RolePageGrant.can_read.is_(True),
        )
        .all()
    )
    return {
        r.page_key: {"can_read": bool(r.can_read), "can_write": bool(r.can_write)}
        for r in rows
    }


def role_page_grants_list(db: Session, tenant_id: int, role: str) -> List[dict]:
    rows = (
        db.query(RolePageGrant)
        .filter(
            RolePageGrant.tenant_id == tenant_id,
            RolePageGrant.role == role,
            RolePageGrant.active.is_(True),
        )
        .order_by(RolePageGrant.page_key.asc())
        .all()
    )
    return [
        {
            "page_key": r.page_key,
            "can_read": r.can_read,
            "can_write": r.can_write,
        }
        for r in rows
        if r.can_read
    ]


def sync_role_page_grants(
    db: Session,
    tenant_id: int,
    role: str,
    granted_by: int,
    page_grants: List[dict],
) -> None:
    if role == "admin":
        raise ValueError("O perfil administrador tem acesso total; configure apenas o perfil usuário")

    grants = validate_page_grants_payload(page_grants)

    existing = (
        db.query(RolePageGrant)
        .filter(RolePageGrant.tenant_id == tenant_id, RolePageGrant.role == role)
        .all()
    )
    by_key = {g.page_key: g for g in existing}
    desired_keys = {g["page_key"] for g in grants}

    for grant in grants:
        row = by_key.get(grant["page_key"])
        if row:
            row.active = True
            row.can_read = grant["can_read"]
            row.can_write = grant["can_write"]
            row.granted_by = granted_by
        else:
            db.add(
                RolePageGrant(
                    tenant_id=tenant_id,
                    role=role,
                    page_key=grant["page_key"],
                    can_read=grant["can_read"],
                    can_write=grant["can_write"],
                    granted_by=granted_by,
                    active=True,
                )
            )

    for key, row in by_key.items():
        if key not in desired_keys:
            row.active = False


def grantable_pages(db: Session) -> List:
    return list_grantable_pages(db)