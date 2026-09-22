"""Rotas da Saúde Financeira (leitura dos fechamentos da conta)."""

from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_account
from app.services import financial_health_service as health_service

router = APIRouter(prefix="/api/financial-health", tags=["financial-health"])

ScopeQuery = Literal["all", "account", "shared"]


def _scope(current_user: dict) -> tuple[int, int]:
    tenant_id = current_user.get("tenant_id")
    account_id = current_user.get("account_id")
    if tenant_id is None or account_id is None:
        raise HTTPException(status_code=400, detail="Conta inválida no token")
    return int(tenant_id), int(account_id)


@router.get("/options")
async def get_financial_health_options(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id = _scope(current_user)
    return health_service.list_options(db, tenant_id, account_id)


@router.get("/categories")
async def get_financial_health_categories(
    year: Optional[int] = Query(None, ge=2000, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    scope: ScopeQuery = Query("all"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id = _scope(current_user)
    try:
        return health_service.get_categories(db, tenant_id, account_id, year, scope, month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("")
async def get_financial_health(
    year: Optional[int] = Query(None, ge=2000, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    scope: ScopeQuery = Query("all"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id = _scope(current_user)
    try:
        return health_service.get_series(db, tenant_id, account_id, year, scope, month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/details")
async def get_financial_health_details(
    kind: str = Query(..., description="entries ou exits"),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    tag_id: Optional[int] = Query(None, ge=-2),
    scope: ScopeQuery = Query("all"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id = _scope(current_user)
    try:
        return health_service.get_details(db, tenant_id, account_id, kind, year, tag_id, scope, month)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
