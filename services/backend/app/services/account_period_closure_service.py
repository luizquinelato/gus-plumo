"""Fechamentos mensais explícitos da conta (snapshot do extrato bancário)."""

from __future__ import annotations

import logging
from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import Integer, and_, case, cast, extract, func, or_
from sqlalchemy.orm import Session, aliased
from sqlalchemy.orm.attributes import flag_modified

from app.models.base_entity import now_utc
from app.models.unified_models import (
    Account,
    AccountPeriodClosure,
    BalanceClosure,
    BalanceClosurePayment,
    Bank,
    BankStatement,
    BenefitCardStatement,
    Cartao,
    CreditCardInvoice,
    ExpenseSharingSetting,
    LoanPayment,
    Subtag,
    Tag,
)
from app.services.financial_health_service import (
    _load_benefit_items,
    compute_scoped_month_flows,
    period_allocation_details,
    serialize_splits,
    split_signed_amount,
)

logger = logging.getLogger(__name__)

MONEY = Decimal("0.01")
ZERO = Decimal("0.00")
MIN_YEAR = 2000
SOURCES = ["bank"]
ADJUSTMENT_DESCRIPTION_PREFIX = "Ajuste de fechamento"
LIVE_OPENING_STATUSES = ("can_close", "blocked", "current")


