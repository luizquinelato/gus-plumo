"""Saúde Financeira: leitura dos fechamentos consolidados da conta (extrato)."""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import and_, extract, or_
from sqlalchemy.orm import Session, aliased, joinedload

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
    InvoicePaymentMatch,
    Loan,
    LoanPayment,
    Subtag,
    Tag,
)
from app.services.invoice_payment_match_service import CARD_TAG_NAMES

MONEY = Decimal("0.01")
ZERO = Decimal("0.00")
HUNDRED = Decimal("100")
SCOPES = ("all", "account", "shared")
SETTLEMENT_TAG_ID = -2
SETTLEMENT_TAG_NAME = "Acertos compartilhados"
SETTLEMENT_TAG_ICON = "Scale"
MONTH_SHORT = ("Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez")


def _money(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(MONEY)


def _normalize_scope(scope: Optional[str]) -> str:
    value = str(scope or "all").strip().lower()
    if value not in SCOPES:
        raise ValueError("scope deve ser all, account ou shared")
    return value


def _normalize_month(year: Optional[int], month: Optional[int]) -> Optional[int]:
    if month is None:
        return None
    if year is None:
        raise ValueError("mês exige o filtro de ano")
    month_value = int(month)
    if month_value < 1 or month_value > 12:
        raise ValueError("mês deve ser 1 a 12")
    return month_value


def _sharing_of(row: Any) -> tuple[Any, Any, Any]:
    if isinstance(row, dict):
        return (
            row.get("ownership_percentage"),
            row.get("expense_sharing_id"),
            row.get("shared_partner_id"),
        )
    return (
        getattr(row, "ownership_percentage", None),
        getattr(row, "expense_sharing_id", None),
        getattr(row, "shared_partner_id", None),
    )


def _has_sharing(sharing_id: Any, partner_id: Any) -> bool:
    return sharing_id is not None or partner_id is not None


def _mine_percentage(ownership_percentage: Any, has_sharing: bool) -> Decimal:
    if ownership_percentage is not None:
        pct = Decimal(str(ownership_percentage))
        if pct < ZERO:
            return ZERO
        if pct > HUNDRED:
            return HUNDRED
        return pct
    if not has_sharing:
        return HUNDRED
    return HUNDRED


def _scoped_abs(
    amount: Decimal,
    ownership_percentage: Any,
    sharing_id: Any,
    partner_id: Any,
    scope: str,
) -> Optional[Decimal]:
    abs_amount = abs(amount)
    has_sharing = _has_sharing(sharing_id, partner_id)
    if scope == "all":
        return abs_amount
    mine = _mine_percentage(ownership_percentage, has_sharing)
    if scope == "account":
        return (abs_amount * mine / HUNDRED).quantize(MONEY)
    if not has_sharing:
        return None
    partner = HUNDRED - mine
    return (abs_amount * partner / HUNDRED).quantize(MONEY)


def _empty_settlements() -> dict[str, Any]:
    return {
        "excluded_statement_ids": set(),
        "items": [],
        "by_month": {},
        "by_month_shared": {},
    }


def _closure_month_label(year: Any, month: Any) -> str:
    month_value = int(month or 0)
    name = MONTH_SHORT[month_value - 1] if 1 <= month_value <= 12 else f"{month_value:02d}"
    return f"{name}/{str(year)[-2:]}"


def _join_label_parts(*parts: Any) -> str:
    seen: set[str] = set()
    out: list[str] = []
    for part in parts:
        text = " ".join(str(part or "").split())
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
    return " · ".join(out)


def _append_settlement_item(
    items: list[dict[str, Any]],
    *,
    item_id: str,
    date_value: Any,
    year_month: str,
    amount: Decimal,
    partner_name: str,
    label: str,
    kind: str,
    shared_partner_id: Any = None,
    shared_partner_name: Any = None,
    shared_partner_bank: Any = None,
    shared_partner_agency: Any = None,
    shared_partner_account_number: Any = None,
    linked: bool = False,
) -> None:
    items.append({
        "id": item_id,
        "date": _iso_date(date_value),
        "description": label,
        "year_month": year_month,
        "amount": float(amount),
        "source": "settlement",
        "kind": kind,
        "linked": linked,
        "tag_id": SETTLEMENT_TAG_ID,
        "tag_name": SETTLEMENT_TAG_NAME,
        "subtag_name": None,
        "ownership_percentage": None,
        "expense_sharing_id": None,
        "amount_account": 0.0,
        "amount_shared": float(amount),
        "shared_partner_id": int(shared_partner_id) if shared_partner_id else None,
        "shared_partner_name": shared_partner_name,
        "shared_partner_bank": shared_partner_bank,
        "shared_partner_agency": shared_partner_agency,
        "shared_partner_account_number": shared_partner_account_number,
    })


def _closure_remaining(net_balance: Any, total_paid: Decimal) -> Decimal:
    return max(ZERO, abs(_money(net_balance)) - total_paid)


def _in_month(value: Any, year: int, month: int) -> bool:
    parsed = _to_date(value)
    return parsed is not None and parsed.year == year and parsed.month == month


def _on_or_before_month(value: Any, year: int, month: int) -> bool:
    parsed = _to_date(value)
    return parsed is not None and (parsed.year, parsed.month) <= (year, month)


def _should_separate_loan_settlement(
    *,
    settled_this_month: bool,
    remaining: Decimal,
    loan_amount: Decimal,
) -> bool:
    """Separa o empréstimo só se a quitação caiu neste mês,
    ou se o saldo em aberto neste mês já era menor que o empréstimo."""
    if settled_this_month:
        return True
    return remaining < loan_amount


def _allocate_loan_settlement_month(
    *,
    periods: list[tuple[int, int]],
    settled_at: Any,
    net_balance: Any,
    payments: list[tuple[Any, Decimal]],
    loan_amount: Decimal,
) -> Optional[tuple[int, int]]:
    for year, month in sorted(periods):
        paid_through = sum(
            (amount for paid_date, amount in payments if _on_or_before_month(paid_date, year, month)),
            ZERO,
        )
        remaining = _closure_remaining(net_balance, paid_through)
        settled_this_month = _in_month(settled_at, year, month)
        if _should_separate_loan_settlement(
            settled_this_month=settled_this_month,
            remaining=remaining,
            loan_amount=loan_amount,
        ):
            return year, month
    return None


def _load_account_settlements(
    db: Session,
    tenant_id: int,
    account_id: int,
    periods: list[tuple[int, int]],
) -> dict[str, Any]:
    """Acertos da mandante: PIX/pagamento e empréstimo de fechamento → entrada compartilhada."""
    if not periods:
        return _empty_settlements()

    Partner = aliased(Account)
    year_col = extract("year", BalanceClosurePayment.payment_date)
    month_col = extract("month", BalanceClosurePayment.payment_date)
    period_filters = [
        and_(year_col == year, month_col == month)
        for year, month in periods
    ]
    rows = (
        db.query(
            BalanceClosurePayment.id,
            BalanceClosurePayment.amount,
            BalanceClosurePayment.payment_date,
            BalanceClosurePayment.bank_statement_id,
            BalanceClosure.year,
            BalanceClosure.month,
            BankStatement.description.label("statement_description"),
            Partner.id.label("shared_partner_id"),
            Partner.name.label("shared_partner_name"),
            Partner.agency.label("shared_partner_agency"),
            Partner.account_number.label("shared_partner_account_number"),
            Bank.name.label("shared_partner_bank"),
        )
        .join(BalanceClosure, BalanceClosure.id == BalanceClosurePayment.balance_closure_id)
        .outerjoin(Partner, Partner.id == BalanceClosure.shared_account_id)
        .outerjoin(Bank, Bank.id == Partner.bank_id)
        .outerjoin(
            BankStatement,
            and_(
                BankStatement.id == BalanceClosurePayment.bank_statement_id,
                BankStatement.tenant_id == tenant_id,
            ),
        )
        .filter(
            BalanceClosurePayment.tenant_id == tenant_id,
            BalanceClosure.tenant_id == tenant_id,
            BalanceClosure.account_id == account_id,
            BalanceClosure.net_balance > 0,
            BalanceClosurePayment.active == True,
            or_(
                BalanceClosure.is_settled == True,
                BalanceClosurePayment.bank_statement_id.isnot(None),
            ),
            or_(*period_filters),
        )
        .order_by(BalanceClosurePayment.payment_date.asc(), BalanceClosurePayment.id.asc())
        .all()
    )

    loan_pay_year = extract("year", LoanPayment.payment_date)
    loan_pay_month = extract("month", LoanPayment.payment_date)
    settled_year = extract("year", BalanceClosure.settled_at)
    settled_month = extract("month", BalanceClosure.settled_at)
    loan_filters = [
        or_(
            and_(loan_pay_year == year, loan_pay_month == month),
            and_(settled_year == year, settled_month == month),
            and_(BalanceClosure.year == year, BalanceClosure.month == month),
        )
        for year, month in periods
    ]
    loan_rows = (
        db.query(
            LoanPayment.id,
            LoanPayment.amount,
            LoanPayment.payment_date,
            LoanPayment.source_table,
            LoanPayment.source_id,
            LoanPayment.notes,
            Loan.description.label("loan_description"),
            BankStatement.description.label("statement_description"),
            BalanceClosure.id.label("closure_id"),
            BalanceClosure.year,
            BalanceClosure.month,
            BalanceClosure.settled_at,
            BalanceClosure.net_balance,
            Partner.id.label("shared_partner_id"),
            Partner.name.label("shared_partner_name"),
            Partner.agency.label("shared_partner_agency"),
            Partner.account_number.label("shared_partner_account_number"),
            Bank.name.label("shared_partner_bank"),
        )
        .join(BalanceClosure, BalanceClosure.id == LoanPayment.balance_closure_id)
        .outerjoin(Loan, Loan.id == LoanPayment.loan_id)
        .outerjoin(Partner, Partner.id == BalanceClosure.shared_account_id)
        .outerjoin(Bank, Bank.id == Partner.bank_id)
        .outerjoin(
            BankStatement,
            and_(
                LoanPayment.source_table == "bank_statements",
                BankStatement.id == LoanPayment.source_id,
                BankStatement.tenant_id == tenant_id,
            ),
        )
        .filter(
            LoanPayment.tenant_id == tenant_id,
            LoanPayment.active == True,
            LoanPayment.balance_closure_id.isnot(None),
            BalanceClosure.tenant_id == tenant_id,
            BalanceClosure.account_id == account_id,
            BalanceClosure.net_balance > 0,
            or_(*loan_filters),
        )
        .order_by(LoanPayment.payment_date.asc(), LoanPayment.id.asc())
        .all()
    )

    loan_closure_ids = {int(row.closure_id) for row in loan_rows if row.closure_id}
    payments_by_closure: dict[int, list[tuple[date, Decimal]]] = {}
    if loan_closure_ids:
        paid_rows = (
            db.query(
                BalanceClosurePayment.balance_closure_id,
                BalanceClosurePayment.payment_date,
                BalanceClosurePayment.amount,
            )
            .filter(
                BalanceClosurePayment.tenant_id == tenant_id,
                BalanceClosurePayment.balance_closure_id.in_(loan_closure_ids),
                BalanceClosurePayment.active == True,
            )
            .all()
        )
        for paid in paid_rows:
            paid_date = _to_date(paid.payment_date)
            if paid_date is None:
                continue
            payments_by_closure.setdefault(int(paid.balance_closure_id), []).append(
                (paid_date, _money(paid.amount)),
            )

    excluded_statement_ids: set[int] = set()
    items: list[dict[str, Any]] = []
    by_month: dict[str, Decimal] = {}
    by_month_shared: dict[str, Decimal] = {}

    def add_shared(year_month: str, amount: Decimal) -> None:
        by_month_shared[year_month] = by_month_shared.get(year_month, ZERO) + amount

    for row in rows:
        amount = _money(row.amount)
        if amount == 0 or not row.payment_date:
            continue
        year_month = f"{int(row.payment_date.year):04d}-{int(row.payment_date.month):02d}"
        partner_name = row.shared_partner_name or "conta compartilhada"
        linked = bool(row.bank_statement_id)
        if linked:
            excluded_statement_ids.add(int(row.bank_statement_id))
        else:
            by_month[year_month] = by_month.get(year_month, ZERO) + amount
        add_shared(year_month, amount)
        _append_settlement_item(
            items,
            item_id=f"settlement:{int(row.id)}",
            date_value=row.payment_date,
            year_month=year_month,
            amount=amount,
            partner_name=partner_name,
            label=_join_label_parts(
                "Acerto compartilhado",
                partner_name,
                f"fechamento {_closure_month_label(row.year, row.month)}",
                row.statement_description,
            ),
            kind="payment",
            shared_partner_id=row.shared_partner_id,
            shared_partner_name=row.shared_partner_name,
            shared_partner_bank=row.shared_partner_bank,
            shared_partner_agency=row.shared_partner_agency,
            shared_partner_account_number=row.shared_partner_account_number,
            linked=linked,
        )

    for row in loan_rows:
        amount = _money(row.amount)
        if amount == 0:
            continue
        allocated = _allocate_loan_settlement_month(
            periods=periods,
            settled_at=row.settled_at,
            net_balance=row.net_balance,
            payments=payments_by_closure.get(int(row.closure_id), []),
            loan_amount=amount,
        )
        if allocated is None:
            continue
        as_of_year, as_of_month = allocated
        year_month = f"{as_of_year:04d}-{as_of_month:02d}"
        date_value = row.settled_at if _in_month(row.settled_at, as_of_year, as_of_month) else row.payment_date
        partner_name = row.shared_partner_name or "conta compartilhada"
        linked = str(row.source_table or "") == "bank_statements" and row.source_id is not None
        if linked:
            excluded_statement_ids.add(int(row.source_id))
        else:
            by_month[year_month] = by_month.get(year_month, ZERO) + amount
        add_shared(year_month, amount)
        _append_settlement_item(
            items,
            item_id=f"loan-settlement:{int(row.id)}",
            date_value=date_value,
            year_month=year_month,
            amount=amount,
            partner_name=partner_name,
            label=_join_label_parts(
                "Empréstimo",
                row.loan_description,
                row.statement_description,
                row.notes,
                f"fechamento {_closure_month_label(row.year, row.month)}",
            ),
            kind="loan",
            shared_partner_id=row.shared_partner_id,
            shared_partner_name=row.shared_partner_name,
            shared_partner_bank=row.shared_partner_bank,
            shared_partner_agency=row.shared_partner_agency,
            shared_partner_account_number=row.shared_partner_account_number,
            linked=linked,
        )

    return {
        "excluded_statement_ids": excluded_statement_ids,
        "items": items,
        "by_month": by_month,
        "by_month_shared": by_month_shared,
    }


def _to_date(value: Any) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and len(value) >= 10:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _iso_date(value: Any) -> str:
    parsed = _to_date(value)
    return parsed.isoformat() if parsed else ""


def _invoice_billing_window(year_month: str, closing_day: int) -> tuple[date, date]:
    from app.utils.card_invoice_calendar import invoice_billing_window

    return invoice_billing_window(year_month, closing_day)


def _prev_month(year: int, month: int) -> tuple[int, int]:
    if month == 1:
        return year - 1, 12
    return year, month - 1


def _period_start(year: int, month: int) -> datetime:
    return datetime(year, month, 1)


def _period_end_exclusive(year: int, month: int) -> datetime:
    if month == 12:
        return datetime(year + 1, 1, 1)
    return datetime(year, month + 1, 1)


def _has_closure(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: int,
    month: int,
) -> bool:
    return (
        db.query(AccountPeriodClosure.id)
        .filter(
            AccountPeriodClosure.tenant_id == tenant_id,
            AccountPeriodClosure.account_id == account_id,
            AccountPeriodClosure.year == year,
            AccountPeriodClosure.month == month,
        )
        .first()
        is not None
    )


def _current_open_period(
    db: Session,
    tenant_id: int,
    account_id: int,
) -> Optional[tuple[int, int]]:
    today = date.today()
    current = (today.year, today.month)
    if _has_closure(db, tenant_id, account_id, *current):
        return None
    previous = _prev_month(*current)
    if not _has_closure(db, tenant_id, account_id, *previous):
        return None
    return current


def _wants_current_open(year: Optional[int], month: Optional[int] = None) -> bool:
    today = date.today()
    if year is not None and year != today.year:
        return False
    if month is not None and month != today.month:
        return False
    return True


def _month_flow(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: int,
    month: int,
) -> tuple[Decimal, Decimal]:
    rows = (
        db.query(BankStatement.amount)
        .filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            BankStatement.date >= _period_start(year, month),
            BankStatement.date < _period_end_exclusive(year, month),
        )
        .all()
    )
    entries = ZERO
    exits = ZERO
    for row in rows:
        amount = _money(row.amount)
        if amount > 0:
            entries += amount
        elif amount < 0:
            exits += abs(amount)
    return entries.quantize(MONEY), exits.quantize(MONEY)


