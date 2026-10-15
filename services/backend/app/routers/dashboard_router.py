"""
Router para dashboard - totais e estatísticas
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, desc, case
from datetime import datetime, date
from decimal import Decimal
from typing import List, Optional, Dict, Tuple
from pydantic import BaseModel
from collections import defaultdict

from app.database import get_db
from app.models.unified_models import BankStatement, CreditCardInvoice, Cartao, BenefitCardStatement
from app.dependencies.auth import get_current_user
from app.services.installment_service import get_open_installment_purchases
from app.utils.card_helper import CardHelper

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


# Schemas
class MonthlyTotal(BaseModel):
    total: Decimal
    count: int

class CardTotal(BaseModel):
    card_number: str
    owner: str
    description: str | None
    total: Decimal
    count: int

class DashboardResponse(BaseModel):
    bank_statements_total: Decimal
    bank_statements_count: int
    credit_cards_total: Decimal
    credit_cards_count: int
    cards: List[CardTotal]


# Schemas para novo endpoint de resumo
class MonthSummary(BaseModel):
    year_month: str  # "YYYY-MM"
    month_label: str  # "Jan/2026"
    balance: Decimal  # Saldo (receitas - despesas)
    total_expenses: Decimal  # Total despesas
    total_revenue: Decimal  # Total receitas
    expenses_count: int
    revenue_count: int

class CardMonthData(BaseModel):
    """Dados de um cartão em um mês específico"""
    card_id: int
    card_number: str
    card_name: str
    card_type: str  # 'credito' ou 'beneficios'
    total: Decimal
    count: int

class InvoiceMonthSummary(BaseModel):
    """Resumo de faturas de um mês"""
    year_month: str  # "YYYY-MM"
    month_label: str  # "Jan/2026"
    total: Decimal
    count: int
    cards: List[CardMonthData]  # Breakdown por cartão

class CardRemainingBalance(BaseModel):
    """Saldo parcelado restante de um cartão"""
    card_id: int
    card_number: str
    card_name: str
    card_type: str
    remaining_total: Decimal
    remaining_count: int


class RemainingInstallmentsSummary(BaseModel):
    """Saldo parcelado restante (todas as compras em aberto)"""
    total: Decimal
    count: int
    cards: List[CardRemainingBalance]


class HomeDashboardResponse(BaseModel):
    """Sumário executivo da Home (extrato, cartão, benefícios)."""
    period_label: str
    year_month: str
    bank: "ExecutiveFlowBlock"
    benefit: "ExecutiveFlowBlock"
    credit_card: "CreditCardExecutiveBlock"


class ExecutiveFlowBlock(BaseModel):
    """Fluxo do período (extrato ou benefício)."""
    period_label: str
    year_month: str
    current_balance: Decimal | None = None  # Home extrato: saldo em conta (= opening + entradas - saídas)
    opening_balance: Decimal | None = None  # Soma do extrato até o último dia do mês anterior
    entries: Decimal
    exits: Decimal
    net: Decimal
    entries_count: int
    exits_count: int
    last_transaction_date: str | None = None


class CreditCardExecutiveBlock(BaseModel):
    last_invoice_year_month: str | None = None
    last_invoice_label: str | None = None
    last_invoice_total: Decimal
    last_invoice_count: int
    average_invoice_total: Decimal
    average_sample_months: int


class InvoiceDetailItem(BaseModel):
    id: int
    description: str
    amount: Decimal
    date: str
    current_installment: int | None = None
    total_installments: int | None = None
    card_id: int
    card_name: str
    card_number: str
    card_type: str
    remaining_installments: int | None = None
    remaining_total: Decimal | None = None


class InvoiceDetailsSection(BaseModel):
    key: str
    title: str
    total: Decimal
    count: int
    items: List[InvoiceDetailItem]
    next_month_total: Decimal | None = None


class InvoiceDetailsResponse(BaseModel):
    title: str
    sections: List[InvoiceDetailsSection]


class CurrentBalanceResponse(BaseModel):
    """Saldo atual da conta corrente"""
    current_balance: Decimal  # Saldo atual (soma de todos os lançamentos)
    total_credits: Decimal    # Total de entradas (valores positivos)
    total_debits: Decimal     # Total de saídas (valores negativos)
    credits_count: int        # Quantidade de entradas
    debits_count: int         # Quantidade de saídas
    last_transaction_date: str | None  # Data da última transação


def _sort_invoice_items_by_date_desc(items: List[InvoiceDetailItem]) -> List[InvoiceDetailItem]:
    return sorted(items, key=lambda x: (x.date or '', x.description or ''), reverse=True)


def _sort_card_ids_by_number(cards_map: Dict[int, List[InvoiceDetailItem]]) -> List[int]:
    """Ordena cartões pelo número (asc), não pelo nome."""
    return sorted(cards_map.keys(), key=lambda cid: cards_map[cid][0].card_number or '')


def _get_remaining_installment_items(
    db: Session,
    tenant_id: int,
    account_id: int,
    card_id: int | None = None,
) -> List[InvoiceDetailItem]:
    """Retorna compras parceladas em aberto (registro mais recente de cada compra)."""
    purchases = get_open_installment_purchases(db, tenant_id, account_id, card_id=card_id)

    return [
        InvoiceDetailItem(
            id=purchase.id,
            description=purchase.description,
            amount=purchase.amount,
            date=purchase.purchase_date.strftime("%Y-%m-%d") if purchase.purchase_date else '',
            current_installment=purchase.current_installment,
            total_installments=purchase.total_installments,
            card_id=purchase.card_id,
            card_name=purchase.card_name,
            card_number=purchase.card_number,
            card_type=purchase.card_type,
            remaining_installments=purchase.remaining_installments,
            remaining_total=purchase.remaining_total,
        )
        for purchase in purchases
    ]


def _get_month_invoice_items(
    db: Session,
    tenant_id: int,
    account_id: int,
    year_month: str,
    card_id: int | None = None,
) -> List[InvoiceDetailItem]:
    """Retorna todos os lançamentos de fatura de um mês (opcionalmente filtrado por cartão)."""
    query = db.query(
        CreditCardInvoice.id,
        CreditCardInvoice.credit_card_id,
        CreditCardInvoice.description,
        CreditCardInvoice.total_installments,
        CreditCardInvoice.current_installment,
        CreditCardInvoice.amount,
        CreditCardInvoice.date,
        Cartao.number.label('card_number'),
        Cartao.name.label('card_name'),
        Cartao.type.label('card_type'),
    ).join(
        Cartao, CreditCardInvoice.credit_card_id == Cartao.id
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        Cartao.account_id == account_id,
        CreditCardInvoice.year_month == year_month,
    )

    if card_id is not None:
        query = query.filter(CreditCardInvoice.credit_card_id == card_id)

    rows = query.order_by(CreditCardInvoice.date.desc(), CreditCardInvoice.description).all()

    return [
        InvoiceDetailItem(
            id=row.id,
            description=row.description or '',
            amount=row.amount,
            date=row.date.strftime("%Y-%m-%d") if row.date else '',
            current_installment=row.current_installment,
            total_installments=row.total_installments,
            card_id=row.credit_card_id,
            card_name=row.card_name,
            card_number=row.card_number,
            card_type=row.card_type or 'credito',
        )
        for row in rows
    ]


def _calculate_remaining_installments(
    db: Session,
    tenant_id: int,
    account_id: int,
) -> RemainingInstallmentsSummary:
    """
    Calcula o saldo parcelado restante somando, para cada compra parcelada,
    (total_installments - current_installment) * valor_da_parcela.
    """
    items = _get_remaining_installment_items(db, tenant_id, account_id)

    total_remaining = Decimal(0)
    per_card: Dict[int, dict] = {}

    for item in items:
        remaining_total = item.remaining_total or Decimal(0)
        total_remaining += remaining_total

        if item.card_id not in per_card:
            per_card[item.card_id] = {
                'card_number': item.card_number,
                'card_name': item.card_name,
                'card_type': item.card_type,
                'remaining_total': Decimal(0),
                'remaining_count': 0,
            }
        per_card[item.card_id]['remaining_total'] += remaining_total
        per_card[item.card_id]['remaining_count'] += 1

    cards_list = [
        CardRemainingBalance(
            card_id=card_id,
            card_number=data['card_number'],
            card_name=data['card_name'],
            card_type=data['card_type'],
            remaining_total=data['remaining_total'],
            remaining_count=data['remaining_count'],
        )
        for card_id, data in sorted(per_card.items(), key=lambda x: x[1]['card_number'] or '')
    ]

    return RemainingInstallmentsSummary(
        total=total_remaining,
        count=len(items),
        cards=cards_list,
    )


@router.get("/monthly", response_model=DashboardResponse)
async def get_monthly_dashboard(
    year: int | None = None,
    month: int | None = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Retorna totais do mês atual ou especificado.

    Args:
        year: Ano (default: ano atual)
        month: Mês (default: mês atual)
        db: Sessão do banco de dados
        current_user: Usuário autenticado

    Returns:
        Totais de bank_statements, credit_card_invoices e por cartão
    """
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Default para mês/ano atual
    now = datetime.now()
    target_year = year if year else now.year
    target_month = month if month else now.month

    # Formata year_month no formato YYYY-MM para filtrar faturas
    year_month_filter = f"{target_year}-{str(target_month).zfill(2)}"

    # Total de bank_statements do mês corrente
    # Filtra pela data da transação (extract year/month da coluna date) E por account_id
    # NOTA: BankStatement NÃO tem campo 'active' (não usa soft delete)
    bank_total = db.query(
        func.coalesce(func.sum(BankStatement.amount), 0).label('total'),
        func.count(BankStatement.id).label('count')
    ).filter(
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == account_id,  # ✅ FILTRO POR ACCOUNT_ID
        extract('year', BankStatement.date) == target_year,
        extract('month', BankStatement.date) == target_month
    ).first()

    # Total de credit_card_invoices do mês corrente
    # Filtra pelo mês/ano da FATURA (coluna year_month), não pela data da transação E por account_id
    # NOTA: CreditCardInvoice NÃO tem campo 'active' (não usa soft delete)
    cards_total = db.query(
        func.coalesce(func.sum(CreditCardInvoice.amount), 0).label('total'),
        func.count(CreditCardInvoice.id).label('count')
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        CreditCardInvoice.account_id == account_id,  # ✅ FILTRO POR ACCOUNT_ID
        CreditCardInvoice.year_month == year_month_filter
    ).first()

    # Total por cartão do mês corrente
    # Filtra pelo mês/ano da FATURA (coluna year_month) E por account_id do cartão
    # NOTA: CreditCardInvoice NÃO tem campo 'active', mas Cartao (credit_cards) TEM
    cards_query = db.query(
        Cartao.number.label('card_number'),
        Cartao.name,
        Cartao.description,
        func.sum(CreditCardInvoice.amount).label('total'),
        func.count(CreditCardInvoice.id).label('count')
    ).join(
        CreditCardInvoice, CreditCardInvoice.credit_card_id == Cartao.id
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        CreditCardInvoice.account_id == account_id,  # ✅ FILTRO POR ACCOUNT_ID
        CreditCardInvoice.year_month == year_month_filter,
        Cartao.account_id == account_id,  # ✅ FILTRO POR ACCOUNT_ID (cartão também)
    ).group_by(Cartao.id, Cartao.number, Cartao.name, Cartao.description).all()

    # Monta lista de cartões
    cards_list = [
        CardTotal(
            card_number=card_data.card_number,
            owner=card_data.name,
            description=card_data.description,
            total=card_data.total,
            count=card_data.count
        )
        for card_data in cards_query
    ]

    # Ordena cartões por número (menor para maior)
    cards_list.sort(key=lambda x: x.card_number)

    return DashboardResponse(
        bank_statements_total=bank_total.total if bank_total else Decimal(0),
        bank_statements_count=bank_total.count if bank_total else 0,
        credit_cards_total=cards_total.total if cards_total else Decimal(0),
        credit_cards_count=cards_total.count if cards_total else 0,
        cards=cards_list
    )


