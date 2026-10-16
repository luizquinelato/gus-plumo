"""Projeção mensal: lançamento de entradas (holerites) e cartões (faturas) e clonagem de mês."""

from __future__ import annotations

import calendar
import logging
from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

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



SHARING_MODES = ("own", "mine", "all")


def _apply_sharing(query, sharing: str):
    """Filtra os itens de fatura: own = participação 100%; mine = participação > 0; all = todos."""
    if sharing == "own":
        return query.filter(CreditCardInvoice.ownership_percentage == 100)
    if sharing == "mine":
        return query.filter(CreditCardInvoice.ownership_percentage > 0)
    return query


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


def _projection_source(db: Session, tenant_id: int, cards: list[Cartao], year_month: str, sharing: str) -> str:
    """Fonte única da "fatura atual" para toda a seleção: 'current', 'previous' ou 'none'.

    Usa a fatura do mês se ao menos um cartão tiver itens nela (os demais ficam sem linha);
    só se nenhum tiver, olha a fatura do mês anterior; se também não houver, não projeta.
    """
    for source, step in (("current", 0), ("previous", 1)):
        for card in cards:
            closing, due = _closing_due(card)
            ym = _invoice_ym(year_month, closing, due)
            if step:
                ym = prev_year_month(ym)
            if _card_invoice_totals(db, tenant_id, card, ym, sharing):
                return source
    return "none"


def _card_projection_base(
    db: Session, tenant_id: int, card: Cartao, invoice_ym: str, today: date, history: int,
    sharing: str, source: str,
) -> tuple[Decimal, Decimal] | None:
    """Base da projeção automática do cartão conforme a fonte escolhida para a seleção."""
    if source == "average":
        return _card_averages(db, tenant_id, card, invoice_ym, today, history)
    if source == "none":
        return None
    ym = invoice_ym if source == "current" else prev_year_month(invoice_ym)
    return _card_invoice_totals(db, tenant_id, card, ym, sharing)


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
        out.append({
            "description": label if actual else f"{label} (estimativa)", "amount": amount,
            "expected_date": _clamped_date(year_month, day),
        })
    return out


def _deactivate(db: Session, tenant_id: int, account_id: int, year_month: str, income: bool) -> None:
    """Desativa só as projeções geradas automaticamente do mês: holerite (receitas) ou
    cartão (despesas). Itens manuais e clonados são preservados."""
    kind_filter = MonthlyProjection.kind == "income" if income else MonthlyProjection.kind != "income"
    sources = ("payroll",) if income else ("card_invoice", "card_item")
    db.query(MonthlyProjection).filter(
        MonthlyProjection.tenant_id == tenant_id,
        MonthlyProjection.account_id == account_id,
        MonthlyProjection.year_month == year_month,
        kind_filter,
        MonthlyProjection.source.in_(sources),
        MonthlyProjection.active.is_(True),
    ).update({"active": False}, synchronize_session=False)