def _serialize_month(
    year: int,
    month: int,
    opening: Decimal,
    entries: Decimal,
    exits: Decimal,
    closing: Decimal,
    *,
    is_open: bool,
    closed_at: Optional[str] = None,
    split_account: Optional[dict[str, Any]] = None,
    split_shared: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    splits = serialize_splits(split_account, split_shared)
    return {
        "year": int(year),
        "month": int(month),
        "year_month": f"{int(year):04d}-{int(month):02d}",
        "opening_balance": float(_money(opening)),
        "entries": float(_money(entries)),
        "exits": float(_money(exits)),
        "closing_balance": float(_money(closing)),
        "is_open": is_open,
        "closed_at": closed_at,
        "split_account": splits["account"],
        "split_shared": splits["shared"],
    }


def _serialize_closure(row: AccountPeriodClosure) -> dict[str, Any]:
    stored = _splits_from_snapshot(row.closure_data)
    return _serialize_month(
        int(row.year),
        int(row.month),
        _money(row.opening_balance),
        _money(row.entries),
        _money(row.exits),
        _money(row.closing_balance),
        is_open=False,
        closed_at=row.created_at.isoformat() if row.created_at else None,
        split_account=(stored["account"] if stored else None),
        split_shared=(stored["shared"] if stored else None),
    )


def _current_open_snapshot(
    db: Session,
    tenant_id: int,
    account_id: int,
) -> Optional[dict[str, Any]]:
    period = _current_open_period(db, tenant_id, account_id)
    if period is None:
        return None
    year, month = period
    previous = _prev_month(year, month)
    previous_row = (
        db.query(AccountPeriodClosure)
        .filter(
            AccountPeriodClosure.tenant_id == tenant_id,
            AccountPeriodClosure.account_id == account_id,
            AccountPeriodClosure.year == previous[0],
            AccountPeriodClosure.month == previous[1],
        )
        .first()
    )
    if previous_row is None:
        return None
    opening = _money(previous_row.closing_balance)
    entries, exits = _month_flow(db, tenant_id, account_id, year, month)
    closing = (opening + entries - exits).quantize(MONEY)
    return _serialize_month(year, month, opening, entries, exits, closing, is_open=True)


def _closures_query(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: Optional[int] = None,
    month: Optional[int] = None,
):
    query = db.query(AccountPeriodClosure).filter(
        AccountPeriodClosure.tenant_id == tenant_id,
        AccountPeriodClosure.account_id == account_id,
    )
    if year is not None:
        query = query.filter(AccountPeriodClosure.year == year)
    if month is not None:
        query = query.filter(AccountPeriodClosure.month == month)
    return query.order_by(AccountPeriodClosure.year, AccountPeriodClosure.month)


def _closed_periods(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: Optional[int] = None,
    month: Optional[int] = None,
) -> list[tuple[int, int]]:
    query = db.query(AccountPeriodClosure.year, AccountPeriodClosure.month).filter(
        AccountPeriodClosure.tenant_id == tenant_id,
        AccountPeriodClosure.account_id == account_id,
    )
    if year is not None:
        query = query.filter(AccountPeriodClosure.year == year)
    if month is not None:
        query = query.filter(AccountPeriodClosure.month == month)
    rows = query.order_by(AccountPeriodClosure.year, AccountPeriodClosure.month).all()
    return [(int(row.year), int(row.month)) for row in rows]


def _visible_periods(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: Optional[int] = None,
    month: Optional[int] = None,
) -> list[tuple[int, int]]:
    periods = _closed_periods(db, tenant_id, account_id, year, month)
    if not _wants_current_open(year, month):
        return periods
    current = _current_open_period(db, tenant_id, account_id)
    if current and current not in periods:
        periods.append(current)
    return periods


def _statements_in_periods(
    db: Session,
    tenant_id: int,
    account_id: int,
    periods: list[tuple[int, int]],
):
    if not periods:
        return []
    year_col = extract("year", BankStatement.date)
    month_col = extract("month", BankStatement.date)
    period_filters = [
        and_(year_col == year, month_col == month)
        for year, month in periods
    ]
    SharedAccount = aliased(Account)
    return (
        db.query(
            BankStatement.id,
            BankStatement.date,
            BankStatement.description,
            BankStatement.amount,
            BankStatement.subtag_id,
            BankStatement.category,
            BankStatement.is_manual,
            BankStatement.migrated_from_account_id,
            BankStatement.ownership_percentage,
            BankStatement.expense_sharing_id,
            Subtag.name.label("subtag_name"),
            Tag.id.label("tag_id"),
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
            or_(*period_filters),
        )
        .order_by(BankStatement.date.asc(), BankStatement.id.asc())
        .all()
    )


def list_options(db: Session, tenant_id: int, account_id: int) -> dict[str, Any]:
    years = [
        int(row[0])
        for row in (
            db.query(AccountPeriodClosure.year)
            .filter(
                AccountPeriodClosure.tenant_id == tenant_id,
                AccountPeriodClosure.account_id == account_id,
            )
            .distinct()
            .order_by(AccountPeriodClosure.year.desc())
            .all()
        )
        if row[0] is not None
    ]
    current = _current_open_period(db, tenant_id, account_id)
    if current and current[0] not in years:
        years.append(current[0])
        years.sort(reverse=True)
    return {"years": years}


def get_series(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: Optional[int] = None,
    scope: Optional[str] = None,
    month: Optional[int] = None,
) -> dict[str, Any]:
    scope_value = _normalize_scope(scope)
    month_value = _normalize_month(year, month)
    return _get_scoped_series(db, tenant_id, account_id, year, scope_value, month_value)


def _monthly_scoped_flows(
    statements: list[Any],
    expansion: dict[str, Any],
    scope: str,
    settlements: Optional[dict[str, Any]] = None,
) -> dict[str, dict[str, Decimal]]:
    matched_ids = expansion["matched_ids"]
    excluded_ids = (settlements or {}).get("excluded_statement_ids") or set()
    buckets: dict[str, dict[str, Decimal]] = {}

    def add(year_month: str, is_credit: bool, share: Decimal) -> None:
        bucket = buckets.setdefault(year_month, {"entries": ZERO, "exits": ZERO})
        if is_credit:
            bucket["entries"] += share
        else:
            bucket["exits"] += share

    for row in statements:
        if int(row.id) in matched_ids or int(row.id) in excluded_ids:
            continue
        amount = _money(row.amount)
        if amount == 0 or not row.date:
            continue
        share = _scoped_abs(amount, *_sharing_of(row), scope)
        if share is None or share == 0:
            continue
        year_month = f"{int(row.date.year):04d}-{int(row.date.month):02d}"
        add(year_month, amount > 0, share)

    for item in expansion["items"]:
        amount = _money(item.get("amount"))
        share = _scoped_abs(amount, *_sharing_of(item), scope)
        if share is None or share == 0:
            continue
        year_month = item.get("year_month")
        if not year_month:
            continue
        add(str(year_month), amount > 0, share)

    if scope == "account":
        for year_month, deduction in ((settlements or {}).get("by_month") or {}).items():
            share = _money(deduction)
            if share == 0:
                continue
            bucket = buckets.setdefault(str(year_month), {"entries": ZERO, "exits": ZERO})
            bucket["entries"] -= share
    if scope == "shared":
        for year_month, extra in ((settlements or {}).get("by_month_shared") or {}).items():
            share = _money(extra)
            if share == 0:
                continue
            bucket = buckets.setdefault(str(year_month), {"entries": ZERO, "exits": ZERO})
            bucket["entries"] += share
    return buckets


def _partner_key(row: Any) -> tuple[Any, str, Any, Any, Any]:
    if isinstance(row, dict):
        partner_id = row.get("shared_partner_id")
        name = row.get("shared_partner_name") or "Conta compartilhada"
        return (
            partner_id,
            name,
            row.get("shared_partner_bank"),
            row.get("shared_partner_agency"),
            row.get("shared_partner_account_number"),
        )
    partner_id = getattr(row, "shared_partner_id", None)
    name = getattr(row, "shared_partner_name", None) or "Conta compartilhada"
    return (
        partner_id,
        name,
        getattr(row, "shared_partner_bank", None),
        getattr(row, "shared_partner_agency", None),
        getattr(row, "shared_partner_account_number", None),
    )


def _shared_by_account(
    statements: list[Any],
    expansion: dict[str, Any],
    settlements: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    """Totais compartilhados (entradas/saídas) agrupados pela conta parceira."""
    matched_ids = expansion["matched_ids"]
    excluded_ids = (settlements or {}).get("excluded_statement_ids") or set()
    buckets: dict[Any, dict[str, Any]] = {}

    def add(row: Any, is_credit: bool, share: Optional[Decimal]) -> None:
        if share is None or share == 0:
            return
        partner_id, name, bank, agency, number = _partner_key(row)
        key = int(partner_id) if partner_id else f"name:{name}"
        bucket = buckets.setdefault(key, {
            "shared_partner_id": int(partner_id) if partner_id else None,
            "shared_partner_name": name,
            "shared_partner_bank": bank,
            "shared_partner_agency": agency,
            "shared_partner_account_number": number,
            "entries": ZERO,
            "exits": ZERO,
        })
        if is_credit:
            bucket["entries"] += share
        else:
            bucket["exits"] += share

    for row in statements:
        if int(row.id) in matched_ids or int(row.id) in excluded_ids:
            continue
        amount = _money(row.amount)
        if amount == 0 or not row.date:
            continue
        add(row, amount > 0, _scoped_abs(amount, *_sharing_of(row), "shared"))

    for item in expansion.get("items") or []:
        amount = _money(item.get("amount"))
        add(item, amount > 0, _scoped_abs(amount, *_sharing_of(item), "shared"))

    for item in (settlements or {}).get("items") or []:
        add(item, True, _money(item.get("amount")))

    rows: list[dict[str, Any]] = []
    for bucket in buckets.values():
        entries = _money(bucket["entries"])
        exits = _money(bucket["exits"])
        if entries == 0 and exits == 0:
            continue
        rows.append({
            "shared_partner_id": bucket["shared_partner_id"],
            "shared_partner_name": bucket["shared_partner_name"],
            "shared_partner_bank": bucket["shared_partner_bank"],
            "shared_partner_agency": bucket["shared_partner_agency"],
            "shared_partner_account_number": bucket["shared_partner_account_number"],
            "entries": float(entries),
            "exits": float(exits),
        })
    rows.sort(key=lambda item: str(item["shared_partner_name"] or "").lower())
    return rows


def compute_scoped_month_flows(
    db: Session,
    tenant_id: int,
    account_id: int,
    periods: list[tuple[int, int]],
    settlements: Optional[dict[str, Any]] = None,
) -> dict[str, dict[str, dict[str, Decimal]]]:
    """Rateio conta/compartilhado por mês (extrato + fatura + benefício). Acertos vêm no overlay."""
    if not periods:
        return {"account": {}, "shared": {}}
    statements = _statements_in_periods(db, tenant_id, account_id, periods)
    expansion = _period_source_expansion(db, tenant_id, account_id, statements, periods)
    overlay = (
        settlements if settlements is not None
        else _load_account_settlements(db, tenant_id, account_id, periods)
    )
    return {
        "account": _monthly_scoped_flows(statements, expansion, "account", overlay),
        "shared": _monthly_scoped_flows(statements, expansion, "shared", overlay),
    }


def period_allocation_details(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: int,
    month: int,
) -> dict[str, Any]:
    """Itens de fatura, benefícios, acertos e cartões sem match para o preview do fechamento."""
    periods = [(year, month)]
    statements = _statements_in_periods(db, tenant_id, account_id, periods)
    expansion = _period_source_expansion(db, tenant_id, account_id, statements, periods)
    settlements = _load_account_settlements(db, tenant_id, account_id, periods)
    flows = {
        "account": _monthly_scoped_flows(statements, expansion, "account", settlements),
        "shared": _monthly_scoped_flows(statements, expansion, "shared", settlements),
    }
    year_month = f"{year:04d}-{month:02d}"
    replaced_ids = sorted(
        {
            int(statement_id)
            for statement_id in (
                set(expansion["matched_ids"]) | set(settlements["excluded_statement_ids"])
            )
        }
    )
    return {
        "splits": serialize_splits(
            flows["account"].get(year_month),
            flows["shared"].get(year_month),
        ),
        "card_items": [
            item for item in expansion["items"]
            if item.get("year_month") == year_month and item.get("source") != "benefit"
        ],
        "benefit_items": [
            item for item in expansion["items"]
            if item.get("year_month") == year_month and item.get("source") == "benefit"
        ],
        "unmatched_card_payments": [
            item for item in expansion.get("unmatched") or []
            if item.get("year_month") == year_month
        ],
        "shared_settlements": [
            item for item in settlements["items"]
            if item.get("year_month") == year_month
        ],
        "replaced_bank_ids": replaced_ids,
        "shared_by_account": _shared_by_account(statements, expansion, settlements),
    }


def _flow_pair(bucket: Optional[dict[str, Any]]) -> dict[str, Decimal]:
    data = bucket or {}
    return {
        "entries": _money(data.get("entries")),
        "exits": _money(data.get("exits")),
    }


def _splits_from_snapshot(snapshot: Optional[dict[str, Any]]) -> Optional[dict[str, dict[str, Decimal]]]:
    splits = (snapshot or {}).get("splits")
    if not isinstance(splits, dict):
        return None
    account = splits.get("account")
    shared = splits.get("shared")
    if not isinstance(account, dict) and not isinstance(shared, dict):
        return None
    return {
        "account": _flow_pair(account if isinstance(account, dict) else None),
        "shared": _flow_pair(shared if isinstance(shared, dict) else None),
    }


def serialize_splits(
    account: Optional[dict[str, Any]] = None,
    shared: Optional[dict[str, Any]] = None,
) -> dict[str, dict[str, float]]:
    account_flow = _flow_pair(account)
    shared_flow = _flow_pair(shared)
    return {
        "account": {
            "entries": float(account_flow["entries"]),
            "exits": float(account_flow["exits"]),
        },
        "shared": {
            "entries": float(shared_flow["entries"]),
            "exits": float(shared_flow["exits"]),
        },
    }


def split_signed_amount(
    amount: Any,
    ownership_percentage: Any = None,
    sharing_id: Any = None,
    partner_id: Any = None,
) -> dict[str, float]:
    money = _money(amount)
    account = _scoped_abs(money, ownership_percentage, sharing_id, partner_id, "account") or ZERO
    shared = _scoped_abs(money, ownership_percentage, sharing_id, partner_id, "shared") or ZERO
    sign = Decimal("1") if money >= 0 else Decimal("-1")
    return {
        "amount_account": float((sign * account).quantize(MONEY)),
        "amount_shared": float((sign * shared).quantize(MONEY)),
    }


def _overlay_settlements(
    account_flow: dict[str, Decimal],
    shared_flow: dict[str, Decimal],
    year_month: str,
    settlements: Optional[dict[str, Any]],
) -> tuple[dict[str, Decimal], dict[str, Decimal]]:
    deduct = _money(((settlements or {}).get("by_month") or {}).get(year_month))
    extra = _money(((settlements or {}).get("by_month_shared") or {}).get(year_month))
    next_account = account_flow
    next_shared = shared_flow
    if deduct != 0:
        next_account = {
            "entries": (account_flow["entries"] - deduct).quantize(MONEY),
            "exits": account_flow["exits"],
        }
    if extra != 0:
        next_shared = {
            "entries": (shared_flow["entries"] + extra).quantize(MONEY),
            "exits": shared_flow["exits"],
        }
    return next_account, next_shared


def _pick_scoped_flow(
    account_flow: dict[str, Decimal],
    shared_flow: dict[str, Decimal],
    scope: str,
) -> dict[str, Decimal]:
    if scope == "account":
        return account_flow
    if scope == "shared":
        return shared_flow
    return {
        "entries": (account_flow["entries"] + shared_flow["entries"]).quantize(MONEY),
        "exits": (account_flow["exits"] + shared_flow["exits"]).quantize(MONEY),
    }


def _get_scoped_series(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: Optional[int],
    scope: str,
    month: Optional[int] = None,
) -> dict[str, Any]:
    closures = _closures_query(db, tenant_id, account_id, None).all()
    closures_by_period = {(int(row.year), int(row.month)): row for row in closures}

    chain: list[tuple[int, int, bool, Optional[str]]] = []
    for row in closures:
        year_value = int(row.year)
        month_value = int(row.month)
        if year is not None and year_value > year:
            continue
        if year is not None and month is not None and year_value == year and month_value > month:
            continue
        chain.append((
            year_value,
            month_value,
            False,
            row.created_at.isoformat() if row.created_at else None,
        ))
    if _wants_current_open(year, month):
        current = _current_open_period(db, tenant_id, account_id)
        if current and current not in [(item[0], item[1]) for item in chain]:
            chain.append((current[0], current[1], True, None))

    settlements = _load_account_settlements(
        db, tenant_id, account_id, [(item[0], item[1]) for item in chain],
    )

    live_periods: list[tuple[int, int]] = []
    stored_by_period: dict[tuple[int, int], dict[str, dict[str, Decimal]]] = {}
    for year_value, month_value, is_open, _closed_at in chain:
        row = closures_by_period.get((year_value, month_value))
        stored = None if is_open or row is None else _splits_from_snapshot(row.closure_data)
        if stored is None:
            live_periods.append((year_value, month_value))
        else:
            stored_by_period[(year_value, month_value)] = stored

    live = compute_scoped_month_flows(
        db,
        tenant_id,
        account_id,
        live_periods,
        settlements if live_periods else None,
    )

    opening = _money(closures[0].opening_balance) if closures and scope != "shared" else ZERO
    months: list[dict[str, Any]] = []
    for year_value, month_value, is_open, closed_at in chain:
        year_month = f"{year_value:04d}-{month_value:02d}"
        stored = stored_by_period.get((year_value, month_value))
        if stored is not None:
            account_flow = stored["account"]
            shared_flow = stored["shared"]
        else:
            account_flow = _flow_pair(live["account"].get(year_month))
            shared_flow = _flow_pair(live["shared"].get(year_month))
        picked = _pick_scoped_flow(account_flow, shared_flow, scope)
        entries = _money(picked["entries"])
        exits = _money(picked["exits"])
        closing = (opening + entries - exits).quantize(MONEY)
        include = (year is None or year_value == year) and (month is None or month_value == month)
        if include:
            months.append(_serialize_month(
                year_value,
                month_value,
                opening,
                entries,
                exits,
                closing,
                is_open=is_open,
                closed_at=closed_at,
                split_account=account_flow,
                split_shared=shared_flow,
            ))
        opening = closing
    return {
        "months": months,
        "selected": months[-1] if months else None,
        "scope": scope,
        "year": year,
        "month": month,
    }


def get_details(
    db: Session,
    tenant_id: int,
    account_id: int,
    kind: str,
    year: Optional[int] = None,
    tag_id: Optional[int] = None,
    scope: Optional[str] = None,
    month: Optional[int] = None,
) -> dict[str, Any]:
    if kind not in ("entries", "exits"):
        raise ValueError("kind deve ser entries ou exits")
    scope_value = _normalize_scope(scope)
    month_value = _normalize_month(year, month)

    periods = _visible_periods(db, tenant_id, account_id, year, month_value)
    want_credit = kind == "entries"
    current_open = (
        _current_open_period(db, tenant_id, account_id)
        if _wants_current_open(year, month_value)
        else None
    )
    statements = _statements_in_periods(db, tenant_id, account_id, periods)
    expansion = _period_source_expansion(db, tenant_id, account_id, statements, periods)
    settlements = _load_account_settlements(db, tenant_id, account_id, periods)
    excluded_ids = settlements["excluded_statement_ids"]
    matched_ids = expansion["matched_ids"]
    buckets: dict[str, dict[str, Any]] = {}
    total = ZERO
    count = 0

    def matches_tag(item_tag_id: Optional[int], *, settlement: bool = False) -> bool:
        if tag_id is None:
            return True
        if tag_id == SETTLEMENT_TAG_ID:
            return settlement
        if tag_id < 0:
            return (not settlement) and item_tag_id is None
        return (not settlement) and item_tag_id == tag_id

    def add_item(year_month: str, share: Decimal, item: dict[str, Any], is_open: bool) -> None:
        nonlocal total, count
        year_value = int(year_month[:4])
        month_value = int(year_month[5:7])
        bucket = buckets.setdefault(year_month, {
            "year": year_value,
            "month": month_value,
            "year_month": year_month,
            "is_open": is_open,
            "total": ZERO,
            "items": [],
        })
        bucket["total"] += share
        bucket["items"].append(item)
        total += share
        count += 1

    for row in statements:
        amount = _money(row.amount)
        if amount == 0 or not row.date:
            continue
        is_credit = amount > 0
        if is_credit != want_credit:
            continue
        if int(row.id) in excluded_ids:
            continue
        if int(row.id) in matched_ids:
            continue
        row_tag_id = int(row.tag_id) if row.tag_id else None
        if not matches_tag(row_tag_id):
            continue
        share = _scoped_abs(amount, *_sharing_of(row), scope_value)
        if share is None or share == 0:
            continue
        year_month = f"{int(row.date.year):04d}-{int(row.date.month):02d}"
        add_item(year_month, share, {
            "id": f"bank:{int(row.id)}",
            "date": _iso_date(row.date),
            "description": row.description or "",
            "year_month": year_month,
            "amount": float(share),
            "source": "bank",
            "is_manual": bool(row.is_manual) and row.migrated_from_account_id is None,
            "migrated_from_account_id": (
                int(row.migrated_from_account_id) if row.migrated_from_account_id else None
            ),
            "tag_name": row.tag_name,
            "subtag_name": row.subtag_name,
            "ownership_percentage": (
                float(row.ownership_percentage) if row.ownership_percentage is not None else None
            ),
            "shared_partner_id": int(row.shared_partner_id) if row.shared_partner_id else None,
            "shared_partner_name": row.shared_partner_name,
            "shared_partner_bank": row.shared_partner_bank,
            "shared_partner_agency": row.shared_partner_agency,
            "shared_partner_account_number": row.shared_partner_account_number,
        }, current_open == (int(row.date.year), int(row.date.month)))

    for item in expansion["items"]:
        original = _money(item["amount"])
        is_refund = original > 0
        if is_refund != want_credit:
            continue
        if not matches_tag(item.get("tag_id")):
            continue
        share = _scoped_abs(original, *_sharing_of(item), scope_value)
        if share is None or share == 0:
            continue
        year_month = item["year_month"]
        year_value = int(year_month[:4])
        month_value = int(year_month[5:7])
        add_item(
            year_month,
            share,
            {**item, "amount": float(share)},
            current_open == (year_value, month_value),
        )

    if want_credit:
        for item in settlements["items"]:
            share = _money(item.get("amount"))
            if share == 0:
                continue
            if not matches_tag(SETTLEMENT_TAG_ID, settlement=True):
                continue
            linked = bool(item.get("linked"))
            if scope_value == "account":
                if linked:
                    continue
                signed = -share
            elif scope_value == "shared":
                signed = share
            else:
                if not linked:
                    continue
                signed = share
            year_month = item["year_month"]
            year_value = int(year_month[:4])
            month_value = int(year_month[5:7])
            add_item(
                year_month,
                signed,
                {**item, "amount": float(signed)},
                current_open == (year_value, month_value),
            )

    months = []
    for key in sorted(buckets):
        bucket = buckets[key]
        items = sorted(bucket["items"], key=lambda row: (row["date"] or "", row["id"]))
        months.append({
            "year": bucket["year"],
            "month": bucket["month"],
            "year_month": bucket["year_month"],
            "is_open": bucket["is_open"],
            "total": float(bucket["total"].quantize(MONEY)),
            "count": len(items),
            "items": items,
        })
    return {
        "kind": kind,
        "year": year,
        "month": month_value,
        "tag_id": tag_id,
        "scope": scope_value,
        "total": float(total.quantize(MONEY)),
        "count": count,
        "months": months,
    }


def _is_card_tag_name(name: Optional[str]) -> bool:
    return str(name or "").strip().lower() in CARD_TAG_NAMES


def _cycle_card_ids(
    db: Session,
    tenant_id: int,
    account_id: int,
    invoice_group_id: Optional[int],
    credit_card_id: Optional[int],
) -> list[int]:
    if invoice_group_id is not None:
        rows = (
            db.query(Cartao.id)
            .filter(
                Cartao.tenant_id == tenant_id,
                Cartao.account_id == account_id,
                Cartao.invoice_group_id == invoice_group_id,
                Cartao.type == "credito",
            )
            .all()
        )
        return [int(row[0]) for row in rows]
    if credit_card_id is not None:
        return [int(credit_card_id)]
    return []


def _card_closing_days(
    db: Session,
    tenant_id: int,
    account_id: int,
    card_ids: list[int],
) -> dict[int, int]:
    if not card_ids:
        return {}
    from app.utils.card_invoice_calendar import effective_closing_day

    rows = (
        db.query(Cartao)
        .options(joinedload(Cartao.invoice_group))
        .filter(
            Cartao.tenant_id == tenant_id,
            Cartao.account_id == account_id,
            Cartao.id.in_(card_ids),
        )
        .all()
    )
    return {int(card.id): effective_closing_day(card) for card in rows}


def _card_invoice_lines(
    db: Session,
    tenant_id: int,
    account_id: int,
    card_ids: list[int],
    year_months: list[str],
    date_start: Optional[date] = None,
    date_end: Optional[date] = None,
) -> list[Any]:
    if not card_ids:
        return []
    month_filter = CreditCardInvoice.year_month.in_(year_months) if year_months else None
    date_filter = None
    if date_start and date_end:
        # end inclusive: compras no dia de fechamento entram até 23:59:59
        date_filter = and_(
            CreditCardInvoice.date >= datetime.combine(date_start, datetime.min.time()),
            CreditCardInvoice.date < datetime.combine(date_end + timedelta(days=1), datetime.min.time()),
        )
    identity_filter = None
    if month_filter is not None and date_filter is not None:
        identity_filter = or_(month_filter, date_filter)
    elif month_filter is not None:
        identity_filter = month_filter
    elif date_filter is not None:
        identity_filter = date_filter
    else:
        return []
    SharedAccount = aliased(Account)
    return (
        db.query(
            CreditCardInvoice.id,
            CreditCardInvoice.year_month,
            CreditCardInvoice.date,
            CreditCardInvoice.description,
            CreditCardInvoice.amount,
            CreditCardInvoice.current_installment,
            CreditCardInvoice.total_installments,
            CreditCardInvoice.ownership_percentage,
            CreditCardInvoice.expense_sharing_id,
            CreditCardInvoice.credit_card_id,
            Cartao.name.label("card_name"),
            Cartao.number.label("card_number"),
            Subtag.name.label("subtag_name"),
            Tag.id.label("tag_id"),
            Tag.name.label("tag_name"),
            SharedAccount.id.label("shared_partner_id"),
            SharedAccount.name.label("shared_partner_name"),
            SharedAccount.agency.label("shared_partner_agency"),
            SharedAccount.account_number.label("shared_partner_account_number"),
            Bank.name.label("shared_partner_bank"),
        )
        .join(Cartao, Cartao.id == CreditCardInvoice.credit_card_id)
        .outerjoin(Subtag, Subtag.id == CreditCardInvoice.subtag_id)
        .outerjoin(Tag, Tag.id == Subtag.tag_id)
        .outerjoin(ExpenseSharingSetting, ExpenseSharingSetting.id == CreditCardInvoice.expense_sharing_id)
        .outerjoin(SharedAccount, SharedAccount.id == ExpenseSharingSetting.shared_account_id)
        .outerjoin(Bank, Bank.id == SharedAccount.bank_id)
        .filter(
            CreditCardInvoice.tenant_id == tenant_id,
            Cartao.tenant_id == tenant_id,
            Cartao.account_id == account_id,
            CreditCardInvoice.credit_card_id.in_(card_ids),
            identity_filter,
        )
        .order_by(CreditCardInvoice.date.asc(), CreditCardInvoice.id.asc())
        .all()
    )


def _serialize_invoice_line(row: Any) -> dict[str, Any]:
    installment = ""
    if row.current_installment and row.total_installments:
        installment = f" ({int(row.current_installment)}/{int(row.total_installments)})"
    description = f"{row.description or ''}{installment}".strip()
    amount = _money(row.amount)
    splits = split_signed_amount(
        amount, row.ownership_percentage, row.expense_sharing_id, row.shared_partner_id,
    )
    return {
        "id": f"invoice:{int(row.id)}",
        "date": _iso_date(row.date),
        "description": description,
        "amount": float(amount),
        "source": "card",
        "card_id": int(row.credit_card_id),
        "card_name": row.card_name,
        "card_number": row.card_number,
        "tag_id": None if _is_card_tag_name(row.tag_name) else (int(row.tag_id) if row.tag_id else None),
        "tag_name": None if _is_card_tag_name(row.tag_name) else row.tag_name,
        "subtag_name": row.subtag_name,
        "ownership_percentage": (
            float(row.ownership_percentage) if row.ownership_percentage is not None else None
        ),
        "expense_sharing_id": (
            int(row.expense_sharing_id) if getattr(row, "expense_sharing_id", None) else None
        ),
        "shared_partner_id": int(row.shared_partner_id) if row.shared_partner_id else None,
        "shared_partner_name": row.shared_partner_name,
        "shared_partner_bank": row.shared_partner_bank,
        "shared_partner_agency": row.shared_partner_agency,
        "shared_partner_account_number": row.shared_partner_account_number,
        "amount_account": splits["amount_account"],
        "amount_shared": splits["amount_shared"],
    }


def _load_benefit_items(
    db: Session,
    tenant_id: int,
    account_id: int,
    periods: list[tuple[int, int]],
) -> list[dict[str, Any]]:
    """Lançamentos de cartão de benefício no mês civil do item (mesmo critério do balanço)."""
    if not periods:
        return []
    year_col = extract("year", BenefitCardStatement.date)
    month_col = extract("month", BenefitCardStatement.date)
    period_filters = [
        and_(year_col == year, month_col == month)
        for year, month in periods
    ]
    SharedAccount = aliased(Account)
    rows = (
        db.query(
            BenefitCardStatement.id,
            BenefitCardStatement.date,
            BenefitCardStatement.description,
            BenefitCardStatement.amount,
            BenefitCardStatement.ownership_percentage,
            BenefitCardStatement.expense_sharing_id,
            BenefitCardStatement.credit_card_id,
            Cartao.name.label("card_name"),
            Cartao.number.label("card_number"),
            Subtag.name.label("subtag_name"),
            Tag.id.label("tag_id"),
            Tag.name.label("tag_name"),
            SharedAccount.id.label("shared_partner_id"),
            SharedAccount.name.label("shared_partner_name"),
            SharedAccount.agency.label("shared_partner_agency"),
            SharedAccount.account_number.label("shared_partner_account_number"),
            Bank.name.label("shared_partner_bank"),
        )
        .join(Cartao, Cartao.id == BenefitCardStatement.credit_card_id)
        .outerjoin(Subtag, Subtag.id == BenefitCardStatement.subtag_id)
        .outerjoin(Tag, Tag.id == Subtag.tag_id)
        .outerjoin(ExpenseSharingSetting, ExpenseSharingSetting.id == BenefitCardStatement.expense_sharing_id)
        .outerjoin(SharedAccount, SharedAccount.id == ExpenseSharingSetting.shared_account_id)
        .outerjoin(Bank, Bank.id == SharedAccount.bank_id)
        .filter(
            BenefitCardStatement.tenant_id == tenant_id,
            or_(
                BenefitCardStatement.account_id == account_id,
                and_(BenefitCardStatement.account_id.is_(None), Cartao.account_id == account_id),
            ),
            or_(*period_filters),
        )
        .order_by(BenefitCardStatement.date.asc(), BenefitCardStatement.id.asc())
        .all()
    )
    items: list[dict[str, Any]] = []
    for row in rows:
        amount = _money(row.amount)
        if amount == 0 or not row.date:
            continue
        splits = split_signed_amount(
            amount, row.ownership_percentage, row.expense_sharing_id, row.shared_partner_id,
        )
        items.append({
            "id": f"benefit:{int(row.id)}",
            "date": _iso_date(row.date),
            "description": row.description or "",
            "amount": float(amount),
            "source": "benefit",
            "year_month": f"{int(row.date.year):04d}-{int(row.date.month):02d}",
            "card_id": int(row.credit_card_id) if row.credit_card_id else None,
            "card_name": row.card_name,
            "card_number": row.card_number,
            "tag_id": int(row.tag_id) if row.tag_id else None,
            "tag_name": row.tag_name,
            "subtag_name": row.subtag_name,
            "ownership_percentage": (
                float(row.ownership_percentage) if row.ownership_percentage is not None else None
            ),
            "expense_sharing_id": (
                int(row.expense_sharing_id) if row.expense_sharing_id else None
            ),
            "shared_partner_id": int(row.shared_partner_id) if row.shared_partner_id else None,
            "shared_partner_name": row.shared_partner_name,
            "shared_partner_bank": row.shared_partner_bank,
            "shared_partner_agency": row.shared_partner_agency,
            "shared_partner_account_number": row.shared_partner_account_number,
            "amount_account": splits["amount_account"],
            "amount_shared": splits["amount_shared"],
        })
    return items


def _period_source_expansion(
    db: Session,
    tenant_id: int,
    account_id: int,
    statements: list[Any],
    periods: list[tuple[int, int]],
) -> dict[str, Any]:
    expansion = _expand_card_payments(db, tenant_id, account_id, statements)
    benefit_items = _load_benefit_items(db, tenant_id, account_id, periods)
    if not benefit_items:
        return expansion
    return {
        **expansion,
        "items": list(expansion.get("items") or []) + benefit_items,
    }


def _expand_card_payments(
    db: Session,
    tenant_id: int,
    account_id: int,
    statements: list[Any],
) -> dict[str, Any]:
    """Troca débitos com InvoicePaymentMatch pelos itens da fatura do ciclo.

    A data do item (e um year_month antigo) não define o mês do fechamento:
    tudo que pertence à fatura vinculada entra no mês do lançamento bancário.
    """
    statement_by_id = {int(row.id): row for row in statements}
    statement_ids = list(statement_by_id)
    if not statement_ids:
        return {"matched_ids": set(), "items": [], "unmatched": []}

    matches = (
        db.query(InvoicePaymentMatch)
        .filter(
            InvoicePaymentMatch.tenant_id == tenant_id,
            InvoicePaymentMatch.account_id == account_id,
            InvoicePaymentMatch.bank_statement_id.in_(statement_ids),
            InvoicePaymentMatch.match_method.in_(("auto", "manual")),
        )
        .all()
    )
    matched_ids = {int(match.bank_statement_id) for match in matches if match.bank_statement_id}
    if not matched_ids:
        return {"matched_ids": set(), "items": [], "unmatched": []}

    month_by_statement: dict[int, str] = {}
    for statement_id in matched_ids:
        row = statement_by_id.get(statement_id)
        if row is None or not row.date:
            continue
        month_by_statement[statement_id] = f"{int(row.date.year):04d}-{int(row.date.month):02d}"

    cycles: list[dict[str, Any]] = []
    all_card_ids: set[int] = set()
    invoice_months: set[str] = set()
    for match in matches:
        statement_id = int(match.bank_statement_id or 0)
        bank_year_month = month_by_statement.get(statement_id)
        if not bank_year_month:
            continue
        group_id = int(match.invoice_group_id) if match.invoice_group_id else None
        card_id = int(match.credit_card_id) if match.credit_card_id else None
        card_ids = set(_cycle_card_ids(db, tenant_id, account_id, group_id, card_id))
        all_card_ids.update(card_ids)
        invoice_months.add(match.year_month)
        cycles.append({
            "bank_statement_id": statement_id,
            "bank_year_month": bank_year_month,
            "invoice_year_month": match.year_month,
            "card_ids": card_ids,
        })

    due_days = _card_closing_days(db, tenant_id, account_id, list(all_card_ids))
    window_starts: list[date] = []
    window_ends: list[date] = []
    for cycle in cycles:
        windows: dict[int, tuple[date, date]] = {}
        for card_id in cycle["card_ids"]:
            window = _invoice_billing_window(
                cycle["invoice_year_month"],
                due_days.get(int(card_id), 14),
            )
            windows[int(card_id)] = window
            window_starts.append(window[0])
            window_ends.append(window[1])
        cycle["windows"] = windows

    date_start = min(window_starts) if window_starts else None
    date_end = max(window_ends) if window_ends else None
    lines = _card_invoice_lines(
        db, tenant_id, account_id, list(all_card_ids), list(invoice_months),
        date_start, date_end,
    )

    def take_line(row: Any, cycle: dict[str, Any], seen: set[int], items: list[dict[str, Any]], statements_with_items: set[int]) -> None:
        seen.add(int(row.id))
        serialized = _serialize_invoice_line(row)
        serialized["year_month"] = cycle["bank_year_month"]
        items.append(serialized)
        statements_with_items.add(int(cycle["bank_statement_id"]))

    seen: set[int] = set()
    items: list[dict[str, Any]] = []
    statements_with_items: set[int] = set()
    for row in lines:
        line_id = int(row.id)
        if line_id in seen:
            continue
        card_id = int(row.credit_card_id)
        for cycle in cycles:
            if card_id not in cycle["card_ids"]:
                continue
            if row.year_month != cycle["invoice_year_month"]:
                continue
            take_line(row, cycle, seen, items, statements_with_items)
            break

    for row in lines:
        line_id = int(row.id)
        if line_id in seen:
            continue
        card_id = int(row.credit_card_id)
        item_date = _to_date(row.date)
        if item_date is None:
            continue
        row_month = str(row.year_month or "")
        for cycle in cycles:
            if card_id not in cycle["card_ids"]:
                continue
            invoice_month = str(cycle.get("invoice_year_month") or "")
            # Parcela de fatura futura (ex.: 2/2 com a mesma data de compra da 1/2).
            if row_month and invoice_month and row_month > invoice_month:
                continue
            window = cycle.get("windows", {}).get(card_id)
            if not window:
                continue
            start, end = window
            if start <= item_date <= end:
                take_line(row, cycle, seen, items, statements_with_items)
                break

    unmatched: list[dict[str, Any]] = []
    for statement_id in matched_ids:
        if statement_id in statements_with_items:
            continue
        row = statement_by_id.get(statement_id)
        if row is None or not row.date:
            continue
        amount = _money(row.amount)
        splits = split_signed_amount(
            amount, *_sharing_of(row),
        )
        unmatched.append({
            "id": int(row.id),
            "date": _iso_date(row.date),
            "description": row.description or "",
            "amount": float(amount),
            "source": "bank",
            "year_month": month_by_statement.get(int(row.id)),
            "amount_account": splits["amount_account"],
            "amount_shared": splits["amount_shared"],
        })
    return {"matched_ids": statements_with_items, "items": items, "unmatched": unmatched}


def _load_tags(
    db: Session,
    tenant_id: int,
    account_id: int,
) -> tuple[dict[int, dict[str, Any]], dict[int, dict[str, Any]]]:
    subtags = {
        int(row.id): {"tag_id": int(row.tag_id), "name": row.name}
        for row in (
            db.query(Subtag.id, Subtag.tag_id, Subtag.name)
            .filter(Subtag.tenant_id == tenant_id, Subtag.account_id == account_id)
            .all()
        )
    }
    tags = {
        int(row.id): {"name": row.name, "icon": row.icon}
        for row in (
            db.query(Tag.id, Tag.name, Tag.icon)
            .filter(Tag.tenant_id == tenant_id, Tag.account_id == account_id)
            .all()
        )
    }
    return subtags, tags


def _bucket_categories(
    rows: list[Any],
    subtags: dict[int, dict[str, Any]],
    tags: dict[int, dict[str, Any]],
    want_credit: bool,
    matched_ids: Optional[set[int]] = None,
    invoice_items: Optional[list[dict[str, Any]]] = None,
    scope: str = "all",
    settlements: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    buckets: dict[str, dict[str, Any]] = {}
    total = ZERO
    skipped = set(matched_ids or set())
    skipped.update((settlements or {}).get("excluded_statement_ids") or set())

    def add(tag_id: Optional[int], share: Decimal) -> None:
        nonlocal total
        if share == 0:
            return
        if tag_id == SETTLEMENT_TAG_ID:
            tag = {"name": SETTLEMENT_TAG_NAME, "icon": SETTLEMENT_TAG_ICON}
        else:
            tag = tags.get(tag_id) if tag_id else None
        key = str(tag_id) if tag_id is not None else "none"
        bucket = buckets.setdefault(key, {
            "tag_id": tag_id,
            "tag_name": tag["name"] if tag else "Sem categoria",
            "icon": tag["icon"] if tag else "Tag",
            "amount": ZERO,
            "count": 0,
        })
        bucket["amount"] += share
        bucket["count"] += 1
        total += share

    for row in rows:
        if int(row.id) in skipped:
            continue
        amount = _money(row.amount)
        if amount == 0:
            continue
        is_credit = amount > 0
        if is_credit != want_credit:
            continue
        share = _scoped_abs(amount, *_sharing_of(row), scope)
        if share is None or share == 0:
            continue
        subtag = subtags.get(int(row.subtag_id)) if row.subtag_id else None
        tag_id = subtag["tag_id"] if subtag else (int(row.tag_id) if getattr(row, "tag_id", None) else None)
        add(tag_id, share)

    if not want_credit:
        for item in invoice_items or []:
            original = _money(item.get("amount"))
            if original > 0:
                continue
            share = _scoped_abs(original, *_sharing_of(item), scope)
            if share is None or share == 0:
                continue
            add(item.get("tag_id"), share)
    else:
        for item in invoice_items or []:
            original = _money(item.get("amount"))
            if original <= 0:
                continue
            share = _scoped_abs(original, *_sharing_of(item), scope)
            if share is None or share == 0:
                continue
            add(item.get("tag_id"), share)
        for item in (settlements or {}).get("items") or []:
            share = _money(item.get("amount"))
            if share == 0:
                continue
            linked = bool(item.get("linked"))
            if scope == "account":
                if linked:
                    continue
                add(SETTLEMENT_TAG_ID, -share)
            elif scope == "shared":
                add(SETTLEMENT_TAG_ID, share)
            elif linked:
                add(SETTLEMENT_TAG_ID, share)

    ranked = sorted(
        buckets.values(),
        key=lambda item: item["amount"],
        reverse=True,
    )
    items = []
    for row in ranked:
        amount = _money(row["amount"])
        if amount == 0:
            continue
        items.append({
            "tag_id": row["tag_id"],
            "tag_name": row["tag_name"],
            "icon": row["icon"],
            "amount": float(amount),
            "count": row["count"],
            "share_pct": float((amount / total * Decimal("100")).quantize(MONEY)) if total else 0,
        })
    return {
        "total": float(total.quantize(MONEY)),
        "items": items,
    }


def get_categories(
    db: Session,
    tenant_id: int,
    account_id: int,
    year: Optional[int] = None,
    scope: Optional[str] = None,
    month: Optional[int] = None,
) -> dict[str, Any]:
    scope_value = _normalize_scope(scope)
    month_value = _normalize_month(year, month)
    periods = _visible_periods(db, tenant_id, account_id, year, month_value)
    rows = _statements_in_periods(db, tenant_id, account_id, periods)
    expansion = _period_source_expansion(db, tenant_id, account_id, rows, periods)
    settlements = _load_account_settlements(db, tenant_id, account_id, periods)
    subtags, tags = _load_tags(db, tenant_id, account_id)
    return {
        "year": year,
        "month": month_value,
        "scope": scope_value,
        "entries": _bucket_categories(
            rows, subtags, tags, True, expansion["matched_ids"], expansion["items"],
            scope_value, settlements,
        ),
        "exits": _bucket_categories(
            rows, subtags, tags, False, expansion["matched_ids"], expansion["items"],
            scope_value, settlements,
        ),
    }