MONTH_NAMES = {
    1: "Jan", 2: "Fev", 3: "Mar", 4: "Abr", 5: "Mai", 6: "Jun",
    7: "Jul", 8: "Ago", 9: "Set", 10: "Out", 11: "Nov", 12: "Dez",
}


def _month_label(year: int, month: int) -> str:
    return f"{MONTH_NAMES[month]}/{year}"


def _flow_from_amount_rows(
    db: Session,
    model,
    tenant_id: int,
    account_id: int,
    target_year: int,
    target_month: int,
    amount_column,
    date_column,
) -> tuple[Decimal, Decimal, int, int, str | None]:
    """Entradas, saídas (positivo), contagens e última data no mês calendário."""
    row = db.query(
        func.coalesce(func.sum(case((amount_column < 0, amount_column), else_=Decimal(0))), 0).label('expenses_raw'),
        func.coalesce(func.sum(case((amount_column > 0, amount_column), else_=Decimal(0))), 0).label('revenue'),
        func.count(case((amount_column < 0, 1))).label('expenses_count'),
        func.count(case((amount_column > 0, 1))).label('revenue_count'),
    ).filter(
        model.tenant_id == tenant_id,
        model.account_id == account_id,
        extract('year', date_column) == target_year,
        extract('month', date_column) == target_month,
    ).first()

    exits = abs(row.expenses_raw) if row and row.expenses_raw else Decimal(0)
    entries = row.revenue if row and row.revenue else Decimal(0)
    exits_count = row.expenses_count if row else 0
    entries_count = row.revenue_count if row else 0

    last_tx = db.query(date_column).filter(
        model.tenant_id == tenant_id,
        model.account_id == account_id,
        extract('year', date_column) == target_year,
        extract('month', date_column) == target_month,
    ).order_by(desc(date_column)).first()

    last_date = None
    if last_tx is not None:
        dt = last_tx[0] if isinstance(last_tx, tuple) else last_tx
        if hasattr(dt, 'strftime'):
            last_date = dt.strftime("%Y-%m-%d")

    return entries, exits, entries_count, exits_count, last_date