def launch_income_projections(
    db: Session, tenant_id: int, account_id: int, user_id: int, year_month: str
) -> int:
    """Apaga as receitas geradas (holerite) do mês e as refaz. Retorna a quantidade criada."""
    _deactivate(db, tenant_id, account_id, year_month, income=True)
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
    today: date | None = None, include_installments: bool = False, sharing: str = "all",
    basis: str = "average",
) -> int:
    """Apaga todas as despesas do mês (qualquer origem, inclusive manuais) e as refaz.

    - basis (com include_average): "current" usa a fatura atual (ou a do mês anterior, para a
      seleção toda); "average" usa a média dos últimos `history_months` meses.

    - sharing: "own" (itens 100% meus), "mine" (itens com alguma participação minha) ou "all"
      (todos). Em "own" e "mine", `amount` das linhas automáticas recebe só a minha parte
      (`my_amount`); em "all", o total. Fica gravado na linha para recalcular o valor real.

    - include_average: uma linha por cartão (ou grupo de faturas) com a média dos últimos
      `history_months` meses; não editável.
    - include_installments: uma linha por parcela em aberto que vence no mês; editável.
    - items: itens individuais (card_id, description, amount, kind); editáveis.
    """
    if sharing not in SHARING_MODES:
        raise ValueError("Compartilhamento inválido")
    own_only = sharing != "all"
    today = today or date.today()
    cards = (
        db.query(Cartao)
        .options(joinedload(Cartao.invoice_group))
        .filter(
            Cartao.tenant_id == tenant_id, Cartao.account_id == account_id,
            Cartao.type == "credito", Cartao.id.in_(card_ids),
        )
        .all()
    )
    if not cards:
        raise ValueError("Selecione ao menos um cartão")
    by_id = {c.id: c for c in cards}
    if any(item["card_id"] not in by_id for item in items):
        raise ValueError("Item individual com cartão não selecionado")

    _deactivate(db, tenant_id, account_id, year_month, income=False)
    created = 0

    def _add(**kwargs) -> None:
        nonlocal created
        db.add(MonthlyProjection(
            tenant_id=tenant_id, account_id=account_id, created_by=user_id,
            year_month=year_month, **kwargs,
        ))
        created += 1

    if include_average:
        source = "average" if basis == "average" else _projection_source(db, tenant_id, cards, year_month, sharing)
        grouped: dict[int, list[Cartao]] = defaultdict(list)
        for card in cards:
            if card.invoice_group_id:
                grouped[card.invoice_group_id].append(card)
                continue
            closing, due = _closing_due(card)
            avg = _card_projection_base(
                db, tenant_id, card, _invoice_ym(year_month, closing, due), today, history_months,
                sharing, source,
            )
            if avg:
                _add(
                    kind="variable", source="card_invoice", credit_card_id=card.id,
                    description=f"Fatura {card.name} •{card.number}",
                    expected_date=_clamped_date(year_month, due),
                    amount=_money(avg[1] if own_only else avg[0]), my_amount=_money(avg[1]),
                    sharing=sharing,
                )
        for group_id, members in grouped.items():
            group = members[0].invoice_group
            closing, due = _closing_due(members[0])
            inv_ym = _invoice_ym(year_month, closing, due)
            breakdown, total, mine = [], Decimal(0), Decimal(0)
            for card in members:
                avg = _card_projection_base(db, tenant_id, card, inv_ym, today, history_months, sharing, source)
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
                    amount=_money(mine if own_only else total), my_amount=_money(mine), breakdown=breakdown,
                    sharing=sharing,
                )

    if include_installments:
        for inst in installments_for_month(db, tenant_id, account_id, year_month, list(by_id)):
            _add(
                kind="fixed", source="card_item", credit_card_id=inst["card_id"],
                description=f"{inst['description']} ({inst['installment']}/{inst['total_installments']})"[:255],
                expected_date=inst["expected_date"],
                amount=inst["my_amount"] if own_only else inst["amount"], my_amount=inst["my_amount"],
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
    db: Session, tenant_id: int, account_id: int, user_id: int, source_ym: str, months: int = 1
) -> tuple[str, int]:
    """Copia todos os itens ativos (receitas e despesas, inclusive os gerados pela projeção, com
    cartão e detalhamento) para os `months` meses seguintes. Dia inexistente -> último dia.

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

    def _key(description: str, expected: date, kind: str) -> tuple:
        # Direção: receita (kind "income") ou despesa (fixed/variable).
        return (description, expected.day, kind == "income")

    # Copia exatamente os valores gravados na geração, sem recalcular nem consultar faturas.
    for target_ym in targets:
        existing: dict[tuple, list[MonthlyProjection]] = defaultdict(list)
        for row in base.filter(MonthlyProjection.year_month == target_ym).order_by(MonthlyProjection.id):
            existing[_key(row.description, row.expected_date, row.kind)].append(row)
        for item in items:
            target_date = _clamped_date(target_ym, item.expected_date.day)
            values = dict(
                expected_date=target_date,
                amount=item.amount, my_amount=item.my_amount,
                kind=item.kind, source=item.source, credit_card_id=item.credit_card_id,
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
    db.commit()
    return targets[0], len(items) * len(targets)


def clear_month(db: Session, tenant_id: int, account_id: int, year_month: str) -> int:
    """Exclui definitivamente (hard delete) todos os itens do mês. Retorna a quantidade."""
    deleted = db.query(MonthlyProjection).filter(
        MonthlyProjection.tenant_id == tenant_id,
        MonthlyProjection.account_id == account_id,
        MonthlyProjection.year_month == year_month,
    ).delete(synchronize_session=False)
    db.commit()
    return deleted
