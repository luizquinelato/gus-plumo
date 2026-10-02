"""Rotas de reconciliação entre fatura de cartão e pagamento no extrato."""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_account
from app.services import invoice_payment_match_service as match_service

router = APIRouter(prefix="/api/invoice-payment-matches", tags=["invoice-payment-matches"])


class MatchCreate(BaseModel):
    year_month: str = Field(..., min_length=7, max_length=7)
    bank_statement_id: int
    invoice_group_id: Optional[int] = None
    credit_card_id: Optional[int] = None
    match_method: str = "manual"


def _scope(current_user: dict) -> tuple[int, int, int]:
    tenant_id = current_user.get("tenant_id")
    account_id = current_user.get("account_id")
    user_id = current_user.get("user_id") or current_user.get("id")
    if tenant_id is None or account_id is None or user_id is None:
        raise HTTPException(status_code=400, detail="Conta ou usuário inválido no token")
    return int(tenant_id), int(account_id), int(user_id)


def _http_from_service(exc: Exception) -> HTTPException:
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/preview")
async def preview_matches(
    year_month: str = Query(..., min_length=7, max_length=7),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    try:
        return match_service.preview(db, tenant_id, account_id, year_month)
    except ValueError as exc:
        raise _http_from_service(exc)


@router.get("/preview-history")
async def preview_history(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    return match_service.preview_history(db, tenant_id, account_id)


@router.post("/auto")
async def auto_match(
    year_month: str = Query(..., min_length=7, max_length=7),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, user_id = _scope(current_user)
    try:
        return match_service.auto_match(db, tenant_id, account_id, user_id, year_month)
    except ValueError as exc:
        raise _http_from_service(exc)


@router.post("/auto-history")
async def auto_match_history(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, user_id = _scope(current_user)
    return match_service.auto_match_history(db, tenant_id, account_id, user_id)


@router.post("/suggest-history")
async def suggest_auto_history(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    return match_service.suggest_auto_history(db, tenant_id, account_id)


@router.get("/search-statements")
async def search_statements(
    start_date: date = Query(...),
    end_date: date = Query(...),
    min_amount: float = Query(..., gt=0),
    max_amount: float = Query(..., gt=0),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    try:
        return match_service.search_statements(
            db, tenant_id, account_id, start_date, end_date, min_amount, max_amount,
        )
    except ValueError as exc:
        raise _http_from_service(exc)


@router.get("/by-bank-statement/{bank_statement_id}")
async def get_invoice_detail_for_bank_statement(
    bank_statement_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    try:
        return match_service.invoice_detail_for_bank_statement(
            db, tenant_id, account_id, bank_statement_id,
        )
    except LookupError as exc:
        raise _http_from_service(exc)


@router.get("/")
async def list_matches(
    year_month: Optional[str] = Query(None, min_length=7, max_length=7),
    bank_year_month: Optional[str] = Query(None, min_length=7, max_length=7),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    if not year_month and not bank_year_month:
        raise HTTPException(
            status_code=400,
            detail="Informe year_month ou bank_year_month",
        )
    tenant_id, account_id, _user_id = _scope(current_user)
    try:
        return match_service.list_matches(
            db, tenant_id, account_id,
            year_month=year_month,
            bank_year_month=bank_year_month,
        )
    except ValueError as exc:
        raise _http_from_service(exc)


@router.post("/", status_code=201)
async def create_match(
    payload: MatchCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, user_id = _scope(current_user)
    try:
        return match_service.apply_match(
            db,
            tenant_id,
            account_id,
            user_id,
            payload.year_month,
            payload.bank_statement_id,
            payload.invoice_group_id,
            payload.credit_card_id,
            payload.match_method or "manual",
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Este vínculo já existe")
    except (ValueError, LookupError) as exc:
        db.rollback()
        raise _http_from_service(exc)


class MatchSkip(BaseModel):
    year_month: str = Field(..., min_length=7, max_length=7)
    invoice_group_id: Optional[int] = None
    credit_card_id: Optional[int] = None


@router.post("/skip", status_code=201)
async def skip_match(
    payload: MatchSkip,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, user_id = _scope(current_user)
    try:
        return match_service.skip_match(
            db,
            tenant_id,
            account_id,
            user_id,
            payload.year_month,
            payload.invoice_group_id,
            payload.credit_card_id,
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Este ciclo já está marcado")
    except (ValueError, LookupError) as exc:
        db.rollback()
        raise _http_from_service(exc)


@router.delete("/{match_id}", status_code=204)
async def delete_match(
    match_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    try:
        match_service.unmatch(db, tenant_id, account_id, match_id)
    except LookupError as exc:
        raise _http_from_service(exc)
    return None
