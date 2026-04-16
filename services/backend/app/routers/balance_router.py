"""
Router para balanço de despesas compartilhadas.
Fornece endpoints para visualização de balanço entre contas.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, extract, and_, or_
from typing import List, Dict
from decimal import Decimal
from datetime import datetime, timedelta, date
from dateutil.relativedelta import relativedelta
import calendar
from pydantic import BaseModel

from app.database import get_db
from app.models.unified_models import (
    ExpenseSharingSetting, Account, Bank, BankStatement,
    CreditCardInvoice, Cartao, Subtag, Tag, BalanceClosure,
    BenefitCardStatement, Loan, LoanPayment
)
from app.dependencies.auth import get_current_user

router = APIRouter(prefix="/api/balance", tags=["balance"])


# ==================== SCHEMAS ====================

class AccountInfo(BaseModel):
    """Informações básicas de uma conta"""
    id: int
    name: str | None
    description: str | None
    bank_name: str | None

    class Config:
        from_attributes = True


class CategoryBalance(BaseModel):
    """Balanço de uma categoria específica"""
    total_amount: Decimal
    my_share: Decimal
    partner_share: Decimal
    transaction_count: int


class BalanceCategories(BaseModel):
    """Categorias de balanço"""
    shared_expenses: CategoryBalance
    shared_cards: CategoryBalance


class NetBalance(BaseModel):
    """Saldo líquido do balanço"""
    net_balance: Decimal
    i_should_receive: Decimal  # positivo = receber
    i_should_pay: Decimal      # negativo = pagar
    status: str  # "receive" | "pay" | "even"


class CurrentMonthBalanceResponse(BaseModel):
    """Resposta do balanço do mês atual"""
    month: str  # "2025-01"
    main_account: AccountInfo
    partner_account: AccountInfo
    my_contribution_percentage: Decimal
    categories: BalanceCategories
    balance: NetBalance


class MonthlyAccountBalance(BaseModel):
    """Balanço mensal de uma conta específica"""
    a_receber: Decimal  # O que esta conta tem a receber
    a_pagar: Decimal    # O que esta conta tem a pagar
    net_balance: Decimal  # Saldo líquido (a_receber - a_pagar)
    status: str  # "receive" | "pay" | "even"


class MonthlyBalanceSummary(BaseModel):
    """Resumo de balanço de um mês para ambas as contas"""
    month: str  # "2025-01"
    main_account_balance: MonthlyAccountBalance
    partner_account_balance: MonthlyAccountBalance
    has_closure: bool = False  # Indica se o mês foi fechado
    is_settled: bool = False  # Indica se o fechamento foi quitado


class YearSummary(BaseModel):
    """Resumo anual de uma conta"""
    total_a_receber: Decimal
    total_a_pagar: Decimal
    net_balance: Decimal
    status: str


class AnnualHistoryResponse(BaseModel):
    """Resposta do histórico anual"""
    year: int
    main_account: AccountInfo
    partner_account: AccountInfo
    my_contribution_percentage: Decimal
    months: List[MonthlyBalanceSummary]
    main_account_year_summary: YearSummary
    partner_account_year_summary: YearSummary


class MonthlyDetailItem(BaseModel):
    """Item de detalhe mensal"""
    id: int
    date: datetime
    description: str
    amount: Decimal
    source_table: str  # "bank_statements" | "credit_card_invoices" | "benefit_card_statements"
    tag_name: str | None
    subtag_name: str | None
    ownership_percentage: Decimal  # Percentual de ownership do item
    my_share: Decimal  # Valor que é minha parte
    partner_share: Decimal  # Valor que é parte do parceiro
    # Campos específicos para cartões
    year_month: str | None = None
    card_name: str | None = None
    card_number: str | None = None
    card_type: str | None = None  # "crédito" ou "benefício"


class MonthlyDetailsResponse(BaseModel):
    """Resposta com detalhes de um mês específico"""
    year: int
    month: int
    month_name: str
    main_account: AccountInfo
    partner_account: AccountInfo
    # Transações da conta logada
    main_bank_expenses: List[MonthlyDetailItem] = []
    main_bank_revenues: List[MonthlyDetailItem] = []
    main_cc_expenses: List[MonthlyDetailItem] = []
    main_cc_revenues: List[MonthlyDetailItem] = []
    main_benefit_expenses: List[MonthlyDetailItem] = []
    main_benefit_revenues: List[MonthlyDetailItem] = []
    # Transações da conta parceira
    partner_bank_expenses: List[MonthlyDetailItem] = []
    partner_bank_revenues: List[MonthlyDetailItem] = []
    partner_cc_expenses: List[MonthlyDetailItem] = []
    partner_cc_revenues: List[MonthlyDetailItem] = []
    partner_benefit_expenses: List[MonthlyDetailItem] = []
    partner_benefit_revenues: List[MonthlyDetailItem] = []
    # Resumo
    main_total_a_receber: Decimal
    main_total_a_pagar: Decimal
    main_net_balance: Decimal
    partner_total_a_receber: Decimal
    partner_total_a_pagar: Decimal
    partner_net_balance: Decimal


class TransactionItem(BaseModel):
    """Item de transação individual"""
    id: int
    date: datetime
    description: str
    amount: Decimal
    source_table: str  # "bank_statements" | "credit_card_invoices" | "benefit_card_statements"
    tag_name: str | None
    subtag_name: str | None
    my_contribution_percentage: Decimal  # Percentual de contribuição da conta logada
    partner_contribution_percentage: Decimal  # Percentual de contribuição da conta parceira
    # Campos específicos para credit_card_invoices e benefit_card_statements
    year_month: str | None = None  # Formato: "YYYY-MM" (ex: "2025-12")
    card_id: int | None = None
    card_name: str | None = None
    card_number: str | None = None
    card_active: bool | None = None
    card_closing_day: int | None = None
    card_type: str | None = None  # "crédito" ou "benefício"
    card_id: int | None = None
    card_name: str | None = None
    card_number: str | None = None  # Número do cartão (últimos 4 dígitos)
    card_active: bool | None = None  # Se o cartão está ativo
    card_type: str | None = None  # Tipo do cartão: "crédito" ou "benefício"


class AccountBalanceCard(BaseModel):
    """Card de balanço de uma conta"""
    account_id: int
    account_name: str
    bank_name: str | None
    agency: str | None = None  # Agência bancária
    account_number: int | None = None  # Número da conta
    total_expenses: Decimal  # Total de despesas (negativo)
    total_revenues: Decimal  # Total de receitas (positivo)
    net_amount: Decimal      # Líquido (receitas - despesas)
    contribution_percentage: Decimal
    status: str  # "to_pay" | "to_receive" | "even"
    # Transações de bank_statements
    expense_items: List[TransactionItem] = []  # Lista de despesas (bank_statements)
    revenue_items: List[TransactionItem] = []  # Lista de receitas (bank_statements)
    # Transações de credit_card_invoices
    credit_card_expense_items: List[TransactionItem] = []  # Lista de despesas (faturas de cartão)
    credit_card_revenue_items: List[TransactionItem] = []  # Lista de receitas (faturas de cartão)
    # Transações de benefit_card_statements
    benefit_card_expense_items: List[TransactionItem] = []  # Lista de despesas (cartão de benefícios)
    benefit_card_revenue_items: List[TransactionItem] = []  # Lista de receitas (cartão de benefícios)


class BalanceCalculationResponse(BaseModel):
    """Resposta do cálculo de balanço"""
    main_account_card: AccountBalanceCard
    partner_account_card: AccountBalanceCard
    year: int
    start_date: datetime
    end_date: datetime
    calculation_date: datetime


# ==================== HELPER FUNCTIONS ====================

def _calculate_balance_status(net_balance: Decimal) -> str:
    """Calcula o status do balanço"""
    if net_balance > 0:
        return "receive"
    elif net_balance < 0:
        return "pay"
    else:
        return "even"


def _get_account_info(account: Account) -> AccountInfo:
    """Converte Account para AccountInfo"""
    return AccountInfo(
        id=account.id,
        name=account.name,
        description=account.description,
        bank_name=account.bank.name if account.bank else None
    )


def calculate_invoice_periods(
    closing_day: int,
    start_date: date,
    end_date: date
) -> List[str]:
    """
    Calcula quais faturas (year_month) devem ser incluídas no período.

    Lógica:
    - Período da fatura: (closing_day + 1) do mês anterior até closing_day do mês atual
    - Data de fechamento: closing_day do mês atual
    - Critério de inclusão: data_inicio <= closing_day (data de fechamento) <= data_fim

    Args:
        closing_day: Dia de fechamento da fatura (1-31)
        start_date: Data de início do filtro
        end_date: Data de fim do filtro

    Returns:
        Lista de year_month (formato "YYYY-MM") das faturas a incluir

    Exemplo:
        Filtro: 01/01/2026 até 05/02/2026
        Closing day: 14

        Fatura Dez/2025:
          - Fecha em: 14/12/2025
          - Check: 01/01/2026 <= 14/12/2025? ❌ NÃO
          - Resultado: ❌ NÃO INCLUIR

        Fatura Jan/2026:
          - Fecha em: 14/01/2026
          - Período: 15/12/2025 - 14/01/2026
          - Check: 01/01/2026 <= 14/01/2026 <= 05/02/2026? ✅ SIM
          - Resultado: ✅ INCLUIR

        Fatura Fev/2026:
          - Fecha em: 14/02/2026
          - Check: 14/02/2026 <= 05/02/2026? ❌ NÃO
          - Resultado: ❌ NÃO INCLUIR
    """
    invoices_to_include = []

    # Começar do mês da data_inicio (ou mês anterior se necessário)
    # Precisamos começar um mês antes para capturar faturas que podem fechar no início do período
    current_month = (start_date.replace(day=1) - relativedelta(months=1))
    end_month = end_date.replace(day=1) + relativedelta(months=1)  # Vai um mês além para garantir

    while current_month <= end_month:
        # Data de fechamento desta fatura
        try:
            closing_date = date(current_month.year, current_month.month, closing_day)
        except ValueError:
            # Se o closing_day não existe neste mês (ex: dia 31 em fevereiro)
            # Usa o último dia do mês
            last_day = calendar.monthrange(current_month.year, current_month.month)[1]
            closing_date = date(current_month.year, current_month.month, last_day)

        # Verifica se deve incluir esta fatura
        # Regra: data_inicio <= closing_date <= data_fim
        if start_date <= closing_date <= end_date:
            year_month = f"{current_month.year}-{current_month.month:02d}"
            invoices_to_include.append(year_month)

        # Próximo mês
        current_month = current_month + relativedelta(months=1)

    return invoices_to_include


# ==================== ENDPOINTS ====================

@router.get("/current-month", response_model=CurrentMonthBalanceResponse)
async def get_current_month_balance(
    partner_account_id: int = Query(..., description="ID da conta parceira"),
    year: int | None = Query(None, description="Ano (default: ano atual)"),
    month: int | None = Query(None, description="Mês (default: mês atual)"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Retorna o balanço do mês atual entre a conta logada e uma conta parceira.
    
    Calcula automaticamente:
    - Total de despesas compartilhadas (bank_statements)
    - Total de cartões compartilhados (credit_card_invoices)
    - Saldo líquido (quem deve pagar para quem)
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")
    
    # Define ano/mês (default: atual)
    now = datetime.now()
    target_year = year or now.year
    target_month = month or now.month
    month_str = f"{target_year}-{str(target_month).zfill(2)}"
    
    # Busca TODOS os sharings entre as duas contas (pode haver mais de um)
    all_sharings = db.query(ExpenseSharingSetting).options(
        joinedload(ExpenseSharingSetting.account).joinedload(Account.bank),
        joinedload(ExpenseSharingSetting.shared_account).joinedload(Account.bank)
    ).filter(
        ExpenseSharingSetting.tenant_id == tenant_id,
        or_(
            and_(
                ExpenseSharingSetting.account_id == account_id,
                ExpenseSharingSetting.shared_account_id == partner_account_id
            ),
            and_(
                ExpenseSharingSetting.account_id == partner_account_id,
                ExpenseSharingSetting.shared_account_id == account_id
            )
        ),
        ExpenseSharingSetting.active == True
    ).all()

    if not all_sharings:
        raise HTTPException(
            status_code=404,
            detail=f"Configuração de compartilhamento não encontrada entre as contas {account_id} e {partner_account_id}"
        )

    # Usa o primeiro sharing para obter dados das contas e percentuais
    # Prioriza o sharing onde a conta logada é o account_id
    sharing = next((s for s in all_sharings if s.account_id == account_id), all_sharings[0])

    # Lista de IDs de todos os sharings para buscar transações
    sharing_ids = [s.id for s in all_sharings]

    # Determina se a conta logada é a "account" ou "shared_account" do sharing
    is_main_account = sharing.account_id == account_id

    # Busca dados das contas para a resposta
    logged_account = sharing.account if is_main_account else sharing.shared_account
    shared_account = sharing.shared_account if is_main_account else sharing.account

    # Percentual de contribuição da conta logada
    my_contribution_pct = sharing.my_contribution_percentage if is_main_account else (Decimal(100) - sharing.my_contribution_percentage)

    # Calcula despesas compartilhadas de bank_statements
    bank_expenses = db.query(
        func.sum(BankStatement.amount).label('total'),
        func.count(BankStatement.id).label('count')
    ).filter(
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == account_id,
        BankStatement.expense_sharing_id.in_(sharing_ids),  # Busca em TODOS os sharings
        extract('year', BankStatement.date) == target_year,
        extract('month', BankStatement.date) == target_month
    ).first()

    bank_total = abs(bank_expenses.total) if bank_expenses.total else Decimal(0)
    bank_count = bank_expenses.count or 0

    # Calcula despesas compartilhadas de credit_card_invoices
    card_expenses = db.query(
        func.sum(CreditCardInvoice.amount).label('total'),
        func.count(CreditCardInvoice.id).label('count')
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        CreditCardInvoice.expense_sharing_id.in_(sharing_ids),  # Busca em TODOS os sharings
        CreditCardInvoice.year_month == month_str
    ).first()

    card_total = abs(card_expenses.total) if card_expenses.total else Decimal(0)
    card_count = card_expenses.count or 0

    # Calcula as partes de cada um baseado no percentual de contribuição
    # my_contribution_pct: 0% = compartilhada paga tudo, 50% = meio a meio, 100% = eu pago tudo
    my_percentage = my_contribution_pct / Decimal(100)
    shared_percentage = Decimal(1) - my_percentage

    # Despesas compartilhadas (bank_statements)
    bank_my_share = bank_total * my_percentage
    bank_shared_share = bank_total * shared_percentage

    # Cartões compartilhados (credit_card_invoices)
    card_my_share = card_total * my_percentage
    card_shared_share = card_total * shared_percentage

    # Saldo líquido: positivo = eu devo receber, negativo = eu devo pagar
    # Se eu paguei tudo mas só deveria pagar 50%, a compartilhada me deve 50%
    total_my_share = bank_my_share + card_my_share
    total_shared_share = bank_shared_share + card_shared_share

    # Net balance: quanto a compartilhada me deve (positivo) ou quanto eu devo à compartilhada (negativo)
    net_balance = total_shared_share  # O que a compartilhada deve pagar

    return CurrentMonthBalanceResponse(
        month=month_str,
        main_account=_get_account_info(logged_account),
        partner_account=_get_account_info(shared_account),
        my_contribution_percentage=my_contribution_pct,
        categories=BalanceCategories(
            shared_expenses=CategoryBalance(
                total_amount=bank_total,
                my_share=bank_my_share,
                partner_share=bank_shared_share,
                transaction_count=bank_count
            ),
            shared_cards=CategoryBalance(
                total_amount=card_total,
                my_share=card_my_share,
                partner_share=card_shared_share,
                transaction_count=card_count
            )
        ),
        balance=NetBalance(
            net_balance=net_balance,
            i_should_receive=net_balance if net_balance > 0 else Decimal(0),
            i_should_pay=abs(net_balance) if net_balance < 0 else Decimal(0),
            status=_calculate_balance_status(net_balance)
        )
    )


@router.get("/annual-history", response_model=AnnualHistoryResponse)
async def get_annual_history(
    partner_account_id: int = Query(..., description="ID da conta parceira"),
    year: int | None = Query(None, description="Ano (default: ano atual)"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Retorna o histórico anual de balanço entre a conta logada e uma conta parceira.

    Usa a mesma lógica do endpoint /calculate:
    - Considera transações de AMBAS as contas (logada e parceira)
    - Inclui 3 fontes: BankStatement, CreditCardInvoice, BenefitCardStatement
    - Usa ownership_percentage de cada transação individual
    - A Receber = despesas que EU paguei × % do parceiro
    - A Pagar = despesas que o PARCEIRO pagou × minha %
    - Saldo Líquido = A Receber - A Pagar

    Agrupamento por mês:
    - BankStatement: agrupa por extract('month', date)
    - CreditCardInvoice: agrupa por year_month (mês da fatura, não da data do lançamento)
    - BenefitCardStatement: agrupa por extract('month', date)
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Define ano (default: atual)
    target_year = year or datetime.now().year

    # Busca TODOS os sharings entre as duas contas (pode haver mais de um)
    all_sharings = db.query(ExpenseSharingSetting).options(
        joinedload(ExpenseSharingSetting.account).joinedload(Account.bank),
        joinedload(ExpenseSharingSetting.shared_account).joinedload(Account.bank)
    ).filter(
        ExpenseSharingSetting.tenant_id == tenant_id,
        or_(
            and_(
                ExpenseSharingSetting.account_id == account_id,
                ExpenseSharingSetting.shared_account_id == partner_account_id
            ),
            and_(
                ExpenseSharingSetting.account_id == partner_account_id,
                ExpenseSharingSetting.shared_account_id == account_id
            )
        ),
        ExpenseSharingSetting.active == True
    ).all()

    if not all_sharings:
        raise HTTPException(
            status_code=404,
            detail=f"Configuração de compartilhamento não encontrada entre as contas {account_id} e {partner_account_id}"
        )

    # Usa o primeiro sharing para obter dados das contas e percentuais
    # Prioriza o sharing onde a conta logada é o account_id
    sharing = next((s for s in all_sharings if s.account_id == account_id), all_sharings[0])

    # Lista de IDs de todos os sharings para buscar transações
    sharing_ids = [s.id for s in all_sharings]

    # Buscar fechamentos existentes para o ano em qualquer um dos sharings
    closures = db.query(BalanceClosure).filter(
        BalanceClosure.tenant_id == tenant_id,
        BalanceClosure.expense_sharing_id.in_(sharing_ids),
        BalanceClosure.year == target_year
    ).all()

    # Criar dicts de meses fechados e quitados para busca rápida
    closed_months = {closure.month for closure in closures}
    settled_months = {closure.month for closure in closures if closure.is_settled}

    # Determina se a conta logada é a "account" ou "shared_account" do sharing
    # Isso afeta o percentual de contribuição
    is_main_account = sharing.account_id == account_id

    # Busca dados das contas para a resposta
    logged_account = sharing.account if is_main_account else sharing.shared_account
    shared_account = sharing.shared_account if is_main_account else sharing.account

    # Percentual de contribuição da conta logada
    my_contribution_pct = sharing.my_contribution_percentage if is_main_account else (Decimal(100) - sharing.my_contribution_percentage)

    # Acumuladores anuais para CONTA LOGADA (main)
    main_year_a_receber = Decimal(0)
    main_year_a_pagar = Decimal(0)

    # Acumuladores anuais para CONTA COMPARTILHADA (shared)
    shared_year_a_receber = Decimal(0)
    shared_year_a_pagar = Decimal(0)

    # Função auxiliar para determinar status
    def get_status(net: Decimal) -> str:
        if net > 0:
            return "receive"
        elif net < 0:
            return "pay"
        return "even"

    months = []
    for month_num in range(1, 13):
        month_str = f"{target_year}-{str(month_num).zfill(2)}"

        # ========== BANK STATEMENTS - CONTA LOGADA ==========
        main_bank_expenses = db.query(BankStatement).filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            BankStatement.expense_sharing_id.in_(sharing_ids),
            extract('year', BankStatement.date) == target_year,
            extract('month', BankStatement.date) == month_num,
            BankStatement.amount < 0
        ).all()

        main_bank_revenues = db.query(BankStatement).filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            BankStatement.expense_sharing_id.in_(sharing_ids),
            extract('year', BankStatement.date) == target_year,
            extract('month', BankStatement.date) == month_num,
            BankStatement.amount > 0
        ).all()

        # ========== CREDIT CARD INVOICES - CONTA LOGADA ==========
        # Agrupa por year_month (mês da fatura, não da data do lançamento)
        main_cc_expenses = db.query(CreditCardInvoice).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.account_id == account_id,
            CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
            CreditCardInvoice.year_month == month_str,
            CreditCardInvoice.amount < 0
        ).all()

        main_cc_revenues = db.query(CreditCardInvoice).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.account_id == account_id,
            CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
            CreditCardInvoice.year_month == month_str,
            CreditCardInvoice.amount > 0
        ).all()

        # ========== BENEFIT CARD STATEMENTS - CONTA LOGADA ==========
        main_bc_expenses = db.query(BenefitCardStatement).filter(
            BenefitCardStatement.tenant_id == tenant_id,
            BenefitCardStatement.account_id == account_id,
            BenefitCardStatement.expense_sharing_id.in_(sharing_ids),
            extract('year', BenefitCardStatement.date) == target_year,
            extract('month', BenefitCardStatement.date) == month_num,
            BenefitCardStatement.amount < 0
        ).all()

        main_bc_revenues = db.query(BenefitCardStatement).filter(
            BenefitCardStatement.tenant_id == tenant_id,
            BenefitCardStatement.account_id == account_id,
            BenefitCardStatement.expense_sharing_id.in_(sharing_ids),
            extract('year', BenefitCardStatement.date) == target_year,
            extract('month', BenefitCardStatement.date) == month_num,
            BenefitCardStatement.amount > 0
        ).all()

        # ========== BANK STATEMENTS - CONTA COMPARTILHADA ==========
        shared_bank_expenses = db.query(BankStatement).filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == partner_account_id,
            BankStatement.expense_sharing_id.in_(sharing_ids),
            extract('year', BankStatement.date) == target_year,
            extract('month', BankStatement.date) == month_num,
            BankStatement.amount < 0
        ).all()

        shared_bank_revenues = db.query(BankStatement).filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == partner_account_id,
            BankStatement.expense_sharing_id.in_(sharing_ids),
            extract('year', BankStatement.date) == target_year,
            extract('month', BankStatement.date) == month_num,
            BankStatement.amount > 0
        ).all()

        # ========== CREDIT CARD INVOICES - CONTA COMPARTILHADA ==========
        shared_cc_expenses = db.query(CreditCardInvoice).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.account_id == partner_account_id,
            CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
            CreditCardInvoice.year_month == month_str,
            CreditCardInvoice.amount < 0
        ).all()

        shared_cc_revenues = db.query(CreditCardInvoice).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.account_id == partner_account_id,
            CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
            CreditCardInvoice.year_month == month_str,
            CreditCardInvoice.amount > 0
        ).all()

        # ========== BENEFIT CARD STATEMENTS - CONTA COMPARTILHADA ==========
        shared_bc_expenses = db.query(BenefitCardStatement).filter(
            BenefitCardStatement.tenant_id == tenant_id,
            BenefitCardStatement.account_id == partner_account_id,
            BenefitCardStatement.expense_sharing_id.in_(sharing_ids),
            extract('year', BenefitCardStatement.date) == target_year,
            extract('month', BenefitCardStatement.date) == month_num,
            BenefitCardStatement.amount < 0
        ).all()

        shared_bc_revenues = db.query(BenefitCardStatement).filter(
            BenefitCardStatement.tenant_id == tenant_id,
            BenefitCardStatement.account_id == partner_account_id,
            BenefitCardStatement.expense_sharing_id.in_(sharing_ids),
            extract('year', BenefitCardStatement.date) == target_year,
            extract('month', BenefitCardStatement.date) == month_num,
            BenefitCardStatement.amount > 0
        ).all()

        # ========== CÁLCULOS - CONTA LOGADA ==========
        # Combina todas as despesas da conta logada
        main_all_expenses = main_bank_expenses + main_cc_expenses + main_bc_expenses
        # NOTA: Receitas de cartão benefício NÃO são incluídas nos cálculos de balanço
        main_all_revenues = main_bank_revenues + main_cc_revenues  # SEM main_bc_revenues

        # Para cada despesa que a CONTA LOGADA pagou:
        # - CONTA LOGADA tem A RECEBER (parte da compartilhada)
        # - CONTA COMPARTILHADA tem A PAGAR (parte dela nas despesas da logada)
        main_a_receber_from_expenses = Decimal(0)
        shared_a_pagar_from_main_expenses = Decimal(0)
        for item in main_all_expenses:
            my_ownership = item.ownership_percentage / Decimal(100)
            shared_ownership = Decimal(1) - my_ownership
            amount = abs(item.amount)
            main_a_receber_from_expenses += amount * shared_ownership
            shared_a_pagar_from_main_expenses += amount * shared_ownership

        # Para cada receita que a CONTA LOGADA recebeu:
        # - CONTA LOGADA tem A PAGAR (parte da compartilhada na receita)
        # - CONTA COMPARTILHADA tem A RECEBER (parte dela na receita da logada)
        main_a_pagar_from_revenues = Decimal(0)
        shared_a_receber_from_main_revenues = Decimal(0)
        for item in main_all_revenues:
            my_ownership = item.ownership_percentage / Decimal(100)
            shared_ownership = Decimal(1) - my_ownership
            amount = abs(item.amount)
            main_a_pagar_from_revenues += amount * shared_ownership
            shared_a_receber_from_main_revenues += amount * shared_ownership

        # ========== CÁLCULOS - CONTA COMPARTILHADA ==========
        # Combina todas as despesas da conta compartilhada
        shared_all_expenses = shared_bank_expenses + shared_cc_expenses + shared_bc_expenses
        # NOTA: Receitas de cartão benefício NÃO são incluídas nos cálculos de balanço
        shared_all_revenues = shared_bank_revenues + shared_cc_revenues  # SEM shared_bc_revenues

        # Para cada despesa que a CONTA COMPARTILHADA pagou:
        # - CONTA COMPARTILHADA tem A RECEBER (parte da logada)
        # - CONTA LOGADA tem A PAGAR (parte dela nas despesas da compartilhada)
        shared_a_receber_from_expenses = Decimal(0)
        main_a_pagar_from_shared_expenses = Decimal(0)
        for item in shared_all_expenses:
            shared_ownership = item.ownership_percentage / Decimal(100)
            my_ownership = Decimal(1) - shared_ownership
            amount = abs(item.amount)
            shared_a_receber_from_expenses += amount * my_ownership
            main_a_pagar_from_shared_expenses += amount * my_ownership

        # Para cada receita que a CONTA COMPARTILHADA recebeu:
        # - CONTA COMPARTILHADA tem A PAGAR (parte da logada na receita)
        # - CONTA LOGADA tem A RECEBER (parte dela na receita da compartilhada)
        shared_a_pagar_from_revenues = Decimal(0)
        main_a_receber_from_shared_revenues = Decimal(0)
        for item in shared_all_revenues:
            shared_ownership = item.ownership_percentage / Decimal(100)
            my_ownership = Decimal(1) - shared_ownership
            amount = abs(item.amount)
            shared_a_pagar_from_revenues += amount * my_ownership
            main_a_receber_from_shared_revenues += amount * my_ownership

        # ========== TOTAIS DO MÊS ==========
        # CONTA LOGADA
        # A Receber = despesas que EU paguei (compartilhada me deve) + receitas da COMPARTILHADA (minha parte)
        # A Pagar = despesas da COMPARTILHADA (minha parte) + receitas que EU recebi (parte da compartilhada)
        main_month_a_receber = main_a_receber_from_expenses + main_a_receber_from_shared_revenues
        main_month_a_pagar = main_a_pagar_from_shared_expenses + main_a_pagar_from_revenues
        main_net_balance = main_month_a_receber - main_month_a_pagar

        # CONTA COMPARTILHADA
        # A Receber = despesas que ELA pagou (eu devo) + receitas que EU recebi (parte dela)
        # A Pagar = despesas que EU paguei (parte dela) + receitas que ELA recebeu (minha parte)
        shared_month_a_receber = shared_a_receber_from_expenses + shared_a_receber_from_main_revenues
        shared_month_a_pagar = shared_a_pagar_from_main_expenses + shared_a_pagar_from_revenues
        shared_net_balance = shared_month_a_receber - shared_month_a_pagar

        # Acumula no ano
        main_year_a_receber += main_month_a_receber
        main_year_a_pagar += main_month_a_pagar
        shared_year_a_receber += shared_month_a_receber
        shared_year_a_pagar += shared_month_a_pagar

        months.append(MonthlyBalanceSummary(
            month=month_str,
            main_account_balance=MonthlyAccountBalance(
                a_receber=main_month_a_receber,
                a_pagar=main_month_a_pagar,
                net_balance=main_net_balance,
                status=get_status(main_net_balance)
            ),
            partner_account_balance=MonthlyAccountBalance(
                a_receber=shared_month_a_receber,
                a_pagar=shared_month_a_pagar,
                net_balance=shared_net_balance,
                status=get_status(shared_net_balance)
            ),
            has_closure=month_num in closed_months,
            is_settled=month_num in settled_months
        ))

    # Resumos anuais
    main_year_net = main_year_a_receber - main_year_a_pagar
    shared_year_net = shared_year_a_receber - shared_year_a_pagar

    # Retorna resposta com conta logada como main e conta compartilhada como shared
    return AnnualHistoryResponse(
        year=target_year,
        main_account=_get_account_info(logged_account),
        partner_account=_get_account_info(shared_account),
        my_contribution_percentage=my_contribution_pct,
        months=months,
        main_account_year_summary=YearSummary(
            total_a_receber=main_year_a_receber,
            total_a_pagar=main_year_a_pagar,
            net_balance=main_year_net,
            status=get_status(main_year_net)
        ),
        partner_account_year_summary=YearSummary(
            total_a_receber=shared_year_a_receber,
            total_a_pagar=shared_year_a_pagar,
            net_balance=shared_year_net,
            status=get_status(shared_year_net)
        )
    )


# Nomes dos meses em português
MONTH_NAMES = {
    1: "Janeiro", 2: "Fevereiro", 3: "Março", 4: "Abril",
    5: "Maio", 6: "Junho", 7: "Julho", 8: "Agosto",
    9: "Setembro", 10: "Outubro", 11: "Novembro", 12: "Dezembro"
}


@router.get("/monthly-details", response_model=MonthlyDetailsResponse)
async def get_monthly_details(
    partner_account_id: int = Query(..., description="ID da conta parceira"),
    year: int = Query(..., description="Ano"),
    month: int = Query(..., ge=1, le=12, description="Mês (1-12)"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Retorna os detalhes de um mês específico do histórico anual.

    Inclui todas as transações das 3 fontes:
    - BankStatement
    - CreditCardInvoice
    - BenefitCardStatement
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    month_str = f"{year}-{str(month).zfill(2)}"

    # Busca TODOS os sharings entre as duas contas
    all_sharings = db.query(ExpenseSharingSetting).options(
        joinedload(ExpenseSharingSetting.account).joinedload(Account.bank),
        joinedload(ExpenseSharingSetting.shared_account).joinedload(Account.bank)
    ).filter(
        ExpenseSharingSetting.tenant_id == tenant_id,
        or_(
            and_(
                ExpenseSharingSetting.account_id == account_id,
                ExpenseSharingSetting.shared_account_id == partner_account_id
            ),
            and_(
                ExpenseSharingSetting.account_id == partner_account_id,
                ExpenseSharingSetting.shared_account_id == account_id
            )
        ),
        ExpenseSharingSetting.active == True
    ).all()

    if not all_sharings:
        raise HTTPException(
            status_code=404,
            detail=f"Configuração de compartilhamento não encontrada entre as contas {account_id} e {partner_account_id}"
        )

    # Usa o primeiro sharing para obter dados das contas
    sharing = next((s for s in all_sharings if s.account_id == account_id), all_sharings[0])
    sharing_ids = [s.id for s in all_sharings]

    is_main_account = sharing.account_id == account_id
    logged_account = sharing.account if is_main_account else sharing.shared_account
    shared_account = sharing.shared_account if is_main_account else sharing.account

    # Função auxiliar para converter item em MonthlyDetailItem
    def to_detail_item(item, source_table: str, card_name: str = None, card_number: str = None, card_type: str = None) -> MonthlyDetailItem:
        ownership = item.ownership_percentage / Decimal(100)
        amount = abs(item.amount)
        my_share = amount * ownership
        partner_share = amount * (Decimal(1) - ownership)

        # Determina tag_name e subtag_name
        tag_name = None
        subtag_name = None
        if hasattr(item, 'subtag') and item.subtag:
            subtag_name = item.subtag.name
            if hasattr(item.subtag, 'tag') and item.subtag.tag:
                tag_name = item.subtag.tag.name

        # Determina a data
        item_date = item.date if hasattr(item, 'date') else item.datetime

        return MonthlyDetailItem(
            id=item.id,
            date=item_date,
            description=item.description,
            amount=item.amount,
            source_table=source_table,
            tag_name=tag_name,
            subtag_name=subtag_name,
            ownership_percentage=item.ownership_percentage,
            my_share=my_share,
            partner_share=partner_share,
            year_month=getattr(item, 'year_month', None),
            card_name=card_name,
            card_number=card_number,
            card_type=card_type
        )

    # ========== BANK STATEMENTS - CONTA LOGADA ==========
    main_bank_expenses_raw = db.query(BankStatement).options(
        joinedload(BankStatement.subtag).joinedload(Subtag.tag)
    ).filter(
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == account_id,
        BankStatement.expense_sharing_id.in_(sharing_ids),
        extract('year', BankStatement.date) == year,
        extract('month', BankStatement.date) == month,
        BankStatement.amount < 0
    ).order_by(BankStatement.date.desc()).all()

    main_bank_revenues_raw = db.query(BankStatement).options(
        joinedload(BankStatement.subtag).joinedload(Subtag.tag)
    ).filter(
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == account_id,
        BankStatement.expense_sharing_id.in_(sharing_ids),
        extract('year', BankStatement.date) == year,
        extract('month', BankStatement.date) == month,
        BankStatement.amount > 0
    ).order_by(BankStatement.date.desc()).all()

    # ========== CREDIT CARD INVOICES - CONTA LOGADA ==========
    main_cc_expenses_raw = db.query(CreditCardInvoice).options(
        joinedload(CreditCardInvoice.subtag).joinedload(Subtag.tag),
        joinedload(CreditCardInvoice.credit_card)
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        CreditCardInvoice.account_id == account_id,
        CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
        CreditCardInvoice.year_month == month_str,
        CreditCardInvoice.amount < 0
    ).order_by(CreditCardInvoice.date.desc()).all()

    main_cc_revenues_raw = db.query(CreditCardInvoice).options(
        joinedload(CreditCardInvoice.subtag).joinedload(Subtag.tag),
        joinedload(CreditCardInvoice.credit_card)
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        CreditCardInvoice.account_id == account_id,
        CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
        CreditCardInvoice.year_month == month_str,
        CreditCardInvoice.amount > 0
    ).order_by(CreditCardInvoice.date.desc()).all()

    # ========== BENEFIT CARD STATEMENTS - CONTA LOGADA ==========
    main_bc_expenses_raw = db.query(BenefitCardStatement).options(
        joinedload(BenefitCardStatement.subtag).joinedload(Subtag.tag),
        joinedload(BenefitCardStatement.credit_card)
    ).filter(
        BenefitCardStatement.tenant_id == tenant_id,
        BenefitCardStatement.account_id == account_id,
        BenefitCardStatement.expense_sharing_id.in_(sharing_ids),
        extract('year', BenefitCardStatement.date) == year,
        extract('month', BenefitCardStatement.date) == month,
        BenefitCardStatement.amount < 0
    ).order_by(BenefitCardStatement.date.desc()).all()

    main_bc_revenues_raw = db.query(BenefitCardStatement).options(
        joinedload(BenefitCardStatement.subtag).joinedload(Subtag.tag),
        joinedload(BenefitCardStatement.credit_card)
    ).filter(
        BenefitCardStatement.tenant_id == tenant_id,
        BenefitCardStatement.account_id == account_id,
        BenefitCardStatement.expense_sharing_id.in_(sharing_ids),
        extract('year', BenefitCardStatement.date) == year,
        extract('month', BenefitCardStatement.date) == month,
        BenefitCardStatement.amount > 0
    ).order_by(BenefitCardStatement.date.desc()).all()

    # ========== BANK STATEMENTS - CONTA PARCEIRA ==========
    partner_bank_expenses_raw = db.query(BankStatement).options(
        joinedload(BankStatement.subtag).joinedload(Subtag.tag)
    ).filter(
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == partner_account_id,
        BankStatement.expense_sharing_id.in_(sharing_ids),
        extract('year', BankStatement.date) == year,
        extract('month', BankStatement.date) == month,
        BankStatement.amount < 0
    ).order_by(BankStatement.date.desc()).all()

    partner_bank_revenues_raw = db.query(BankStatement).options(
        joinedload(BankStatement.subtag).joinedload(Subtag.tag)
    ).filter(
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == partner_account_id,
        BankStatement.expense_sharing_id.in_(sharing_ids),
        extract('year', BankStatement.date) == year,
        extract('month', BankStatement.date) == month,
        BankStatement.amount > 0
    ).order_by(BankStatement.date.desc()).all()

    # ========== CREDIT CARD INVOICES - CONTA PARCEIRA ==========
    partner_cc_expenses_raw = db.query(CreditCardInvoice).options(
        joinedload(CreditCardInvoice.subtag).joinedload(Subtag.tag),
        joinedload(CreditCardInvoice.credit_card)
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        CreditCardInvoice.account_id == partner_account_id,
        CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
        CreditCardInvoice.year_month == month_str,
        CreditCardInvoice.amount < 0
    ).order_by(CreditCardInvoice.date.desc()).all()

    partner_cc_revenues_raw = db.query(CreditCardInvoice).options(
        joinedload(CreditCardInvoice.subtag).joinedload(Subtag.tag),
        joinedload(CreditCardInvoice.credit_card)
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        CreditCardInvoice.account_id == partner_account_id,
        CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
        CreditCardInvoice.year_month == month_str,
        CreditCardInvoice.amount > 0
    ).order_by(CreditCardInvoice.date.desc()).all()

    # ========== BENEFIT CARD STATEMENTS - CONTA PARCEIRA ==========
    partner_bc_expenses_raw = db.query(BenefitCardStatement).options(
        joinedload(BenefitCardStatement.subtag).joinedload(Subtag.tag),
        joinedload(BenefitCardStatement.credit_card)
    ).filter(
        BenefitCardStatement.tenant_id == tenant_id,
        BenefitCardStatement.account_id == partner_account_id,
        BenefitCardStatement.expense_sharing_id.in_(sharing_ids),
        extract('year', BenefitCardStatement.date) == year,
        extract('month', BenefitCardStatement.date) == month,
        BenefitCardStatement.amount < 0
    ).order_by(BenefitCardStatement.date.desc()).all()

    partner_bc_revenues_raw = db.query(BenefitCardStatement).options(
        joinedload(BenefitCardStatement.subtag).joinedload(Subtag.tag),
        joinedload(BenefitCardStatement.credit_card)
    ).filter(
        BenefitCardStatement.tenant_id == tenant_id,
        BenefitCardStatement.account_id == partner_account_id,
        BenefitCardStatement.expense_sharing_id.in_(sharing_ids),
        extract('year', BenefitCardStatement.date) == year,
        extract('month', BenefitCardStatement.date) == month,
        BenefitCardStatement.amount > 0
    ).order_by(BenefitCardStatement.date.desc()).all()

    # ========== CONVERTER PARA MonthlyDetailItem ==========
    # Conta Logada
    main_bank_expenses = [to_detail_item(i, "bank_statements") for i in main_bank_expenses_raw]
    main_bank_revenues = [to_detail_item(i, "bank_statements") for i in main_bank_revenues_raw]
    main_cc_expenses = [to_detail_item(i, "credit_card_invoices",
        card_name=i.credit_card.name if i.credit_card else None,
        card_number=i.credit_card.number if i.credit_card else None,
        card_type="crédito") for i in main_cc_expenses_raw]
    main_cc_revenues = [to_detail_item(i, "credit_card_invoices",
        card_name=i.credit_card.name if i.credit_card else None,
        card_number=i.credit_card.number if i.credit_card else None,
        card_type="crédito") for i in main_cc_revenues_raw]
    main_benefit_expenses = [to_detail_item(i, "benefit_card_statements",
        card_name=i.credit_card.name if i.credit_card else None,
        card_number=i.credit_card.number if i.credit_card else None,
        card_type="benefício") for i in main_bc_expenses_raw]
    main_benefit_revenues = [to_detail_item(i, "benefit_card_statements",
        card_name=i.credit_card.name if i.credit_card else None,
        card_number=i.credit_card.number if i.credit_card else None,
        card_type="benefício") for i in main_bc_revenues_raw]

    # Conta Parceira
    partner_bank_expenses = [to_detail_item(i, "bank_statements") for i in partner_bank_expenses_raw]
    partner_bank_revenues = [to_detail_item(i, "bank_statements") for i in partner_bank_revenues_raw]
    partner_cc_expenses = [to_detail_item(i, "credit_card_invoices",
        card_name=i.credit_card.name if i.credit_card else None,
        card_number=i.credit_card.number if i.credit_card else None,
        card_type="crédito") for i in partner_cc_expenses_raw]
    partner_cc_revenues = [to_detail_item(i, "credit_card_invoices",
        card_name=i.credit_card.name if i.credit_card else None,
        card_number=i.credit_card.number if i.credit_card else None,
        card_type="crédito") for i in partner_cc_revenues_raw]
    partner_benefit_expenses = [to_detail_item(i, "benefit_card_statements",
        card_name=i.credit_card.name if i.credit_card else None,
        card_number=i.credit_card.number if i.credit_card else None,
        card_type="benefício") for i in partner_bc_expenses_raw]
    partner_benefit_revenues = [to_detail_item(i, "benefit_card_statements",
        card_name=i.credit_card.name if i.credit_card else None,
        card_number=i.credit_card.number if i.credit_card else None,
        card_type="benefício") for i in partner_bc_revenues_raw]

    # ========== CÁLCULOS DE TOTAIS ==========
    # NOTA: Receitas de cartão benefício NÃO são incluídas nos cálculos de balanço
    # (apenas despesas são consideradas para benefícios)

    # Conta Logada - A Receber (despesas que EU paguei × % do parceiro)
    main_a_receber = sum(i.partner_share for i in main_bank_expenses + main_cc_expenses + main_benefit_expenses)
    # Conta Logada - A Receber (parte das receitas do parceiro) - SEM benefit_revenues
    main_a_receber += sum(i.my_share for i in partner_bank_revenues + partner_cc_revenues)

    # Conta Logada - A Pagar (despesas do parceiro × minha %)
    main_a_pagar = sum(i.my_share for i in partner_bank_expenses + partner_cc_expenses + partner_benefit_expenses)
    # Conta Logada - A Pagar (parte das receitas que EU recebi) - SEM benefit_revenues
    main_a_pagar += sum(i.partner_share for i in main_bank_revenues + main_cc_revenues)

    main_net = main_a_receber - main_a_pagar

    # Conta Parceira (inverso da conta logada)
    partner_a_receber = main_a_pagar
    partner_a_pagar = main_a_receber
    partner_net = partner_a_receber - partner_a_pagar

    return MonthlyDetailsResponse(
        year=year,
        month=month,
        month_name=MONTH_NAMES.get(month, str(month)),
        main_account=_get_account_info(logged_account),
        partner_account=_get_account_info(shared_account),
        main_bank_expenses=main_bank_expenses,
        main_bank_revenues=main_bank_revenues,
        main_cc_expenses=main_cc_expenses,
        main_cc_revenues=main_cc_revenues,
        main_benefit_expenses=main_benefit_expenses,
        main_benefit_revenues=main_benefit_revenues,
        partner_bank_expenses=partner_bank_expenses,
        partner_bank_revenues=partner_bank_revenues,
        partner_cc_expenses=partner_cc_expenses,
        partner_cc_revenues=partner_cc_revenues,
        partner_benefit_expenses=partner_benefit_expenses,
        partner_benefit_revenues=partner_benefit_revenues,
        main_total_a_receber=main_a_receber,
        main_total_a_pagar=main_a_pagar,
        main_net_balance=main_net,
        partner_total_a_receber=partner_a_receber,
        partner_total_a_pagar=partner_a_pagar,
        partner_net_balance=partner_net
    )


@router.get("/calculate", response_model=BalanceCalculationResponse)
async def calculate_balance(
    partner_account_id: int = Query(..., description="ID da conta parceira"),
    year: int = Query(..., description="Ano para cálculo do balanço"),
    custom_start_date: str | None = Query(None, description="Data inicial customizada (YYYY-MM-DD). Se não fornecida, usa dia após último fechamento ou início do ano."),
    custom_end_date: str | None = Query(None, description="Data final customizada (YYYY-MM-DD). Se não fornecida, usa hoje."),
    last_closure_timestamp: str | None = Query(None, description="Timestamp completo do último fechamento (YYYY-MM-DD HH:MM:SS). Usado para filtrar transações após esse momento exato."),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Calcula o balanço de despesas compartilhadas entre duas contas.

    Lógica de Período:
    - Se custom_start_date fornecida: usa essa data como início
    - Senão, busca o último fechamento do ano selecionado:
      - Se encontrado: período inicia no dia seguinte ao period_end_date do último fechamento
      - Se não encontrado: período inicia em 01/Janeiro do ano selecionado
    - Data final: custom_end_date (se fornecida) ou hoje

    Filtragem por Timestamp:
    - Se last_closure_timestamp fornecido: filtra transações com timestamp > last_closure_timestamp
    - Isso permite incluir transações do mesmo dia do fechamento, mas após o horário do fechamento

    Lógica de Cálculo:
    - Conta Logada: Busca transações onde expense_sharing_id aponta para a conta compartilhada
    - Conta Compartilhada: Busca transações onde expense_sharing_id aponta para a conta logada
      E account_id é da conta compartilhada

    Retorna 2 cards com totais multiplicados pelo percentual de contribuição.
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Busca configuração de compartilhamento em ambas as direções
    # Busca TODOS os sharings entre as duas contas (pode haver mais de um)
    all_sharings = db.query(ExpenseSharingSetting).options(
        joinedload(ExpenseSharingSetting.account).joinedload(Account.bank),
        joinedload(ExpenseSharingSetting.shared_account).joinedload(Account.bank)
    ).filter(
        ExpenseSharingSetting.tenant_id == tenant_id,
        or_(
            and_(
                ExpenseSharingSetting.account_id == account_id,
                ExpenseSharingSetting.shared_account_id == partner_account_id
            ),
            and_(
                ExpenseSharingSetting.account_id == partner_account_id,
                ExpenseSharingSetting.shared_account_id == account_id
            )
        ),
        ExpenseSharingSetting.active == True
    ).all()

    if not all_sharings:
        raise HTTPException(
            status_code=404,
            detail=f"Configuração de compartilhamento não encontrada entre as contas {account_id} e {partner_account_id}"
        )

    # Usa o primeiro sharing para obter dados das contas e percentuais
    # Prioriza o sharing onde a conta logada é o account_id (mais intuitivo)
    sharing = next((s for s in all_sharings if s.account_id == account_id), all_sharings[0])

    # Lista de IDs de todos os sharings para buscar transações
    sharing_ids = [s.id for s in all_sharings]

    # Determina se a conta logada é a "account" ou "shared_account" do sharing selecionado
    # Isso afeta o percentual de contribuição
    is_main_account = sharing.account_id == account_id

    # Busca dados das contas para a resposta
    logged_account = sharing.account if is_main_account else sharing.shared_account
    partner_account = sharing.shared_account if is_main_account else sharing.account

    # Percentual de contribuição da conta logada
    my_contribution_pct = sharing.my_contribution_percentage if is_main_account else (Decimal(100) - sharing.my_contribution_percentage)
    partner_contribution_pct = Decimal(100) - my_contribution_pct

    # ========== NOVA LÓGICA DE CÁLCULO DE PERÍODO ==========
    # 1. Define data de início
    if custom_start_date:
        # Se fornecida data customizada, usa ela
        try:
            start_date = datetime.strptime(custom_start_date, "%Y-%m-%d")

            # Se houver timestamp do último fechamento, usar ele como filtro mínimo
            if last_closure_timestamp:
                try:
                    # ✅ Normalizar formato: substituir 'T' por espaço (aceita ISO 8601)
                    normalized_timestamp = last_closure_timestamp.replace('T', ' ')

                    # Parse do timestamp completo (pode vir com ou sem microsegundos)
                    if '.' in normalized_timestamp:
                        closure_dt = datetime.strptime(normalized_timestamp, "%Y-%m-%d %H:%M:%S.%f")
                    else:
                        closure_dt = datetime.strptime(normalized_timestamp, "%Y-%m-%d %H:%M:%S")

                    # ✅ Se a data de início for o mesmo dia do fechamento, usar closing_date + 1 segundo
                    # Isso garante que o novo período comece APÓS o último fechamento
                    if start_date.date() == closure_dt.date():
                        start_date = closure_dt + timedelta(seconds=1)
                    else:
                        # Se for dia diferente, usar meia-noite
                        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
                except ValueError as e:
                    # Se falhar o parse, ignora o timestamp e usa meia-noite
                    start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
            else:
                start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato de custom_start_date inválido. Use YYYY-MM-DD")
    else:
        # Busca o último fechamento do ano selecionado
        last_closure = db.query(BalanceClosure).filter(
            BalanceClosure.tenant_id == tenant_id,
            BalanceClosure.expense_sharing_id.in_(sharing_ids),
            BalanceClosure.year == year
        ).order_by(BalanceClosure.period_end_date.desc()).first()

        if last_closure:
            # Se há fechamento: inicia no dia seguinte ao period_end_date
            start_date = last_closure.period_end_date + timedelta(days=1)
            # Zera as horas para começar à meia-noite
            start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            # Se não há fechamento: inicia em 01/Janeiro do ano selecionado
            start_date = datetime(year, 1, 1, 0, 0, 0)

    # 2. Define data de fim
    if custom_end_date:
        # Se fornecida data customizada, usa ela
        try:
            end_date = datetime.strptime(custom_end_date, "%Y-%m-%d")
            end_date = end_date.replace(hour=23, minute=59, second=59)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato de custom_end_date inválido. Use YYYY-MM-DD")
    else:
        # Se não fornecida, usa hoje
        end_date = datetime.now().replace(hour=23, minute=59, second=59, microsecond=0)

    # ========== CONTA LOGADA (Main Account) ==========
    # Busca transações onde a conta LOGADA pagou e está vinculada ao sharing

    main_filters = [
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == account_id,  # Conta LOGADA
        BankStatement.expense_sharing_id.in_(sharing_ids),  # Busca em TODOS os sharings entre as contas
        BankStatement.date >= start_date,
        BankStatement.date <= end_date
    ]

    # Despesas (valores negativos)
    main_expenses = db.query(
        func.sum(BankStatement.amount).label('total')
    ).filter(
        and_(*main_filters),
        BankStatement.amount < 0
    ).scalar() or Decimal(0)

    # Receitas (valores positivos)
    main_revenues = db.query(
        func.sum(BankStatement.amount).label('total')
    ).filter(
        and_(*main_filters),
        BankStatement.amount > 0
    ).scalar() or Decimal(0)

    # Busca itens individuais de despesas
    main_expense_items = db.query(BankStatement).options(
        joinedload(BankStatement.subtag).joinedload(Subtag.tag)
    ).filter(
        and_(*main_filters),
        BankStatement.amount < 0
    ).order_by(BankStatement.date.desc()).all()

    # Busca itens individuais de receitas
    main_revenue_items = db.query(BankStatement).options(
        joinedload(BankStatement.subtag).joinedload(Subtag.tag)
    ).filter(
        and_(*main_filters),
        BankStatement.amount > 0
    ).order_by(BankStatement.date.desc()).all()

    # Calcula valores para a CONTA LOGADA usando ownership_percentage de cada transação
    # Para cada despesa que EU paguei, a parte do parceiro vai para MEU "a receber"
    main_a_receber = Decimal(0)
    for item in main_expense_items:
        my_ownership = item.ownership_percentage / Decimal(100)  # Quanto EU pago
        partner_ownership = Decimal(1) - my_ownership  # Quanto o PARCEIRO deve pagar
        main_a_receber += item.amount * partner_ownership  # Negativo * % = valor a receber

    # Para cada receita que EU recebi, a parte do parceiro vai para MEU "a pagar"
    main_a_pagar_from_my_expenses = Decimal(0)
    for item in main_revenue_items:
        my_ownership = item.ownership_percentage / Decimal(100)
        partner_ownership = Decimal(1) - my_ownership
        main_a_pagar_from_my_expenses += item.amount * partner_ownership

    # ========== CREDIT CARD INVOICES - CONTA LOGADA ==========
    # Abordagem dupla:
    #   A) Cartões cujo expense_sharing_id está no cartão → usa closing_day p/ determinar year_months
    #   B) Itens marcados individualmente (expense_sharing_id no item, cartão sem sharing) → filtra por date

    # A) Busca todos os cartões da conta logada com expense_sharing
    main_cards = db.query(Cartao).filter(
        Cartao.tenant_id == tenant_id,
        Cartao.account_id == account_id,
        Cartao.expense_sharing_id.in_(sharing_ids),
        Cartao.active == True
    ).all()
    main_card_ids = [c.id for c in main_cards]

    # Para cada cartão, calcula quais year_month incluir
    main_cc_year_months_to_include = []
    for card in main_cards:
        closing_day = card.closing_day if hasattr(card, 'closing_day') and card.closing_day else 14
        year_months = calculate_invoice_periods(
            closing_day=closing_day,
            start_date=start_date.date() if isinstance(start_date, datetime) else start_date,
            end_date=end_date.date() if isinstance(end_date, datetime) else end_date
        )
        main_cc_year_months_to_include.extend(year_months)
    main_cc_year_months_to_include = list(set(main_cc_year_months_to_include))

    # Busca faturas dos year_months calculados (via cartão)
    main_cc_expense_items = []
    main_cc_revenue_items = []

    if main_cc_year_months_to_include:
        main_cc_expense_items = db.query(CreditCardInvoice).options(
            joinedload(CreditCardInvoice.subtag).joinedload(Subtag.tag),
            joinedload(CreditCardInvoice.credit_card)
        ).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.account_id == account_id,
            CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
            CreditCardInvoice.year_month.in_(main_cc_year_months_to_include),
            CreditCardInvoice.amount < 0
        ).order_by(CreditCardInvoice.date.desc()).all()

        main_cc_revenue_items = db.query(CreditCardInvoice).options(
            joinedload(CreditCardInvoice.subtag).joinedload(Subtag.tag),
            joinedload(CreditCardInvoice.credit_card)
        ).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.account_id == account_id,
            CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
            CreditCardInvoice.year_month.in_(main_cc_year_months_to_include),
            CreditCardInvoice.amount > 0
        ).order_by(CreditCardInvoice.date.desc()).all()

    # B) Itens marcados individualmente (expense_sharing_id no item, cartão sem sharing no nível do cartão)
    # Descobre os cartões distintos desses itens e usa o closing_day de cada um para calcular year_months
    individual_main_cards_q = db.query(Cartao).join(
        CreditCardInvoice, CreditCardInvoice.credit_card_id == Cartao.id
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        CreditCardInvoice.account_id == account_id,
        CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
    )
    if main_card_ids:
        individual_main_cards_q = individual_main_cards_q.filter(~Cartao.id.in_(main_card_ids))
    individual_main_cards = individual_main_cards_q.distinct(Cartao.id).all()

    for card in individual_main_cards:
        closing_day = card.closing_day if hasattr(card, 'closing_day') and card.closing_day else 14
        card_year_months = calculate_invoice_periods(
            closing_day=closing_day,
            start_date=start_date.date() if isinstance(start_date, datetime) else start_date,
            end_date=end_date.date() if isinstance(end_date, datetime) else end_date
        )
        if not card_year_months:
            continue
        main_cc_expense_items += db.query(CreditCardInvoice).options(
            joinedload(CreditCardInvoice.subtag).joinedload(Subtag.tag),
            joinedload(CreditCardInvoice.credit_card)
        ).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.account_id == account_id,
            CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
            CreditCardInvoice.credit_card_id == card.id,
            CreditCardInvoice.year_month.in_(card_year_months),
            CreditCardInvoice.amount < 0
        ).order_by(CreditCardInvoice.date.desc()).all()

        main_cc_revenue_items += db.query(CreditCardInvoice).options(
            joinedload(CreditCardInvoice.subtag).joinedload(Subtag.tag),
            joinedload(CreditCardInvoice.credit_card)
        ).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.account_id == account_id,
            CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
            CreditCardInvoice.credit_card_id == card.id,
            CreditCardInvoice.year_month.in_(card_year_months),
            CreditCardInvoice.amount > 0
        ).order_by(CreditCardInvoice.date.desc()).all()

    # Calcula valores de credit_card_invoices para a CONTA LOGADA
    for item in main_cc_expense_items:
        my_ownership = item.ownership_percentage / Decimal(100)
        partner_ownership = Decimal(1) - my_ownership
        main_a_receber += item.amount * partner_ownership

    for item in main_cc_revenue_items:
        my_ownership = item.ownership_percentage / Decimal(100)
        partner_ownership = Decimal(1) - my_ownership
        main_a_pagar_from_my_expenses += item.amount * partner_ownership

    # ========== BENEFIT CARD STATEMENTS - CONTA LOGADA ==========
    main_bc_filters = [
        BenefitCardStatement.tenant_id == tenant_id,
        BenefitCardStatement.account_id == account_id,
        BenefitCardStatement.expense_sharing_id.in_(sharing_ids),
        BenefitCardStatement.date >= start_date,
        BenefitCardStatement.date <= end_date
    ]

    # Busca itens individuais de despesas (cartão de benefícios)
    main_bc_expense_items = db.query(BenefitCardStatement).options(
        joinedload(BenefitCardStatement.subtag).joinedload(Subtag.tag)
    ).filter(
        and_(*main_bc_filters),
        BenefitCardStatement.amount < 0
    ).order_by(BenefitCardStatement.date.desc()).all()

    # Busca itens individuais de receitas (cartão de benefícios - estornos, etc)
    main_bc_revenue_items = db.query(BenefitCardStatement).options(
        joinedload(BenefitCardStatement.subtag).joinedload(Subtag.tag)
    ).filter(
        and_(*main_bc_filters),
        BenefitCardStatement.amount > 0
    ).order_by(BenefitCardStatement.date.desc()).all()

    # Calcula valores de benefit_card_statements para a CONTA LOGADA
    for item in main_bc_expense_items:
        my_ownership = item.ownership_percentage / Decimal(100)
        partner_ownership = Decimal(1) - my_ownership
        main_a_receber += item.amount * partner_ownership

    # NOTA: Receitas de cartão benefício NÃO são incluídas nos cálculos de balanço
    # (apenas despesas são consideradas)
    # for item in main_bc_revenue_items:
    #     my_ownership = item.ownership_percentage / Decimal(100)
    #     partner_ownership = Decimal(1) - my_ownership
    #     main_a_pagar_from_my_expenses += item.amount * partner_ownership

    # ========== CONTA COMPARTILHADA (Shared Account) ==========
    # Busca transações onde a conta COMPARTILHADA pagou e está vinculada ao sharing

    # Inicializa variáveis da conta compartilhada
    shared_a_receber = Decimal(0)
    shared_a_pagar_from_shared_expenses = Decimal(0)
    shared_expense_items = []
    shared_revenue_items = []

    # Busca transações que a conta COMPARTILHADA pagou
    shared_filters = [
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == partner_account_id,  # Conta COMPARTILHADA (selecionada no dropdown)
        BankStatement.expense_sharing_id.in_(sharing_ids),  # Busca em TODOS os sharings entre as contas
        BankStatement.date >= start_date,
        BankStatement.date <= end_date
    ]

    # Despesas (valores negativos)
    shared_expenses = db.query(
        func.sum(BankStatement.amount).label('total')
    ).filter(
        and_(*shared_filters),
        BankStatement.amount < 0
    ).scalar() or Decimal(0)

    # Receitas (valores positivos)
    shared_revenues = db.query(
        func.sum(BankStatement.amount).label('total')
    ).filter(
        and_(*shared_filters),
        BankStatement.amount > 0
    ).scalar() or Decimal(0)

    # Busca itens individuais de despesas da conta compartilhada
    shared_expense_items = db.query(BankStatement).options(
        joinedload(BankStatement.subtag).joinedload(Subtag.tag)
    ).filter(
        and_(*shared_filters),
        BankStatement.amount < 0
    ).order_by(BankStatement.date.desc()).all()

    # Busca itens individuais de receitas da conta compartilhada
    shared_revenue_items = db.query(BankStatement).options(
        joinedload(BankStatement.subtag).joinedload(Subtag.tag)
    ).filter(
        and_(*shared_filters),
        BankStatement.amount > 0
    ).order_by(BankStatement.date.desc()).all()

    # Calcula valores para a CONTA COMPARTILHADA usando ownership_percentage de cada transação
    # Para cada despesa que ELA pagou, a minha parte vai para "a receber" DELA
    for item in shared_expense_items:
        shared_ownership = item.ownership_percentage / Decimal(100)  # Quanto ELA paga
        my_ownership = Decimal(1) - shared_ownership  # Quanto EU devo pagar
        shared_a_receber += item.amount * my_ownership  # Negativo * % = valor a receber dela

    # Para cada receita que ELA recebeu, a minha parte vai para "a pagar" DELA
    for item in shared_revenue_items:
        shared_ownership = item.ownership_percentage / Decimal(100)
        my_ownership = Decimal(1) - shared_ownership
        shared_a_pagar_from_shared_expenses += item.amount * my_ownership

    # ========== CREDIT CARD INVOICES - CONTA COMPARTILHADA ==========

    # A) Cartões da conta compartilhada com expense_sharing_id no nível do cartão
    shared_cards = db.query(Cartao).filter(
        Cartao.tenant_id == tenant_id,
        Cartao.account_id == partner_account_id,
        Cartao.expense_sharing_id.in_(sharing_ids),
        Cartao.active == True
    ).all()
    shared_card_ids = [c.id for c in shared_cards]

    shared_cc_year_months_to_include = []
    for card in shared_cards:
        closing_day = card.closing_day if hasattr(card, 'closing_day') and card.closing_day else 14
        year_months = calculate_invoice_periods(
            closing_day=closing_day,
            start_date=start_date.date() if isinstance(start_date, datetime) else start_date,
            end_date=end_date.date() if isinstance(end_date, datetime) else end_date
        )
        shared_cc_year_months_to_include.extend(year_months)
    shared_cc_year_months_to_include = list(set(shared_cc_year_months_to_include))

    shared_cc_expense_items = []
    shared_cc_revenue_items = []

    if shared_cc_year_months_to_include:
        shared_cc_expense_items = db.query(CreditCardInvoice).options(
            joinedload(CreditCardInvoice.subtag).joinedload(Subtag.tag),
            joinedload(CreditCardInvoice.credit_card)
        ).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.account_id == partner_account_id,
            CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
            CreditCardInvoice.year_month.in_(shared_cc_year_months_to_include),
            CreditCardInvoice.amount < 0
        ).order_by(CreditCardInvoice.date.desc()).all()

        shared_cc_revenue_items = db.query(CreditCardInvoice).options(
            joinedload(CreditCardInvoice.subtag).joinedload(Subtag.tag),
            joinedload(CreditCardInvoice.credit_card)
        ).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.account_id == partner_account_id,
            CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
            CreditCardInvoice.year_month.in_(shared_cc_year_months_to_include),
            CreditCardInvoice.amount > 0
        ).order_by(CreditCardInvoice.date.desc()).all()

    # B) Itens marcados individualmente na conta compartilhada (cartão sem sharing no nível do cartão)
    individual_shared_cards_q = db.query(Cartao).join(
        CreditCardInvoice, CreditCardInvoice.credit_card_id == Cartao.id
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        CreditCardInvoice.account_id == partner_account_id,
        CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
    )
    if shared_card_ids:
        individual_shared_cards_q = individual_shared_cards_q.filter(~Cartao.id.in_(shared_card_ids))
    individual_shared_cards = individual_shared_cards_q.distinct(Cartao.id).all()

    for card in individual_shared_cards:
        closing_day = card.closing_day if hasattr(card, 'closing_day') and card.closing_day else 14
        card_year_months = calculate_invoice_periods(
            closing_day=closing_day,
            start_date=start_date.date() if isinstance(start_date, datetime) else start_date,
            end_date=end_date.date() if isinstance(end_date, datetime) else end_date
        )
        if not card_year_months:
            continue
        shared_cc_expense_items += db.query(CreditCardInvoice).options(
            joinedload(CreditCardInvoice.subtag).joinedload(Subtag.tag),
            joinedload(CreditCardInvoice.credit_card)
        ).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.account_id == partner_account_id,
            CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
            CreditCardInvoice.credit_card_id == card.id,
            CreditCardInvoice.year_month.in_(card_year_months),
            CreditCardInvoice.amount < 0
        ).order_by(CreditCardInvoice.date.desc()).all()

        shared_cc_revenue_items += db.query(CreditCardInvoice).options(
            joinedload(CreditCardInvoice.subtag).joinedload(Subtag.tag),
            joinedload(CreditCardInvoice.credit_card)
        ).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.account_id == partner_account_id,
            CreditCardInvoice.expense_sharing_id.in_(sharing_ids),
            CreditCardInvoice.credit_card_id == card.id,
            CreditCardInvoice.year_month.in_(card_year_months),
            CreditCardInvoice.amount > 0
        ).order_by(CreditCardInvoice.date.desc()).all()

    # Calcula valores de credit_card_invoices para a CONTA COMPARTILHADA
    for item in shared_cc_expense_items:
        shared_ownership = item.ownership_percentage / Decimal(100)
        my_ownership = Decimal(1) - shared_ownership
        shared_a_receber += item.amount * my_ownership

    for item in shared_cc_revenue_items:
        shared_ownership = item.ownership_percentage / Decimal(100)
        my_ownership = Decimal(1) - shared_ownership
        shared_a_pagar_from_shared_expenses += item.amount * my_ownership

    # ========== BENEFIT CARD STATEMENTS - CONTA COMPARTILHADA ==========
    shared_bc_filters = [
        BenefitCardStatement.tenant_id == tenant_id,
        BenefitCardStatement.account_id == partner_account_id,
        BenefitCardStatement.expense_sharing_id.in_(sharing_ids),
        BenefitCardStatement.date >= start_date,
        BenefitCardStatement.date <= end_date
    ]

    # Busca itens individuais de despesas (cartão de benefícios) da conta compartilhada
    shared_bc_expense_items = db.query(BenefitCardStatement).options(
        joinedload(BenefitCardStatement.subtag).joinedload(Subtag.tag)
    ).filter(
        and_(*shared_bc_filters),
        BenefitCardStatement.amount < 0
    ).order_by(BenefitCardStatement.date.desc()).all()

    # Busca itens individuais de receitas (cartão de benefícios) da conta compartilhada
    shared_bc_revenue_items = db.query(BenefitCardStatement).options(
        joinedload(BenefitCardStatement.subtag).joinedload(Subtag.tag)
    ).filter(
        and_(*shared_bc_filters),
        BenefitCardStatement.amount > 0
    ).order_by(BenefitCardStatement.date.desc()).all()

    # Calcula valores de benefit_card_statements para a CONTA COMPARTILHADA
    for item in shared_bc_expense_items:
        shared_ownership = item.ownership_percentage / Decimal(100)
        my_ownership = Decimal(1) - shared_ownership
        shared_a_receber += item.amount * my_ownership

    # NOTA: Receitas de cartão benefício NÃO são incluídas nos cálculos de balanço
    # (apenas despesas são consideradas)
    # for item in shared_bc_revenue_items:
    #     shared_ownership = item.ownership_percentage / Decimal(100)
    #     my_ownership = Decimal(1) - shared_ownership
    #     shared_a_pagar_from_shared_expenses += item.amount * my_ownership

    # Agora calcula os valores finais de cada lado
    # LÓGICA:
    # 1. Buscar transações da conta logada (main)
    # 2. Buscar transações da conta compartilhada (shared)
    # 3. Calcular valores de cada lado
    # 4. Inverter e somar os dois lados

    # LADO 1: Transações da CONTA LOGADA
    # - A Receber: parte da conta compartilhada nas despesas que EU paguei (negativo)
    # - A Pagar: parte da conta compartilhada nas receitas que EU recebi (positivo)
    main_side_a_receber = main_a_receber  # Negativo (despesas que paguei * % compartilhada)
    main_side_a_pagar = main_a_pagar_from_my_expenses  # Positivo (receitas que recebi * % compartilhada)

    # LADO 2: Transações da CONTA COMPARTILHADA
    # - A Receber: parte minha nas despesas que ELA pagou (negativo)
    # - A Pagar: parte minha nas receitas que ELA recebeu (positivo)
    shared_side_a_receber = shared_a_receber  # Negativo (despesas que ela pagou * % meu)
    shared_side_a_pagar = shared_a_pagar_from_shared_expenses  # Positivo (receitas que ela recebeu * % meu)

    # TOTAIS FINAIS:
    # MINHA CONTA (logada): meus valores + valores INVERTIDOS da compartilhada
    main_total_a_receber = main_side_a_receber + (-shared_side_a_pagar)  # Negativo
    main_total_a_pagar = main_side_a_pagar + (-shared_side_a_receber)  # Positivo
    main_net = main_total_a_receber + main_total_a_pagar

    # CONTA COMPARTILHADA: valores dela + meus valores INVERTIDOS
    shared_total_a_receber = shared_side_a_receber + (-main_side_a_pagar)  # Negativo
    shared_total_a_pagar = shared_side_a_pagar + (-main_side_a_receber)  # Positivo
    shared_net = shared_total_a_receber + shared_total_a_pagar

    # Determina status
    # Valores negativos = a receber (despesas que paguei, conta compartilhada me deve)
    # Valores positivos = a pagar (receitas que recebi, devo à conta compartilhada)
    main_status = "even"
    shared_status = "even"

    if main_net < 0:
        main_status = "to_receive"
    elif main_net > 0:
        main_status = "to_pay"

    if shared_net < 0:
        shared_status = "to_receive"
    elif shared_net > 0:
        shared_status = "to_pay"

    # Converte itens para TransactionItem
    # Para transações da conta logada (main), usa o ownership_percentage de cada item
    main_expense_transaction_items = [
        TransactionItem(
            id=item.id,
            date=item.date,
            description=item.description or "Sem descrição",
            amount=item.amount,
            source_table="bank_statements",
            tag_name=item.subtag.tag.name if item.subtag and item.subtag.tag else None,
            subtag_name=item.subtag.name if item.subtag else None,
            my_contribution_percentage=item.ownership_percentage,  # Percentual específico desta transação
            partner_contribution_percentage=Decimal(100) - item.ownership_percentage  # Complemento
        )
        for item in main_expense_items
    ]

    main_revenue_transaction_items = [
        TransactionItem(
            id=item.id,
            date=item.date,
            description=item.description or "Sem descrição",
            amount=item.amount,
            source_table="bank_statements",
            tag_name=item.subtag.tag.name if item.subtag and item.subtag.tag else None,
            subtag_name=item.subtag.name if item.subtag else None,
            my_contribution_percentage=item.ownership_percentage,
            partner_contribution_percentage=Decimal(100) - item.ownership_percentage
        )
        for item in main_revenue_items
    ]

    # Para transações da conta compartilhada, usa o ownership_percentage de cada item
    # Do ponto de vista da conta logada, "my_contribution" é o que EU pago das despesas da COMPARTILHADA
    shared_expense_transaction_items = [
        TransactionItem(
            id=item.id,
            date=item.date,
            description=item.description or "Sem descrição",
            amount=item.amount,
            source_table="bank_statements",
            tag_name=item.subtag.tag.name if item.subtag and item.subtag.tag else None,
            subtag_name=item.subtag.name if item.subtag else None,
            my_contribution_percentage=Decimal(100) - item.ownership_percentage,  # O que EU pago das despesas da compartilhada
            partner_contribution_percentage=item.ownership_percentage  # O que a COMPARTILHADA paga das próprias despesas
        )
        for item in shared_expense_items
    ]

    shared_revenue_transaction_items = [
        TransactionItem(
            id=item.id,
            date=item.date,
            description=item.description or "Sem descrição",
            amount=item.amount,
            source_table="bank_statements",
            tag_name=item.subtag.tag.name if item.subtag and item.subtag.tag else None,
            subtag_name=item.subtag.name if item.subtag else None,
            my_contribution_percentage=Decimal(100) - item.ownership_percentage,
            partner_contribution_percentage=item.ownership_percentage
        )
        for item in shared_revenue_items
    ]

    # ========== CONVERTE CREDIT CARD INVOICES PARA TransactionItem ==========
    # Conta logada - despesas de cartão de crédito
    main_cc_expense_transaction_items = [
        TransactionItem(
            id=item.id,
            date=item.date,
            description=item.description or "Sem descrição",
            amount=item.amount,
            source_table="credit_card_invoices",
            tag_name=item.subtag.tag.name if item.subtag and item.subtag.tag else None,
            subtag_name=item.subtag.name if item.subtag else None,
            my_contribution_percentage=item.ownership_percentage,
            partner_contribution_percentage=Decimal(100) - item.ownership_percentage,
            year_month=item.year_month,
            card_id=item.credit_card.id if item.credit_card else None,
            card_name=item.credit_card.name if item.credit_card else None,
            card_number=item.credit_card.number if item.credit_card else None,
            card_active=item.credit_card.active if item.credit_card else None,
            card_closing_day=item.credit_card.closing_day if item.credit_card else None,
            card_type=item.credit_card.type if item.credit_card else None
        )
        for item in main_cc_expense_items
    ]

    # Conta logada - receitas de cartão de crédito
    main_cc_revenue_transaction_items = [
        TransactionItem(
            id=item.id,
            date=item.date,
            description=item.description or "Sem descrição",
            amount=item.amount,
            source_table="credit_card_invoices",
            tag_name=item.subtag.tag.name if item.subtag and item.subtag.tag else None,
            subtag_name=item.subtag.name if item.subtag else None,
            my_contribution_percentage=item.ownership_percentage,
            partner_contribution_percentage=Decimal(100) - item.ownership_percentage,
            year_month=item.year_month,
            card_id=item.credit_card.id if item.credit_card else None,
            card_name=item.credit_card.name if item.credit_card else None,
            card_number=item.credit_card.number if item.credit_card else None,
            card_active=item.credit_card.active if item.credit_card else None,
            card_closing_day=item.credit_card.closing_day if item.credit_card else None,
            card_type=item.credit_card.type if item.credit_card else None
        )
        for item in main_cc_revenue_items
    ]

    # Conta compartilhada - despesas de cartão de crédito
    shared_cc_expense_transaction_items = [
        TransactionItem(
            id=item.id,
            date=item.date,
            description=item.description or "Sem descrição",
            amount=item.amount,
            source_table="credit_card_invoices",
            tag_name=item.subtag.tag.name if item.subtag and item.subtag.tag else None,
            subtag_name=item.subtag.name if item.subtag else None,
            my_contribution_percentage=Decimal(100) - item.ownership_percentage,
            partner_contribution_percentage=item.ownership_percentage,
            year_month=item.year_month,
            card_id=item.credit_card.id if item.credit_card else None,
            card_name=item.credit_card.name if item.credit_card else None,
            card_number=item.credit_card.number if item.credit_card else None,
            card_active=item.credit_card.active if item.credit_card else None,
            card_closing_day=item.credit_card.closing_day if item.credit_card else None,
            card_type=item.credit_card.type if item.credit_card else None
        )
        for item in shared_cc_expense_items
    ]

    # Conta compartilhada - receitas de cartão de crédito
    shared_cc_revenue_transaction_items = [
        TransactionItem(
            id=item.id,
            date=item.date,
            description=item.description or "Sem descrição",
            amount=item.amount,
            source_table="credit_card_invoices",
            tag_name=item.subtag.tag.name if item.subtag and item.subtag.tag else None,
            subtag_name=item.subtag.name if item.subtag else None,
            my_contribution_percentage=Decimal(100) - item.ownership_percentage,
            partner_contribution_percentage=item.ownership_percentage,
            year_month=item.year_month,
            card_id=item.credit_card.id if item.credit_card else None,
            card_name=item.credit_card.name if item.credit_card else None,
            card_number=item.credit_card.number if item.credit_card else None,
            card_active=item.credit_card.active if item.credit_card else None,
            card_closing_day=item.credit_card.closing_day if item.credit_card else None,
            card_type=item.credit_card.type if item.credit_card else None
        )
        for item in shared_cc_revenue_items
    ]

    # ========== CONVERTE BENEFIT CARD STATEMENTS PARA TransactionItem ==========
    # Conta logada - despesas de cartão de benefícios
    main_bc_expense_transaction_items = [
        TransactionItem(
            id=item.id,
            date=item.date,  # BenefitCardStatement usa atributo 'date' (coluna 'datetime' no DB)
            description=item.description or "Sem descrição",
            amount=item.amount,
            source_table="benefit_card_statements",
            tag_name=item.subtag.tag.name if item.subtag and item.subtag.tag else None,
            subtag_name=item.subtag.name if item.subtag else None,
            my_contribution_percentage=item.ownership_percentage,
            partner_contribution_percentage=Decimal(100) - item.ownership_percentage,
            card_id=item.credit_card.id if item.credit_card else None,
            card_name=item.credit_card.name if item.credit_card else None,
            card_number=item.credit_card.number if item.credit_card else None,
            card_active=item.credit_card.active if item.credit_card else None,
            card_closing_day=item.credit_card.closing_day if item.credit_card else None,
            card_type=item.credit_card.type if item.credit_card else None
        )
        for item in main_bc_expense_items
    ]

    # Conta logada - receitas de cartão de benefícios
    main_bc_revenue_transaction_items = [
        TransactionItem(
            id=item.id,
            date=item.date,
            description=item.description or "Sem descrição",
            amount=item.amount,
            source_table="benefit_card_statements",
            tag_name=item.subtag.tag.name if item.subtag and item.subtag.tag else None,
            subtag_name=item.subtag.name if item.subtag else None,
            my_contribution_percentage=item.ownership_percentage,
            partner_contribution_percentage=Decimal(100) - item.ownership_percentage,
            card_id=item.credit_card.id if item.credit_card else None,
            card_name=item.credit_card.name if item.credit_card else None,
            card_number=item.credit_card.number if item.credit_card else None,
            card_active=item.credit_card.active if item.credit_card else None,
            card_closing_day=item.credit_card.closing_day if item.credit_card else None,
            card_type=item.credit_card.type if item.credit_card else None
        )
        for item in main_bc_revenue_items
    ]

    # Conta compartilhada - despesas de cartão de benefícios
    shared_bc_expense_transaction_items = [
        TransactionItem(
            id=item.id,
            date=item.date,
            description=item.description or "Sem descrição",
            amount=item.amount,
            source_table="benefit_card_statements",
            tag_name=item.subtag.tag.name if item.subtag and item.subtag.tag else None,
            subtag_name=item.subtag.name if item.subtag else None,
            my_contribution_percentage=Decimal(100) - item.ownership_percentage,
            partner_contribution_percentage=item.ownership_percentage,
            card_id=item.credit_card.id if item.credit_card else None,
            card_name=item.credit_card.name if item.credit_card else None,
            card_number=item.credit_card.number if item.credit_card else None,
            card_active=item.credit_card.active if item.credit_card else None,
            card_closing_day=item.credit_card.closing_day if item.credit_card else None,
            card_type=item.credit_card.type if item.credit_card else None
        )
        for item in shared_bc_expense_items
    ]

    # Conta compartilhada - receitas de cartão de benefícios
    shared_bc_revenue_transaction_items = [
        TransactionItem(
            id=item.id,
            date=item.date,
            description=item.description or "Sem descrição",
            amount=item.amount,
            source_table="benefit_card_statements",
            tag_name=item.subtag.tag.name if item.subtag and item.subtag.tag else None,
            subtag_name=item.subtag.name if item.subtag else None,
            my_contribution_percentage=Decimal(100) - item.ownership_percentage,
            partner_contribution_percentage=item.ownership_percentage,
            card_id=item.credit_card.id if item.credit_card else None,
            card_name=item.credit_card.name if item.credit_card else None,
            card_number=item.credit_card.number if item.credit_card else None,
            card_active=item.credit_card.active if item.credit_card else None,
            card_closing_day=item.credit_card.closing_day if item.credit_card else None,
            card_type=item.credit_card.type if item.credit_card else None
        )
        for item in shared_bc_revenue_items
    ]

    # Retorna resposta com conta logada como main e conta compartilhada como shared
    return BalanceCalculationResponse(
        main_account_card=AccountBalanceCard(
            account_id=logged_account.id,
            account_name=logged_account.name or "Sem nome",
            bank_name=logged_account.bank.name if logged_account.bank else None,
            agency=logged_account.agency,
            account_number=logged_account.account_number,
            total_expenses=main_total_a_receber,  # A receber (negativo)
            total_revenues=main_total_a_pagar,  # A pagar (positivo)
            net_amount=main_net,
            contribution_percentage=my_contribution_pct,
            status=main_status,
            expense_items=main_expense_transaction_items,
            revenue_items=main_revenue_transaction_items,
            credit_card_expense_items=main_cc_expense_transaction_items,
            credit_card_revenue_items=main_cc_revenue_transaction_items,
            benefit_card_expense_items=main_bc_expense_transaction_items,
            benefit_card_revenue_items=main_bc_revenue_transaction_items
        ),
        partner_account_card=AccountBalanceCard(
            account_id=partner_account.id,
            account_name=partner_account.name or "Sem nome",
            bank_name=partner_account.bank.name if partner_account.bank else None,
            agency=partner_account.agency,
            account_number=partner_account.account_number,
            total_expenses=shared_total_a_receber,  # A receber (negativo)
            total_revenues=shared_total_a_pagar,  # A pagar (positivo)
            net_amount=shared_net,
            contribution_percentage=partner_contribution_pct,
            status=shared_status,
            expense_items=shared_expense_transaction_items,
            revenue_items=shared_revenue_transaction_items,
            credit_card_expense_items=shared_cc_expense_transaction_items,
            credit_card_revenue_items=shared_cc_revenue_transaction_items,
            benefit_card_expense_items=shared_bc_expense_transaction_items,
            benefit_card_revenue_items=shared_bc_revenue_transaction_items
        ),
        year=year,
        start_date=start_date,
        end_date=end_date,
        calculation_date=datetime.now()
    )


# ==================== SCHEMAS - EMPRÉSTIMOS ====================

class OpenLoanItem(BaseModel):
    """Item de empréstimo aberto para balanço"""
    id: int
    loan_type: str  # 'lent' ou 'borrowed'
    description: str
    loan_date: datetime
    principal_amount: Decimal
    total_paid: Decimal
    remaining_balance: Decimal
    interest_enabled: bool
    interest_type: str | None
    interest_rate: Decimal | None
    interest_period: str | None
    counterpart_name: str | None
    counterpart_account_id: int | None

    class Config:
        from_attributes = True


class OpenLoansResponse(BaseModel):
    """Response para empréstimos abertos com um parceiro"""
    partner_account_id: int
    partner_account_name: str | None
    loans: List[OpenLoanItem]
    total_lent_remaining: Decimal  # Total que tenho a receber (emprestei)
    total_borrowed_remaining: Decimal  # Total que tenho a pagar (peguei emprestado)
    net_loan_balance: Decimal  # lent - borrowed

    class Config:
        from_attributes = True


# ==================== ENDPOINT - EMPRÉSTIMOS ====================

@router.get("/open-loans", response_model=OpenLoansResponse)
def get_open_loans_for_balance(
    partner_account_id: int = Query(..., description="ID da conta parceira"),
    max_date: str | None = Query(None, description="Data máxima para filtrar empréstimos (YYYY-MM-DD). Apenas empréstimos com loan_date <= max_date serão retornados."),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Busca empréstimos abertos entre a conta logada e uma conta parceira específica.

    Regras:
    - Apenas empréstimos criados pela conta logada (account_id = logged_account_id)
    - Apenas empréstimos com counterpart_account_id = partner_account_id (ignora externos)
    - Apenas empréstimos com status = 'open' e remaining_balance > 0
    - Se max_date fornecido: apenas empréstimos com loan_date <= max_date

    Retorna:
    - Lista de empréstimos com valores para preenchimento
    - Totais separados por tipo (lent = a receber, borrowed = a pagar)
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Buscar conta parceira
    partner_account = db.query(Account).filter(
        Account.id == partner_account_id,
        Account.tenant_id == tenant_id
    ).options(joinedload(Account.bank)).first()

    if not partner_account:
        raise HTTPException(status_code=404, detail="Conta parceira não encontrada")

    # Filtros base para empréstimos abertos:
    # - Criados pela conta logada (account_id)
    # - Com counterpart_account_id = partner_account_id (ignora externos)
    # - Status = 'open'
    # - Active = True
    filters = [
        Loan.account_id == account_id,
        Loan.tenant_id == tenant_id,
        Loan.counterpart_account_id == partner_account_id,
        Loan.status == 'open',
        Loan.active == True
    ]

    # Filtrar por data máxima (empréstimos que existiam até a data do período)
    if max_date:
        try:
            max_date_parsed = datetime.strptime(max_date, "%Y-%m-%d")
            # Incluir todo o dia (até 23:59:59)
            max_date_dt = max_date_parsed.replace(hour=23, minute=59, second=59)
            filters.append(Loan.loan_date <= max_date_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato de data inválido. Use YYYY-MM-DD")

    loans = db.query(Loan).filter(
        and_(*filters)
    ).options(
        joinedload(Loan.payments),
        joinedload(Loan.counterpart_account)
    ).order_by(Loan.loan_date.asc()).all()

    # Processar empréstimos
    loan_items = []
    total_lent_remaining = Decimal('0')
    total_borrowed_remaining = Decimal('0')

    for loan in loans:
        # Calcular total pago e saldo restante
        total_paid = sum(
            p.amount for p in loan.payments
            if p.active
        ) if loan.payments else Decimal('0')
        remaining = loan.principal_amount - total_paid

        # Ignorar se já foi totalmente pago
        if remaining <= 0:
            continue

        # Somar por tipo
        if loan.loan_type == 'lent':
            total_lent_remaining += remaining
        else:  # borrowed
            total_borrowed_remaining += remaining

        counterpart_name = None
        if loan.counterpart_account:
            counterpart_name = loan.counterpart_account.name

        loan_items.append(OpenLoanItem(
            id=loan.id,
            loan_type=loan.loan_type,
            description=loan.description,
            loan_date=loan.loan_date,
            principal_amount=loan.principal_amount,
            total_paid=total_paid,
            remaining_balance=remaining,
            interest_enabled=loan.interest_enabled,
            interest_type=loan.interest_type,
            interest_rate=loan.interest_rate,
            interest_period=loan.interest_period,
            counterpart_name=counterpart_name,
            counterpart_account_id=loan.counterpart_account_id
        ))

    # Net balance: positivo = a receber, negativo = a pagar
    net_loan_balance = total_lent_remaining - total_borrowed_remaining

    return OpenLoansResponse(
        partner_account_id=partner_account_id,
        partner_account_name=partner_account.name,
        loans=loan_items,
        total_lent_remaining=total_lent_remaining,
        total_borrowed_remaining=total_borrowed_remaining,
        net_loan_balance=net_loan_balance
    )

