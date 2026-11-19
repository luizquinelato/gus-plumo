"""Projeção mensal: lançamento de entradas (holerites) e cartões (faturas) e clonagem de mês."""

from __future__ import annotations

import calendar
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models.payroll_models import Payslip
from app.models.unified_models import (
    BankStatement,
    Cartao,
    CreditCardInvoice,
    MonthlyProjection,
)
from app.services.extrato_daily_balance_service import compute_opening_balance_calendar
from app.services.installment_service import get_open_installment_purchases
from app.utils.card_invoice_calendar import (
    effective_closing_day,
    effective_due_day,
)

logger = logging.getLogger(__name__)

DEFAULT_HISTORY_MONTHS = 6
BANK_STATEMENT_SOURCE = "bank_statement"
OPENING_BALANCE_DESCRIPTION = "Saldo mês anterior"
SECOND_HALF_STMT_FROM_DAY = 16
FINAL_PAYROLL_EXTRATO_FROM_DAY_PREV_MONTH = 21
FINAL_ON_DAY1_EXTRATO_UNTIL_DAY = 10
ADVANCE_PAYROLL_EXTRATO_FROM_DAY = 11
PayrollReconcileChoice = Literal["keep", "clear"]
INSTALLMENT_SOURCE = "card_item_installment"
CARD_ITEM_SOURCE = "card_item_manual"
CARD_SOURCES = ("card_invoice", CARD_ITEM_SOURCE, INSTALLMENT_SOURCE)
AUTOMATIC_SOURCES = ("card_invoice", "payroll", BANK_STATEMENT_SOURCE)
MAX_INSTALLMENT_MONTHS = 24
INCOME_KINDS = {"advance": "Adiantamento salarial", "final": "Salário (fim do mês)"}
ADVANCE_PROJECTION_DAY = 15


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
        # Linhas antigas não guardam o compartilhamento: amount == my_amount indica "own".
        sharing = row.sharing or ("own" if row.amount == row.my_amount else "all")
        sums_query = (
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
        )
        sums_query = _apply_sharing(sums_query, sharing)
        sums = sums_query.group_by(CreditCardInvoice.credit_card_id).all()
        if not sums:
            continue
        by_card = {c.id: c for c in cards}
        # "own"/"mine" valem a parte do usuário; só "all" usa o total da fatura.
        pick = (lambda t, m: t) if sharing == "all" else (lambda t, m: m)
        out[row.id] = {
            "amount": sum((_money(pick(t, m)) for _, t, m in sums), Decimal(0)),
            "my_amount": sum((_money(m) for _, _, m in sums), Decimal(0)),
            "breakdown": [
                {
                    "card_id": cid, "card_name": by_card[cid].name, "card_number": by_card[cid].number,
                    "amount": str(_money(pick(t, m))), "my_amount": str(_money(m)),
                }
                for cid, t, m in sums
            ],
        }
    return out


SHARING_MODES = ("own", "mine", "all")
LAUNCH_SHARING_MODES = ("own", "mine")


def _apply_sharing(query, sharing: str):
    """Filtra os itens de fatura: own = participação 100%; mine = participação > 0; all = todos."""
    if sharing == "own":
        return query.filter(CreditCardInvoice.ownership_percentage == 100)
    if sharing == "mine":
        return query.filter(CreditCardInvoice.ownership_percentage > 0)
    return query


def _sharing_matches(pct: Decimal, sharing: str) -> bool:
    """own = participação 100%; mine = participação > 0; all = todos."""
    if sharing == "own":
        return pct == 100
    if sharing == "mine":
        return pct > 0
    return True


def _card_invoice_totals(
    db: Session, tenant_id: int, card: Cartao, invoice_ym: str, sharing: str
) -> tuple[Decimal, Decimal] | None:
    """(total, minha parte) lançados na fatura `invoice_ym` do cartão; None se não há valor.

    `sharing` filtra os itens considerados (ver `_apply_sharing`).
    """
    query = db.query(
        func.count(CreditCardInvoice.id),
        func.coalesce(func.sum(-CreditCardInvoice.amount), 0),
        func.coalesce(func.sum(-CreditCardInvoice.amount * CreditCardInvoice.ownership_percentage / 100), 0),
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        CreditCardInvoice.credit_card_id == card.id,
        CreditCardInvoice.year_month == invoice_ym,
    )
    query = _apply_sharing(query, sharing)
    count, total, mine = query.one()
    if not count or (Decimal(total) <= 0 and Decimal(mine) <= 0):
        return None
    return max(Decimal(total), Decimal(0)), max(Decimal(mine), Decimal(0))


