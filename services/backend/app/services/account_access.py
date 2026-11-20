# -*- coding: utf-8 -*-
"""Validação de acesso do usuário às contas (v1: todas as contas ativas do tenant)."""

from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session, Query

from app.models.unified_models import Account


def resolve_auth_flags(current_user: dict) -> tuple[int, int, bool]:
    tenant_id = current_user.get("tenant_id")
    user_id = current_user.get("user_id") or current_user.get("id")
    is_admin = bool(current_user.get("is_admin", False))
    if tenant_id is None or user_id is None:
        raise HTTPException(status_code=400, detail="Sessão inválida")
    return int(tenant_id), int(user_id), is_admin


def filter_accounts_for_user(
    query: Query,
    tenant_id: int,
    user_id: int,
    is_admin: bool,
) -> Query:
    """Restringe query de Account às contas ativas do tenant (admin e user: todas)."""
    del user_id, is_admin
    return query.filter(Account.tenant_id == tenant_id)


def filter_accounts_owned_or_admin(
    query: Query,
    tenant_id: int,
    user_id: int,
    is_admin: bool,
) -> Query:
    """Listagem de cadastro de contas: v1 — todas as contas ativas do tenant."""
    del user_id, is_admin
    return query.filter(Account.tenant_id == tenant_id)


def filter_accounts_cadastro_mutable(
    query: Query,
    tenant_id: int,
    user_id: int,
    is_admin: bool,
) -> Query:
    """Alteração/exclusão de metadados: v1 — todas do tenant (mutações via RBAC de página)."""
    del user_id, is_admin
    return query.filter(Account.tenant_id == tenant_id)


def get_account_if_accessible(
    db: Session,
    tenant_id: int,
    user_id: int,
    is_admin: bool,
    account_id: int,
    *,
    require_active: bool = True,
) -> Optional[Account]:
    q = db.query(Account).filter(Account.id == account_id, Account.tenant_id == tenant_id)
    if require_active:
        q = q.filter(Account.active.is_(True))
    q = filter_accounts_for_user(q, tenant_id, user_id, is_admin)
    return q.first()


def require_account_access(
    db: Session,
    tenant_id: int,
    user_id: int,
    is_admin: bool,
    account_id: int,
    *,
    require_active: bool = True,
    not_found_detail: str = "Conta não encontrada ou sem permissão de acesso",
) -> Account:
    account = get_account_if_accessible(
        db, tenant_id, user_id, is_admin, account_id, require_active=require_active
    )
    if not account:
        raise HTTPException(status_code=404, detail=not_found_detail)
    return account