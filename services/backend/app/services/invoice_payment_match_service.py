"""Reconciliação entre o ciclo de fatura (grupo ou cartão isolado) e o débito no extrato."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models.unified_models import (
    BankStatement,
    Cartao,
    CreditCardInvoice,
    CreditCardInvoiceGroup,
    InvoicePaymentMatch,
    Subtag,
)

YEAR_MONTH_LEN = 7
CARD_TAG_NAMES = frozenset({"cartão", "cartao"})
WINDOWS = (("current", 0), ("previous", -1), ("next", 1))


def to_cents(amount: Any) -> int:
    return int((Decimal(str(amount or 0)) * 100).quantize(Decimal("1")))


def to_cents_abs(amount: Any) -> int:
    return abs(to_cents(amount))


def shift_year_month(year_month: str, delta_months: int) -> str:
    year, month = _parse_year_month(year_month)
    month += delta_months
    while month < 1:
        month += 12
        year -= 1
    while month > 12:
        month -= 12
        year += 1
    return f"{year:04d}-{month:02d}"


def month_range(year_month: str) -> tuple[datetime, datetime]:
    year, month = _parse_year_month(year_month)
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1)
    else:
        end = datetime(year, month + 1, 1)
    return start, end


def _parse_year_month(year_month: str) -> tuple[int, int]:
    if not year_month or len(year_month) != YEAR_MONTH_LEN or year_month[4] != "-":
        raise ValueError("year_month deve estar no formato YYYY-MM")
    year = int(year_month[:4])
    month = int(year_month[5:7])
    if month < 1 or month > 12:
        raise ValueError("year_month deve estar no formato YYYY-MM")
    return year, month


def _iso_date(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "date") and callable(value.date):
        try:
            return value.date().isoformat()
        except Exception:
            pass
    return str(value)[:10]


def _has_card_tag(statement: BankStatement) -> bool:
    tag = statement.subtag.tag if statement.subtag else None
    if not tag or not tag.name:
        return False
    return tag.name.strip().lower() in CARD_TAG_NAMES


def _cycle_key(invoice_group_id: Optional[int], credit_card_id: Optional[int]) -> str:
    if invoice_group_id is not None:
        return f"group:{invoice_group_id}"
    return f"card:{credit_card_id}"


def _used_bank_statement_ids(db: Session, tenant_id: int, account_id: int) -> set[int]:
    rows = (
        db.query(InvoicePaymentMatch.bank_statement_id)
        .filter(
            InvoicePaymentMatch.tenant_id == tenant_id,
            InvoicePaymentMatch.account_id == account_id,
        )
        .all()
    )
    return {int(row[0]) for row in rows if row[0] is not None}


def _load_credit_cards(db: Session, tenant_id: int, account_id: int) -> list[Cartao]:
    """Todos os cartões de crédito da conta, inclusive inativos (histórico de fatura)."""
    return (
        db.query(Cartao)
        .options(joinedload(Cartao.invoice_group))
        .filter(
            Cartao.tenant_id == tenant_id,
            Cartao.account_id == account_id,
            Cartao.type == "credito",
        )
        .order_by(Cartao.name, Cartao.number)
        .all()
    )


def _invoice_year_months(
    db: Session,
    tenant_id: int,
    card_ids: Iterable[int],
) -> list[str]:
    ids = list(card_ids)
    if not ids:
        return []
    rows = (
        db.query(CreditCardInvoice.year_month)
        .filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.credit_card_id.in_(ids),
        )
        .distinct()
        .all()
    )
    months = [str(row[0]) for row in rows if row[0]]
    months.sort(reverse=True)
    return months


def _serialize_cycle_cards(cards: list[Cartao]) -> list[dict[str, Any]]:
    return [
        {
            "id": card.id,
            "name": card.name,
            "number": card.number,
            "active": bool(card.active),
        }
        for card in cards
    ]


def _build_cycles(cards: list[Cartao]) -> list[dict[str, Any]]:
    grouped: dict[int, list[Cartao]] = {}
    singletons: list[Cartao] = []
    for card in cards:
        if card.invoice_group_id:
            grouped.setdefault(int(card.invoice_group_id), []).append(card)
        else:
            singletons.append(card)

    cycles: list[dict[str, Any]] = []
    for group_id, group_cards in grouped.items():
        group = group_cards[0].invoice_group
        cycles.append({
            "invoice_group_id": group_id,
            "credit_card_id": None,
            "name": group.name if group else f"Grupo {group_id}",
            "cards": group_cards,
        })
    for card in singletons:
        cycles.append({
            "invoice_group_id": None,
            "credit_card_id": card.id,
            "name": f"{card.name} •••• {card.number}",
            "cards": [card],
        })
    return cycles


def _invoice_totals(
    db: Session,
    tenant_id: int,
    account_id: int,
    year_month: str,
    card_ids: Iterable[int],
) -> tuple[Decimal, int]:
    ids = list(card_ids)
    if not ids:
        return Decimal("0"), 0
    row = (
        db.query(
            func.coalesce(func.sum(CreditCardInvoice.amount), 0),
            func.count(CreditCardInvoice.id),
        )
        .filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.year_month == year_month,
            CreditCardInvoice.credit_card_id.in_(ids),
        )
        .one()
    )
    return Decimal(str(row[0] or 0)), int(row[1] or 0)


def _find_match(
    db: Session,
    tenant_id: int,
    account_id: int,
    year_month: str,
    invoice_group_id: Optional[int],
    credit_card_id: Optional[int],
) -> Optional[InvoicePaymentMatch]:
    query = db.query(InvoicePaymentMatch).options(
        joinedload(InvoicePaymentMatch.bank_statement).joinedload(BankStatement.subtag).joinedload(Subtag.tag),
    ).filter(
        InvoicePaymentMatch.tenant_id == tenant_id,
        InvoicePaymentMatch.account_id == account_id,
        InvoicePaymentMatch.year_month == year_month,
    )
    if invoice_group_id is not None:
        query = query.filter(InvoicePaymentMatch.invoice_group_id == invoice_group_id)
    else:
        query = query.filter(
            InvoicePaymentMatch.invoice_group_id.is_(None),
            InvoicePaymentMatch.credit_card_id == credit_card_id,
        )
    return query.first()


def _serialize_statement(statement: BankStatement, month_relative: Optional[str] = None) -> dict[str, Any]:
    payload = {
        "bank_statement_id": statement.id,
        "date": _iso_date(statement.date),
        "description": statement.description,
        "amount": float(statement.amount),
        "has_card_tag": _has_card_tag(statement),
    }
    if month_relative is not None:
        payload["month_relative"] = month_relative
    return payload


def _is_unlinked_match(match: InvoicePaymentMatch) -> bool:
    return match.match_method == "unlinked" or match.bank_statement_id is None


def _serialize_match(match: InvoicePaymentMatch) -> dict[str, Any]:
    statement = match.bank_statement
    return {
        "id": match.id,
        "bank_statement_id": match.bank_statement_id,
        "matched_amount": float(match.matched_amount),
        "match_method": match.match_method,
        "date": _iso_date(statement.date) if statement else None,
        "description": statement.description if statement else None,
        "amount": float(statement.amount) if statement else None,
        "has_card_tag": _has_card_tag(statement) if statement else False,
    }


def _collect_candidates(
    db: Session,
    tenant_id: int,
    account_id: int,
    year_month: str,
    target_cents: int,
    exclude_ids: set[int],
) -> list[dict[str, Any]]:
    if target_cents <= 0:
        return []

    candidates: list[dict[str, Any]] = []
    for label, delta in WINDOWS:
        window_month = shift_year_month(year_month, delta)
        start, end = month_range(window_month)
        statements = (
            db.query(BankStatement)
            .options(joinedload(BankStatement.subtag).joinedload(Subtag.tag))
            .filter(
                BankStatement.tenant_id == tenant_id,
                BankStatement.account_id == account_id,
                BankStatement.amount < 0,
                BankStatement.date >= start,
                BankStatement.date < end,
            )
            .order_by(BankStatement.date, BankStatement.id)
            .all()
        )
        for statement in statements:
            if statement.id in exclude_ids:
                continue
            if to_cents_abs(statement.amount) != target_cents:
                continue
            candidates.append(_serialize_statement(statement, label))
    return candidates


def _has_multiple_exact_debits(candidates: list[dict[str, Any]]) -> bool:
    """True quando o Auto não pode escolher: o mesmo valor aparece em mais de um débito."""
    for window, _delta in WINDOWS:
        tagged = [
            item for item in candidates
            if item.get("month_relative") == window and item.get("has_card_tag")
        ]
        if len(tagged) == 1:
            return False
        if len(tagged) >= 2:
            return True
    return len(candidates) >= 2


def _classify(candidates: list[dict[str, Any]]) -> tuple[str, bool, Optional[dict[str, Any]]]:
    """Retorna (status, auto_eligible, auto_candidate).

    Auto vale só para um débito único de valor exato. Vários débitos iguais
    ficam pendentes para escolha manual.
    """
    for window, _delta in WINDOWS:
        tagged = [
            item for item in candidates
            if item.get("month_relative") == window and item.get("has_card_tag")
        ]
        if len(tagged) == 1:
            return "unmatched", True, tagged[0]
        if len(tagged) >= 2:
            return "unmatched", False, None

    if len(candidates) >= 2:
        return "unmatched", False, None
    if len(candidates) == 1:
        return "unmatched", True, candidates[0]
    return "unmatched", False, None


def _count_multiple_debits(cycles: Iterable[dict[str, Any]]) -> int:
    return sum(
        1
        for item in cycles
        if item.get("status") == "unmatched" and item.get("multiple_debits")
    )


def _stamp_invoices(
    db: Session,
    tenant_id: int,
    account_id: int,
    year_month: str,
    card_ids: Iterable[int],
    bank_statement_id: Optional[int],
) -> None:
    ids = list(card_ids)
    if not ids:
        return
    db.query(CreditCardInvoice).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        CreditCardInvoice.year_month == year_month,
        CreditCardInvoice.credit_card_id.in_(ids),
    ).update(
        {CreditCardInvoice.bank_statement_id: bank_statement_id},
        synchronize_session=False,
    )


def _card_ids_for_cycle(
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
                Cartao.type == "credito",
                Cartao.invoice_group_id == invoice_group_id,
            )
            .all()
        )
        return [int(row[0]) for row in rows]
    if credit_card_id is not None:
        return [int(credit_card_id)]
    return []


def _preview_month_cycles(
    db: Session,
    tenant_id: int,
    account_id: int,
    year_month: str,
    cycles: list[dict[str, Any]],
    reserved_ids: set[int],
) -> tuple[list[dict[str, Any]], set[int]]:
    items: list[dict[str, Any]] = []
    newly_reserved: set[int] = set()

    for cycle in cycles:
        card_ids = [card.id for card in cycle["cards"]]
        net_amount, line_count = _invoice_totals(db, tenant_id, account_id, year_month, card_ids)
        if line_count == 0:
            continue

        amount_to_pay = abs(net_amount)
        target_cents = to_cents(amount_to_pay)
        existing = _find_match(
            db, tenant_id, account_id, year_month,
            cycle["invoice_group_id"], cycle["credit_card_id"],
        )

        exclude = set(reserved_ids)
        if existing and existing.bank_statement_id is not None:
            exclude.discard(int(existing.bank_statement_id))

        candidates = _collect_candidates(
            db, tenant_id, account_id, year_month, target_cents, exclude,
        )

        if existing:
            status = "unlinked" if _is_unlinked_match(existing) else "matched"
            auto_eligible = False
            auto_candidate = None
            multiple_debits = False
        else:
            status, auto_eligible, auto_candidate = _classify(candidates)
            multiple_debits = _has_multiple_exact_debits(candidates)
            if auto_eligible and auto_candidate:
                newly_reserved.add(int(auto_candidate["bank_statement_id"]))

        items.append({
            "key": f"{year_month}:{_cycle_key(cycle['invoice_group_id'], cycle['credit_card_id'])}",
            "invoice_group_id": cycle["invoice_group_id"],
            "credit_card_id": cycle["credit_card_id"],
            "name": cycle["name"],
            "group_name": cycle["name"] if cycle["invoice_group_id"] is not None else None,
            "card_names": [card.name for card in cycle["cards"]],
            "card_ids": card_ids,
            "cards": _serialize_cycle_cards(cycle["cards"]),
            "year_month": year_month,
            "net_amount": float(net_amount),
            "amount_to_pay": float(amount_to_pay),
            "line_count": line_count,
            "status": status,
            "auto_eligible": auto_eligible,
            "multiple_debits": multiple_debits,
            "auto_candidate": auto_candidate,
            "match": _serialize_match(existing) if existing else None,
            "statement_description": (
                existing.bank_statement.description
                if existing and existing.bank_statement
                else None
            ),
            "candidates": candidates,
        })

    return items, newly_reserved


def preview(
    db: Session,
    tenant_id: int,
    account_id: int,
    year_month: str,
) -> dict[str, Any]:
    _parse_year_month(year_month)
    cards = _load_credit_cards(db, tenant_id, account_id)
    cycles = _build_cycles(cards)
    used_ids = _used_bank_statement_ids(db, tenant_id, account_id)
    items, _reserved = _preview_month_cycles(
        db, tenant_id, account_id, year_month, cycles, used_ids,
    )
    return {"year_month": year_month, "cycles": items}


def preview_history(
    db: Session,
    tenant_id: int,
    account_id: int,
) -> dict[str, Any]:
    """Percorre todas as faturas do mais novo ao mais velho, por grupo ou cartão isolado."""
    cards = _load_credit_cards(db, tenant_id, account_id)
    cycles = _build_cycles(cards)
    months = _invoice_year_months(db, tenant_id, [card.id for card in cards])
    reserved_ids = _used_bank_statement_ids(db, tenant_id, account_id)

    month_payloads: list[dict[str, Any]] = []
    matched = unmatched = unlinked = auto_eligible = 0

    for year_month in months:
        items, newly_reserved = _preview_month_cycles(
            db, tenant_id, account_id, year_month, cycles, reserved_ids,
        )
        reserved_ids.update(newly_reserved)
        if not items:
            continue
        for item in items:
            if item["status"] == "matched":
                matched += 1
            elif item["status"] == "unlinked":
                unlinked += 1
            else:
                unmatched += 1
            if item.get("auto_eligible"):
                auto_eligible += 1
        month_payloads.append({"year_month": year_month, "cycles": items})

    return {
        "months": month_payloads,
        "summary": {
            "month_count": len(month_payloads),
            "cycle_count": matched + unmatched + unlinked,
            "matched": matched,
            "unmatched": unmatched,
            "ambiguous": 0,
            "unlinked": unlinked,
            "auto_eligible": auto_eligible,
        },
    }


def list_matches(
    db: Session,
    tenant_id: int,
    account_id: int,
    year_month: Optional[str] = None,
    bank_year_month: Optional[str] = None,
) -> list[dict[str, Any]]:
    query = (
        db.query(InvoicePaymentMatch)
        .options(
            joinedload(InvoicePaymentMatch.bank_statement).joinedload(BankStatement.subtag).joinedload(Subtag.tag),
            joinedload(InvoicePaymentMatch.invoice_group),
            joinedload(InvoicePaymentMatch.credit_card),
        )
        .filter(
            InvoicePaymentMatch.tenant_id == tenant_id,
            InvoicePaymentMatch.account_id == account_id,
        )
    )
    if year_month:
        _parse_year_month(year_month)
        query = query.filter(InvoicePaymentMatch.year_month == year_month)
    if bank_year_month:
        start, end = month_range(bank_year_month)
        query = query.join(InvoicePaymentMatch.bank_statement).filter(
            BankStatement.date >= start,
            BankStatement.date < end,
        )

    matches = query.order_by(InvoicePaymentMatch.year_month, InvoicePaymentMatch.id).all()
    results = []
    for match in matches:
        payload = _serialize_match(match)
        payload.update({
            "year_month": match.year_month,
            "invoice_group_id": match.invoice_group_id,
            "credit_card_id": match.credit_card_id,
            "name": (
                match.invoice_group.name if match.invoice_group
                else (
                    f"{match.credit_card.name} •••• {match.credit_card.number}"
                    if match.credit_card else None
                )
            ),
        })
        results.append(payload)
    return results


def apply_match(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    year_month: str,
    bank_statement_id: int,
    invoice_group_id: Optional[int],
    credit_card_id: Optional[int],
    match_method: str = "manual",
) -> dict[str, Any]:
    _parse_year_month(year_month)
    if match_method not in ("auto", "manual"):
        raise ValueError("match_method deve ser auto ou manual")
    if (invoice_group_id is None) == (credit_card_id is None):
        raise ValueError("Informe invoice_group_id ou credit_card_id")

    if invoice_group_id is not None:
        group = db.query(CreditCardInvoiceGroup).filter(
            CreditCardInvoiceGroup.id == invoice_group_id,
            CreditCardInvoiceGroup.tenant_id == tenant_id,
            CreditCardInvoiceGroup.account_id == account_id,
        ).first()
        if not group:
            raise LookupError("Grupo de fatura não encontrado")
        credit_card_id = None
    else:
        card = db.query(Cartao).filter(
            Cartao.id == credit_card_id,
            Cartao.tenant_id == tenant_id,
            Cartao.account_id == account_id,
            Cartao.type == "credito",
        ).first()
        if not card:
            raise LookupError("Cartão não encontrado")
        if card.invoice_group_id:
            raise ValueError("Este cartão pertence a um grupo; reconcilie pelo grupo")

    existing = _find_match(db, tenant_id, account_id, year_month, invoice_group_id, credit_card_id)
    if existing:
        raise ValueError("Este ciclo já está reconciliado")

    taken = (
        db.query(InvoicePaymentMatch)
        .filter(
            InvoicePaymentMatch.tenant_id == tenant_id,
            InvoicePaymentMatch.account_id == account_id,
            InvoicePaymentMatch.bank_statement_id == bank_statement_id,
        )
        .first()
    )
    if taken:
        raise ValueError("Este lançamento do extrato já está vinculado a outra fatura")

    card_ids = _card_ids_for_cycle(db, tenant_id, account_id, invoice_group_id, credit_card_id)
    net_amount, line_count = _invoice_totals(db, tenant_id, account_id, year_month, card_ids)
    if line_count == 0:
        raise ValueError("Não há lançamentos de fatura neste ciclo")

    amount_to_pay = abs(net_amount)
    target_cents = to_cents(amount_to_pay)
    if target_cents <= 0:
        raise ValueError("O líquido deste ciclo não gera pagamento")

    statement = (
        db.query(BankStatement)
        .options(joinedload(BankStatement.subtag).joinedload(Subtag.tag))
        .filter(
            BankStatement.id == bank_statement_id,
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
        )
        .first()
    )
    if not statement:
        raise LookupError("Lançamento do extrato não encontrado")
    if statement.amount >= 0:
        raise ValueError("O pagamento da fatura deve ser um débito no extrato")
    if match_method == "auto" and to_cents_abs(statement.amount) != target_cents:
        raise ValueError("O valor do extrato não confere com o líquido da fatura")

    match = InvoicePaymentMatch(
        tenant_id=tenant_id,
        account_id=account_id,
        created_by=user_id,
        year_month=year_month,
        invoice_group_id=invoice_group_id,
        credit_card_id=credit_card_id,
        bank_statement_id=bank_statement_id,
        matched_amount=amount_to_pay,
        match_method=match_method,
    )
    db.add(match)
    db.flush()
    _stamp_invoices(db, tenant_id, account_id, year_month, card_ids, bank_statement_id)
    db.commit()
    db.refresh(match)
    return _serialize_match(match)


def skip_match(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    year_month: str,
    invoice_group_id: Optional[int],
    credit_card_id: Optional[int],
) -> dict[str, Any]:
    """Marca o ciclo como não vinculado: sem débito no extrato e fora do alerta da Saúde."""
    _parse_year_month(year_month)
    if (invoice_group_id is None) == (credit_card_id is None):
        raise ValueError("Informe invoice_group_id ou credit_card_id")

    if invoice_group_id is not None:
        group = db.query(CreditCardInvoiceGroup).filter(
            CreditCardInvoiceGroup.id == invoice_group_id,
            CreditCardInvoiceGroup.tenant_id == tenant_id,
            CreditCardInvoiceGroup.account_id == account_id,
        ).first()
        if not group:
            raise LookupError("Grupo de fatura não encontrado")
        credit_card_id = None
    else:
        card = db.query(Cartao).filter(
            Cartao.id == credit_card_id,
            Cartao.tenant_id == tenant_id,
            Cartao.account_id == account_id,
            Cartao.type == "credito",
        ).first()
        if not card:
            raise LookupError("Cartão não encontrado")
        if card.invoice_group_id:
            raise ValueError("Este cartão pertence a um grupo; reconcilie pelo grupo")

    existing = _find_match(db, tenant_id, account_id, year_month, invoice_group_id, credit_card_id)
    if existing:
        if _is_unlinked_match(existing):
            return _serialize_match(existing)
        raise ValueError("Este ciclo já está reconciliado. Desfaça o vínculo antes de marcar como não vinculado")

    card_ids = _card_ids_for_cycle(db, tenant_id, account_id, invoice_group_id, credit_card_id)
    net_amount, line_count = _invoice_totals(db, tenant_id, account_id, year_month, card_ids)
    if line_count == 0:
        raise ValueError("Não há lançamentos de fatura neste ciclo")

    match = InvoicePaymentMatch(
        tenant_id=tenant_id,
        account_id=account_id,
        created_by=user_id,
        year_month=year_month,
        invoice_group_id=invoice_group_id,
        credit_card_id=credit_card_id,
        bank_statement_id=None,
        matched_amount=abs(net_amount),
        match_method="unlinked",
    )
    db.add(match)
    db.flush()
    _stamp_invoices(db, tenant_id, account_id, year_month, card_ids, None)
    db.commit()
    db.refresh(match)
    return _serialize_match(match)


SEARCH_STATEMENTS_LIMIT = 200


def search_statements(
    db: Session,
    tenant_id: int,
    account_id: int,
    start_date: date,
    end_date: date,
    min_amount: Any,
    max_amount: Any,
) -> dict[str, Any]:
    """Débitos no período com valor absoluto entre o mínimo e o máximo informados."""
    if end_date < start_date:
        raise ValueError("Data fim deve ser posterior à data início")
    min_threshold = Decimal(str(min_amount or 0)).quantize(Decimal("0.01"))
    max_threshold = Decimal(str(max_amount or 0)).quantize(Decimal("0.01"))
    if min_threshold <= 0 or max_threshold <= 0:
        raise ValueError("Informe valores mínimo e máximo maiores que zero")
    if max_threshold < min_threshold:
        raise ValueError("Valor máximo deve ser maior ou igual ao mínimo")

    start_dt = datetime.combine(start_date, time.min)
    end_dt = datetime.combine(end_date + timedelta(days=1), time.min)
    used_ids = _used_bank_statement_ids(db, tenant_id, account_id)

    query = (
        db.query(BankStatement)
        .options(joinedload(BankStatement.subtag).joinedload(Subtag.tag))
        .filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            BankStatement.amount < 0,
            BankStatement.amount <= -min_threshold,
            BankStatement.amount >= -max_threshold,
            BankStatement.date >= start_dt,
            BankStatement.date < end_dt,
        )
        .order_by(BankStatement.date.desc(), BankStatement.id.desc())
    )
    if used_ids:
        query = query.filter(~BankStatement.id.in_(used_ids))

    rows = query.limit(SEARCH_STATEMENTS_LIMIT + 1).all()
    truncated = len(rows) > SEARCH_STATEMENTS_LIMIT
    statements = rows[:SEARCH_STATEMENTS_LIMIT]
    return {
        "candidates": [_serialize_statement(item) for item in statements],
        "truncated": truncated,
    }


def auto_match(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    year_month: str,
) -> dict[str, Any]:
    applied = []
    skipped = []
    seen: set[str] = set()
    while True:
        data = preview(db, tenant_id, account_id, year_month)
        cycle = next(
            (
                item for item in data["cycles"]
                if item.get("auto_eligible") and item.get("auto_candidate") and item["key"] not in seen
            ),
            None,
        )
        if not cycle:
            break
        seen.add(cycle["key"])
        try:
            match = apply_match(
                db,
                tenant_id,
                account_id,
                user_id,
                year_month,
                int(cycle["auto_candidate"]["bank_statement_id"]),
                cycle["invoice_group_id"],
                cycle["credit_card_id"],
                match_method="auto",
            )
            applied.append({"key": cycle["key"], "match": match})
        except Exception as exc:
            db.rollback()
            skipped.append({"key": cycle["key"], "status": "error", "detail": str(exc)})
    preview_data = preview(db, tenant_id, account_id, year_month)
    return {
        "year_month": year_month,
        "applied_count": len(applied),
        "applied": applied,
        "skipped": skipped,
        "skipped_multiple_count": _count_multiple_debits(preview_data.get("cycles") or []),
        "preview": preview_data,
    }


def auto_match_history(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
) -> dict[str, Any]:
    """Aplica matches automáticos do mês mais recente ao mais antigo."""
    cards = _load_credit_cards(db, tenant_id, account_id)
    months = _invoice_year_months(db, tenant_id, [card.id for card in cards])
    applied: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for year_month in months:
        result = auto_match(db, tenant_id, account_id, user_id, year_month)
        applied.extend(result.get("applied") or [])
        skipped.extend(result.get("skipped") or [])

    preview_data = preview_history(db, tenant_id, account_id)
    remaining = [
        cycle
        for month in preview_data.get("months") or []
        for cycle in month.get("cycles") or []
    ]
    return {
        "applied_count": len(applied),
        "applied": applied,
        "skipped": skipped,
        "skipped_multiple_count": _count_multiple_debits(remaining),
        "preview": preview_data,
    }


def unmatch(
    db: Session,
    tenant_id: int,
    account_id: int,
    match_id: int,
) -> None:
    match = (
        db.query(InvoicePaymentMatch)
        .filter(
            InvoicePaymentMatch.id == match_id,
            InvoicePaymentMatch.tenant_id == tenant_id,
            InvoicePaymentMatch.account_id == account_id,
        )
        .first()
    )
    if not match:
        raise LookupError("Vínculo não encontrado")

    card_ids = _card_ids_for_cycle(
        db, tenant_id, account_id, match.invoice_group_id, match.credit_card_id,
    )
    _stamp_invoices(db, tenant_id, account_id, match.year_month, card_ids, None)
    db.delete(match)
    db.commit()


def unmatch_group_matches(
    db: Session,
    tenant_id: int,
    account_id: int,
    invoice_group_id: int,
) -> None:
    matches = (
        db.query(InvoicePaymentMatch)
        .filter(
            InvoicePaymentMatch.tenant_id == tenant_id,
            InvoicePaymentMatch.account_id == account_id,
            InvoicePaymentMatch.invoice_group_id == invoice_group_id,
        )
        .all()
    )
    for match in matches:
        card_ids = _card_ids_for_cycle(
            db, tenant_id, account_id, match.invoice_group_id, match.credit_card_id,
        )
        _stamp_invoices(db, tenant_id, account_id, match.year_month, card_ids, None)
        db.delete(match)
