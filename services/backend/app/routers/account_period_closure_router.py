"""Rotas de fechamento mensal da conta (extrato)."""

from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_account
from app.services import account_period_closure_service as closure_service

router = APIRouter(prefix="/api/account-period-closures", tags=["account-period-closures"])


def _scope(current_user: dict) -> tuple[int, int, int]:
    tenant_id = current_user.get("tenant_id")
    account_id = current_user.get("account_id")
    user_id = current_user.get("user_id") or current_user.get("id")
    if tenant_id is None or account_id is None or user_id is None:
        raise HTTPException(status_code=400, detail="Conta ou usuário inválido no token")
    return int(tenant_id), int(account_id), int(user_id)


def _raise_service(exc: Exception) -> None:
    if isinstance(exc, closure_service.AccountPeriodClosedError):
        raise HTTPException(status_code=409, detail=exc.message) from exc
    if isinstance(exc, closure_service.AccountPeriodCloseError):
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    raise exc


class ClosePeriodRequest(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    opening_balance: Optional[Decimal] = None
    adjustment: Optional[Decimal] = None
    notes: Optional[str] = None


class BulkCloseMonth(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)


class BulkCloseRequest(BaseModel):
    months: list[BulkCloseMonth] = Field(..., min_length=1)
    adjustment: Optional[Decimal] = None
    notes: Optional[str] = None


@router.get("/options")
async def list_account_period_closure_options(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    try:
        return closure_service.list_options(db, tenant_id, account_id)
    except (closure_service.AccountPeriodCloseError, closure_service.AccountPeriodClosedError) as exc:
        _raise_service(exc)


@router.get("")
async def list_account_period_closures(
    year: Optional[int] = Query(None, ge=2000, le=2100),
    all_years: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    try:
        return closure_service.list_year(db, tenant_id, account_id, year, all_years)
    except (closure_service.AccountPeriodCloseError, closure_service.AccountPeriodClosedError) as exc:
        _raise_service(exc)


@router.get("/preview")
async def preview_account_period(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    try:
        return closure_service.get_preview(db, tenant_id, account_id, year, month)
    except (closure_service.AccountPeriodCloseError, closure_service.AccountPeriodClosedError) as exc:
        _raise_service(exc)


@router.get("/validate-date")
async def validate_date_against_account_closures(
    date_value: str = Query(..., alias="date", description="Data no formato YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    try:
        return closure_service.validate_date(db, tenant_id, account_id, date_value)
    except (closure_service.AccountPeriodCloseError, closure_service.AccountPeriodClosedError) as exc:
        _raise_service(exc)


@router.post("")
async def close_account_period(
    request: ClosePeriodRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, user_id = _scope(current_user)
    try:
        return closure_service.close_period(
            db,
            tenant_id,
            account_id,
            user_id,
            request.year,
            request.month,
            request.opening_balance,
            request.notes,
            request.adjustment,
        )
    except (closure_service.AccountPeriodCloseError, closure_service.AccountPeriodClosedError) as exc:
        _raise_service(exc)


@router.post("/bulk")
async def bulk_close_account_periods(
    request: BulkCloseRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, user_id = _scope(current_user)
    try:
        return closure_service.close_periods(
            db,
            tenant_id,
            account_id,
            user_id,
            [(item.year, item.month) for item in request.months],
            request.adjustment,
            request.notes,
        )
    except (closure_service.AccountPeriodCloseError, closure_service.AccountPeriodClosedError) as exc:
        _raise_service(exc)


@router.delete("/{closure_id}")
async def reopen_account_period(
    closure_id: int,
    delete_adjustment: bool = Query(
        True,
        description="Se true, remove do extrato o lançamento de ajuste gravado no fechamento.",
    ),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    try:
        return closure_service.reopen_period(
            db,
            tenant_id,
            account_id,
            closure_id,
            delete_adjustment=delete_adjustment,
        )
    except (closure_service.AccountPeriodCloseError, closure_service.AccountPeriodClosedError) as exc:
        _raise_service(exc)