class AccountPeriodClosedError(Exception):
    """Lançamento em mês já fechado da conta."""

    def __init__(self, message: str, payload: Optional[dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.payload = payload or {}


class AccountPeriodCloseError(Exception):
    """Não foi possível fechar ou reabrir o período."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _money(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(MONEY)


def _as_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and len(value) >= 10:
        return date.fromisoformat(value[:10])
    return None


def _iso_date(value: Any) -> str:
    parsed = _as_date(value)
    return parsed.isoformat() if parsed else ""


def _iso_datetime(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%dT%H:%M:%S")
    if isinstance(value, date):
        return f"{value.isoformat()}T00:00:00"
    if isinstance(value, str) and len(value) >= 10:
        text = value.strip().replace(" ", "T")
        if "T" not in text:
            return f"{text[:10]}T00:00:00"
        return text[:19]
    return None


def _prefixed_int(value: Any, prefix: str) -> Optional[int]:
    if not isinstance(value, str) or not value.startswith(prefix):
        return None
    raw = value[len(prefix):]
    return int(raw) if raw.isdigit() else None


def _year_month_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def _period_label(year: int, month: int) -> str:
    return f"{month:02d}/{year}"


def _add_month(year: int, month: int, delta: int = 1) -> tuple[int, int]:
    total = year * 12 + (month - 1) + delta
    return total // 12, (total % 12) + 1


def _period_start(year: int, month: int) -> datetime:
    return datetime(year, month, 1)


def _period_end_exclusive(year: int, month: int) -> datetime:
    next_year, next_month = _add_month(year, month, 1)
    return datetime(next_year, next_month, 1)


def _last_moment(year: int, month: int) -> datetime:
    last_day = monthrange(year, month)[1]
    return datetime(year, month, last_day, 23, 59, 59)


def closed_periods(db: Session, tenant_id: int, account_id: int) -> set[tuple[int, int]]:
    rows = (
        db.query(AccountPeriodClosure.year, AccountPeriodClosure.month)
        .filter(
            AccountPeriodClosure.tenant_id == tenant_id,
            AccountPeriodClosure.account_id == account_id,
        )
        .all()
    )
    return {(int(row.year), int(row.month)) for row in rows}


def validate_date(
    db: Session,
    tenant_id: int,
    account_id: int,
    target: date | datetime | str,
) -> dict[str, Any]:
    parsed = _as_date(target)
    if parsed is None:
        raise AccountPeriodCloseError("Data inválida. Use YYYY-MM-DD.")

    closure = (
        db.query(AccountPeriodClosure)
        .filter(
            AccountPeriodClosure.tenant_id == tenant_id,
            AccountPeriodClosure.account_id == account_id,
            AccountPeriodClosure.year == parsed.year,
            AccountPeriodClosure.month == parsed.month,
        )
        .first()
    )
    if not closure:
        return {
            "is_closed": False,
            "message": "Data está em período aberto",
        }

    last_closed = _last_closed(db, tenant_id, account_id)
    if last_closed:
        next_year, next_month = _add_month(last_closed[0], last_closed[1], 1)
        next_open_date = date(next_year, next_month, 1).isoformat()
    else:
        next_open_date = None

    message = (
        f"A data {parsed.strftime('%d/%m/%Y')} está no mês já fechado "
        f"{closure.month:02d}/{closure.year}."
    )
    return {
        "is_closed": True,
        "closure_id": closure.id,
        "closure_year": closure.year,
        "closure_month": closure.month,
        "next_open_date": next_open_date,
        "message": message,
    }


def ensure_period_open(
    db: Session,
    tenant_id: int,
    account_id: int,
    *dates: Any,
) -> None:
    for value in dates:
        parsed = _as_date(value)
        if parsed is None:
            continue
        result = validate_date(db, tenant_id, account_id, parsed)
        if result["is_closed"]:
            raise AccountPeriodClosedError(result["message"], result)


def _benefit_statements_for_account_filter(tenant_id: int, account_id: int):
    """Mesmo escopo de conta usado em `_load_benefit_items` (balanço / fechamento)."""
    return and_(
        BenefitCardStatement.tenant_id == tenant_id,
        or_(
            BenefitCardStatement.account_id == account_id,
            and_(
                BenefitCardStatement.account_id.is_(None),
                Cartao.account_id == account_id,
            ),
        ),
    )


def _first_bank_period(db: Session, tenant_id: int, account_id: int) -> Optional[tuple[int, int]]:
    first_date = (
        db.query(func.min(BankStatement.date))
        .filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            BankStatement.date >= datetime(MIN_YEAR, 1, 1),
        )
        .scalar()
    )
    parsed = _as_date(first_date)
    if parsed is None:
        return None
    return parsed.year, parsed.month


def _first_benefit_period(db: Session, tenant_id: int, account_id: int) -> Optional[tuple[int, int]]:
    first_date = (
        db.query(func.min(BenefitCardStatement.date))
        .join(Cartao, Cartao.id == BenefitCardStatement.credit_card_id)
        .filter(
            _benefit_statements_for_account_filter(tenant_id, account_id),
            BenefitCardStatement.date >= datetime(MIN_YEAR, 1, 1),
        )
        .scalar()
    )
    parsed = _as_date(first_date)
    if parsed is None:
        return None
    return parsed.year, parsed.month


def _first_data_period(db: Session, tenant_id: int, account_id: int) -> Optional[tuple[int, int]]:
    """Primeiro mês com extrato bancário ou lançamento de benefício na conta (cartão ignorado)."""
    candidates = [
        p
        for p in (
            _first_bank_period(db, tenant_id, account_id),
            _first_benefit_period(db, tenant_id, account_id),
        )
        if p is not None
    ]
    if not candidates:
        return None
    return min(candidates)


def _available_years(first_data: Optional[tuple[int, int]], today: date) -> list[int]:
    start = first_data[0] if first_data else today.year
    start = max(start, MIN_YEAR)
    end = max(today.year, start)
    return list(range(start, end + 1))


def _resolve_list_year(
    year: Optional[int],
    years: list[int],
    next_closeable: Optional[tuple[int, int]],
    today: date,
) -> int:
    fallback = next_closeable[0] if next_closeable else today.year
    if year is None:
        year = fallback
    if years:
        if year < years[0]:
            return years[0]
        if year > years[-1]:
            return years[-1]
        return year
    return min(max(year, MIN_YEAR), today.year)


def _list_scope(
    db: Session,
    tenant_id: int,
    account_id: int,
) -> dict[str, Any]:
    today = date.today()
    first_data = _first_data_period(db, tenant_id, account_id)
    years = _available_years(first_data, today)
    last_closed = _last_closed(db, tenant_id, account_id)
    next_closeable = _next_closeable(first_data, last_closed)
    return {
        "today": today,
        "first_data": first_data,
        "years": years,
        "last_closed": last_closed,
        "next_closeable": next_closeable,
        "first_data_year_month": _year_month_key(*first_data) if first_data else None,
        "last_closed_year_month": _year_month_key(*last_closed) if last_closed else None,
        "next_closeable_year_month": (
            _year_month_key(*next_closeable) if next_closeable else None
        ),
    }


def list_options(db: Session, tenant_id: int, account_id: int) -> dict[str, Any]:
    scope = _list_scope(db, tenant_id, account_id)
    return {
        "years": scope["years"],
        "first_data_year_month": scope["first_data_year_month"],
        "last_closed_year_month": scope["last_closed_year_month"],
        "next_closeable_year_month": scope["next_closeable_year_month"],
    }


def _next_closeable(
    first_data: Optional[tuple[int, int]],
    last_closed: Optional[tuple[int, int]],
) -> Optional[tuple[int, int]]:
    if last_closed is not None:
        return _add_month(last_closed[0], last_closed[1], 1)
    return first_data


def _list_closures(db: Session, tenant_id: int, account_id: int) -> list[AccountPeriodClosure]:
    return (
        db.query(AccountPeriodClosure)
        .filter(
            AccountPeriodClosure.tenant_id == tenant_id,
            AccountPeriodClosure.account_id == account_id,
        )
        .order_by(AccountPeriodClosure.year, AccountPeriodClosure.month)
        .all()
    )


def _last_closed(db: Session, tenant_id: int, account_id: int) -> Optional[tuple[int, int]]:
    row = (
        db.query(AccountPeriodClosure.year, AccountPeriodClosure.month)
        .filter(
            AccountPeriodClosure.tenant_id == tenant_id,
            AccountPeriodClosure.account_id == account_id,
        )
        .order_by(AccountPeriodClosure.year.desc(), AccountPeriodClosure.month.desc())
        .first()
    )
    if not row:
        return None
    return int(row.year), int(row.month)


def _partner_fields(row: Any) -> dict[str, Any]:
    partner_id = getattr(row, "shared_partner_id", None)
    return {
        "shared_partner_id": int(partner_id) if partner_id else None,
        "shared_partner_name": getattr(row, "shared_partner_name", None),
        "shared_partner_bank": getattr(row, "shared_partner_bank", None),
        "shared_partner_agency": getattr(row, "shared_partner_agency", None),
        "shared_partner_account_number": getattr(row, "shared_partner_account_number", None),
    }


def _sharing_partner_map(db: Session, tenant_id: int, sharing_ids: set[int]) -> dict[int, dict[str, Any]]:
    if not sharing_ids:
        return {}
    SharedAccount = aliased(Account)
    rows = (
        db.query(
            ExpenseSharingSetting.id,
            SharedAccount.id.label("shared_partner_id"),
            SharedAccount.name.label("shared_partner_name"),
            SharedAccount.agency.label("shared_partner_agency"),
            SharedAccount.account_number.label("shared_partner_account_number"),
            Bank.name.label("shared_partner_bank"),
        )
        .outerjoin(SharedAccount, SharedAccount.id == ExpenseSharingSetting.shared_account_id)
        .outerjoin(Bank, Bank.id == SharedAccount.bank_id)
        .filter(
            ExpenseSharingSetting.tenant_id == tenant_id,
            ExpenseSharingSetting.id.in_(list(sharing_ids)),
        )
        .all()
    )
    return {int(row.id): _partner_fields(row) for row in rows}


def _attach_sharing_partners(
    db: Session,
    tenant_id: int,
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    missing_ids: set[int] = set()
    for item in items:
        sharing_id = item.get("expense_sharing_id")
        if sharing_id and not item.get("shared_partner_id") and not item.get("shared_partner_name"):
            missing_ids.add(int(sharing_id))
    partners = _sharing_partner_map(db, tenant_id, missing_ids)
    attached: list[dict[str, Any]] = []
    for item in items:
        payload = dict(item)
        sharing_id = payload.get("expense_sharing_id")
        if sharing_id and not payload.get("shared_partner_id") and not payload.get("shared_partner_name"):
            info = partners.get(int(sharing_id))
            if info:
                payload.update(info)
        attached.append(payload)
    return attached


def _month_flow(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: int,
    month: int,
    include_items: bool = False,
) -> dict[str, Any]:
    start = _period_start(year, month)
    end = _period_end_exclusive(year, month)
    SharedAccount = aliased(Account)
    rows = (
        db.query(
            BankStatement.id,
            BankStatement.date,
            BankStatement.description,
            BankStatement.amount,
            BankStatement.category,
            BankStatement.migrated_from_account_id,
            BankStatement.ownership_percentage,
            BankStatement.expense_sharing_id,
            BankStatement.subtag_id,
            Subtag.name.label("subtag_name"),
            Tag.name.label("tag_name"),
            SharedAccount.id.label("shared_partner_id"),
            SharedAccount.name.label("shared_partner_name"),
            SharedAccount.agency.label("shared_partner_agency"),
            SharedAccount.account_number.label("shared_partner_account_number"),
            Bank.name.label("shared_partner_bank"),
        )
        .outerjoin(Subtag, Subtag.id == BankStatement.subtag_id)
        .outerjoin(Tag, Tag.id == Subtag.tag_id)
        .outerjoin(ExpenseSharingSetting, ExpenseSharingSetting.id == BankStatement.expense_sharing_id)
        .outerjoin(SharedAccount, SharedAccount.id == ExpenseSharingSetting.shared_account_id)
        .outerjoin(Bank, Bank.id == SharedAccount.bank_id)
        .filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            BankStatement.date >= start,
            BankStatement.date < end,
        )
        .order_by(BankStatement.date.asc(), BankStatement.id.asc())
        .all()
    )
    entries = ZERO
    exits = ZERO
    items: list[dict[str, Any]] = []
    for row in rows:
        amount = _money(row.amount)
        if amount > 0:
            entries += amount
        elif amount < 0:
            exits += abs(amount)
        if include_items:
            splits = split_signed_amount(
                amount, row.ownership_percentage, row.expense_sharing_id, row.shared_partner_id,
            )
            items.append({
                "id": int(row.id),
                "date": _iso_date(row.date),
                "description": row.description or "",
                "amount": float(amount),
                "source": "bank",
                "is_manual": row.category is None and row.migrated_from_account_id is None,
                "migrated_from_account_id": (
                    int(row.migrated_from_account_id) if row.migrated_from_account_id else None
                ),
                "ownership_percentage": (
                    float(row.ownership_percentage) if row.ownership_percentage is not None else None
                ),
                "expense_sharing_id": (
                    int(row.expense_sharing_id) if row.expense_sharing_id is not None else None
                ),
                "subtag_id": int(row.subtag_id) if row.subtag_id is not None else None,
                "subtag_name": row.subtag_name,
                "tag_name": row.tag_name,
                "amount_account": splits["amount_account"],
                "amount_shared": splits["amount_shared"],
                **_partner_fields(row),
            })
    return {
        "entries": entries.quantize(MONEY),
        "exits": exits.quantize(MONEY),
        "items": items,
        "item_count": len(rows),
    }


def _load_month_flows(
    db: Session,
    tenant_id: int,
    account_id: int,
    start: tuple[int, int],
    end_inclusive: tuple[int, int],
) -> dict[tuple[int, int], tuple[Decimal, Decimal, int]]:
    if start > end_inclusive:
        return {}

    year_col = cast(extract("year", BankStatement.date), Integer)
    month_col = cast(extract("month", BankStatement.date), Integer)
    entries_expr = func.coalesce(
        func.sum(case((BankStatement.amount > 0, BankStatement.amount), else_=0)),
        0,
    )
    exits_expr = func.coalesce(
        func.sum(case((BankStatement.amount < 0, -BankStatement.amount), else_=0)),
        0,
    )
    rows = (
        db.query(
            year_col.label("year"),
            month_col.label("month"),
            entries_expr.label("entries"),
            exits_expr.label("exits"),
            func.count(BankStatement.id).label("item_count"),
        )
        .filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            BankStatement.date >= _period_start(*start),
            BankStatement.date < _period_end_exclusive(*end_inclusive),
        )
        .group_by(year_col, month_col)
        .all()
    )
    return {
        (int(row.year), int(row.month)): (
            _money(row.entries),
            _money(row.exits),
            int(row.item_count or 0),
        )
        for row in rows
    }


def _opening_for_month(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: int,
    month: int,
    closures_by_period: dict[tuple[int, int], AccountPeriodClosure],
    first_data: Optional[tuple[int, int]],
) -> Decimal:
    prev = _add_month(year, month, -1)
    previous_closure = closures_by_period.get(prev)
    if previous_closure:
        return _money(previous_closure.closing_balance)
    if first_data and (year, month) == first_data:
        return ZERO

    last_closed = None
    for period in sorted(closures_by_period):
        if period < (year, month):
            last_closed = period
    if last_closed:
        opening = _money(closures_by_period[last_closed].closing_balance)
        cursor = _add_month(last_closed[0], last_closed[1], 1)
    elif first_data and first_data < (year, month):
        opening = ZERO
        cursor = first_data
    else:
        return ZERO

    if cursor >= (year, month):
        return opening

    end = _add_month(year, month, -1)
    flows = _load_month_flows(db, tenant_id, account_id, cursor, end)
    while cursor < (year, month):
        entries, exits, _count = flows.get(cursor, (ZERO, ZERO, 0))
        opening = (opening + entries - exits).quantize(MONEY)
        cursor = _add_month(cursor[0], cursor[1], 1)
    return opening


def _month_status(
    year: int,
    month: int,
    today: date,
    first_data: Optional[tuple[int, int]],
    last_closed: Optional[tuple[int, int]],
    is_closed: bool,
) -> tuple[str, Optional[str]]:
    if is_closed:
        return "closed", None
    if (year, month) > (today.year, today.month):
        return "future", "Mês futuro"
    if (year, month) == (today.year, today.month):
        return "current", "Não é possível fechar o mês corrente"
    if first_data is None:
        return "no_data", "Sem lançamentos de extrato ou benefício nesta conta"
    if (year, month) < first_data:
        return "no_data", "Anterior ao primeiro lançamento (extrato ou benefício)"
    expected = first_data if last_closed is None else _add_month(last_closed[0], last_closed[1], 1)
    if (year, month) == expected:
        return "can_close", None
    previous = _add_month(year, month, -1)
    return "blocked", (
        f"Feche {_period_label(*previous)} antes de fechar {_period_label(year, month)}"
    )


def _open_shared_notice(year: int, month: int) -> str:
    return (
        f"Há fechamento compartilhado de {_period_label(year, month)} em aberto. "
        "Somente os pagamentos realizados até o final deste mês entram neste fechamento."
    )


def _unsettled_shared_periods(db: Session, tenant_id: int, account_id: int) -> set[tuple[int, int]]:
    rows = (
        db.query(BalanceClosure.year, BalanceClosure.month)
        .filter(
            BalanceClosure.tenant_id == tenant_id,
            BalanceClosure.is_settled.is_(False),
            or_(
                BalanceClosure.account_id == account_id,
                BalanceClosure.shared_account_id == account_id,
            ),
        )
        .distinct()
        .all()
    )
    return {(int(row.year), int(row.month)) for row in rows}


def _shared_closures_for_month(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: int,
    month: int,
) -> list[dict[str, Any]]:
    month_start = _period_start(year, month)
    month_end = _period_end_exclusive(year, month)
    rows = (
        db.query(BalanceClosure)
        .filter(
            BalanceClosure.tenant_id == tenant_id,
            or_(
                BalanceClosure.account_id == account_id,
                BalanceClosure.shared_account_id == account_id,
            ),
            or_(
                and_(BalanceClosure.year == year, BalanceClosure.month == month),
                and_(
                    BalanceClosure.closing_date >= month_start,
                    BalanceClosure.closing_date < month_end,
                ),
            ),
        )
        .order_by(BalanceClosure.closing_date.desc())
        .all()
    )
    seen: set[int] = set()
    closures: list[dict[str, Any]] = []
    for row in rows:
        partner_id = (
            int(row.shared_account_id)
            if int(row.account_id) == account_id
            else int(row.account_id)
        )
        if partner_id in seen:
            continue
        seen.add(partner_id)
        closures.append({
            "shared_partner_id": partner_id,
            "expense_sharing_id": int(row.expense_sharing_id) if row.expense_sharing_id else None,
            "period_start_date": _iso_datetime(row.period_start_date),
            "closing_date": _iso_datetime(row.closing_date),
            "is_settled": bool(row.is_settled),
        })
    return closures


def _hydrate_item_datetimes(
    db: Session,
    tenant_id: int,
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    bank_ids: set[int] = set()
    invoice_ids: set[int] = set()
    benefit_ids: set[int] = set()
    payment_ids: set[int] = set()
    loan_payment_ids: set[int] = set()
    for item in items:
        raw_id = item.get("id")
        invoice_id = _prefixed_int(raw_id, "invoice:")
        benefit_id = _prefixed_int(raw_id, "benefit:")
        settlement_id = _prefixed_int(raw_id, "settlement:")
        loan_id = _prefixed_int(raw_id, "loan-settlement:")
        if invoice_id is not None:
            invoice_ids.add(invoice_id)
        elif benefit_id is not None:
            benefit_ids.add(benefit_id)
        elif settlement_id is not None:
            payment_ids.add(settlement_id)
        elif loan_id is not None:
            loan_payment_ids.add(loan_id)
        elif raw_id is not None and str(raw_id).isdigit():
            bank_ids.add(int(raw_id))

    bank_dates: dict[int, Any] = {}
    if bank_ids:
        bank_dates = {
            int(row.id): row.date
            for row in (
                db.query(BankStatement.id, BankStatement.date)
                .filter(BankStatement.tenant_id == tenant_id, BankStatement.id.in_(bank_ids))
                .all()
            )
        }
    invoice_dates: dict[int, Any] = {}
    if invoice_ids:
        invoice_dates = {
            int(row.id): row.date
            for row in (
                db.query(CreditCardInvoice.id, CreditCardInvoice.date)
                .filter(CreditCardInvoice.tenant_id == tenant_id, CreditCardInvoice.id.in_(invoice_ids))
                .all()
            )
        }
    benefit_dates: dict[int, Any] = {}
    if benefit_ids:
        benefit_dates = {
            int(row.id): row.date
            for row in (
                db.query(BenefitCardStatement.id, BenefitCardStatement.date)
                .filter(
                    BenefitCardStatement.tenant_id == tenant_id,
                    BenefitCardStatement.id.in_(benefit_ids),
                )
                .all()
            )
        }
    payment_dates: dict[int, Any] = {}
    if payment_ids:
        payment_dates = {
            int(row.id): row.payment_date
            for row in (
                db.query(BalanceClosurePayment.id, BalanceClosurePayment.payment_date)
                .filter(
                    BalanceClosurePayment.tenant_id == tenant_id,
                    BalanceClosurePayment.id.in_(payment_ids),
                )
                .all()
            )
        }
    loan_dates: dict[int, Any] = {}
    if loan_payment_ids:
        loan_dates = {
            int(row.id): row.payment_date
            for row in (
                db.query(LoanPayment.id, LoanPayment.payment_date)
                .filter(LoanPayment.tenant_id == tenant_id, LoanPayment.id.in_(loan_payment_ids))
                .all()
            )
        }

    hydrated: list[dict[str, Any]] = []
    for item in items:
        payload = dict(item)
        raw_id = payload.get("id")
        stamp = payload.get("occurred_at")
        if not stamp:
            invoice_id = _prefixed_int(raw_id, "invoice:")
            benefit_id = _prefixed_int(raw_id, "benefit:")
            settlement_id = _prefixed_int(raw_id, "settlement:")
            loan_id = _prefixed_int(raw_id, "loan-settlement:")
            if invoice_id is not None:
                stamp = _iso_datetime(invoice_dates.get(invoice_id))
            elif benefit_id is not None:
                stamp = _iso_datetime(benefit_dates.get(benefit_id))
            elif settlement_id is not None:
                stamp = _iso_datetime(payment_dates.get(settlement_id))
            elif loan_id is not None:
                stamp = _iso_datetime(loan_dates.get(loan_id))
            elif raw_id is not None and str(raw_id).isdigit():
                stamp = _iso_datetime(bank_dates.get(int(raw_id)))
        payload["occurred_at"] = stamp or _iso_datetime(payload.get("date"))
        hydrated.append(payload)
    return hydrated


def _enrich_item_splits(
    db: Session,
    tenant_id: int,
    account_id: int,
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    missing_ids = [
        int(item["id"])
        for item in items
        if item.get("id") is not None and item.get("amount_account") is None
    ]
    by_id: dict[int, Any] = {}
    if missing_ids:
        rows = (
            db.query(
                BankStatement.id,
                BankStatement.ownership_percentage,
                BankStatement.expense_sharing_id,
            )
            .filter(
                BankStatement.tenant_id == tenant_id,
                BankStatement.account_id == account_id,
                BankStatement.id.in_(missing_ids),
            )
            .all()
        )
        by_id = {int(row.id): row for row in rows}
    enriched: list[dict[str, Any]] = []
    for item in items:
        payload = dict(item)
        payload.setdefault("source", "bank")
        if payload.get("amount_account") is None or payload.get("amount_shared") is None:
            row = by_id.get(int(payload["id"])) if payload.get("id") is not None else None
            ownership = payload.get("ownership_percentage")
            sharing_id = payload.get("expense_sharing_id")
            partner_id = payload.get("shared_partner_id")
            if row is not None:
                if ownership is None:
                    ownership = row.ownership_percentage
                if sharing_id is None:
                    sharing_id = row.expense_sharing_id
            splits = split_signed_amount(payload.get("amount"), ownership, sharing_id, partner_id)
            payload["amount_account"] = splits["amount_account"]
            payload["amount_shared"] = splits["amount_shared"]
            payload["ownership_percentage"] = float(ownership) if ownership is not None else None
            payload["expense_sharing_id"] = int(sharing_id) if sharing_id is not None else None
        enriched.append(payload)
    return _attach_sharing_partners(db, tenant_id, enriched)


def _month_splits(
    snapshot: Optional[dict[str, Any]],
    live_splits: Optional[dict[str, dict[str, dict[str, Decimal]]]],
    year: int,
    month: int,
    allocation: Optional[dict[str, Any]] = None,
) -> dict[str, dict[str, float]]:
    stored = (snapshot or {}).get("splits")
    if isinstance(stored, dict) and (
        isinstance(stored.get("account"), dict) or isinstance(stored.get("shared"), dict)
    ):
        return serialize_splits(stored.get("account"), stored.get("shared"))
    allocation_splits = (allocation or {}).get("splits")
    if isinstance(allocation_splits, dict) and (
        isinstance(allocation_splits.get("account"), dict)
        or isinstance(allocation_splits.get("shared"), dict)
    ):
        return serialize_splits(allocation_splits.get("account"), allocation_splits.get("shared"))
    year_month = _year_month_key(year, month)
    live = live_splits or {}
    return serialize_splits(
        (live.get("account") or {}).get(year_month),
        (live.get("shared") or {}).get(year_month),
    )


def _allocation_fields(allocation: Optional[dict[str, Any]]) -> dict[str, Any]:
    data = allocation or {}
    replaced = []
    for value in data.get("replaced_bank_ids") or []:
        try:
            replaced.append(int(value))
        except (TypeError, ValueError):
            continue
    return {
        "card_items": list(data.get("card_items") or []),
        "benefit_items": list(data.get("benefit_items") or []),
        "shared_settlements": list(data.get("shared_settlements") or []),
        "unmatched_card_payments": list(data.get("unmatched_card_payments") or []),
        "replaced_bank_ids": replaced,
        "shared_by_account": list(data.get("shared_by_account") or []),
        "splits": data.get("splits"),
    }


def _mask_replaced_bank_items(
    items: list[dict[str, Any]],
    replaced_ids: list[int],
) -> list[dict[str, Any]]:
    replaced = set(replaced_ids)
    masked: list[dict[str, Any]] = []
    for item in items:
        payload = dict(item)
        if payload.get("source", "bank") == "bank" and payload.get("id") in replaced:
            payload["amount_account"] = 0.0
            payload["amount_shared"] = 0.0
        masked.append(payload)
    return masked


def _serialize_month(
    year: int,
    month: int,
    status: str,
    block_reason: Optional[str],
    opening: Decimal,
    entries: Decimal,
    exits: Decimal,
    closure: Optional[AccountPeriodClosure],
    last_closed: Optional[tuple[int, int]],
    _first_data: Optional[tuple[int, int]],
    items: Optional[list[dict[str, Any]]] = None,
    item_count: Optional[int] = None,
    live_splits: Optional[dict[str, dict[str, dict[str, Decimal]]]] = None,
    allocation: Optional[dict[str, Any]] = None,
    has_open_shared: bool = False,
    shared_closures: Optional[list[dict[str, Any]]] = None,
    db: Optional[Session] = None,
    tenant_id: Optional[int] = None,
    account_id: Optional[int] = None,
) -> dict[str, Any]:
    closing = (opening + entries - exits).quantize(MONEY)
    is_closed = status == "closed"
    can_close = status == "can_close"
    can_reopen = bool(closure and last_closed == (year, month))
    snapshot = (closure.closure_data or {}) if closure else {}
    adjustment_amount = snapshot.get("adjustment_amount")
    if closure and db is not None and tenant_id is not None and account_id is not None:
        snap_amt = _money(adjustment_amount or 0)
        snap_id = snapshot.get("adjustment_bank_statement_id")
        anchor = snapshot.get("adjustment_anchor")
        is_adjustment_anchor = (
            isinstance(anchor, dict)
            and int(anchor.get("year", -1)) == year
            and int(anchor.get("month", -1)) == month
        )
        # Só enriquece o mês que de fato possui ajuste (snapshot ou âncora do lote).
        if snap_id is not None or snap_amt != ZERO or is_adjustment_anchor:
            resolved_adj = _resolve_closure_adjustment_statement(
                db, tenant_id, account_id, year, month, snapshot,
            )
            if resolved_adj is not None:
                adjustment_amount = float(resolved_adj.amount)
            elif snap_amt == ZERO and not is_adjustment_anchor:
                adjustment_amount = None
    resolved_count = len(items) if items is not None else item_count
    allocation_fields = _allocation_fields(allocation)
    payload = {
        "id": closure.id if closure else None,
        "year": year,
        "month": month,
        "year_month": _year_month_key(year, month),
        "status": status,
        "is_closed": is_closed,
        "can_close": can_close,
        "can_reopen": can_reopen,
        "opening_editable": False,
        "opening_balance": float(opening),
        "entries": float(entries),
        "exits": float(exits),
        "closing_balance": float(_money(closure.closing_balance) if closure else closing),
        "item_count": resolved_count,
        "adjustment_amount": float(adjustment_amount) if adjustment_amount is not None else None,
        "closed_at": closure.created_at.isoformat() if closure and closure.created_at else None,
        "notes": closure.notes if closure else None,
        "block_reason": block_reason,
        "has_open_shared_closure": has_open_shared,
        "open_shared_notice": _open_shared_notice(year, month) if has_open_shared else None,
        "sources": list(snapshot.get("sources", SOURCES)) if closure else SOURCES,
        "card_items": allocation_fields["card_items"],
        "benefit_items": allocation_fields["benefit_items"],
        "shared_settlements": allocation_fields["shared_settlements"],
        "unmatched_card_payments": allocation_fields["unmatched_card_payments"],
        "replaced_bank_ids": allocation_fields["replaced_bank_ids"],
        "shared_by_account": allocation_fields["shared_by_account"],
        "shared_closures": list(shared_closures or []),
    }
    if items is not None:
        payload["items"] = _mask_replaced_bank_items(items, allocation_fields["replaced_bank_ids"])
    splits = _month_splits(snapshot, live_splits, year, month, allocation_fields)
    payload["split_account"] = splits["account"]
    payload["split_shared"] = splits["shared"]
    return payload


def list_year(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: Optional[int] = None,
    all_years: bool = False,
) -> dict[str, Any]:
    if not all_years and year is None:
        raise AccountPeriodCloseError("Informe o ano")

    scope = _list_scope(db, tenant_id, account_id)
    today = scope["today"]
    first_data = scope["first_data"]
    years: list[int] = scope["years"]
    last_closed = scope["last_closed"]
    next_closeable = scope["next_closeable"]

    if all_years:
        target_years = years or [today.year]
    else:
        target_years = [_resolve_list_year(year, years, next_closeable, today)]

    closures = _list_closures(db, tenant_id, account_id)
    closures_by_period = {(row.year, row.month): row for row in closures}

    flow_start = next_closeable
    last_target = target_years[-1]
    flow_end = (last_target, 12)
    if flow_end > (today.year, today.month):
        flow_end = (today.year, today.month)
    flows: dict[tuple[int, int], tuple[Decimal, Decimal, int]] = {}
    openings: dict[tuple[int, int], Decimal] = {}
    if flow_start and flow_start <= flow_end:
        flows = _load_month_flows(db, tenant_id, account_id, flow_start, flow_end)
        running = ZERO
        if last_closed:
            previous = closures_by_period.get(last_closed)
            if previous:
                running = _money(previous.closing_balance)
        cursor = flow_start
        while cursor <= flow_end:
            openings[cursor] = running
            entries, exits, _count = flows.get(cursor, (ZERO, ZERO, 0))
            running = (running + entries - exits).quantize(MONEY)
            cursor = _add_month(cursor[0], cursor[1], 1)

    live_periods: list[tuple[int, int]] = []
    for target_year in target_years:
        for month in range(1, 13):
            closure = closures_by_period.get((target_year, month))
            status, _reason = _month_status(
                target_year, month, today, first_data, last_closed, closure is not None,
            )
            if status in ("future", "no_data"):
                continue
            if closure:
                continue
            live_periods.append((target_year, month))
    live_splits = compute_scoped_month_flows(db, tenant_id, account_id, live_periods)
    unsettled_shared = _unsettled_shared_periods(db, tenant_id, account_id)

    months: list[dict[str, Any]] = []
    closed_series: list[dict[str, Any]] = []
    for target_year in target_years:
        for month in range(1, 13):
            closure = closures_by_period.get((target_year, month))
            status, block_reason = _month_status(
                target_year, month, today, first_data, last_closed, closure is not None,
            )
            if closure:
                opening = _money(closure.opening_balance)
                entries = _money(closure.entries)
                exits = _money(closure.exits)
                item_count = len((closure.closure_data or {}).get("items") or [])
            elif status in ("future", "no_data"):
                opening = ZERO
                entries = ZERO
                exits = ZERO
                item_count = 0
            else:
                entries, exits, item_count = flows.get((target_year, month), (ZERO, ZERO, 0))
                opening = openings.get((target_year, month), ZERO) if status in LIVE_OPENING_STATUSES else ZERO

            serialized = _serialize_month(
                target_year, month, status, block_reason, opening, entries, exits,
                closure, last_closed, first_data, item_count=item_count, live_splits=live_splits,
                has_open_shared=(target_year, month) in unsettled_shared,
                db=db, tenant_id=tenant_id, account_id=account_id,
            )
            months.append(serialized)
            if closure:
                closed_series.append({
                    "year_month": serialized["year_month"],
                    "label": serialized["year_month"],
                    "opening_balance": serialized["opening_balance"],
                    "entries": serialized["entries"],
                    "exits": serialized["exits"],
                    "closing_balance": serialized["closing_balance"],
                    "split_account": serialized["split_account"],
                    "split_shared": serialized["split_shared"],
                })

    return {
        "year": None if all_years else target_years[0],
        "all_years": all_years,
        "years": years,
        "first_data_year_month": scope["first_data_year_month"],
        "last_closed_year_month": scope["last_closed_year_month"],
        "next_closeable_year_month": scope["next_closeable_year_month"],
        "months": months,
        "closed_series": closed_series,
    }


def get_preview(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: int,
    month: int,
) -> dict[str, Any]:
    if month < 1 or month > 12:
        raise AccountPeriodCloseError("Mês inválido")
    today = date.today()
    first_data = _first_data_period(db, tenant_id, account_id)
    closures = _list_closures(db, tenant_id, account_id)
    closures_by_period = {(row.year, row.month): row for row in closures}
    last_closed = _last_closed(db, tenant_id, account_id)
    closure = closures_by_period.get((year, month))
    status, block_reason = _month_status(
        year, month, today, first_data, last_closed, closure is not None,
    )
    has_open_shared = (year, month) in _unsettled_shared_periods(db, tenant_id, account_id)

    if closure:
        snapshot = closure.closure_data or {}
        items = _attach_sharing_partners(db, tenant_id, list(snapshot.get("items") or []))
        allocation = _allocation_fields(snapshot)
        allocation["splits"] = snapshot.get("splits")
        allocation["card_items"] = _attach_sharing_partners(db, tenant_id, list(allocation.get("card_items") or []))
        allocation["benefit_items"] = _attach_sharing_partners(db, tenant_id, list(allocation.get("benefit_items") or []))
        allocation["shared_settlements"] = _attach_sharing_partners(
            db, tenant_id, list(allocation.get("shared_settlements") or []),
        )
        if not allocation["benefit_items"]:
            allocation["benefit_items"] = _attach_sharing_partners(
                db, tenant_id, _load_benefit_items(db, tenant_id, account_id, [(year, month)]),
            )
        items = _hydrate_item_datetimes(db, tenant_id, items)
        allocation["card_items"] = _hydrate_item_datetimes(
            db, tenant_id, list(allocation.get("card_items") or []),
        )
        allocation["benefit_items"] = _hydrate_item_datetimes(
            db, tenant_id, list(allocation.get("benefit_items") or []),
        )
        allocation["shared_settlements"] = _hydrate_item_datetimes(
            db, tenant_id, list(allocation.get("shared_settlements") or []),
        )
        return _serialize_month(
            year, month, status, block_reason,
            _money(closure.opening_balance),
            _money(closure.entries),
            _money(closure.exits),
            closure, last_closed, first_data, items,
            allocation=allocation,
            has_open_shared=has_open_shared,
            shared_closures=_shared_closures_for_month(db, tenant_id, account_id, year, month),
            db=db, tenant_id=tenant_id, account_id=account_id,
        )

    flow = _month_flow(db, tenant_id, account_id, year, month, include_items=True)
    opening = ZERO
    if status in LIVE_OPENING_STATUSES:
        opening = _opening_for_month(
            db, tenant_id, account_id, year, month, closures_by_period, first_data,
        )
    allocation = period_allocation_details(db, tenant_id, account_id, year, month)
    allocation["card_items"] = _hydrate_item_datetimes(
        db, tenant_id, list(allocation.get("card_items") or []),
    )
    allocation["benefit_items"] = _hydrate_item_datetimes(
        db, tenant_id, list(allocation.get("benefit_items") or []),
    )
    allocation["shared_settlements"] = _hydrate_item_datetimes(
        db, tenant_id, list(allocation.get("shared_settlements") or []),
    )
    return _serialize_month(
        year, month, status, block_reason, opening, flow["entries"], flow["exits"],
        None, last_closed, first_data,
        _hydrate_item_datetimes(
            db, tenant_id, _enrich_item_splits(db, tenant_id, account_id, flow["items"]),
        ),
        allocation=allocation,
        has_open_shared=has_open_shared,
        shared_closures=_shared_closures_for_month(db, tenant_id, account_id, year, month),
    )


def _adjustment_description(year: int, month: int) -> str:
    return f"{ADJUSTMENT_DESCRIPTION_PREFIX} {_period_label(year, month)}"


def _resolve_closure_adjustment_statement(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: int,
    month: int,
    snapshot: dict[str, Any],
) -> Optional[BankStatement]:
    """Localiza lançamento de ajuste do fechamento (snapshot, descrição ou data do mês)."""
    raw_id = snapshot.get("adjustment_bank_statement_id")
    if raw_id is not None:
        try:
            stmt_id = int(raw_id)
        except (TypeError, ValueError):
            stmt_id = None
        if stmt_id:
            found = (
                db.query(BankStatement)
                .filter(
                    BankStatement.id == stmt_id,
                    BankStatement.tenant_id == tenant_id,
                    BankStatement.account_id == account_id,
                )
                .first()
            )
            if found:
                return found

    desc = _adjustment_description(year, month)
    found = (
        db.query(BankStatement)
        .filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            BankStatement.description == desc,
        )
        .order_by(BankStatement.id.desc())
        .first()
    )
    if found:
        return found

    start = _period_start(year, month)
    end = _last_moment(year, month)
    return (
        db.query(BankStatement)
        .filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            BankStatement.description.like(f"{ADJUSTMENT_DESCRIPTION_PREFIX}%"),
            BankStatement.date >= start,
            BankStatement.date <= end,
        )
        .order_by(BankStatement.id.desc())
        .first()
    )


def _find_adjustment_for_reopen(
    db: Session,
    tenant_id: int,
    account_id: int,
    row: AccountPeriodClosure,
    snapshot: dict[str, Any],
) -> Optional[BankStatement]:
    """Ajuste deste fechamento, inclusive em lote com âncora no último mês do grupo."""
    statement = _resolve_closure_adjustment_statement(
        db, tenant_id, account_id, row.year, row.month, snapshot,
    )
    if statement:
        return statement

    anchor = snapshot.get("adjustment_anchor")
    if not isinstance(anchor, dict):
        return None
    try:
        ay, am = int(anchor["year"]), int(anchor["month"])
    except (KeyError, TypeError, ValueError):
        return None

    cursor = _add_month(row.year, row.month, -1)
    while True:
        prev_row = (
            db.query(AccountPeriodClosure)
            .filter(
                AccountPeriodClosure.tenant_id == tenant_id,
                AccountPeriodClosure.account_id == account_id,
                AccountPeriodClosure.year == cursor[0],
                AccountPeriodClosure.month == cursor[1],
            )
            .first()
        )
        if not prev_row:
            break
        prev_snap = prev_row.closure_data or {}
        prev_anchor = prev_snap.get("adjustment_anchor")
        if not isinstance(prev_anchor, dict):
            break
        try:
            if int(prev_anchor["year"]) != ay or int(prev_anchor["month"]) != am:
                break
        except (KeyError, TypeError, ValueError):
            break
        statement = _resolve_closure_adjustment_statement(
            db, tenant_id, account_id, cursor[0], cursor[1], prev_snap,
        )
        if statement:
            return statement
        cursor = _add_month(cursor[0], cursor[1], -1)

    if (ay, am) != (row.year, row.month):
        return _resolve_closure_adjustment_statement(db, tenant_id, account_id, ay, am, {})
    return None


def _insert_adjustment(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    year: int,
    month: int,
    amount: Decimal,
    notes: Optional[str],
) -> Optional[BankStatement]:
    amount = _money(amount)
    if amount == ZERO:
        return None
    stamped = now_utc()
    statement = BankStatement(
        tenant_id=tenant_id,
        created_by=user_id,
        created_at=stamped,
        last_updated_at=stamped,
        account_id=account_id,
        date=_last_moment(year, month),
        description=_adjustment_description(year, month),
        amount=amount,
        category=None,
        transaction=None,
        ownership_percentage=Decimal("100.00"),
        adjustment_notes=notes or "Ajuste lançado no fechamento da conta",
    )
    db.add(statement)
    db.flush()
    return statement


def _normalize_periods(months: list[tuple[int, int]]) -> list[tuple[int, int]]:
    unique = sorted(set(months))
    if not unique:
        raise AccountPeriodCloseError("Selecione pelo menos um mês")
    for year, month in unique:
        if month < 1 or month > 12:
            raise AccountPeriodCloseError("Mês inválido")
        if year < MIN_YEAR:
            raise AccountPeriodCloseError("Ano inválido")
    cursor = unique[0]
    for period in unique[1:]:
        expected = _add_month(cursor[0], cursor[1], 1)
        if period != expected:
            raise AccountPeriodCloseError(
                "Os meses precisam ser consecutivos, a partir do próximo mês a fechar"
            )
        cursor = period
    return unique


def _previous_month_closed(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: int,
    month: int,
    first_data: Optional[tuple[int, int]],
) -> None:
    if first_data and (year, month) == first_data:
        return
    previous = _add_month(year, month, -1)
    exists = (
        db.query(AccountPeriodClosure.id)
        .filter(
            AccountPeriodClosure.tenant_id == tenant_id,
            AccountPeriodClosure.account_id == account_id,
            AccountPeriodClosure.year == previous[0],
            AccountPeriodClosure.month == previous[1],
        )
        .first()
    )
    if not exists:
        raise AccountPeriodCloseError(
            f"Feche {_period_label(*previous)} antes de fechar {_period_label(year, month)}"
        )


def _close_one(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    year: int,
    month: int,
    adjustment: Optional[Decimal],
    notes: Optional[str],
    *,
    adjustment_anchor: Optional[tuple[int, int]] = None,
) -> dict[str, Any]:
    preview = get_preview(db, tenant_id, account_id, year, month)
    if preview["is_closed"]:
        raise AccountPeriodCloseError("Este mês já está fechado", status_code=409)
    today = date.today()
    if (year, month) >= (today.year, today.month):
        raise AccountPeriodCloseError("Não é possível fechar o mês corrente")
    if not preview["can_close"]:
        raise AccountPeriodCloseError(preview["block_reason"] or "Este mês não pode ser fechado agora")
    first_data = _first_data_period(db, tenant_id, account_id)
    _previous_month_closed(db, tenant_id, account_id, year, month, first_data)

    anchor = adjustment_anchor or (year, month)
    apply_adjustment = (
        adjustment is not None
        and _money(adjustment) != ZERO
        and (year, month) == anchor
    )
    adj_amount = _money(adjustment) if apply_adjustment else ZERO
    statement = _insert_adjustment(
        db, tenant_id, account_id, user_id, year, month, adj_amount, notes,
    )

    flow = _month_flow(db, tenant_id, account_id, year, month, include_items=True)
    opening = _money(preview["opening_balance"])
    entries = flow["entries"]
    exits = flow["exits"]
    closing = (opening + entries - exits).quantize(MONEY)
    closed_at = now_utc()
    allocation = period_allocation_details(db, tenant_id, account_id, year, month)
    snapshot = {
        "sources": SOURCES,
        "items": flow["items"],
        "adjustment_anchor": {"year": anchor[0], "month": anchor[1]},
        "adjustment_bank_statement_id": int(statement.id) if statement else None,
        "adjustment_amount": float(adj_amount),
        "adjustment_date": _iso_date(_last_moment(year, month)) if statement else None,
        "splits": allocation["splits"],
        "card_items": allocation["card_items"],
        "benefit_items": allocation["benefit_items"],
        "shared_settlements": allocation["shared_settlements"],
        "unmatched_card_payments": allocation["unmatched_card_payments"],
        "replaced_bank_ids": allocation["replaced_bank_ids"],
        "shared_by_account": allocation["shared_by_account"],
    }
    row = AccountPeriodClosure(
        year=year,
        month=month,
        opening_balance=opening,
        entries=entries,
        exits=exits,
        closing_balance=closing,
        closure_data=snapshot,
        notes=notes,
        account_id=account_id,
        tenant_id=tenant_id,
        created_by=user_id,
        created_at=closed_at,
        last_updated_at=closed_at,
    )
    db.add(row)
    db.flush()
    logger.info(
        "Fechamento da conta gravado account=%s período=%s-%02d closing=%s adjustment=%s",
        account_id, year, month, closing, adj_amount,
    )
    return get_preview(db, tenant_id, account_id, year, month)


def close_period(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    year: int,
    month: int,
    opening_balance: Optional[Decimal] = None,
    notes: Optional[str] = None,
    adjustment: Optional[Decimal] = None,
) -> dict[str, Any]:
    del opening_balance
    result = _close_one(
        db, tenant_id, account_id, user_id, year, month, adjustment, notes,
        adjustment_anchor=(year, month),
    )
    db.commit()
    return result


def close_periods(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    months: list[tuple[int, int]],
    adjustment: Optional[Decimal] = None,
    notes: Optional[str] = None,
) -> dict[str, Any]:
    periods = _normalize_periods(months)
    first_data = _first_data_period(db, tenant_id, account_id)
    last_closed = _last_closed(db, tenant_id, account_id)
    expected = _next_closeable(first_data, last_closed)
    if expected is None:
        raise AccountPeriodCloseError("Não há mês disponível para fechar")
    if periods[0] != expected:
        raise AccountPeriodCloseError(
            f"A seleção precisa começar em {_period_label(*expected)}"
        )

    last = periods[-1]
    closed: list[dict[str, Any]] = []
    try:
        for period in periods:
            closed.append(
                _close_one(
                    db, tenant_id, account_id, user_id,
                    period[0], period[1], adjustment, notes if period == last else None,
                    adjustment_anchor=last,
                )
            )
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "closed": closed,
        "count": len(closed),
        "adjustment_year": last[0],
        "adjustment_month": last[1],
        "adjustment_date": _iso_date(_last_moment(*last)),
        "adjustment_amount": float(_money(adjustment) if adjustment is not None else ZERO),
    }


def reopen_period(
    db: Session,
    tenant_id: int,
    account_id: int,
    closure_id: int,
    *,
    delete_adjustment: bool = True,
) -> dict[str, Any]:
    row = (
        db.query(AccountPeriodClosure)
        .filter(
            AccountPeriodClosure.id == closure_id,
            AccountPeriodClosure.tenant_id == tenant_id,
            AccountPeriodClosure.account_id == account_id,
        )
        .first()
    )
    if not row:
        raise AccountPeriodCloseError("Fechamento não encontrado", status_code=404)

    last_closed = _last_closed(db, tenant_id, account_id)
    if last_closed != (row.year, row.month):
        raise AccountPeriodCloseError("Só é possível reabrir o último mês fechado")

    year, month = row.year, row.month
    snapshot = row.closure_data or {}
    statement = (
        _find_adjustment_for_reopen(db, tenant_id, account_id, row, snapshot)
        if delete_adjustment
        else None
    )
    db.delete(row)
    if delete_adjustment and statement:
        db.delete(statement)
    db.commit()
    logger.info("Fechamento da conta reaberto account=%s período=%s-%02d", account_id, year, month)
    return get_preview(db, tenant_id, account_id, year, month)


def get_closure_for_period(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: int,
    month: int,
) -> Optional[AccountPeriodClosure]:
    return (
        db.query(AccountPeriodClosure)
        .filter(
            AccountPeriodClosure.tenant_id == tenant_id,
            AccountPeriodClosure.account_id == account_id,
            AccountPeriodClosure.year == year,
            AccountPeriodClosure.month == month,
        )
        .first()
    )


def _build_closure_snapshot(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: int,
    month: int,
    prior_snapshot: dict[str, Any],
    flow_items: list[dict[str, Any]],
) -> dict[str, Any]:
    allocation = period_allocation_details(db, tenant_id, account_id, year, month)
    snapshot = dict(prior_snapshot)
    snapshot["sources"] = SOURCES
    snapshot["items"] = flow_items
    snapshot["splits"] = allocation["splits"]
    snapshot["card_items"] = allocation["card_items"]
    snapshot["benefit_items"] = allocation["benefit_items"]
    snapshot["shared_settlements"] = allocation["shared_settlements"]
    snapshot["unmatched_card_payments"] = allocation["unmatched_card_payments"]
    snapshot["replaced_bank_ids"] = allocation["replaced_bank_ids"]
    snapshot["shared_by_account"] = allocation["shared_by_account"]
    return snapshot


def _apply_month_adjustment_delta(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    year: int,
    month: int,
    snapshot: dict[str, Any],
    delta_closing: Decimal,
    note_append: Optional[str],
) -> dict[str, Any]:
    """Atualiza, cria ou remove lançamento de ajuste conforme delta de fechamento."""
    snapshot = dict(snapshot)
    adj_stmt = _resolve_closure_adjustment_statement(db, tenant_id, account_id, year, month, snapshot)
    amount_atual = _money(adj_stmt.amount) if adj_stmt else ZERO
    amount_novo = (amount_atual + delta_closing).quantize(MONEY)

    if adj_stmt is not None:
        if amount_novo == ZERO:
            db.delete(adj_stmt)
            snapshot.pop("adjustment_bank_statement_id", None)
            snapshot["adjustment_amount"] = 0.0
            snapshot.pop("adjustment_date", None)
        else:
            adj_stmt.amount = amount_novo
            if note_append:
                prior = (adj_stmt.adjustment_notes or "").strip()
                adj_stmt.adjustment_notes = f"{prior}\n{note_append}".strip() if prior else note_append
            snapshot["adjustment_bank_statement_id"] = int(adj_stmt.id)
            snapshot["adjustment_amount"] = float(amount_novo)
            snapshot["adjustment_date"] = _iso_date(_last_moment(year, month))
    elif amount_novo != ZERO:
        note = note_append or "Retificação após fechamento da conta"
        stmt = _insert_adjustment(db, tenant_id, account_id, user_id, year, month, amount_novo, note)
        if stmt:
            snapshot["adjustment_bank_statement_id"] = int(stmt.id)
            snapshot["adjustment_amount"] = float(amount_novo)
            snapshot["adjustment_date"] = _iso_date(_last_moment(year, month))
    return snapshot


def recascade_single_closed_month(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    closure: AccountPeriodClosure,
    opening: Decimal,
    closing_old: Decimal,
    *,
    note_append: Optional[str] = None,
    apply_adjustment_delta: bool = False,
) -> Decimal:
    year, month = int(closure.year), int(closure.month)
    prior_snapshot = dict(closure.closure_data or {})

    flow = _month_flow(db, tenant_id, account_id, year, month, include_items=True)
    entries = flow["entries"]
    exits = flow["exits"]
    closing_final = (opening + entries - exits).quantize(MONEY)

    snapshot = dict(prior_snapshot)
    if apply_adjustment_delta:
        delta_closing = closing_final - _money(closing_old)
        if delta_closing != ZERO:
            snapshot = _apply_month_adjustment_delta(
                db,
                tenant_id,
                account_id,
                user_id,
                year,
                month,
                prior_snapshot,
                delta_closing,
                note_append,
            )
            flow = _month_flow(db, tenant_id, account_id, year, month, include_items=True)

    snapshot = _build_closure_snapshot(
        db, tenant_id, account_id, year, month, snapshot, flow["items"],
    )

    closure.opening_balance = opening
    closure.entries = entries
    closure.exits = exits
    closure.closing_balance = closing_final
    closure.closure_data = snapshot
    closure.last_updated_at = now_utc()
    flag_modified(closure, "closure_data")
    return closing_final


def recascade_closed_periods(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    periods: list[tuple[int, int]],
    *,
    note_append: Optional[str] = None,
    adjustment_periods: Optional[set[tuple[int, int]]] = None,
) -> list[dict[str, Any]]:
    """Recalcula fechamentos fechados em ordem cronológica (ajuste no próprio mês)."""
    if not periods:
        return []
    ordered = sorted(set(periods))
    closures = {
        (int(row.year), int(row.month)): row
        for row in _list_closures(db, tenant_id, account_id)
    }
    results: list[dict[str, Any]] = []
    closing_old_by_period: dict[tuple[int, int], Decimal] = {
        key: _money(row.closing_balance) for key, row in closures.items()
    }

    prev_closing: Optional[Decimal] = None
    for year, month in ordered:
        closure = closures.get((year, month))
        if not closure:
            continue
        if prev_closing is not None:
            opening = prev_closing
        else:
            prev = _add_month(year, month, -1)
            prev_row = closures.get(prev)
            opening = _money(prev_row.closing_balance) if prev_row else ZERO

        closing_old = closing_old_by_period.get((year, month), _money(closure.closing_balance))
        apply_adj = (
            (year, month) in adjustment_periods
            if adjustment_periods is not None
            else False
        )
        closing_final = recascade_single_closed_month(
            db,
            tenant_id,
            account_id,
            user_id,
            closure,
            opening,
            closing_old,
            note_append=note_append,
            apply_adjustment_delta=apply_adj,
        )
        prev_closing = closing_final
        results.append({
            "year": year,
            "month": month,
            "closing_old": float(closing_old),
            "closing_new": float(closing_final),
            "delta_closing": float(closing_final - closing_old),
        })
    return results


def preview_recascade_closed_periods(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    periods: list[tuple[int, int]],
    *,
    adjustment_periods: Optional[set[tuple[int, int]]] = None,
) -> list[dict[str, Any]]:
    """Simula recascata; reverte ao final (não persiste lançamentos/fechamentos)."""
    if not periods:
        return []
    savepoint = db.begin_nested()
    try:
        results = recascade_closed_periods(
            db,
            tenant_id,
            account_id,
            user_id,
            periods,
            adjustment_periods=adjustment_periods,
        )
        db.flush()
        return results
    finally:
        savepoint.rollback()
