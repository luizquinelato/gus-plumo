"""
Router para dashboard - totais e estatísticas
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, desc, case
from datetime import datetime, date
from dateutil.relativedelta import relativedelta
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel

from app.database import get_db
from app.models.unified_models import BankStatement, CreditCardInvoice, Cartao
from app.dependencies.auth import get_current_user
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

class HomeDashboardResponse(BaseModel):
    months: List[MonthSummary]  # Últimos 3 meses (extrato)
    invoice_months: List[InvoiceMonthSummary]  # Últimos 3 meses (faturas)


class CurrentBalanceResponse(BaseModel):
    """Saldo atual da conta corrente"""
    current_balance: Decimal  # Saldo atual (soma de todos os lançamentos)
    total_credits: Decimal    # Total de entradas (valores positivos)
    total_debits: Decimal     # Total de saídas (valores negativos)
    credits_count: int        # Quantidade de entradas
    debits_count: int         # Quantidade de saídas
    last_transaction_date: str | None  # Data da última transação


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
        Cartao.active == True  # Apenas cartões ativos
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


@router.get("/home", response_model=HomeDashboardResponse)
async def get_home_dashboard(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Retorna dados para a HomePage:
    - Saldo, despesas e receitas dos últimos 3 meses
    - Cartões ativos com sua última fatura disponível

    Returns:
        HomeDashboardResponse com months e cards
    """
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    now = datetime.now()

    # Mapeamento de mês para nome em português abreviado
    month_names = {
        1: "Jan", 2: "Fev", 3: "Mar", 4: "Abr", 5: "Mai", 6: "Jun",
        7: "Jul", 8: "Ago", 9: "Set", 10: "Out", 11: "Nov", 12: "Dez"
    }

    # ==================== ÚLTIMOS 3 MESES ====================
    months_data = []
    for i in range(2, -1, -1):  # 2, 1, 0 (do mais antigo para o mais recente)
        target_date = now - relativedelta(months=i)
        target_year = target_date.year
        target_month = target_date.month
        year_month = f"{target_year}-{str(target_month).zfill(2)}"
        month_label = f"{month_names[target_month]}/{target_year}"

        # Total de bank_statements do mês
        bank_data = db.query(
            func.coalesce(func.sum(
                case(
                    (BankStatement.amount < 0, BankStatement.amount),
                    else_=Decimal(0)
                )
            ), 0).label('expenses'),  # Despesas são valores negativos
            func.coalesce(func.sum(
                case(
                    (BankStatement.amount > 0, BankStatement.amount),
                    else_=Decimal(0)
                )
            ), 0).label('revenue'),  # Receitas são valores positivos
            func.count(case((BankStatement.amount < 0, 1))).label('expenses_count'),
            func.count(case((BankStatement.amount > 0, 1))).label('revenue_count')
        ).filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            extract('year', BankStatement.date) == target_year,
            extract('month', BankStatement.date) == target_month
        ).first()

        # Despesas são negativas no banco, convertemos para positivo para exibição
        expenses = abs(bank_data.expenses) if bank_data else Decimal(0)
        revenue = bank_data.revenue if bank_data else Decimal(0)
        balance = revenue - expenses  # Saldo = receitas - despesas

        months_data.append(MonthSummary(
            year_month=year_month,
            month_label=month_label,
            balance=balance,
            total_expenses=expenses,
            total_revenue=revenue,
            expenses_count=bank_data.expenses_count if bank_data else 0,
            revenue_count=bank_data.revenue_count if bank_data else 0
        ))

    # ==================== FATURAS DOS ÚLTIMOS 3 MESES ====================
    # Gera lista de year_months dos últimos 3 meses
    valid_year_months = []
    for i in range(2, -1, -1):
        target_date = now - relativedelta(months=i)
        ym = f"{target_date.year}-{str(target_date.month).zfill(2)}"
        valid_year_months.append(ym)

    invoice_months_data = []
    for i in range(2, -1, -1):  # 2, 1, 0 (do mais antigo para o mais recente)
        target_date = now - relativedelta(months=i)
        target_year = target_date.year
        target_month = target_date.month
        year_month = f"{target_year}-{str(target_month).zfill(2)}"
        month_label = f"{month_names[target_month]}/{target_year}"

        # Total de faturas do mês (todos os cartões ativos)
        # Filtra por Cartao.account_id pois CreditCardInvoice.account_id pode ser NULL
        invoices_data = db.query(
            CreditCardInvoice.credit_card_id,
            Cartao.number.label('card_number'),
            Cartao.name.label('card_name'),
            Cartao.type.label('card_type'),
            func.sum(CreditCardInvoice.amount).label('total'),
            func.count(CreditCardInvoice.id).label('count')
        ).join(
            Cartao, CreditCardInvoice.credit_card_id == Cartao.id
        ).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            Cartao.account_id == account_id,
            CreditCardInvoice.year_month == year_month,
            Cartao.active == True
        ).group_by(
            CreditCardInvoice.credit_card_id,
            Cartao.number,
            Cartao.name,
            Cartao.type
        ).order_by(
            Cartao.name, Cartao.number
        ).all()

        # Calcula totais
        month_total = Decimal(0)
        month_count = 0
        cards_breakdown = []

        for inv in invoices_data:
            month_total += inv.total
            month_count += inv.count
            cards_breakdown.append(CardMonthData(
                card_id=inv.credit_card_id,
                card_number=inv.card_number,
                card_name=inv.card_name,
                card_type=inv.card_type or 'credito',
                total=inv.total,
                count=inv.count
            ))

        invoice_months_data.append(InvoiceMonthSummary(
            year_month=year_month,
            month_label=month_label,
            total=month_total,
            count=month_count,
            cards=cards_breakdown
        ))

    return HomeDashboardResponse(
        months=months_data,
        invoice_months=invoice_months_data
    )


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