def _card_invoice_line_breakdown(
    db: Session, tenant_id: int, card: Cartao, invoice_ym: str, sharing: str,
) -> list[dict]:
    """Linhas da fatura `invoice_ym` do cartão, respeitando o filtro de compartilhamento."""
    rows = (
        db.query(CreditCardInvoice)
        .filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.credit_card_id == card.id,
            CreditCardInvoice.year_month == invoice_ym,
        )
        .order_by(CreditCardInvoice.date, CreditCardInvoice.id)
        .all()
    )
    breakdown: list[dict] = []
    for inv in rows:
        pct = Decimal(inv.ownership_percentage if inv.ownership_percentage is not None else 100)
        if not _sharing_matches(pct, sharing):
            continue
        amount = abs(_money(inv.amount))
        mine = _money(amount * pct / 100)
        line_date = inv.date.isoformat() if inv.date else None
        breakdown.append({
            "card_id": card.id,
            "card_name": card.name,
            "card_number": card.number,
            "description": (inv.description or "").strip() or "—",
            "date": line_date,
            "amount": str(amount),
            "my_amount": str(mine),
        })
    return breakdown


def invoice_preview_for_month(
    db: Session, tenant_id: int, account_id: int, year_month: str, card_ids: list[int], sharing: str,
) -> list[dict]:
    """Prévia da fatura atual de cada cartão para o mês de projeção (sem recorrer ao mês anterior)."""
    cards = (
        db.query(Cartao)
        .options(joinedload(Cartao.invoice_group))
        .filter(
            Cartao.tenant_id == tenant_id,
            Cartao.account_id == account_id,
            Cartao.type == "credito",
            Cartao.id.in_(card_ids),
        )
        .all()
    )
    cards.sort(key=lambda c: (c.name or "", c.number or ""))
    out: list[dict] = []
    for card in cards:
        closing, due = _closing_due(card)
        inv_ym = _invoice_ym(year_month, closing, due)
        totals = _card_invoice_totals(db, tenant_id, card, inv_ym, sharing)
        out.append({
            "card_id": card.id,
            "card_name": card.name or "",
            "card_number": card.number or "",
            "invoice_year_month": inv_ym,
            "due_day": due,
            "has_invoice": totals is not None,
            "amount": _money(totals[0]) if totals else Decimal(0),
            "my_amount": _money(totals[1]) if totals else Decimal(0),
        })
    return out


LATE_FINAL_PAYMENT_DAY = 25


def _is_late_final(p: Payslip) -> bool:
    """Holerite de fim de mês pago no fim do mês: na projeção entra no dia 1 do mês seguinte."""
    return bool(p.payslip_kind == "final" and p.payment_date and p.payment_date.day >= LATE_FINAL_PAYMENT_DAY)


def _payslip_day(p: Payslip) -> int | None:
    if not p.payment_date:
        return None
    return 1 if _is_late_final(p) else p.payment_date.day


def _payslip_ym(p: Payslip) -> str | None:
    if p.payment_date:
        ym = f"{p.payment_date.year:04d}-{p.payment_date.month:02d}"
        return next_year_month(ym) if _is_late_final(p) else ym
    if p.year and p.month:
        return f"{p.year:04d}-{p.month:02d}"
    return None


FINAL_COMPETENCE_PAYSLIP_KINDS = ("final", "regular")


def _final_competence_payslips(
    db: Session,
    tenant_id: int,
    account_id: int,
    projection_year_month: str,
) -> list[Payslip]:
    """Holerite de fim de mês pela competência (mês anterior ao calendário projetado)."""
    prev = prev_year_month(projection_year_month)
    y, m = int(prev[:4]), int(prev[5:7])
    return (
        db.query(Payslip)
        .filter(
            Payslip.tenant_id == tenant_id,
            Payslip.account_id == account_id,
            Payslip.active.is_(True),
            Payslip.year == y,
            Payslip.month == m,
            Payslip.payslip_kind.in_(FINAL_COMPETENCE_PAYSLIP_KINDS),
            Payslip.net_amount.isnot(None),
        )
        .all()
    )


def _final_projection_day_from_payslips(slips: list[Payslip]) -> int:
    dated = [p for p in slips if p.payment_date]
    if dated:
        return max(_payslip_day(p) for p in dated)
    return 1


