"""Mantém projeções espelho alinhadas ao extrato (source_table + source_id)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.unified_models import BankStatement, MonthlyProjection
from decimal import Decimal

from app.services.monthly_projection_service import (
    BANK_STATEMENT_SOURCE,
    FINAL_PAYROLL_OPENING_ADJUSTED_DESCRIPTION,
    _compute_opening_for_month,
    _month_bounds,
    _money,
    _payroll_linked_description,
    _statement_day,
    is_day1_anchored_final_payroll,
)


def delete_projections_for_source(
    db: Session,
    tenant_id: int,
    source_table: str,
    source_id: int,
) -> int:
    rows = (
        db.query(MonthlyProjection)
        .filter(
            MonthlyProjection.tenant_id == tenant_id,
            MonthlyProjection.source_table == source_table,
            MonthlyProjection.source_id == source_id,
        )
        .all()
    )
    n = 0
    for proj in rows:
        if proj.source == "payroll":
            proj.source_table = None
            proj.source_id = None
            n += 1
        else:
            db.delete(proj)
            n += 1
    return n


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
    raw = _money(statement.amount)
    if raw == 0:
        return 0
    credit = raw if raw > 0 else -raw
    pct = Decimal(str(statement.ownership_percentage if statement.ownership_percentage is not None else 100))
    mine = _money(credit * pct / Decimal(100))
    income = raw > 0
    day = _statement_day(statement.date)
    ym = day.strftime("%Y-%m")
    updated = 0
    for proj in rows:
        if proj.source == "payroll" and is_day1_anchored_final_payroll(proj):
            proj.kind = "income"
            if (proj.description or "").strip() == FINAL_PAYROLL_OPENING_ADJUSTED_DESCRIPTION:
                month_start, _ = _month_bounds(proj.year_month)
                opening = _compute_opening_for_month(
                    db, statement.tenant_id, statement.account_id, month_start,
                )
                opening_amt = abs(_money(opening))
                proj.amount = opening_amt
                proj.my_amount = opening_amt
            else:
                proj.amount = abs(credit)
                proj.my_amount = abs(mine)
                proj.description = FINAL_PAYROLL_OPENING_ADJUSTED_DESCRIPTION
            updated += 1
            continue
        proj.year_month = ym
        proj.expected_date = day
        proj.kind = "income" if income else "variable"
        if proj.source == "payroll":
            proj.description = _payroll_linked_description(proj, statement)
            proj.amount = abs(credit)
            proj.my_amount = abs(mine)
        else:
            desc = (statement.description or "").strip()[:255] or "Extrato"
            proj.description = desc
            proj.source = BANK_STATEMENT_SOURCE
            proj.amount = abs(credit)
            proj.my_amount = abs(mine)
        updated += 1
    return updated