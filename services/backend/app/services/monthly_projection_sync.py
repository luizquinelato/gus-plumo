"""Mantém projeções espelho alinhadas ao extrato (source_table + source_id)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.unified_models import BankStatement, MonthlyProjection
from app.services.monthly_projection_service import (
    BANK_STATEMENT_SOURCE,
    _money,
    _statement_day,
)


def delete_projections_for_source(
    db: Session,
    tenant_id: int,
    source_table: str,
    source_id: int,
) -> int:
    removed = (
        db.query(MonthlyProjection)
        .filter(
            MonthlyProjection.tenant_id == tenant_id,
            MonthlyProjection.source_table == source_table,
            MonthlyProjection.source_id == source_id,
        )
        .delete(synchronize_session=False)
    )
    return removed


def sync_from_bank_statement(db: Session, statement: BankStatement) -> int:
    rows = (
        db.query(MonthlyProjection)
        .filter(
            MonthlyProjection.tenant_id == statement.tenant_id,
            MonthlyProjection.source_table == "bank_statements",
            MonthlyProjection.source_id == statement.id,
        )
        .all()
    )
    if not rows:
        return 0
    amount = _money(statement.amount)
    if amount == 0:
        return 0
    income = amount > 0
    desc = (statement.description or "").strip()[:255] or "Extrato"
    day = _statement_day(statement.date)
    ym = day.strftime("%Y-%m")
    updated = 0
    for proj in rows:
        proj.year_month = ym
        proj.expected_date = day
        proj.description = desc
        proj.kind = "income" if income else "variable"
        proj.source = BANK_STATEMENT_SOURCE
        proj.amount = abs(amount)
        proj.my_amount = abs(amount)
        updated += 1
    return updated