def income_projections(
    db: Session,
    tenant_id: int,
    account_id: int,
    year_month: str,
    *,
    advance_on_day_15: bool = True,
) -> list[dict]:
    """Entradas de holerite (adiantamento e fim do mês) do mês.

    Fim do mês no calendário M: prioriza holerite com competência M-1 (``year``/``month``),
    independente da data de pagamento no extrato. Sem holerite, média dos últimos 6 meses
    (estimativa). Adiantamento segue a data de pagamento no calendário M.
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
        if kind == "final":
            competence = _final_competence_payslips(db, tenant_id, account_id, year_month)
            if competence:
                amount = sum((_money(p.net_amount) for p in competence), Decimal(0))
                if amount > 0:
                    day = _final_projection_day_from_payslips(competence)
                    out.append({
                        "description": label,
                        "amount": amount,
                        "expected_date": _clamped_date(year_month, day),
                    })
                continue
        of_kind = [(p, _payslip_ym(p)) for p in payslips if p.payslip_kind == kind]
        current = [p for p, y in of_kind if y == year_month]
        if current:
            amount = sum((_money(p.net_amount) for p in current), Decimal(0))
            day = max((_payslip_day(p) for p in current if p.payment_date), default=None)
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
            day = _payslip_day(max(dated, key=lambda p: p.payment_date)) if dated else None
            actual = False
        if amount <= 0:
            continue
        if day is None:
            day = 5 if kind == "final" else 20
        if kind == "advance" and advance_on_day_15:
            day = ADVANCE_PROJECTION_DAY
        out.append({
            "description": label if actual else f"{label} (estimativa)", "amount": amount,
            "expected_date": _clamped_date(year_month, day),
        })
    return out


def _deactivate(db: Session, tenant_id: int, account_id: int, year_month: str, income: bool) -> None:
    """Desativa só as projeções geradas automaticamente do mês: holerite (receitas) ou
    cartão (despesas). Itens manuais e clonados são preservados."""
    kind_filter = MonthlyProjection.kind == "income" if income else MonthlyProjection.kind != "income"
    sources = ("payroll",) if income else CARD_SOURCES
    db.query(MonthlyProjection).filter(
        MonthlyProjection.tenant_id == tenant_id,
        MonthlyProjection.account_id == account_id,
        MonthlyProjection.year_month == year_month,
        kind_filter,
        MonthlyProjection.source.in_(sources),
        MonthlyProjection.active.is_(True),
    ).update({"active": False}, synchronize_session=False)


def launch_income_projections(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    year_month: str,
    periods: int = 1,
    *,
    advance_on_day_15: bool = True,
) -> int:
    """Apaga as receitas geradas (holerite) do mês e as refaz, e o mesmo nos `periods - 1`
    meses seguintes. Retorna a quantidade criada."""
    created = 0
    ym = year_month
    for step in range(max(periods, 1)):
        if step:
            ym = next_year_month(ym)
        _deactivate(db, tenant_id, account_id, ym, income=True)
        for proj in income_projections(
            db, tenant_id, account_id, ym, advance_on_day_15=advance_on_day_15,
        ):
            db.add(MonthlyProjection(
                tenant_id=tenant_id, account_id=account_id, created_by=user_id,
                year_month=ym, kind="income", source="payroll", is_automatic=True,
                description=proj["description"], expected_date=proj["expected_date"],
                amount=proj["amount"], my_amount=proj["amount"],
            ))
            created += 1
    db.commit()
    logger.info("Projeção de entradas lançada: %s (%s, %s período(s), conta %s)", created, year_month, periods, account_id)
    return created


def _months_between(start_ym: str, end_ym: str) -> int:
    return (int(end_ym[:4]) * 12 + int(end_ym[5:7])) - (int(start_ym[:4]) * 12 + int(start_ym[5:7]))


def installments_for_month(
    db: Session, tenant_id: int, account_id: int, year_month: str, card_ids: list[int],
    sharing: str = "all",
) -> list[dict]:
    """Parcelas em aberto que vencem na fatura paga em `year_month` (saldo parcelado).

    `sharing` filtra pela participação do item (own/mine/all), como nas faturas.
    """
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
                if not _sharing_matches(pct, sharing):
                    continue
                line_date = r.date.isoformat() if r.date else None
                out.append({
                    "card_id": card.id, "card_name": card.name, "card_number": card.number,
                    "description": r.description, "installment": r.current_installment,
                    "total_installments": r.total_installments,
                    "amount": amount, "my_amount": _money(amount * pct / 100),
                    "expected_date": _clamped_date(year_month, due),
                    "date": line_date,
                })
            continue
        for p in get_open_installment_purchases(db, tenant_id, account_id, card_id=card.id):
            offset = _months_between(p.last_year_month, inv_ym)
            if not 1 <= offset <= p.remaining_installments:
                continue
            if not _sharing_matches(Decimal(p.ownership_percentage), sharing):
                continue
            line_date = p.purchase_date.isoformat() if p.purchase_date else None
            out.append({
                "card_id": card.id, "card_name": card.name, "card_number": card.number,
                "description": p.description, "installment": p.current_installment + offset,
                "total_installments": p.total_installments,
                "amount": _money(p.installment_amount), "my_amount": _money(p.my_installment_amount),
                "expected_date": _clamped_date(year_month, due),
                "date": line_date,
            })
    out.sort(key=lambda r: (r["card_name"] or "", r["description"]))
    return out


def _replace_installments(
    db: Session, tenant_id: int, account_id: int, user_id: int, year_month: str,
    card_ids: list[int], sharing: str, include_future: bool = False,
) -> int:
    """Refaz as parcelas (source card_item_installment) de `year_month` e, com `include_future`,
    dos meses seguintes enquanto ainda houver parcelas (até MAX_INSTALLMENT_MONTHS).

    Desativa antes só as parcelas do mês; itens manuais e demais origens ficam. Não faz commit.
    O compartilhamento fica gravado na linha para o clonar recalcular com a mesma regra.
    """
    own_only = sharing != "all"
    created = 0
    ym = year_month
    for step in range(MAX_INSTALLMENT_MONTHS + 1 if include_future else 1):
        if step:
            ym = next_year_month(ym)
        rows = installments_for_month(db, tenant_id, account_id, ym, card_ids, sharing)
        db.query(MonthlyProjection).filter(
            MonthlyProjection.tenant_id == tenant_id,
            MonthlyProjection.account_id == account_id,
            MonthlyProjection.year_month == ym,
            MonthlyProjection.source == INSTALLMENT_SOURCE,
            MonthlyProjection.credit_card_id.in_(card_ids),
            MonthlyProjection.active.is_(True),
        ).update({"active": False}, synchronize_session=False)
        if not rows and step:
            break
        by_card: dict[int, list[dict]] = defaultdict(list)
        for inst in rows:
            by_card[inst["card_id"]].append(inst)
        card_by_id = {c.id: c for c in db.query(Cartao).filter(Cartao.id.in_(by_card)).all()}
        for card_id, insts in by_card.items():
            card = card_by_id.get(card_id)
            if not card:
                continue
            total = sum((_money(i["amount"]) for i in insts), Decimal(0))
            mine = sum((_money(i["my_amount"]) for i in insts), Decimal(0))
            breakdown = [
                {
                    "card_id": card_id,
                    "card_name": card.name,
                    "card_number": card.number,
                    "description": f"{i['description']} ({i['installment']}/{i['total_installments']})",
                    "date": i.get("date") or str(i["expected_date"]),
                    "amount": str(_money(i["amount"])),
                    "my_amount": str(_money(i["my_amount"])),
                }
                for i in insts
            ]
            db.add(MonthlyProjection(
                tenant_id=tenant_id, account_id=account_id, created_by=user_id, year_month=ym,
                kind="fixed", source=INSTALLMENT_SOURCE, is_automatic=True, credit_card_id=card_id,
                description=f"Parcelas {card.name} •{card.number}"[:255],
                expected_date=insts[0]["expected_date"],
                amount=_money(mine if own_only else total),
                my_amount=_money(mine),
                breakdown=breakdown,
                sharing=sharing,
            ))
            created += 1
    return created


def launch_card_projections(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    year_month: str,
    card_ids: list[int],
    mode: str,
    sharing: str = "mine",
) -> int:
    """Substitui despesas automáticas do mês por projeção de cartão (um lançamento por cartão).

    - mode ``invoice``: fatura importada do ciclo atual (sem usar mês anterior).
    - mode ``installments``: soma das parcelas em aberto do mês (estimativa).
    """
    if sharing not in LAUNCH_SHARING_MODES:
        raise ValueError("Compartilhamento inválido")
    if mode not in ("invoice", "installments"):
        raise ValueError("Modo de lançamento inválido")
    cards = (
        db.query(Cartao)
        .options(joinedload(Cartao.invoice_group))
        .filter(
            Cartao.tenant_id == tenant_id,
            Cartao.account_id == account_id,
            Cartao.type == "credito",
            Cartao.id.in_(card_ids),
        )
        .all()
    )
    if not cards:
        raise ValueError("Selecione ao menos um cartão")

    if mode == "invoice":
        missing: list[str] = []
        pending: list[tuple[Cartao, int, list[dict]]] = []
        for card in cards:
            closing, due = _closing_due(card)
            inv_ym = _invoice_ym(year_month, closing, due)
            breakdown = _card_invoice_line_breakdown(db, tenant_id, card, inv_ym, sharing)
            if not breakdown:
                missing.append(f"{card.name} •{card.number}")
                continue
            pending.append((card, due, breakdown))
        if missing:
            raise ValueError(
                "Não há fatura importada para: "
                + ", ".join(missing)
                + ". Importe a fatura ou use Estimativa (parcelas em aberto)."
            )
        if not pending:
            raise ValueError("Nenhum cartão selecionado possui fatura importada para este mês.")
    else:
        rows = installments_for_month(db, tenant_id, account_id, year_month, card_ids, sharing)
        by_card: dict[int, list[dict]] = defaultdict(list)
        for row in rows:
            by_card[row["card_id"]].append(row)
        missing = [f"{c.name} •{c.number}" for c in cards if c.id not in by_card]
        if missing:
            raise ValueError(
                "Nenhuma parcela em aberto neste mês para: "
                + ", ".join(missing)
                + ". Use Fatura atual se a fatura já foi importada."
            )

    _deactivate(db, tenant_id, account_id, year_month, income=False)
    created = 0

    def _add(**kwargs) -> None:
        nonlocal created
        db.add(MonthlyProjection(
            tenant_id=tenant_id,
            account_id=account_id,
            created_by=user_id,
            year_month=year_month,
            is_automatic=True,
            **kwargs,
        ))
        created += 1

    if mode == "invoice":
        for card, due, breakdown in pending:
            mine = sum((Decimal(b["my_amount"]) for b in breakdown), Decimal(0))
            _add(
                kind="variable",
                source="card_invoice",
                credit_card_id=card.id,
                description=f"Fatura {card.name} •{card.number}",
                expected_date=_clamped_date(year_month, due),
                amount=_money(mine),
                my_amount=_money(mine),
                breakdown=breakdown,
                sharing=sharing,
            )
    else:
        created = _replace_installments(
            db, tenant_id, account_id, user_id, year_month, card_ids, sharing, include_future=True,
        )

    db.commit()
    logger.info("Projeção de cartões lançada: %s (%s, conta %s)", created, year_month, account_id)
    return created


def _month_bounds(year_month: str) -> tuple[date, date]:
    year, month = int(year_month[:4]), int(year_month[5:7])
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def _statement_day(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    return value


def _is_final_payroll_projection_label(description: str) -> bool:
    """Rótulo de holerite 'fim do mês' projetado no dia 1 (com ou sem estimativa)."""
    desc = (description or "").strip()
    base = INCOME_KINDS["final"]
    return desc == base or desc.startswith(f"{base} ")


def _is_advance_payroll_projection_label(description: str) -> bool:
    desc = (description or "").strip()
    base = INCOME_KINDS["advance"]
    return desc == base or desc.startswith(f"{base} ")


def _as_of_for_projection_month(year_month: str, as_of: date | None) -> date:
    """Data da atualização, limitada ao último dia do mês projetado."""
    _, end_exclusive = _month_bounds(year_month)
    last_day = end_exclusive - timedelta(days=1)
    today = as_of or date.today()
    return min(today, last_day)


def _statement_launch_from_day(year_month: str, as_of_day: date) -> int:
    """1ª quinzena do mês de referência → dia 1; a partir do dia 16 → só 2ª quinzena."""
    return 1 if as_of_day.day < SECOND_HALF_STMT_FROM_DAY else SECOND_HALF_STMT_FROM_DAY


def _needs_stmt_import_from_day_one(
    db: Session,
    tenant_id: int,
    account_id: int,
    year_month: str,
    before_date: date,
) -> bool:
    """2ª quinzena automática: sobe mês desde o dia 1 se ainda não há Conta na 1ª quinzena."""
    early = (
        db.query(MonthlyProjection)
        .filter(
            MonthlyProjection.tenant_id == tenant_id,
            MonthlyProjection.account_id == account_id,
            MonthlyProjection.year_month == year_month,
            MonthlyProjection.source == BANK_STATEMENT_SOURCE,
            MonthlyProjection.expected_date < before_date,
        )
        .all()
    )
    if not early:
        return True
    non_opening = [
        r for r in early
        if (r.description or "").strip() != OPENING_BALANCE_DESCRIPTION
    ]
    return not non_opening


def _payroll_search_window_final_on_day1(year_month: str, as_of: date) -> tuple[date, date]:
    """Fim do mês (projetado no dia 1): dia 21 do mês anterior → min(hoje, dia 10 do mês)."""
    start, _ = _month_bounds(year_month)
    prev = prev_year_month(year_month)
    py, pm = int(prev[:4]), int(prev[5:7])
    range_start = date(py, pm, FINAL_PAYROLL_EXTRATO_FROM_DAY_PREV_MONTH)
    cap_day = date(start.year, start.month, FINAL_ON_DAY1_EXTRATO_UNTIL_DAY)
    range_end = min(as_of, cap_day)
    return range_start, range_end


def _payroll_search_window_advance(year_month: str, as_of: date) -> tuple[date, date]:
    """Adiantamento (e folha final fora do dia 1 na 2ª quinzena): dia 11 do mês → hoje."""
    start, _ = _month_bounds(year_month)
    return date(start.year, start.month, ADVANCE_PAYROLL_EXTRATO_FROM_DAY), as_of


def _day1_final_payroll_rows(
    db: Session,
    tenant_id: int,
    account_id: int,
    year_month: str,
    month_start: date,
) -> list[MonthlyProjection]:
    rows = db.query(MonthlyProjection).filter(
        MonthlyProjection.tenant_id == tenant_id,
        MonthlyProjection.account_id == account_id,
        MonthlyProjection.year_month == year_month,
        MonthlyProjection.expected_date == month_start,
        MonthlyProjection.kind == "income",
        MonthlyProjection.source == "payroll",
        MonthlyProjection.is_automatic.is_(True),
    ).all()
    return [r for r in rows if _is_final_payroll_projection_label(r.description or "")]


def _advance_payroll_rows(
    db: Session,
    tenant_id: int,
    account_id: int,
    year_month: str,
) -> list[MonthlyProjection]:
    rows = db.query(MonthlyProjection).filter(
        MonthlyProjection.tenant_id == tenant_id,
        MonthlyProjection.account_id == account_id,
        MonthlyProjection.year_month == year_month,
        MonthlyProjection.kind == "income",
        MonthlyProjection.source == "payroll",
        MonthlyProjection.is_automatic.is_(True),
    ).all()
    return [r for r in rows if _is_advance_payroll_projection_label(r.description or "")]


@dataclass(frozen=True)
class PayrollConfirmationItem:
    description: str
    amount: Decimal
    expected_day: int
    matched_in_extrato: bool


@dataclass
class StatementLaunchResult:
    created: int
    payroll_confirmation: list[PayrollConfirmationItem] | None = None


def _second_half_final_payroll_rows(
    db: Session,
    tenant_id: int,
    account_id: int,
    year_month: str,
    from_day: int,
) -> list[MonthlyProjection]:
    start, _ = _month_bounds(year_month)
    y, m = start.year, start.month
    last_dom = calendar.monthrange(y, m)[1]
    clamped = max(1, min(from_day, last_dom))
    second_start = date(y, m, clamped)
    rows = db.query(MonthlyProjection).filter(
        MonthlyProjection.tenant_id == tenant_id,
        MonthlyProjection.account_id == account_id,
        MonthlyProjection.year_month == year_month,
        MonthlyProjection.kind == "income",
        MonthlyProjection.source == "payroll",
        MonthlyProjection.is_automatic.is_(True),
        MonthlyProjection.expected_date >= second_start,
    ).all()
    return [r for r in rows if _is_final_payroll_projection_label(r.description or "")]


def _payroll_match_targets(
    proj: MonthlyProjection,
    db: Session,
    tenant_id: int,
    account_id: int,
) -> set[Decimal]:
    targets = {_money(proj.amount), _money(proj.my_amount)}
    if not _is_final_payroll_projection_label(proj.description or ""):
        return targets
    month_start, _ = _month_bounds(proj.year_month)
    if proj.expected_date != month_start:
        return targets
    for slip in _final_competence_payslips(db, tenant_id, account_id, proj.year_month):
        targets.add(_money(slip.net_amount))
    return targets


def _bank_statement_credit_amounts(row: BankStatement) -> list[Decimal]:
    """Valores de crédito comparáveis ao holerite (cheio e parte ``ownership``)."""
    raw = _money(row.amount)
    if raw == 0:
        return []
    credit = raw if raw > 0 else -raw
    pct = Decimal(str(row.ownership_percentage if row.ownership_percentage is not None else 100))
    mine = _money(credit * pct / Decimal(100))
    if mine == credit:
        return [credit]
    return [credit, mine]


def _extrato_has_payroll_match_in_window(
    db: Session,
    tenant_id: int,
    account_id: int,
    range_start: date,
    range_end_inclusive: date,
    proj: MonthlyProjection,
) -> bool:
    if range_start > range_end_inclusive:
        return False
    targets = _payroll_match_targets(proj, db, tenant_id, account_id)
    stmt_day = func.date(BankStatement.date)
    rows = (
        db.query(BankStatement)
        .filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            stmt_day >= range_start,
            stmt_day <= range_end_inclusive,
        )
        .all()
    )
    for row in rows:
        for candidate in _bank_statement_credit_amounts(row):
            if candidate in targets:
                return True
    return False


def _resolve_payroll_removals(
    payroll_rows: list[MonthlyProjection],
    db: Session,
    tenant_id: int,
    account_id: int,
    range_start: date,
    range_end_inclusive: date,
    payroll_reconcile: PayrollReconcileChoice | None,
) -> tuple[list[MonthlyProjection], list[PayrollConfirmationItem] | None]:
    if not payroll_rows:
        return [], None

    to_remove: list[MonthlyProjection] = []
    need_confirm: list[PayrollConfirmationItem] = []
    for proj in payroll_rows:
        if payroll_reconcile == "clear":
            to_remove.append(proj)
            continue
        if payroll_reconcile == "keep":
            continue
        matched = _extrato_has_payroll_match_in_window(
            db, tenant_id, account_id, range_start, range_end_inclusive, proj,
        )
        if matched:
            to_remove.append(proj)
            continue
        need_confirm.append(PayrollConfirmationItem(
            description=(proj.description or "").strip(),
            amount=_money(proj.amount),
            expected_day=proj.expected_date.day,
            matched_in_extrato=False,
        ))

    if need_confirm:
        return to_remove, need_confirm
    return to_remove, None


def launch_statement_projections(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    year_month: str,
    *,
    from_day: int | None = None,
    payroll_reconcile: PayrollReconcileChoice | None = None,
    as_of: date | None = None,
) -> StatementLaunchResult:
    """Apaga os lançamentos de extrato e recria a partir de bank_statements até ``as_of`` (hoje).

    Se ``from_day`` for omitido, usa a data de atualização: antes do dia 16 → mês desde o dia 1
    (saldo + folha do início); dia 16+ → só da 2ª quinzena, com reconciliação da folha.
    """
    start, end = _month_bounds(year_month)
    y, m = start.year, start.month
    last_dom = calendar.monthrange(y, m)[1]
    as_of_day = _as_of_for_projection_month(year_month, as_of)
    resolved_from = from_day if from_day is not None else _statement_launch_from_day(year_month, as_of_day)
    stmt_from_day = max(1, min(resolved_from, last_dom))
    stmt_from = date(y, m, stmt_from_day)
    if from_day is None and stmt_from_day > 1 and _needs_stmt_import_from_day_one(
        db, tenant_id, account_id, year_month, stmt_from,
    ):
        logger.info(
            "Extrato %s conta %s: 1ª quinzena sem Conta — importando desde o dia 1 até %s",
            year_month,
            account_id,
            as_of_day.isoformat(),
        )
        stmt_from_day = 1
        stmt_from = start
    full_month = stmt_from_day <= 1
    import_end_exclusive = min(end, as_of_day + timedelta(days=1))

    payroll_remove: list[MonthlyProjection] = []

    def _payroll_reconcile_step(
        rows: list[MonthlyProjection],
        range_start: date,
        range_end_inclusive: date,
    ) -> StatementLaunchResult | None:
        if not rows or range_start > range_end_inclusive:
            return None
        removed, payroll_confirm = _resolve_payroll_removals(
            rows, db, tenant_id, account_id, range_start, range_end_inclusive, payroll_reconcile,
        )
        if payroll_confirm:
            for proj in removed:
                db.delete(proj)
            db.commit()
            return StatementLaunchResult(created=0, payroll_confirmation=payroll_confirm)
        payroll_remove.extend(removed)
        return None

    final_d1_win = _payroll_search_window_final_on_day1(year_month, as_of_day)
    early = _payroll_reconcile_step(
        _day1_final_payroll_rows(db, tenant_id, account_id, year_month, start),
        final_d1_win[0],
        final_d1_win[1],
    )
    if early:
        return early

    adv_win = _payroll_search_window_advance(year_month, as_of_day)
    early = _payroll_reconcile_step(
        _advance_payroll_rows(db, tenant_id, account_id, year_month),
        adv_win[0],
        adv_win[1],
    )
    if early:
        return early

    if not full_month:
        early = _payroll_reconcile_step(
            _second_half_final_payroll_rows(db, tenant_id, account_id, year_month, stmt_from_day),
            adv_win[0],
            adv_win[1],
        )
        if early:
            return early

    stmt_delete = db.query(MonthlyProjection).filter(
        MonthlyProjection.tenant_id == tenant_id,
        MonthlyProjection.account_id == account_id,
        MonthlyProjection.year_month == year_month,
        MonthlyProjection.source == BANK_STATEMENT_SOURCE,
    )
    if full_month:
        stmt_delete.delete(synchronize_session=False)
    else:
        stmt_delete.filter(MonthlyProjection.expected_date >= stmt_from).delete(synchronize_session=False)

    for proj in payroll_remove:
        db.delete(proj)

    opening = Decimal(0)
    if full_month:
        opening_raw = compute_opening_balance_calendar(
            db,
            tenant_id,
            ["bank"],
            start,
            account_ids=[account_id],
            tag_ids=None,
            subtag_ids=None,
            partner_id_list=None,
            include_empty_tag=False,
            include_empty_sharing=False,
            origin_list=None,
            card_ids=None,
        )
        opening = _money(Decimal(str(opening_raw)))

    stmt_calendar_day = func.date(BankStatement.date)
    rows = (
        db.query(BankStatement)
        .filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            stmt_calendar_day >= stmt_from,
            stmt_calendar_day < import_end_exclusive,
        )
        .order_by(BankStatement.date, BankStatement.id)
        .all()
    )
    created = 0
    if full_month and opening != 0:
        db.add(MonthlyProjection(
            tenant_id=tenant_id,
            account_id=account_id,
            created_by=user_id,
            year_month=year_month,
            kind="income" if opening > 0 else "variable",
            source=BANK_STATEMENT_SOURCE,
            is_automatic=True,
            description=OPENING_BALANCE_DESCRIPTION,
            expected_date=start,
            amount=abs(opening),
            my_amount=abs(opening),
        ))
        created += 1

    for row in rows:
        amount = _money(row.amount)
        if amount == 0:
            continue
        income = amount > 0
        description = (row.description or "").strip()[:255] or "Extrato"
        db.add(MonthlyProjection(
            tenant_id=tenant_id,
            account_id=account_id,
            created_by=user_id,
            year_month=year_month,
            kind="income" if income else "variable",
            source=BANK_STATEMENT_SOURCE,
            is_automatic=True,
            source_table="bank_statements",
            source_id=row.id,
            description=description,
            expected_date=_statement_day(row.date),
            amount=abs(amount),
            my_amount=abs(amount),
        ))
        created += 1
    db.commit()
    logger.info(
        "Projeção de extrato lançada: %s (%s, conta %s, from_day=%s)",
        created,
        year_month,
        account_id,
        stmt_from_day,
    )
    return StatementLaunchResult(created=created)


def clone_to_next_month(
    db: Session, tenant_id: int, account_id: int, user_id: int, source_ym: str, months: int = 1,
    include_cards: bool = True,
) -> tuple[str, int]:
    """Copia os itens ativos para os `months` meses seguintes. Dia inexistente -> último dia.

    Lançamentos de extrato (`bank_statement`) não entram: o mês seguinte recebe o extrato
    pela atualização própria.

    Faz upsert nos meses de destino: o item que já existe igual (mesma descrição, mesmo dia do
    mês e mesma direção: receita ou despesa) é atualizado; o que não existe é criado. Itens só do destino são mantidos.

    Retorna (primeiro mês de destino, total de itens criados ou atualizados).
    """
    base = db.query(MonthlyProjection).filter(
        MonthlyProjection.tenant_id == tenant_id,
        MonthlyProjection.account_id == account_id,
        MonthlyProjection.active.is_(True),
    )
    targets: list[str] = []
    ym = source_ym
    for _ in range(max(months, 1)):
        ym = next_year_month(ym)
        targets.append(ym)
    items = base.filter(MonthlyProjection.year_month == source_ym).all()
    if not include_cards:
        items = [i for i in items if i.source not in CARD_SOURCES]
    # Extrato não é plano do mês seguinte: cada mês vem de uma atualização própria.
    items = [i for i in items if i.source != BANK_STATEMENT_SOURCE]
    # Parcelas não são copiadas: são recalculadas em cada mês de destino (abaixo).
    installment_cards: dict[str, set[int]] = defaultdict(set)
    for i in items:
        if i.source == INSTALLMENT_SOURCE and i.credit_card_id:
            installment_cards[i.sharing or "all"].add(i.credit_card_id)
    items = [i for i in items if i.source != INSTALLMENT_SOURCE]
    recalculated = 0

    def _key(description: str, expected: date, kind: str) -> tuple:
        # Direção: receita (kind "income") ou despesa (fixed/variable).
        return (description, expected.day, kind == "income")

    # Copia exatamente os valores gravados na geração, sem recalcular nem consultar faturas.
    for target_ym in targets:
        existing: dict[tuple, list[MonthlyProjection]] = defaultdict(list)
        target_rows = base.filter(
            MonthlyProjection.year_month == target_ym,
            MonthlyProjection.source != INSTALLMENT_SOURCE,
            MonthlyProjection.source != BANK_STATEMENT_SOURCE,
        )
        for row in target_rows.order_by(MonthlyProjection.id):
            existing[_key(row.description, row.expected_date, row.kind)].append(row)
        for item in items:
            target_date = _clamped_date(target_ym, item.expected_date.day)
            values = dict(
                expected_date=target_date,
                amount=item.amount, my_amount=item.my_amount,
                kind=item.kind, source=item.source, is_automatic=bool(item.is_automatic),
                credit_card_id=item.credit_card_id,
                invoice_group_id=item.invoice_group_id,
                breakdown=item.breakdown, sharing=item.sharing,
            )
            matches = existing.get(_key(item.description, target_date, item.kind))
            if matches:
                row = matches.pop(0)
                for field, value in values.items():
                    setattr(row, field, value)
                continue
            db.add(MonthlyProjection(
                tenant_id=tenant_id, account_id=account_id, created_by=user_id,
                year_month=target_ym, description=item.description, **values,
            ))
        for sharing, card_ids in installment_cards.items():
            recalculated += _replace_installments(
                db, tenant_id, account_id, user_id, target_ym, sorted(card_ids), sharing,
            )
    db.commit()
    return targets[0], len(items) * len(targets) + recalculated


CLEAR_SOURCES = {
    "manual": ("manual", "clone"),
    "account": (BANK_STATEMENT_SOURCE,),
    "card": CARD_SOURCES,
}


def clear_month(db: Session, tenant_id: int, account_id: int, year_month: str, scope: str = "all") -> int:
    """Exclui definitivamente (hard delete) os itens do mês no escopo pedido.

    ``manual``: digitados. ``account``: extrato. ``card``: fatura e parcelas.
    ``all``: o mês inteiro, inclusive folha. Retorna a quantidade.
    """
    if scope != "all" and scope not in CLEAR_SOURCES:
        raise ValueError("Escopo de limpeza inválido")
    query = db.query(MonthlyProjection).filter(
        MonthlyProjection.tenant_id == tenant_id,
        MonthlyProjection.account_id == account_id,
        MonthlyProjection.year_month == year_month,
    )
    if scope != "all":
        query = query.filter(MonthlyProjection.source.in_(CLEAR_SOURCES[scope]))
    deleted = query.delete(synchronize_session=False)
    db.commit()
    return deleted
