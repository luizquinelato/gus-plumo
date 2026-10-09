# -*- coding: utf-8 -*-
"""Edições em meses fechados: classificação, patch de snapshot e recascata."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Callable, Literal, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models.unified_models import (
    BankStatement,
    BenefitCardStatement,
    Cartao,
    CreditCardInvoice,
    Subtag,
    Tag,
    TransactionMapping,
)
from app.services.account_period_closure_service import (
    AccountPeriodClosedError,
    ZERO,
    _as_date,
    _build_closure_snapshot,
    _month_flow,
    _money,
    closed_periods,
    get_closure_for_period,
    period_allocation_details,
    recascade_closed_periods,
)
from app.services.financial_health_service import split_signed_amount as fh_split

ChangeKind = Literal["classification", "split_only", "cash", "noop"]
ImpactType = Literal["none", "classification", "split_recalc", "financial"]


def _period_from_date(value: Any) -> Optional[tuple[int, int]]:
    parsed = _as_date(value)
    if parsed is None:
        return None
    return parsed.year, parsed.month


def _cash_adjustment_periods_from_dates(*dates: Any) -> set[tuple[int, int]]:
    """Meses em que lançamentos mudaram; só neles atualizamos o ajuste de fechamento."""
    periods: set[tuple[int, int]] = set()
    for value in dates:
        period = _period_from_date(value)
        if period:
            periods.add(period)
    return periods


def _year_month_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def classify_transaction_edit(
    *,
    old_amount: Any,
    new_amount: Any,
    old_date: Any,
    new_date: Any,
    old_subtag_id: int | None,
    new_subtag_id: int | None,
    old_sharing_id: int | None,
    new_sharing_id: int | None,
    old_ownership: Any,
    new_ownership: Any,
) -> ChangeKind:
    if _money(old_amount) != _money(new_amount) or _period_from_date(old_date) != _period_from_date(new_date):
        return "cash"
    if (old_sharing_id or None) != (new_sharing_id or None) or _money(
        100 if old_ownership is None else old_ownership
    ) != _money(100 if new_ownership is None else new_ownership):
        return "split_only"
    if (old_subtag_id or None) != (new_subtag_id or None):
        return "classification"
    return "noop"


def classify_bank_statement_edit(
    before: BankStatement,
    *,
    amount: float,
    date: Any,
    subtag_id: int | None,
    shared_partner_id: int | None,
    ownership_percentage: float | None,
) -> ChangeKind:
    return classify_transaction_edit(
        old_amount=before.amount,
        new_amount=amount,
        old_date=before.date,
        new_date=date,
        old_subtag_id=before.subtag_id,
        new_subtag_id=subtag_id,
        old_sharing_id=before.expense_sharing_id,
        new_sharing_id=shared_partner_id,
        old_ownership=before.ownership_percentage,
        new_ownership=ownership_percentage,
    )


def classify_credit_card_edit(
    before: CreditCardInvoice,
    *,
    amount: float,
    date: Any,
    subtag_id: int | None,
    shared_partner_id: int | None,
    ownership_percentage: float | None,
) -> ChangeKind:
    return classify_transaction_edit(
        old_amount=before.amount,
        new_amount=amount,
        old_date=before.date,
        new_date=date,
        old_subtag_id=before.subtag_id,
        new_subtag_id=subtag_id,
        old_sharing_id=before.expense_sharing_id,
        new_sharing_id=shared_partner_id,
        old_ownership=before.ownership_percentage,
        new_ownership=ownership_percentage,
    )


def _downstream_closed_periods(
    closed: set[tuple[int, int]],
    seed: set[tuple[int, int]],
) -> list[tuple[int, int]]:
    if not seed or not closed:
        return []
    start = min(seed)
    return sorted(p for p in closed if p >= start)


def affected_closed_periods_for_dates(
    db: Session,
    tenant_id: int,
    account_id: int,
    old_date: Any,
    new_date: Any,
) -> list[tuple[int, int]]:
    closed = closed_periods(db, tenant_id, account_id)
    if not closed:
        return []
    seed: set[tuple[int, int]] = set()
    for value in (old_date, new_date):
        period = _period_from_date(value)
        if period and period in closed:
            seed.add(period)
    return _downstream_closed_periods(closed, seed)


def affected_closed_periods_for_bank_edit(
    db: Session,
    tenant_id: int,
    account_id: int,
    old_date: Any,
    new_date: Any,
) -> list[tuple[int, int]]:
    return affected_closed_periods_for_dates(db, tenant_id, account_id, old_date, new_date)


def _account_id_for_card_invoice(db: Session, invoice: CreditCardInvoice) -> int | None:
    if invoice.credit_card_id:
        card = db.query(Cartao).filter(Cartao.id == invoice.credit_card_id).first()
        if card and card.account_id:
            return int(card.account_id)
    return None


def _account_id_for_benefit(db: Session, row: BenefitCardStatement) -> int | None:
    if row.account_id:
        return int(row.account_id)
    if row.credit_card_id:
        card = db.query(Cartao).filter(Cartao.id == row.credit_card_id).first()
        if card and card.account_id:
            return int(card.account_id)
    return None


def closure_impact_financial(month_rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "impact_type": "financial",
        "requires_confirmation": False,
        "message": "Fechamentos recalculados nos meses impactados.",
        "financial": {
            "affected_periods": [
                {
                    "year": row["year"],
                    "month": row["month"],
                    "year_month": _year_month_key(int(row["year"]), int(row["month"])),
                    "closing_old": row["closing_old"],
                    "closing_new": row["closing_new"],
                    "delta_closing": row["delta_closing"],
                }
                for row in month_rows
            ],
        },
    }


def _closure_closing_snapshot(
    db: Session,
    tenant_id: int,
    account_id: int,
    periods: list[tuple[int, int]],
) -> dict[tuple[int, int], Decimal]:
    snap: dict[tuple[int, int], Decimal] = {}
    for year, month in periods:
        row = get_closure_for_period(db, tenant_id, account_id, year, month)
        if row:
            snap[(year, month)] = _money(row.closing_balance)
    return snap


def _merge_financial_recalc_rows(
    periods: list[tuple[int, int]],
    before: dict[tuple[int, int], Decimal],
    after: dict[tuple[int, int], Decimal],
    recascade_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_key = {(int(r["year"]), int(r["month"])): r for r in recascade_rows}
    merged: list[dict[str, Any]] = []
    for year, month in sorted(set(periods)):
        key = (year, month)
        if key in by_key:
            merged.append(by_key[key])
            continue
        old = before.get(key, ZERO)
        new = after.get(key, old)
        merged.append({
            "year": year,
            "month": month,
            "closing_old": float(old),
            "closing_new": float(new),
            "delta_closing": float(new - old),
        })
    return merged


def apply_cash_closure_recalc(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    periods: list[tuple[int, int]],
    *,
    adjustment_periods: Optional[set[tuple[int, int]]] = None,
    note_append: Optional[str] = None,
) -> dict[str, Any]:
    """Recascata meses fechados e monta resumo financeiro (antes/depois por mês)."""
    ordered = sorted(set(periods))
    before = _closure_closing_snapshot(db, tenant_id, account_id, ordered)
    rows = recascade_closed_periods(
        db,
        tenant_id,
        account_id,
        user_id,
        ordered,
        note_append=note_append,
        adjustment_periods=adjustment_periods,
    )
    after = _closure_closing_snapshot(db, tenant_id, account_id, ordered)
    merged = _merge_financial_recalc_rows(ordered, before, after, rows)
    return closure_impact_financial(merged)


def closure_impact_classification(
    *,
    records_updated: int,
    year_months: list[str],
    impact_type: ImpactType = "classification",
    message: str | None = None,
) -> dict[str, Any]:
    return {
        "impact_type": impact_type,
        "message": message,
        "classification": {
            "records_updated": records_updated,
            "closed_months_refreshed": len(year_months),
            "year_months": year_months,
        },
    }


def closure_impact_none() -> dict[str, Any]:
    return {"impact_type": "none"}


def closure_impact_confirmation_prompt(
    impact_type: ImpactType,
    *,
    message: str | None = None,
) -> dict[str, Any]:
    """409 de confirmação: aviso genérico, sem lista de meses ou valores (detalhes vêm após aplicar)."""
    default_messages: dict[ImpactType, str] = {
        "financial": (
            "Esta alteração muda valores em meses já fechados. "
            "Os fechamentos serão recalculados automaticamente."
        ),
        "classification": (
            "Meses fechados serão atualizados no histórico. "
            "Confirme para aplicar a alteração."
        ),
        "split_recalc": (
            "O compartilhamento será recalculado nos meses fechados. "
            "Confirme para aplicar a alteração."
        ),
        "none": "Confirme para continuar.",
    }
    return {
        "impact_type": impact_type,
        "requires_confirmation": True,
        "message": message or default_messages.get(impact_type, default_messages["classification"]),
    }


def merge_closure_impacts(current: dict[str, Any] | None, incoming: dict[str, Any] | None) -> dict[str, Any] | None:
    if not incoming or incoming.get("impact_type") == "none":
        return current
    if not current or current.get("impact_type") == "none":
        return incoming

    merged: dict[str, Any] = dict(current)
    in_type = incoming.get("impact_type")
    cur_type = current.get("impact_type")
    if in_type == "financial" or cur_type == "financial":
        merged["impact_type"] = "financial"
        periods: dict[str, dict] = {}
        for block in (current.get("financial"), incoming.get("financial")):
            if not block:
                continue
            for row in block.get("affected_periods") or []:
                periods[row["year_month"]] = row
        merged["financial"] = {"affected_periods": list(periods.values())}
    elif in_type == "split_recalc" or cur_type == "split_recalc":
        merged["impact_type"] = "split_recalc"
    else:
        merged["impact_type"] = "classification"

    cur_c = current.get("classification") or {}
    in_c = incoming.get("classification") or {}
    ym = sorted(set(cur_c.get("year_months") or []) | set(in_c.get("year_months") or []))
    merged["classification"] = {
        "records_updated": int(cur_c.get("records_updated") or 0) + int(in_c.get("records_updated") or 0),
        "closed_months_refreshed": len(ym),
        "year_months": ym,
    }
    return merged


def _ensure_mutation_in_closed_periods_confirmed(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    periods: list[tuple[int, int]],
    confirm: bool,
    kind: ChangeKind,
    apply_temp_update: Callable[[], None],
    *,
    records_updated: int = 1,
    adjustment_periods: Optional[set[tuple[int, int]]] = None,
) -> None:
    del db, tenant_id, account_id, user_id, apply_temp_update, records_updated, adjustment_periods
    if kind == "noop" or not periods or confirm:
        return
    if kind == "cash":
        preview = closure_impact_confirmation_prompt("financial")
    elif kind == "split_only":
        preview = closure_impact_confirmation_prompt("split_recalc")
    else:
        preview = closure_impact_confirmation_prompt("classification")
    raise AccountPeriodClosedError(preview.get("message", "Confirme o impacto nos fechamentos."), preview)


def _ensure_cash_edit_confirmed(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    periods: list[tuple[int, int]],
    confirm: bool,
    apply_temp_update: Callable[[], None],
    *,
    adjustment_periods: Optional[set[tuple[int, int]]] = None,
) -> None:
    _ensure_mutation_in_closed_periods_confirmed(
        db,
        tenant_id,
        account_id,
        user_id,
        periods,
        confirm,
        "cash",
        apply_temp_update,
        adjustment_periods=adjustment_periods,
    )


def ensure_bank_update_allowed(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    statement: BankStatement,
    *,
    description: str,
    amount: float,
    date: Any,
    subtag_id: int | None,
    shared_partner_id: int | None,
    ownership_percentage: float | None,
    confirm_closed_closure_impact: bool,
) -> ChangeKind:
    kind = classify_bank_statement_edit(
        statement,
        amount=amount,
        date=date,
        subtag_id=subtag_id,
        shared_partner_id=shared_partner_id,
        ownership_percentage=ownership_percentage,
    )
    if kind == "noop":
        return kind

    periods = affected_closed_periods_for_bank_edit(db, tenant_id, account_id, statement.date, date)

    def temp_apply() -> None:
        db.query(BankStatement).filter(
            BankStatement.id == statement.id,
            BankStatement.tenant_id == tenant_id,
        ).update(
            {
                BankStatement.description: description,
                BankStatement.amount: amount,
                BankStatement.date: date,
                BankStatement.subtag_id: subtag_id,
                BankStatement.expense_sharing_id: shared_partner_id,
                BankStatement.ownership_percentage: (
                    ownership_percentage if ownership_percentage is not None else Decimal("100.00")
                ),
            },
            synchronize_session=False,
        )
        db.refresh(statement)

    adjustment_periods = _cash_adjustment_periods_from_dates(statement.date, date)
    _ensure_mutation_in_closed_periods_confirmed(
        db,
        tenant_id,
        account_id,
        user_id,
        periods,
        confirm_closed_closure_impact,
        kind,
        temp_apply,
        adjustment_periods=adjustment_periods,
    )
    return kind


def ensure_credit_card_update_allowed(
    db: Session,
    tenant_id: int,
    account_id: int | None,
    user_id: int,
    invoice: CreditCardInvoice,
    *,
    description: str,
    amount: float,
    date: Any,
    subtag_id: int | None,
    shared_partner_id: int | None,
    ownership_percentage: float | None,
    confirm_closed_closure_impact: bool,
) -> ChangeKind:
    kind = classify_credit_card_edit(
        invoice,
        amount=amount,
        date=date,
        subtag_id=subtag_id,
        shared_partner_id=shared_partner_id,
        ownership_percentage=ownership_percentage,
    )
    if account_id is None:
        return kind
    if kind == "noop":
        return kind
    periods = affected_closed_periods_for_dates(db, tenant_id, account_id, invoice.date, date)

    def temp_apply() -> None:
        db.query(CreditCardInvoice).filter(
            CreditCardInvoice.id == invoice.id,
            CreditCardInvoice.tenant_id == tenant_id,
        ).update(
            {
                CreditCardInvoice.description: description,
                CreditCardInvoice.amount: amount,
                CreditCardInvoice.date: date,
                CreditCardInvoice.subtag_id: subtag_id,
                CreditCardInvoice.expense_sharing_id: shared_partner_id,
                CreditCardInvoice.ownership_percentage: (
                    ownership_percentage if ownership_percentage is not None else Decimal("100.00")
                ),
            },
            synchronize_session=False,
        )
        db.refresh(invoice)

    adjustment_periods = _cash_adjustment_periods_from_dates(invoice.date, date)
    _ensure_mutation_in_closed_periods_confirmed(
        db,
        tenant_id,
        account_id,
        user_id,
        periods,
        confirm_closed_closure_impact,
        kind,
        temp_apply,
        adjustment_periods=adjustment_periods,
    )
    return kind


def refresh_closed_snapshot_for_period(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: int,
    month: int,
) -> bool:
    closure = get_closure_for_period(db, tenant_id, account_id, year, month)
    if not closure:
        return False
    prior = dict(closure.closure_data or {})
    flow = _month_flow(db, tenant_id, account_id, year, month, include_items=True)
    snapshot = _build_closure_snapshot(
        db, tenant_id, account_id, year, month, prior, flow["items"],
    )
    closure.closure_data = snapshot
    flag_modified(closure, "closure_data")
    return True


def refresh_closed_snapshots_for_periods(
    db: Session,
    tenant_id: int,
    account_id: int,
    periods: set[tuple[int, int]],
) -> list[str]:
    refreshed: list[str] = []
    closed = closed_periods(db, tenant_id, account_id)
    for year, month in sorted(periods & closed):
        if refresh_closed_snapshot_for_period(db, tenant_id, account_id, year, month):
            refreshed.append(_year_month_key(year, month))
    return refreshed


def _periods_from_item_rows(dates: list[Any]) -> set[tuple[int, int]]:
    out: set[tuple[int, int]] = set()
    for value in dates:
        period = _period_from_date(value)
        if period:
            out.add(period)
    return out


def _load_subtag_meta(db: Session, tenant_id: int, subtag_id: int | None) -> dict[str, Any]:
    if not subtag_id:
        return {"subtag_id": None, "subtag_name": None, "tag_name": None}
    row = (
        db.query(Subtag.name, Tag.name.label("tag_name"))
        .outerjoin(Tag, Tag.id == Subtag.tag_id)
        .filter(Subtag.id == subtag_id, Subtag.tenant_id == tenant_id)
        .first()
    )
    if not row:
        return {"subtag_id": subtag_id, "subtag_name": None, "tag_name": None}
    return {"subtag_id": subtag_id, "subtag_name": row.name, "tag_name": row.tag_name}


def _patch_bank_item_in_snapshot(
    snapshot: dict[str, Any],
    statement_id: int,
    *,
    description: str | None = None,
    subtag_meta: dict[str, Any] | None = None,
    expense_sharing_id: int | None = None,
    ownership_percentage: float | None = None,
    amount: float | None = None,
    partner_fields: dict[str, Any] | None = None,
) -> bool:
    items = list(snapshot.get("items") or [])
    changed = False
    for idx, item in enumerate(items):
        if item.get("source", "bank") != "bank":
            continue
        if int(item.get("id") or -1) != int(statement_id):
            continue
        payload = dict(item)
        if description is not None:
            payload["description"] = description
        if subtag_meta:
            payload.update(subtag_meta)
        if expense_sharing_id is not None:
            payload["expense_sharing_id"] = expense_sharing_id
        if ownership_percentage is not None:
            payload["ownership_percentage"] = ownership_percentage
        if amount is not None:
            payload["amount"] = float(amount)
            splits = fh_split(
                amount,
                payload.get("ownership_percentage"),
                payload.get("expense_sharing_id"),
                (partner_fields or {}).get("shared_partner_id"),
            )
            payload["amount_account"] = splits["amount_account"]
            payload["amount_shared"] = splits["amount_shared"]
        if partner_fields:
            payload.update(partner_fields)
        items[idx] = payload
        changed = True
        break
    if changed:
        snapshot["items"] = items
    return changed


def patch_closed_months_classification(
    db: Session,
    tenant_id: int,
    account_id: int,
    statement: BankStatement,
    *,
    description: str,
    subtag_id: int | None,
    shared_partner_id: int | None,
    ownership_percentage: float | None,
    kind: ChangeKind,
) -> None:
    period = _period_from_date(statement.date)
    if not period:
        return
    closure = get_closure_for_period(db, tenant_id, account_id, period[0], period[1])
    if not closure:
        return

    snapshot = dict(closure.closure_data or {})
    subtag_meta = _load_subtag_meta(db, tenant_id, subtag_id)
    partner_fields: dict[str, Any] = {}
    if shared_partner_id:
        from app.services.account_period_closure_service import _sharing_partner_map

        info = _sharing_partner_map(db, tenant_id, {int(shared_partner_id)}).get(int(shared_partner_id), {})
        partner_fields = info

    patched = _patch_bank_item_in_snapshot(
        snapshot,
        int(statement.id),
        description=description,
        subtag_meta=subtag_meta,
        expense_sharing_id=shared_partner_id,
        ownership_percentage=ownership_percentage,
        amount=float(statement.amount) if kind == "split_only" else None,
        partner_fields=partner_fields if kind == "split_only" else None,
    )
    if not patched:
        refresh_closed_snapshot_for_period(db, tenant_id, account_id, period[0], period[1])
        return

    if kind == "split_only":
        allocation = period_allocation_details(db, tenant_id, account_id, period[0], period[1])
        snapshot["splits"] = allocation["splits"]

    closure.closure_data = snapshot
    flag_modified(closure, "closure_data")


def after_bank_statement_updated(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    statement: BankStatement,
    *,
    kind: ChangeKind,
    old_date: Any,
    note: str | None = None,
) -> dict[str, Any]:
    if kind == "noop":
        return closure_impact_none()
    periods = affected_closed_periods_for_bank_edit(db, tenant_id, account_id, old_date, statement.date)
    if not periods and kind != "cash":
        period = _period_from_date(statement.date)
        if period and period in closed_periods(db, tenant_id, account_id):
            periods = [period]
    if not periods:
        return closure_impact_none()

    if kind == "cash":
        adjustment_periods = _cash_adjustment_periods_from_dates(old_date, statement.date)
        return apply_cash_closure_recalc(
            db,
            tenant_id,
            account_id,
            user_id,
            periods,
            adjustment_periods=adjustment_periods,
            note_append=note,
        )

    patch_closed_months_classification(
        db,
        tenant_id,
        account_id,
        statement,
        description=statement.description or "",
        subtag_id=statement.subtag_id,
        shared_partner_id=statement.expense_sharing_id,
        ownership_percentage=float(statement.ownership_percentage)
        if statement.ownership_percentage is not None
        else None,
        kind=kind,
    )
    ym = [_year_month_key(p[0], p[1]) for p in periods]
    return closure_impact_classification(
        records_updated=1,
        year_months=ym,
        impact_type="split_recalc" if kind == "split_only" else "classification",
    )


def after_credit_card_updated(
    db: Session,
    tenant_id: int,
    account_id: int | None,
    user_id: int,
    invoice: CreditCardInvoice,
    *,
    kind: ChangeKind,
    old_date: Any,
    note: str | None = None,
) -> dict[str, Any]:
    if account_id is None:
        return closure_impact_none()
    if kind == "noop":
        return closure_impact_none()
    periods_list = affected_closed_periods_for_dates(db, tenant_id, account_id, old_date, invoice.date)
    if not periods_list:
        period = _period_from_date(invoice.date)
        if period and period in closed_periods(db, tenant_id, account_id):
            periods_list = [period]
    if not periods_list:
        return closure_impact_none()

    if kind == "cash":
        adjustment_periods = _cash_adjustment_periods_from_dates(old_date, invoice.date)
        return apply_cash_closure_recalc(
            db,
            tenant_id,
            account_id,
            user_id,
            periods_list,
            adjustment_periods=adjustment_periods,
            note_append=note,
        )

    refreshed = refresh_closed_snapshots_for_periods(
        db, tenant_id, account_id, set(periods_list),
    )
    return closure_impact_classification(
        records_updated=1,
        year_months=refreshed,
        impact_type="split_recalc" if kind == "split_only" else "classification",
    )


def after_benefit_subtag_updated(
    db: Session,
    tenant_id: int,
    account_id: int | None,
    statement: BenefitCardStatement,
) -> dict[str, Any]:
    return after_benefit_curadoria_updated(
        db,
        tenant_id,
        account_id,
        statement,
        subtag_changed=True,
        sharing_changed=False,
    )


def after_benefit_curadoria_updated(
    db: Session,
    tenant_id: int,
    account_id: int | None,
    statement: BenefitCardStatement,
    *,
    subtag_changed: bool,
    sharing_changed: bool,
) -> dict[str, Any]:
    if account_id is None:
        return closure_impact_none()
    if not subtag_changed and not sharing_changed:
        return closure_impact_none()
    period = _period_from_date(statement.date)
    if not period:
        return closure_impact_none()
    refreshed = refresh_closed_snapshots_for_periods(db, tenant_id, account_id, {period})
    if not refreshed:
        return closure_impact_none()
    impact_type: ImpactType = "split_recalc" if sharing_changed else "classification"
    return closure_impact_classification(
        records_updated=1,
        year_months=refreshed,
        impact_type=impact_type,
    )


def _closed_periods_for_new_transaction(
    db: Session,
    tenant_id: int,
    account_id: int,
    transaction_date: Any,
) -> list[tuple[int, int]]:
    period = _period_from_date(transaction_date)
    if not period:
        return []
    closed = closed_periods(db, tenant_id, account_id)
    if period not in closed:
        return []
    return _downstream_closed_periods(closed, {period})


def ensure_closed_period_change_allowed(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    transaction_date: Any,
    confirm: bool,
    temp_apply: Callable[[], None],
) -> None:
    """Exige confirmação quando a mutação em data fechada altera fechamentos (preview financeiro)."""
    periods = _closed_periods_for_new_transaction(db, tenant_id, account_id, transaction_date)
    if not periods or confirm:
        return
    adjustment_periods = _cash_adjustment_periods_from_dates(transaction_date)
    _ensure_cash_edit_confirmed(
        db,
        tenant_id,
        account_id,
        user_id,
        periods,
        confirm,
        temp_apply,
        adjustment_periods=adjustment_periods,
    )


def ensure_new_transaction_in_closed_period_allowed(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    transaction_date: Any,
    confirm: bool,
    temp_insert: Callable[[], None],
) -> None:
    ensure_closed_period_change_allowed(
        db, tenant_id, account_id, user_id, transaction_date, confirm, temp_insert,
    )


def after_new_transaction_in_closed_period(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    transaction_date: Any,
    *,
    note: str,
) -> dict[str, Any]:
    periods = _closed_periods_for_new_transaction(db, tenant_id, account_id, transaction_date)
    if not periods:
        return closure_impact_none()
    adjustment_periods = _cash_adjustment_periods_from_dates(transaction_date)
    return apply_cash_closure_recalc(
        db,
        tenant_id,
        account_id,
        user_id,
        periods,
        adjustment_periods=adjustment_periods,
        note_append=note,
    )


def after_expense_split(
    db: Session,
    tenant_id: int,
    account_id: int | None,
    user_id: int,
    transaction_date: Any,
    *,
    note: str,
) -> dict[str, Any]:
    """Divide lançamento em mês fechado: recascata fechamentos e retorna impacto financeiro por mês."""
    if account_id is None:
        return closure_impact_none()
    periods = _closed_periods_for_new_transaction(db, tenant_id, account_id, transaction_date)
    if not periods:
        return closure_impact_none()
    adjustment_periods = _cash_adjustment_periods_from_dates(transaction_date)
    impact = apply_cash_closure_recalc(
        db,
        tenant_id,
        account_id,
        user_id,
        periods,
        adjustment_periods=adjustment_periods,
        note_append=note,
    )
    if not (impact.get("financial") or {}).get("affected_periods"):
        return closure_impact_none()
    impact["message"] = (
        "Divisão aplicada. Os fechamentos dos meses impactados foram recalculados no histórico."
    )
    return impact


def post_batch_update_closure_sync(
    db: Session,
    tenant_id: int,
    account_id: int,
    *,
    bank_ids: list[int],
    card_ids: list[int],
    benefit_ids: list[int],
    has_subtag_change: bool,
    has_sharing_change: bool,
    updated_count: int,
) -> dict[str, Any]:
    if updated_count <= 0:
        return closure_impact_none()

    dates: list[Any] = []
    if bank_ids:
        dates.extend(
            row.date
            for row in db.query(BankStatement.date).filter(
                BankStatement.id.in_(bank_ids),
                BankStatement.tenant_id == tenant_id,
            ).all()
        )
    if card_ids:
        dates.extend(
            row.date
            for row in db.query(CreditCardInvoice.date).filter(
                CreditCardInvoice.id.in_(card_ids),
                CreditCardInvoice.tenant_id == tenant_id,
            ).all()
        )
    if benefit_ids:
        dates.extend(
            row.date
            for row in db.query(BenefitCardStatement.date).filter(
                BenefitCardStatement.id.in_(benefit_ids),
                BenefitCardStatement.tenant_id == tenant_id,
            ).all()
        )

    periods = _periods_from_item_rows(dates)
    refreshed = refresh_closed_snapshots_for_periods(db, tenant_id, account_id, periods)
    if not refreshed:
        return closure_impact_none()

    impact_type: ImpactType = "split_recalc" if has_sharing_change else "classification"
    if not has_subtag_change and not has_sharing_change:
        impact_type = "classification"
    return closure_impact_classification(
        records_updated=updated_count,
        year_months=refreshed,
        impact_type=impact_type,
    )


def _mapping_match_filters(
    db: Session,
    tenant_id: int,
    account_id: int,
    mapping: TransactionMapping,
) -> tuple[bool, bool, list[Any]]:
    """Retorna (is_receita, has_bank_filter, list de datas bank matching)."""
    subtag = db.query(Subtag).filter(Subtag.id == mapping.subtag_id).first()
    is_receita = subtag.type == "receita" if subtag else False
    dates: list[Any] = []

    if mapping.mapping_type == "exact" and mapping.original_description:
        search = mapping.original_description
        if mapping.is_sensitive:
            try:
                from app.utils.crypto_helper import get_crypto_helper

                search = get_crypto_helper().decrypt(search)
            except Exception:
                search = None
        if not search:
            return is_receita, False, dates
        filters = [
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            func.lower(BankStatement.description) == search.lower(),
        ]
        if is_receita:
            filters.append(BankStatement.amount > 0)
        else:
            filters.append(BankStatement.amount < 0)
        rows = db.query(BankStatement.date).filter(*filters).all()
        dates = [row.date for row in rows]
        return is_receita, True, dates

    if mapping.mapping_type == "pattern" and mapping.pattern:
        from app.utils.sensitive_mapping import decrypt_pattern_for_match

        plain = decrypt_pattern_for_match(mapping.pattern, mapping.is_sensitive)
        if not plain:
            return is_receita, False, dates
        like_pattern = f"%{plain.lower()}%"
        filters = [
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            func.lower(BankStatement.description).like(like_pattern),
        ]
        if is_receita:
            filters.append(BankStatement.amount > 0)
        else:
            filters.append(BankStatement.amount < 0)
        rows = db.query(BankStatement.date).filter(*filters).all()
        dates = [row.date for row in rows]
        return is_receita, True, dates

    return is_receita, False, dates


def _cc_benefit_dates_for_mapping(
    db: Session,
    tenant_id: int,
    mapping: TransactionMapping,
    is_receita: bool,
) -> list[Any]:
    dates: list[Any] = []
    if mapping.mapping_type == "exact" and mapping.original_description:
        search = mapping.original_description
        if mapping.is_sensitive:
            try:
                from app.utils.crypto_helper import get_crypto_helper

                search = get_crypto_helper().decrypt(search)
            except Exception:
                search = None
        if not search:
            return dates
        for model, amount_field in (
            (CreditCardInvoice, CreditCardInvoice.amount),
            (BenefitCardStatement, BenefitCardStatement.amount),
        ):
            filters = [
                model.tenant_id == tenant_id,
                func.lower(model.description) == search.lower(),
            ]
            if is_receita:
                filters.append(amount_field > 0)
            else:
                filters.append(amount_field < 0)
            dates.extend(row.date for row in db.query(model.date).filter(*filters).all())
    elif mapping.mapping_type == "pattern" and mapping.pattern:
        from app.utils.sensitive_mapping import decrypt_pattern_for_match

        plain = decrypt_pattern_for_match(mapping.pattern, mapping.is_sensitive)
        if not plain:
            return dates
        like_pattern = f"%{plain.lower()}%"
        for model, amount_field in (
            (CreditCardInvoice, CreditCardInvoice.amount),
            (BenefitCardStatement, BenefitCardStatement.amount),
        ):
            filters = [
                model.tenant_id == tenant_id,
                func.lower(model.description).like(like_pattern),
            ]
            if is_receita:
                filters.append(amount_field > 0)
            else:
                filters.append(amount_field < 0)
            dates.extend(row.date for row in db.query(model.date).filter(*filters).all())
    return dates


def preview_mapping_remap_closure_impact(
    db: Session,
    tenant_id: int,
    account_id: int,
    mapping: TransactionMapping,
    *,
    overwrite_sharing: bool,
    records_updated: int,
) -> dict[str, Any]:
    is_receita, _has_bank, bank_dates = _mapping_match_filters(db, tenant_id, account_id, mapping)
    all_dates = list(bank_dates) + _cc_benefit_dates_for_mapping(db, tenant_id, mapping, is_receita)
    periods = _periods_from_item_rows(all_dates)
    closed = closed_periods(db, tenant_id, account_id)
    touched = sorted(periods & closed)
    year_months = [_year_month_key(y, m) for y, m in touched]

    if touched:
        impact_type: ImpactType = "split_recalc" if overwrite_sharing else "classification"
        message = (
            "O compartilhamento será recalculado nos fechamentos dos meses impactados."
            if overwrite_sharing
            else "Meses fechados serão atualizados no histórico após o mapeamento."
        )
        return {
            **closure_impact_classification(
                records_updated=records_updated,
                year_months=year_months,
                impact_type=impact_type,
                message=message,
            ),
            "requires_confirmation": True,
        }
    return closure_impact_none()


def finalize_mapping_remap_closures(
    db: Session,
    tenant_id: int,
    account_id: int,
    mapping: TransactionMapping,
    *,
    overwrite_sharing: bool,
    records_updated: int,
) -> dict[str, Any]:
    is_receita, _has_bank, bank_dates = _mapping_match_filters(db, tenant_id, account_id, mapping)
    all_dates = list(bank_dates) + _cc_benefit_dates_for_mapping(db, tenant_id, mapping, is_receita)
    periods = _periods_from_item_rows(all_dates)
    refreshed = refresh_closed_snapshots_for_periods(db, tenant_id, account_id, periods)
    if not refreshed:
        return closure_impact_none()

    impact_type: ImpactType = "split_recalc" if overwrite_sharing else "classification"
    return closure_impact_classification(
        records_updated=records_updated,
        year_months=refreshed,
        impact_type=impact_type,
        message="Histórico de fechamentos atualizado após o mapeamento.",
    )


def ensure_mapping_remap_allowed(
    db: Session,
    tenant_id: int,
    account_id: int,
    mapping: TransactionMapping,
    *,
    overwrite_sharing: bool,
    confirm_closed_closure_impact: bool,
    records_updated_estimate: int,
) -> None:
    if confirm_closed_closure_impact:
        return
    preview = preview_mapping_remap_closure_impact(
        db,
        tenant_id,
        account_id,
        mapping,
        overwrite_sharing=overwrite_sharing,
        records_updated=records_updated_estimate,
    )
    if preview.get("impact_type") == "none":
        return
    impact_type: ImpactType = "split_recalc" if overwrite_sharing else "classification"
    confirm_payload = closure_impact_confirmation_prompt(
        impact_type,
        message=preview.get("message"),
    )
    raise AccountPeriodClosedError(
        confirm_payload.get("message", "Confirme para atualizar fechamentos."),
        confirm_payload,
    )


def ensure_batch_update_closure_allowed(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    *,
    bank_ids: list[int],
    card_ids: list[int],
    benefit_ids: list[int],
    update_fields: dict[str, Any],
    has_sharing_change: bool,
    confirm: bool,
) -> None:
    if confirm or not update_fields:
        return
    dates: list[Any] = []
    if bank_ids:
        dates.extend(
            row.date
            for row in db.query(BankStatement.date).filter(
                BankStatement.id.in_(bank_ids),
                BankStatement.tenant_id == tenant_id,
            ).all()
        )
    if card_ids:
        dates.extend(
            row.date
            for row in db.query(CreditCardInvoice.date).filter(
                CreditCardInvoice.id.in_(card_ids),
                CreditCardInvoice.tenant_id == tenant_id,
            ).all()
        )
    if benefit_ids:
        dates.extend(
            row.date
            for row in db.query(BenefitCardStatement.date).filter(
                BenefitCardStatement.id.in_(benefit_ids),
                BenefitCardStatement.tenant_id == tenant_id,
            ).all()
        )
    periods_list = _periods_from_item_rows(dates)
    closed = closed_periods(db, tenant_id, account_id)
    periods = sorted(p for p in periods_list if p in closed)
    if not periods:
        return
    records_updated = len(bank_ids) + len(card_ids) + len(benefit_ids)
    kind: ChangeKind = "split_only" if has_sharing_change else "classification"

    def temp_apply() -> None:
        if bank_ids:
            db.query(BankStatement).filter(
                BankStatement.id.in_(bank_ids),
                BankStatement.tenant_id == tenant_id,
            ).update(update_fields, synchronize_session=False)
        if card_ids:
            db.query(CreditCardInvoice).filter(
                CreditCardInvoice.id.in_(card_ids),
                CreditCardInvoice.tenant_id == tenant_id,
            ).update(update_fields, synchronize_session=False)
        if benefit_ids:
            db.query(BenefitCardStatement).filter(
                BenefitCardStatement.id.in_(benefit_ids),
                BenefitCardStatement.tenant_id == tenant_id,
            ).update(update_fields, synchronize_session=False)
        db.flush()

    _ensure_mutation_in_closed_periods_confirmed(
        db,
        tenant_id,
        account_id,
        user_id,
        periods,
        confirm,
        kind,
        temp_apply,
        records_updated=records_updated,
    )


def ensure_benefit_curadoria_update_allowed(
    db: Session,
    tenant_id: int,
    account_id: int | None,
    user_id: int,
    statement: BenefitCardStatement,
    update_data: dict[str, Any],
    confirm: bool,
) -> None:
    if account_id is None or confirm or not update_data:
        return
    subtag_changed = "subtag_id" in update_data and update_data["subtag_id"] != statement.subtag_id
    sharing_changed = (
        "expense_sharing_id" in update_data
        and update_data["expense_sharing_id"] != statement.expense_sharing_id
    ) or (
        "ownership_percentage" in update_data
        and update_data["ownership_percentage"] != statement.ownership_percentage
    )
    if not subtag_changed and not sharing_changed:
        return
    periods = _closed_periods_for_new_transaction(db, tenant_id, account_id, statement.date)
    kind: ChangeKind = "split_only" if sharing_changed else "classification"

    def temp_apply() -> None:
        for field, value in update_data.items():
            setattr(statement, field, value)
        db.flush()

    _ensure_mutation_in_closed_periods_confirmed(
        db,
        tenant_id,
        account_id,
        user_id,
        periods,
        confirm,
        kind,
        temp_apply,
    )


# Legado
def sync_closed_snapshots_after_mapping_remap(
    db: Session,
    tenant_id: int,
    account_id: int,
    mapping: TransactionMapping,
) -> None:
    finalize_mapping_remap_closures(
        db,
        tenant_id,
        account_id,
        mapping,
        overwrite_sharing=False,
        records_updated=0,
    )
