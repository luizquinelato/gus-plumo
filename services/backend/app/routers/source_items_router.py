"""Detalhe de itens importados por source_table + source_id (projeção, empréstimos)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_account
from app.routers.reports_router import ExpenseDetail
from app.services.source_item_service import ALLOWED_SOURCE_TABLES, bank_statement_expense_detail

router = APIRouter(prefix="/api/source-items", tags=["source-items"])


@router.get("/{source_table}/{source_id}/expense-detail", response_model=ExpenseDetail)
async def get_expense_detail(
    source_table: str,
    source_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id = int(current_user["tenant_id"])
    account_id = int(current_user["account_id"])
    if source_table not in ALLOWED_SOURCE_TABLES:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="source_table não suportado neste endpoint")
    if source_table != "bank_statements":
        from fastapi import HTTPException
        raise HTTPException(status_code=501, detail="Detalhe disponível apenas para bank_statements por enquanto")
    payload = bank_statement_expense_detail(db, tenant_id, account_id, source_id)
    return ExpenseDetail.model_validate(payload)