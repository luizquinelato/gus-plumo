"""Projeção mensal: lançamento de entradas (holerites) e cartões (faturas) e clonagem de mês."""

from __future__ import annotations

import calendar
import logging
from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models.payroll_models import Payslip
from app.models.unified_models import (
    Cartao,
    CreditCardInvoice,
    MonthlyProjection,
)
from app.services.installment_service import get_open_installment_purchases
from app.utils.card_invoice_calendar import (
    effective_closing_day,
    effective_due_day,
    invoice_billing_window,
)

logger = logging.getLogger(__name__)

DEFAULT_HISTORY_MONTHS = 6
AUTOMATIC_SOURCES = ("card_invoice", "payroll")
INCOME_KINDS = {"advance": "Adiantamento salarial", "final": "Salário (fim do mês)"}


def _money(value) -> Decimal:
    return Decimal(value or 0).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def next_year_month(year_month: str) -> str:
    year, month = int(year_month[:4]), int(year_month[5:7])
    return f"{year + 1:04d}-01" if month == 12 else f"{year:04d}-{month + 1:02d}"


def prev_year_month(year_month: str) -> str:
    year, month = int(year_month[:4]), int(year_month[5:7])
    return f"{year - 1:04d}-12" if month == 1 else f"{year:04d}-{month - 1:02d}"


def _invoice_ym(calendar_ym: str, closing_day: int, due_day: int) -> str:
    """Mês-fatura (mês de fechamento) cujo vencimento cai em `calendar_ym`."""
    return calendar_ym if due_day > closing_day else prev_year_month(calendar_ym)


def _clamped_date(year_month: str, day: int) -> date:
    year, month = int(year_month[:4]), int(year_month[5:7])
    return date(year, month, min(max(day, 1), calendar.monthrange(year, month)[1]))


def _closing_due(card: Cartao) -> tuple[int, int]:
    group = card.invoice_group
    if group:
        return int(group.closing_day or 14), int(group.due_day or 14)
    return effective_closing_day(card), effective_due_day(card)


def actual_invoice_values(db: Session, tenant_id: int, rows: list[MonthlyProjection], calendar_ym: str) -> dict:
    """Valores reais por id de projeção de cartão, quando já existem faturas no mês-fatura."""
    out: dict = {}
    for row in rows:
        if row.source != "card_invoice":
            continue
        query = db.query(Cartao).options(joinedload(Cartao.invoice_group)).filter(Cartao.tenant_id == tenant_id)
        if row.credit_card_id:
            cards = query.filter(Cartao.id == row.credit_card_id).all()
        else:
            cards = query.filter(Cartao.invoice_group_id == row.invoice_group_id).all()
        if not cards:
            continue
        closing, due = _closing_due(cards[0])
        inv_ym = _invoice_ym(calendar_ym, closing, due)
        sums = (
            db.query(
                CreditCardInvoice.credit_card_id,
                func.sum(-CreditCardInvoice.amount),
                func.sum(-CreditCardInvoice.amount * CreditCardInvoice.ownership_percentage / 100),
            )
            .filter(
                CreditCardInvoice.tenant_id == tenant_id,
                CreditCardInvoice.year_month == inv_ym,
                CreditCardInvoice.credit_card_id.in_([c.id for c in cards]),
            )
            .group_by(CreditCardInvoice.credit_card_id)
            .all()
        )
        if not sums:
            continue
        by_card = {c.id: c for c in cards}
        out[row.id] = {
            "amount": sum((_money(t) for _, t, _ in sums), Decimal(0)),
            "my_amount": sum((_money(m) for _, _, m in sums), Decimal(0)),
            "breakdown": [
                {
                    "card_id": cid, "card_name": by_card[cid].name, "card_number": by_card[cid].number,
                    "amount": str(_money(t)), "my_amount": str(_money(m)),
                }
                for cid, t, m in sums
            ],
        }
    return out