@router.get("/home", response_model=HomeDashboardResponse)
async def get_home_dashboard(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Sumário executivo da Home: extrato bancário, última fatura de crédito e benefícios.
    """
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    now = datetime.now()
    target_year = now.year
    target_month = now.month
    year_month = f"{target_year}-{str(target_month).zfill(2)}"
    period_label = _month_label(target_year, target_month)
    month_start = datetime(target_year, target_month, 1)

    # --- Extrato bancário: saldo em conta = saldo mês anterior + entradas - saídas ---
    opening_row = db.query(
        func.coalesce(func.sum(BankStatement.amount), 0).label('balance')
    ).filter(
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == account_id,
        BankStatement.date < month_start,
    ).first()
    opening_balance = opening_row.balance if opening_row and opening_row.balance else Decimal(0)

    b_entries, b_exits, b_ec, b_xc, b_last = _flow_from_amount_rows(
        db,
        BankStatement,
        tenant_id,
        account_id,
        target_year,
        target_month,
        BankStatement.amount,
        BankStatement.date,
    )
    month_flow = b_entries - b_exits
    account_balance = opening_balance + month_flow

    bank_block = ExecutiveFlowBlock(
        period_label=period_label,
        year_month=year_month,
        current_balance=account_balance,
        opening_balance=opening_balance,
        entries=b_entries,
        exits=b_exits,
        net=account_balance,
        entries_count=b_ec,
        exits_count=b_xc,
        last_transaction_date=b_last,
    )

    # --- Benefícios: fluxo do mês (sem saldo de conta) ---
    ben_entries, ben_exits, ben_ec, ben_xc, ben_last = _flow_from_amount_rows(
        db,
        BenefitCardStatement,
        tenant_id,
        account_id,
        target_year,
        target_month,
        BenefitCardStatement.amount,
        BenefitCardStatement.date,
    )
    benefit_block = ExecutiveFlowBlock(
        period_label=period_label,
        year_month=year_month,
        entries=ben_entries,
        exits=ben_exits,
        net=ben_entries - ben_exits,
        entries_count=ben_ec,
        exits_count=ben_xc,
        last_transaction_date=ben_last,
    )

    # --- Cartão de crédito: última fatura fechada + média mensal ---
    credit_type_filter = (Cartao.type == 'credito') | (Cartao.type.is_(None))
    last_ym_row = db.query(func.max(CreditCardInvoice.year_month)).join(
        Cartao, CreditCardInvoice.credit_card_id == Cartao.id
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        Cartao.account_id == account_id,
        credit_type_filter,
    ).scalar()

    last_invoice_total = Decimal(0)
    last_invoice_count = 0
    last_invoice_label = None

    if last_ym_row:
        last_invoice_label = _month_label_from_year_month(last_ym_row)
        inv_agg = db.query(
            func.coalesce(func.sum(CreditCardInvoice.amount), 0).label('total'),
            func.count(CreditCardInvoice.id).label('count'),
        ).join(Cartao, CreditCardInvoice.credit_card_id == Cartao.id).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            Cartao.account_id == account_id,
            CreditCardInvoice.year_month == last_ym_row,
            credit_type_filter,
        ).first()
        if inv_agg:
            last_invoice_total = inv_agg.total or Decimal(0)
            last_invoice_count = inv_agg.count or 0

    monthly_totals = db.query(
        func.sum(CreditCardInvoice.amount).label('total')
    ).join(
        Cartao, CreditCardInvoice.credit_card_id == Cartao.id
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        Cartao.account_id == account_id,
        credit_type_filter,
    ).group_by(CreditCardInvoice.year_month).all()

    sample_months = len(monthly_totals)
    if sample_months:
        average_invoice = sum(abs(m.total or Decimal(0)) for m in monthly_totals) / sample_months
    else:
        average_invoice = Decimal(0)

    credit_block = CreditCardExecutiveBlock(
        last_invoice_year_month=last_ym_row,
        last_invoice_label=last_invoice_label,
        last_invoice_total=last_invoice_total,
        last_invoice_count=last_invoice_count,
        average_invoice_total=Decimal(str(round(average_invoice, 2))),
        average_sample_months=sample_months,
    )

    return HomeDashboardResponse(
        period_label=period_label,
        year_month=year_month,
        bank=bank_block,
        benefit=benefit_block,
        credit_card=credit_block,
    )


def _month_label_from_year_month(year_month: str) -> str:
    year_str, month_str = year_month.split('-')
    return f"{MONTH_NAMES[int(month_str)]}/{year_str}"


def _calc_remaining_totals(items: List[InvoiceDetailItem]) -> tuple[Decimal, Decimal]:
    """Próximo mês = soma das parcelas; Futuro/Total Dívida = soma do saldo restante."""
    next_month = sum(abs(item.amount) for item in items)
    future_debt = sum((item.remaining_total or Decimal(0)) for item in items)
    return next_month, future_debt


def _build_remaining_section(
    key: str,
    title: str,
    items: List[InvoiceDetailItem],
) -> InvoiceDetailsSection:
    next_month, future_debt = _calc_remaining_totals(items)
    return InvoiceDetailsSection(
        key=key,
        title=title,
        total=future_debt,
        count=len(items),
        items=items,
        next_month_total=next_month,
    )


def _build_invoice_section(
    key: str,
    title: str,
    items: List[InvoiceDetailItem],
    use_remaining_total: bool = False,
) -> InvoiceDetailsSection:
    if use_remaining_total:
        total = sum((item.remaining_total or Decimal(0)) for item in items)
    else:
        total = sum(abs(item.amount) for item in items)
    return InvoiceDetailsSection(
        key=key,
        title=title,
        total=total,
        count=len(items),
        items=items,
    )


@router.get("/invoice-details", response_model=InvoiceDetailsResponse)
async def get_invoice_details(
    view: str,
    year_month: str | None = None,
    card_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Detalhes de lançamentos de fatura para modais da HomePage.

    view=remaining — compras parceladas em aberto (todos os cartões)
    view=month — lançamentos de um mês (year_month obrigatório)
    view=card — saldo restante + último mês de um cartão (card_id e year_month obrigatórios)
    """
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    if view == "remaining":
        items = _get_remaining_installment_items(db, tenant_id, account_id)
        next_month_grand, future_grand = _calc_remaining_totals(items)

        cards_map: Dict[int, List[InvoiceDetailItem]] = defaultdict(list)
        for item in items:
            cards_map[item.card_id].append(item)

        sections = [
            InvoiceDetailsSection(
                key="remaining-total",
                title="Total",
                total=future_grand,
                count=len(items),
                items=[],
                next_month_total=next_month_grand,
            ),
        ]

        for card_id in _sort_card_ids_by_number(cards_map):
            card_items = _sort_invoice_items_by_date_desc(cards_map[card_id])
            first = card_items[0]
            sections.append(_build_remaining_section(
                key=f"card-{card_id}",
                title=f"{first.card_name} •••• {first.card_number}",
                items=card_items,
            ))

        return InvoiceDetailsResponse(
            title="Saldo Devedor — Todos os Cartões",
            sections=sections,
        )

    if view == "month":
        if not year_month:
            raise HTTPException(status_code=400, detail="year_month é obrigatório para view=month")
        items = _get_month_invoice_items(db, tenant_id, account_id, year_month)
        month_label = _month_label_from_year_month(year_month)
        grand_total = sum(abs(item.amount) for item in items)

        cards_map: Dict[int, List[InvoiceDetailItem]] = defaultdict(list)
        for item in items:
            cards_map[item.card_id].append(item)

        sections = [
            InvoiceDetailsSection(
                key="month-total",
                title="Total",
                total=grand_total,
                count=len(items),
                items=[],
            ),
        ]

        for card_id in _sort_card_ids_by_number(cards_map):
            card_items = _sort_invoice_items_by_date_desc(cards_map[card_id])
            first = card_items[0]
            card_total = sum(abs(i.amount) for i in card_items)
            sections.append(InvoiceDetailsSection(
                key=f"card-{card_id}",
                title=f"{first.card_name} •••• {first.card_number}",
                total=card_total,
                count=len(card_items),
                items=card_items,
            ))

        return InvoiceDetailsResponse(
            title=f"Fatura {month_label} — Todos os Cartões",
            sections=sections,
        )

    if view == "card":
        if not year_month or card_id is None:
            raise HTTPException(status_code=400, detail="card_id e year_month são obrigatórios para view=card")

        card = db.query(Cartao).filter(
            Cartao.id == card_id,
            Cartao.tenant_id == tenant_id,
            Cartao.account_id == account_id,
        ).first()
        if not card:
            raise HTTPException(status_code=404, detail="Cartão não encontrado")

        remaining_items = _get_remaining_installment_items(db, tenant_id, account_id, card_id=card_id)
        month_items = _get_month_invoice_items(db, tenant_id, account_id, year_month, card_id=card_id)
        month_label = _month_label_from_year_month(year_month)

        return InvoiceDetailsResponse(
            title=f"{card.name} •••• {card.number}",
            sections=[
                _build_remaining_section("remaining", "Saldo Devedor", remaining_items),
                _build_invoice_section("month", f"Fatura {month_label}", month_items),
            ],
        )

    raise HTTPException(status_code=400, detail="view inválido. Use: remaining, month ou card")


@router.get("/current-balance", response_model=CurrentBalanceResponse)
async def get_current_balance(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Retorna o saldo atual da conta corrente.

    Calcula o saldo somando TODOS os lançamentos em bank_statements.
    - Valores positivos = entradas/receitas
    - Valores negativos = saídas/despesas
    - Saldo = soma de todos os valores
    """
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Soma total (saldo atual)
    total_query = db.query(
        func.sum(BankStatement.amount).label('balance')
    ).filter(
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == account_id
    ).first()

    current_balance = total_query.balance if total_query and total_query.balance else Decimal(0)

    # Total de créditos (entradas - valores positivos)
    credits_query = db.query(
        func.sum(BankStatement.amount).label('total'),
        func.count(BankStatement.id).label('count')
    ).filter(
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == account_id,
        BankStatement.amount > 0
    ).first()

    total_credits = credits_query.total if credits_query and credits_query.total else Decimal(0)
    credits_count = credits_query.count if credits_query else 0

    # Total de débitos (saídas - valores negativos)
    debits_query = db.query(
        func.sum(BankStatement.amount).label('total'),
        func.count(BankStatement.id).label('count')
    ).filter(
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == account_id,
        BankStatement.amount < 0
    ).first()

    total_debits = debits_query.total if debits_query and debits_query.total else Decimal(0)
    debits_count = debits_query.count if debits_query else 0

    # Última transação
    last_transaction = db.query(BankStatement.date).filter(
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == account_id
    ).order_by(desc(BankStatement.date)).first()

    last_date = None
    if last_transaction and last_transaction.date:
        last_date = last_transaction.date.strftime("%Y-%m-%d")

    return CurrentBalanceResponse(
        current_balance=current_balance,
        total_credits=total_credits,
        total_debits=total_debits,
        credits_count=credits_count,
        debits_count=debits_count,
        last_transaction_date=last_date
    )
