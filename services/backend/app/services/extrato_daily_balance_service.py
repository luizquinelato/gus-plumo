"""Saldo cumulativo do extrato (banco + benefícios) por data civil — sem limite da listagem."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.models.unified_models import BankStatement, BenefitCardStatement, Cartao, Subtag


def _apply_bank_filters(
    db: Session,
    query,
    tenant_id: int,
    account_ids: list[int] | None,
    tag_ids: list[int] | None,
    subtag_ids: list[int] | None,
    partner_id_list: list[int] | None,
    include_empty_tag: bool,
    include_empty_sharing: bool,
    origin_list: list[str] | None,
):
    query = query.filter(BankStatement.tenant_id == tenant_id)
    if subtag_ids or tag_ids or include_empty_tag:
        tag_conditions = []
        if subtag_ids:
            tag_conditions.append(BankStatement.subtag_id.in_(subtag_ids))
        elif tag_ids:
            subtag_query = db.query(Subtag.id).filter(Subtag.tag_id.in_(tag_ids))
            tag_conditions.append(BankStatement.subtag_id.in_(subtag_query))
        if include_empty_tag:
            tag_conditions.append(BankStatement.subtag_id.is_(None))
        if tag_conditions:
            query = query.filter(or_(*tag_conditions))
    if partner_id_list or include_empty_sharing:
        sharing_conditions = []
        if partner_id_list:
            sharing_conditions.append(BankStatement.expense_sharing_id.in_(partner_id_list))
        if include_empty_sharing:
            sharing_conditions.append(BankStatement.expense_sharing_id.is_(None))
        if sharing_conditions:
            query = query.filter(or_(*sharing_conditions))
    if account_ids:
        query = query.filter(BankStatement.account_id.in_(account_ids))
    if origin_list:
        origin_conditions = []
        if "manual" in origin_list:
            origin_conditions.append(
                and_(
                    BankStatement.is_manual.is_(True),
                    BankStatement.migrated_from_account_id.is_(None),
                )
            )
        if "inverted" in origin_list:
            origin_conditions.append(BankStatement.migrated_from_account_id.isnot(None))
        if origin_conditions:
            query = query.filter(or_(*origin_conditions))
    return query


def _apply_benefit_filters(
    db: Session,
    query,
    tenant_id: int,
    account_ids: list[int] | None,
    tag_ids: list[int] | None,
    subtag_ids: list[int] | None,
    partner_id_list: list[int] | None,
    include_empty_tag: bool,
    include_empty_sharing: bool,
    card_ids: list[int] | None,
):
    query = query.filter(BenefitCardStatement.tenant_id == tenant_id)
    if subtag_ids or tag_ids or include_empty_tag:
        tag_conditions = []
        if subtag_ids:
            tag_conditions.append(BenefitCardStatement.subtag_id.in_(subtag_ids))
        elif tag_ids:
            subtag_query = db.query(Subtag.id).filter(Subtag.tag_id.in_(tag_ids))
            tag_conditions.append(BenefitCardStatement.subtag_id.in_(subtag_query))
        if include_empty_tag:
            tag_conditions.append(BenefitCardStatement.subtag_id.is_(None))
        if tag_conditions:
            query = query.filter(or_(*tag_conditions))
    if partner_id_list or include_empty_sharing:
        sharing_conditions = []
        if partner_id_list:
            sharing_conditions.append(BenefitCardStatement.expense_sharing_id.in_(partner_id_list))
        if include_empty_sharing:
            sharing_conditions.append(BenefitCardStatement.expense_sharing_id.is_(None))
        if sharing_conditions:
            query = query.filter(or_(*sharing_conditions))
    if account_ids:
        query = query.filter(Cartao.account_id.in_(account_ids))
    if card_ids:
        query = query.filter(BenefitCardStatement.credit_card_id.in_(card_ids))
    return query


def _calendar_day_col(model_date_col):
    return func.date(model_date_col)


def _merge_daily_maps(*maps: dict[date, Decimal]) -> dict[date, Decimal]:
    merged: dict[date, Decimal] = {}
    for daily_map in maps:
        for day, amount in daily_map.items():
            if day is None:
                continue
            merged[day] = merged.get(day, Decimal(0)) + Decimal(str(amount or 0))
    return merged


def _bank_daily_net_map(
    db: Session,
    tenant_id: int,
    account_ids: list[int] | None,
    tag_ids: list[int] | None,
    subtag_ids: list[int] | None,
    partner_id_list: list[int] | None,
    include_empty_tag: bool,
    include_empty_sharing: bool,
    origin_list: list[str] | None,
    cal_start: date | None,
    cal_end_exclusive: date | None,
) -> dict[date, Decimal]:
    day_col = _calendar_day_col(BankStatement.date)
    q = db.query(day_col, func.coalesce(func.sum(BankStatement.amount), 0))
    q = _apply_bank_filters(
        db, q, tenant_id, account_ids, tag_ids, subtag_ids, partner_id_list,
        include_empty_tag, include_empty_sharing, origin_list,
    )
    if cal_start is not None:
        q = q.filter(day_col >= cal_start)
    if cal_end_exclusive is not None:
        q = q.filter(day_col < cal_end_exclusive)
    q = q.group_by(day_col)
    return {row[0]: Decimal(str(row[1])) for row in q.all() if row[0] is not None}


def _benefit_daily_net_map(
    db: Session,
    tenant_id: int,
    account_ids: list[int] | None,
    tag_ids: list[int] | None,
    subtag_ids: list[int] | None,
    partner_id_list: list[int] | None,
    include_empty_tag: bool,
    include_empty_sharing: bool,
    card_ids: list[int] | None,
    cal_start: date | None,
    cal_end_exclusive: date | None,
) -> dict[date, Decimal]:
    day_col = _calendar_day_col(BenefitCardStatement.date)
    q = (
        db.query(day_col, func.coalesce(func.sum(BenefitCardStatement.amount), 0))
        .join(Cartao, BenefitCardStatement.credit_card_id == Cartao.id)
    )
    q = _apply_benefit_filters(
        db, q, tenant_id, account_ids, tag_ids, subtag_ids, partner_id_list,
        include_empty_tag, include_empty_sharing, card_ids,
    )
    if cal_start is not None:
        q = q.filter(day_col >= cal_start)
    if cal_end_exclusive is not None:
        q = q.filter(day_col < cal_end_exclusive)
    q = q.group_by(day_col)
    return {row[0]: Decimal(str(row[1])) for row in q.all() if row[0] is not None}


def compute_opening_balance_calendar(
    db: Session,
    tenant_id: int,
    sources: list[str],
    before_date: date,
    account_ids: list[int] | None,
    tag_ids: list[int] | None,
    subtag_ids: list[int] | None,
    partner_id_list: list[int] | None,
    include_empty_tag: bool,
    include_empty_sharing: bool,
    origin_list: list[str] | None,
    card_ids: list[int] | None,
) -> float:
    """Soma banco + benefícios com data civil estritamente anterior a before_date."""
    total = Decimal(0)
    if "bank" in sources:
        day_col = _calendar_day_col(BankStatement.date)
        q = db.query(func.coalesce(func.sum(BankStatement.amount), 0))
        q = _apply_bank_filters(
            db, q, tenant_id, account_ids, tag_ids, subtag_ids, partner_id_list,
            include_empty_tag, include_empty_sharing, origin_list,
        )
        q = q.filter(day_col < before_date)
        total += Decimal(str(q.scalar() or 0))
    if "benefits" in sources:
        should_include = not (origin_list and "manual" in origin_list and "inverted" not in origin_list)
        if should_include:
            day_col = _calendar_day_col(BenefitCardStatement.date)
            q = (
                db.query(func.coalesce(func.sum(BenefitCardStatement.amount), 0))
                .join(Cartao, BenefitCardStatement.credit_card_id == Cartao.id)
            )
            q = _apply_benefit_filters(
                db, q, tenant_id, account_ids, tag_ids, subtag_ids, partner_id_list,
                include_empty_tag, include_empty_sharing, card_ids,
            )
            q = q.filter(day_col < before_date)
            total += Decimal(str(q.scalar() or 0))
    return float(total)


def _end_of_day_iso(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, 23, 59, 59, 999000)


def _daily_row_id(day: date) -> int:
    key = day.strftime("%Y%m%d")
    return -abs(int(key) % 1_000_000_000)


def _mark_month_end_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    last_by_month: dict[str, date] = {}
    for row in rows:
        day: date = row["_day"]
        month_key = day.strftime("%Y-%m")
        prev = last_by_month.get(month_key)
        if prev is None or day > prev:
            last_by_month[month_key] = day
    for row in rows:
        day = row["_day"]
        month_key = day.strftime("%Y-%m")
        is_end = last_by_month.get(month_key) == day
        label = day.strftime("%d/%m/%Y")
        row["daily_month_end"] = is_end
        row["description"] = (
            f"Saldo cumulativo · Final do mês · {label}"
            if is_end
            else f"Saldo cumulativo · {label}"
        )
        del row["_day"]
    return rows


def build_daily_balance_payloads(
    db: Session,
    tenant_id: int,
    sources: list[str],
    period_start: date | None,
    period_end_exclusive: date | None,
    account_ids: list[int] | None,
    tag_ids: list[int] | None,
    subtag_ids: list[int] | None,
    partner_id_list: list[int] | None,
    include_empty_tag: bool,
    include_empty_sharing: bool,
    origin_list: list[str] | None,
    card_ids: list[int] | None,
) -> tuple[float | None, list[dict[str, Any]]]:
    """
    Retorna (opening_before_period ou None, linhas sintéticas de saldo).
    Usa data civil (func.date) alinhada ao agrupamento do frontend.
    """
    opening: float | None = None
    if period_start is not None:
        opening = compute_opening_balance_calendar(
            db, tenant_id, sources, period_start,
            account_ids, tag_ids, subtag_ids, partner_id_list,
            include_empty_tag, include_empty_sharing, origin_list, card_ids,
        )

    cal_start = period_start
    cal_end = period_end_exclusive

    bank_map: dict[date, Decimal] = {}
    benefit_map: dict[date, Decimal] = {}
    if "bank" in sources:
        bank_map = _bank_daily_net_map(
            db, tenant_id, account_ids, tag_ids, subtag_ids, partner_id_list,
            include_empty_tag, include_empty_sharing, origin_list,
            cal_start, cal_end,
        )
    if "benefits" in sources:
        should_include = not (origin_list and "manual" in origin_list and "inverted" not in origin_list)
        if should_include:
            benefit_map = _benefit_daily_net_map(
                db, tenant_id, account_ids, tag_ids, subtag_ids, partner_id_list,
                include_empty_tag, include_empty_sharing, card_ids,
                cal_start, cal_end,
            )

    daily_net = _merge_daily_maps(bank_map, benefit_map)
    sorted_days = sorted(daily_net.keys())

    rows: list[dict[str, Any]] = []
    running = Decimal(str(opening or 0))

    if period_start is not None:
        day_before = period_start - timedelta(days=1)
        day_before_key = day_before
        if day_before_key not in daily_net:
            rows.append({
                "_day": day_before_key,
                "id": _daily_row_id(day_before_key),
                "date": _end_of_day_iso(day_before_key),
                "description": "",
                "amount": float(running),
                "source": "__daily_balance__",
                "daily_month_end": False,
            })

    for day in sorted_days:
        if period_start is not None and day < period_start:
            continue
        running += daily_net[day]
        rows.append({
            "_day": day,
            "id": _daily_row_id(day),
            "date": _end_of_day_iso(day),
            "description": "",
            "amount": float(running),
            "source": "__daily_balance__",
            "daily_month_end": False,
        })

    rows = _mark_month_end_rows(rows)
    return opening, rows