def _card_averages(
    db: Session, tenant_id: int, card: Cartao, target_ym: str, today: date, history: int
) -> tuple[Decimal, Decimal] | None:
    """(média total, média minha parte) dos últimos `history` meses-fatura já fechados.

    A janela é calendário (os meses fechados imediatamente anteriores ao mês alvo).
    Meses sem fatura contam como zero; cartões novos dividem apenas pelos meses desde
    a primeira fatura. None quando não há valor a esperar.
    """
    closing_day = effective_closing_day(card)
    window: list[str] = []
    ym = target_ym
    while len(window) < history:
        ym = prev_year_month(ym)
        if ym < "2000-01":
            break
        if invoice_billing_window(ym, closing_day)[1] <= today:
            window.append(ym)
    if not window:
        return None

    first_ym = (
        db.query(func.min(CreditCardInvoice.year_month))
        .filter(CreditCardInvoice.tenant_id == tenant_id, CreditCardInvoice.credit_card_id == card.id)
        .scalar()
    )
    months = [m for m in window if first_ym and m >= first_ym]
    if not months:
        return None

    total, mine = (
        db.query(
            func.coalesce(func.sum(-CreditCardInvoice.amount), 0),
            func.coalesce(func.sum(-CreditCardInvoice.amount * CreditCardInvoice.ownership_percentage / 100), 0),
        )
        .filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.credit_card_id == card.id,
            CreditCardInvoice.year_month.in_(months),
        )
        .one()
    )
    total_avg = max(Decimal(total) / len(months), Decimal(0))
    mine_avg = max(Decimal(mine) / len(months), Decimal(0))
    if total_avg == 0 and mine_avg == 0:
        return None
    return total_avg, mine_avg



def _payslip_ym(p: Payslip) -> str | None:
    if p.payment_date:
        return f"{p.payment_date.year:04d}-{p.payment_date.month:02d}"
    if p.year and p.month:
        return f"{p.year:04d}-{p.month:02d}"
    return None


def income_projections(db: Session, tenant_id: int, account_id: int, year_month: str) -> list[dict]:
    """Entradas de holerite (adiantamento e fim do mês) do mês.

    Usa o valor real quando o mês já tem holerite; senão, a média dos últimos 6 meses
    com holerite desse tipo (estimativa), no dia de pagamento mais recente.
    """
    window = []
    ym = year_month
    for _ in range(DEFAULT_HISTORY_MONTHS):
        ym = prev_year_month(ym)
        window.append(ym)

    payslips = db.query(Payslip).filter(
        Payslip.tenant_id == tenant_id,
        Payslip.account_id == account_id,
        Payslip.active.is_(True),
        Payslip.payslip_kind.in_(list(INCOME_KINDS)),
        Payslip.net_amount.isnot(None),
    ).all()

    out: list[dict] = []
    for kind, label in INCOME_KINDS.items():
        of_kind = [(p, _payslip_ym(p)) for p in payslips if p.payslip_kind == kind]
        current = [p for p, y in of_kind if y == year_month]
        if current:
            amount = sum((_money(p.net_amount) for p in current), Decimal(0))
            day = max((p.payment_date.day for p in current if p.payment_date), default=None)
            actual = True
        else:
            hist = [(p, y) for p, y in of_kind if y in window]
            if not hist:
                continue
            by_month: dict[str, Decimal] = defaultdict(Decimal)
            for p, y in hist:
                by_month[y] += _money(p.net_amount)
            amount = _money(sum(by_month.values(), Decimal(0)) / len(by_month))
            dated = [p for p, _ in hist if p.payment_date]
            day = max(dated, key=lambda p: p.payment_date).payment_date.day if dated else None
            actual = False
        if amount <= 0:
            continue
        if day is None:
            day = 5 if kind == "final" else 20
        out.append({
            "description": label if actual else f"{label} (estimativa)", "amount": amount,
            "expected_date": _clamped_date(year_month, day),
        })
    return out


def _deactivate(db: Session, tenant_id: int, account_id: int, year_month: str, sources: Iterable[str]) -> None:
    db.query(MonthlyProjection).filter(
        MonthlyProjection.tenant_id == tenant_id,
        MonthlyProjection.account_id == account_id,
        MonthlyProjection.year_month == year_month,
        MonthlyProjection.source.in_(list(sources)),
        MonthlyProjection.active.is_(True),
    ).update({"active": False}, synchronize_session=False)


def launch_income_projections(
    db: Session, tenant_id: int, account_id: int, user_id: int, year_month: str
) -> int:
    """Apaga as entradas de holerite do mês e as refaz. Retorna a quantidade criada."""
    _deactivate(db, tenant_id, account_id, year_month, ["payroll"])
    projections = income_projections(db, tenant_id, account_id, year_month)
    for proj in projections:
        db.add(MonthlyProjection(
            tenant_id=tenant_id, account_id=account_id, created_by=user_id,
            year_month=year_month, kind="income", source="payroll",
            description=proj["description"], expected_date=proj["expected_date"],
            amount=proj["amount"], my_amount=proj["amount"],
        ))
    db.commit()
    logger.info("Projeção de entradas lançada: %s (%s, conta %s)", len(projections), year_month, account_id)
    return len(projections)


def _months_between(start_ym: str, end_ym: str) -> int:
    return (int(end_ym[:4]) * 12 + int(end_ym[5:7])) - (int(start_ym[:4]) * 12 + int(start_ym[5:7]))


def installments_for_month(
    db: Session, tenant_id: int, account_id: int, year_month: str, card_ids: list[int]
) -> list[dict]:
    """Parcelas em aberto que vencem na fatura paga em `year_month` (saldo parcelado)."""
    cards = (
        db.query(Cartao)
        .options(joinedload(Cartao.invoice_group))
        .filter(
            Cartao.tenant_id == tenant_id, Cartao.account_id == account_id,
            Cartao.active.is_(True), Cartao.type == "credito", Cartao.id.in_(card_ids),
        )
        .all()
    )
    out: list[dict] = []
    for card in cards:
        closing, due = _closing_due(card)
        inv_ym = _invoice_ym(year_month, closing, due)
        invoice_rows = (
            db.query(CreditCardInvoice)
            .filter(
                CreditCardInvoice.tenant_id == tenant_id,
                CreditCardInvoice.credit_card_id == card.id,
                CreditCardInvoice.year_month == inv_ym,
            )
            .all()
        )
        if invoice_rows:
            # Fatura já importada: as parcelas do mês vêm dela (o saldo parcelado só projeta
            # a partir da fatura-base, então não enxerga o mês da própria base).
            for r in invoice_rows:
                if not r.total_installments or r.total_installments <= 1 or not r.current_installment:
                    continue
                amount = abs(_money(r.amount))
                pct = Decimal(r.ownership_percentage if r.ownership_percentage is not None else 100)
                out.append({
                    "card_id": card.id, "card_name": card.name, "card_number": card.number,
                    "description": r.description, "installment": r.current_installment,
                    "total_installments": r.total_installments,
                    "amount": amount, "my_amount": _money(amount * pct / 100),
                    "expected_date": _clamped_date(year_month, due),
                })
            continue
        for p in get_open_installment_purchases(db, tenant_id, account_id, card_id=card.id):
            offset = _months_between(p.last_year_month, inv_ym)
            if not 1 <= offset <= p.remaining_installments:
                continue
            out.append({
                "card_id": card.id, "card_name": card.name, "card_number": card.number,
                "description": p.description, "installment": p.current_installment + offset,
                "total_installments": p.total_installments,
                "amount": _money(p.installment_amount), "my_amount": _money(p.my_installment_amount),
                "expected_date": _clamped_date(year_month, due),
            })
    out.sort(key=lambda r: (r["card_name"] or "", r["description"]))
    return out


def launch_card_projections(
    db: Session, tenant_id: int, account_id: int, user_id: int, year_month: str,
    card_ids: list[int], history_months: int, include_average: bool, items: list[dict],
    today: date | None = None, include_installments: bool = False,
) -> int:
    """Apaga as projeções de cartão do mês e as refaz.

    - include_average: uma linha por cartão (ou grupo de faturas) com a média dos últimos
      `history_months` meses; não editável.
    - include_installments: uma linha por parcela em aberto que vence no mês; editável.
    - items: itens individuais (card_id, description, amount, kind); editáveis.
    """
    today = today or date.today()
    cards = (
        db.query(Cartao)
        .options(joinedload(Cartao.invoice_group))
        .filter(
            Cartao.tenant_id == tenant_id, Cartao.account_id == account_id,
            Cartao.active.is_(True), Cartao.type == "credito", Cartao.id.in_(card_ids),
        )
        .all()
    )
    if not cards:
        raise ValueError("Selecione ao menos um cartão")
    by_id = {c.id: c for c in cards}
    if any(item["card_id"] not in by_id for item in items):
        raise ValueError("Item individual com cartão não selecionado")

    _deactivate(db, tenant_id, account_id, year_month, ["card_invoice", "card_item"])
    created = 0

    def _add(**kwargs) -> None:
        nonlocal created
        db.add(MonthlyProjection(
            tenant_id=tenant_id, account_id=account_id, created_by=user_id,
            year_month=year_month, **kwargs,
        ))
        created += 1

    if include_average:
        grouped: dict[int, list[Cartao]] = defaultdict(list)
        for card in cards:
            if card.invoice_group_id:
                grouped[card.invoice_group_id].append(card)
                continue
            closing, due = _closing_due(card)
            avg = _card_averages(db, tenant_id, card, _invoice_ym(year_month, closing, due), today, history_months)
            if avg:
                _add(
                    kind="variable", source="card_invoice", credit_card_id=card.id,
                    description=f"Fatura {card.name} •{card.number}",
                    expected_date=_clamped_date(year_month, due),
                    amount=_money(avg[0]), my_amount=_money(avg[1]),
                )
        for group_id, members in grouped.items():
            group = members[0].invoice_group
            closing, due = _closing_due(members[0])
            inv_ym = _invoice_ym(year_month, closing, due)
            breakdown, total, mine = [], Decimal(0), Decimal(0)
            for card in members:
                avg = _card_averages(db, tenant_id, card, inv_ym, today, history_months)
                if avg is None:
                    continue
                breakdown.append({
                    "card_id": card.id, "card_name": card.name, "card_number": card.number,
                    "amount": str(_money(avg[0])), "my_amount": str(_money(avg[1])),
                })
                total += avg[0]
                mine += avg[1]
            if breakdown:
                _add(
                    kind="variable", source="card_invoice", invoice_group_id=group_id,
                    description=f"Fatura {group.name}", expected_date=_clamped_date(year_month, due),
                    amount=_money(total), my_amount=_money(mine), breakdown=breakdown,
                )

    if include_installments:
        for inst in installments_for_month(db, tenant_id, account_id, year_month, list(by_id)):
            _add(
                kind="fixed", source="card_item", credit_card_id=inst["card_id"],
                description=f"{inst['description']} ({inst['installment']}/{inst['total_installments']})"[:255],
                expected_date=inst["expected_date"],
                amount=inst["amount"], my_amount=inst["my_amount"],
            )

    for item in items:
        card = by_id[item["card_id"]]
        amount = abs(_money(item["amount"]))
        _add(
            kind=item["kind"], source="card_item", credit_card_id=card.id,
            description=item["description"].strip(),
            expected_date=_clamped_date(year_month, _closing_due(card)[1]),
            amount=amount, my_amount=amount,
        )

    db.commit()
    logger.info("Projeção de cartões lançada: %s (%s, conta %s)", created, year_month, account_id)
    return created


def clone_to_next_month(
    db: Session, tenant_id: int, account_id: int, user_id: int, source_ym: str
) -> tuple[str, int]:
    """Copia itens ativos (exceto automáticos) para o mês seguinte. Dia inexistente -> último dia."""
    target_ym = next_year_month(source_ym)
    base = db.query(MonthlyProjection).filter(
        MonthlyProjection.tenant_id == tenant_id,
        MonthlyProjection.account_id == account_id,
        MonthlyProjection.active.is_(True),
    )
    if base.filter(MonthlyProjection.year_month == target_ym, MonthlyProjection.source.notin_(AUTOMATIC_SOURCES)).count():
        raise ValueError(f"O mês {target_ym} já possui lançamentos")
    items = base.filter(
        MonthlyProjection.year_month == source_ym, MonthlyProjection.source.notin_(AUTOMATIC_SOURCES)
    ).all()
    for item in items:
        db.add(MonthlyProjection(
            tenant_id=tenant_id, account_id=account_id, created_by=user_id,
            year_month=target_ym, expected_date=_clamped_date(target_ym, item.expected_date.day),
            description=item.description, amount=item.amount, my_amount=item.my_amount,
            kind=item.kind, source="clone",
        ))
    db.commit()
    return target_ym, len(items)
