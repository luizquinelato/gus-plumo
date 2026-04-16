"""
Router para relatórios - análise de gastos ao longo do tempo
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func, extract, or_, and_
from datetime import datetime, date, timedelta
from decimal import Decimal
from typing import List, Literal, Dict, Any
from pydantic import BaseModel, Field

from app.database import get_db
from app.models.unified_models import BankStatement, CreditCardInvoice, BenefitCardStatement, Tag, Subtag, Cartao, ExpenseSharingSetting, Account, Bank
from app.dependencies.auth import get_current_user

router = APIRouter(prefix="/api/reports", tags=["reports"])


# Schemas
class MonthlyData(BaseModel):
    """Dados de um mês específico"""
    year: int
    month: int
    year_month: str  # Formato: "2024-12"
    total: Decimal  # Total líquido (receitas + despesas)
    count: int
    income: Decimal = Decimal(0)  # Total de receitas (valores positivos)
    expenses: Decimal = Decimal(0)  # Total de despesas (valores negativos)
    income_count: int = 0  # Quantidade de transações de receita
    expenses_count: int = 0  # Quantidade de transações de despesa


class DailyData(BaseModel):
    """Dados de um dia específico"""
    date: str  # Formato: "2024-12-25"
    total: Decimal  # Total líquido (receitas + despesas)
    count: int
    income: Decimal = Decimal(0)  # Total de receitas (valores positivos)
    expenses: Decimal = Decimal(0)  # Total de despesas (valores negativos)
    income_count: int = 0  # Quantidade de transações de receita
    expenses_count: int = 0  # Quantidade de transações de despesa


class TimeSeriesResponse(BaseModel):
    """Resposta com série temporal de gastos"""
    data: List[MonthlyData | DailyData]
    total_amount: Decimal
    total_count: int
    total_income: Decimal  # Total de receitas (valores positivos)
    total_income_count: int  # Quantidade de transações de receita
    total_expenses: Decimal  # Total de despesas (valores negativos)
    total_expenses_count: int  # Quantidade de transações de despesa
    start_date: str  # Formato: "2024-01" ou "2024-01-15"
    end_date: str    # Formato: "2024-12" ou "2024-12-31"
    granularity: str = "monthly"  # "monthly" ou "daily"


class ExpenseDetail(BaseModel):
    """Detalhes de uma despesa individual"""
    id: int
    date: datetime  # Mantém datetime para preservar hora da transação
    description: str
    amount: Decimal
    source: str  # "bank", "card" ou "benefit"
    card_number: str | None = None
    card_name: str | None = None
    category: str | None = None
    subtag_id: int | None = None
    subtag_name: str | None = None
    tag_name: str | None = None
    current_installment: int | None = None
    total_installments: int | None = None
    adjustment_type: str | None = None  # 'proprio', 'compartilhado'
    ownership_percentage: Decimal | None = None
    expense_sharing_id: int | None = None  # ID da configuração de compartilhamento
    shared_partner_id: int | None = None  # ID da conta parceira (destino da inversão)
    shared_partner_name: str | None = None
    shared_partner_bank: str | None = None
    shared_partner_agency: str | None = None
    shared_partner_account_number: str | None = None
    account_id: int | None = None
    account_name: str | None = None
    bank_code: str | None = None
    bank_name: str | None = None
    account_agency: str | None = None
    account_number: str | None = None
    year_month: str | None = None  # Ano/mês da fatura (YYYY-MM) - usado apenas para faturas de cartão
    migrated_from_account_id: int | None = None  # ID da conta de origem - indica item invertido/migrado

    class Config:
        populate_by_name = True


class TopExpense(BaseModel):
    """Despesa agrupada (top gastos)"""
    description: str
    total: Decimal
    count: int
    percentage: float
    average_amount: Decimal  # Valor médio por ocorrência
    average_days_interval: float | None  # Intervalo médio em dias entre ocorrências
    first_date: date | None  # Data da primeira ocorrência
    last_date: date | None  # Data da última ocorrência
    trend: str | None  # Tendência: 'up', 'down', 'stable'


class DetailedReportResponse(BaseModel):
    """Resposta com relatório detalhado"""
    total_amount: Decimal
    total_count: int
    total_income: Decimal  # Total de receitas (valores positivos)
    total_income_count: int  # Quantidade de transações de receita
    total_expenses: Decimal  # Total de despesas (valores negativos)
    total_expenses_count: int  # Quantidade de transações de despesa
    expenses_trend: str | None  # Tendência de despesas: 'up', 'down', 'stable'
    income_trend: str | None  # Tendência de receitas: 'up', 'down', 'stable'
    top_expenses: List[TopExpense]
    expenses: List[ExpenseDetail]


class TagOption(BaseModel):
    """Opção de tag para filtro"""
    id: int
    name: str
    count: int = 0  # Quantidade de transações com esta tag


class SubtagOption(BaseModel):
    """Opção de subtag para filtro"""
    id: int
    name: str
    tag_id: int
    tag_name: str
    tag_type: str  # "receita" ou "despesa"
    count: int = 0  # Quantidade de transações com esta subtag


@router.get("/time-series", response_model=TimeSeriesResponse)
async def get_time_series(
    source: Literal["bank", "cards", "combined"] = Query("combined", description="Fonte dos dados"),
    start_date: str | None = Query(None, description="Data inicial (YYYY-MM-DD)"),
    end_date: str | None = Query(None, description="Data final (YYYY-MM-DD)"),
    start_year: int | None = Query(None, description="Ano inicial (default: primeiro registro)"),
    start_month: int | None = Query(None, description="Mês inicial (default: 1)"),
    end_year: int | None = Query(None, description="Ano final (default: ano atual)"),
    end_month: int | None = Query(None, description="Mês final (default: mês atual)"),
    tag_ids: str | None = Query(None, description="IDs de tags separados por vírgula"),
    subtag_ids: str | None = Query(None, description="IDs de subtags separados por vírgula"),
    partner_ids: str | None = Query(None, description="IDs de parceiros separados por vírgula"),
    include_empty_tag: bool = Query(False, description="Incluir itens sem tag (subtag_id IS NULL)"),
    include_empty_sharing: bool = Query(False, description="Incluir itens sem compartilhamento (expense_sharing_id IS NULL)"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Retorna série temporal de gastos ao longo do tempo.

    Args:
        source: Fonte dos dados ("bank", "cards", "combined")
        start_date: Data inicial no formato YYYY-MM-DD (prioridade sobre start_year/start_month)
        end_date: Data final no formato YYYY-MM-DD (prioridade sobre end_year/end_month)
        start_year: Ano inicial (default: primeiro registro)
        start_month: Mês inicial (default: 1)
        end_year: Ano final (default: ano atual)
        end_month: Mês final (default: mês atual)
        tag_ids: IDs de tags para filtrar (opcional)
        subtag_ids: IDs de subtags para filtrar (opcional)

    Returns:
        Série temporal com totais mensais
    """
    tenant_id = current_user.get("tenant_id", 1)
    logged_account_id = current_user.get("account_id")

    # Parse tag_ids, subtag_ids e partner_ids
    tag_id_list = [int(x) for x in tag_ids.split(',')] if tag_ids else None
    subtag_id_list = [int(x) for x in subtag_ids.split(',')] if subtag_ids else None
    partner_id_list = [int(x) for x in partner_ids.split(',')] if partner_ids else None

    # Define período - prioriza start_date/end_date
    now = datetime.now()
    use_daily_granularity = False
    start_date_obj = None
    end_date_obj = None

    if start_date and end_date:
        # Converte datas para ano/mês
        start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
        end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
        start_year = start_date_obj.year
        start_month = start_date_obj.month
        end_year = end_date_obj.year
        end_month = end_date_obj.month
    else:
        # Usa filtros antigos (ano/mês)
        end_year = end_year or now.year
        end_month = end_month or now.month

    # Se não especificou início, busca o primeiro registro
    if not start_year:
        if source in ["bank", "combined"]:
            # NOTA: BankStatement NÃO tem campo 'active' (não usa soft delete)
            bank_query = db.query(func.min(BankStatement.date)).filter(
                BankStatement.tenant_id == tenant_id
            )
            if logged_account_id:
                bank_query = bank_query.filter(BankStatement.account_id == logged_account_id)
            first_bank = bank_query.scalar()
            if first_bank:
                start_year = first_bank.year
                start_month = first_bank.month

        if source in ["cards", "combined"] and not start_year:
            # NOTA: CreditCardInvoice NÃO tem campo 'active' (não usa soft delete)
            first_card = db.query(func.min(CreditCardInvoice.date)).filter(
                CreditCardInvoice.tenant_id == tenant_id
            ).scalar()
            if first_card:
                start_year = first_card.year
                start_month = first_card.month

        # Fallback: ano atual
        if not start_year:
            start_year = now.year
            start_month = 1

    if not start_month:
        start_month = 1

    # Detecta granularidade baseado no período total
    # Se não temos start_date_obj/end_date_obj, cria a partir de start_year/month e end_year/month
    if not start_date_obj:
        start_date_obj = datetime(start_year, start_month, 1)
    if not end_date_obj:
        # Último dia do mês final
        if end_month == 12:
            end_date_obj = datetime(end_year, 12, 31)
        else:
            end_date_obj = datetime(end_year, end_month + 1, 1) - timedelta(days=1)

    # Calcula diferença em dias
    days_diff = (end_date_obj - start_date_obj).days

    # Se período < 30 dias, usa granularidade diária
    if days_diff < 30:
        use_daily_granularity = True

    # Busca dados conforme a fonte e granularidade
    time_series_data = []
    granularity = "monthly"

    if use_daily_granularity:
        # Usa granularidade diária
        granularity = "daily"
        start_date_for_query = start_date_obj.date()
        end_date_for_query = end_date_obj.date()

        if source == "bank":
            time_series_data = _get_bank_daily_time_series(db, tenant_id, logged_account_id, start_date_for_query, end_date_for_query, tag_id_list, subtag_id_list, partner_id_list, include_empty_tag, include_empty_sharing)
        elif source == "cards":
            time_series_data = _get_cards_daily_time_series(db, tenant_id, logged_account_id, start_date_for_query, end_date_for_query, tag_id_list, subtag_id_list, partner_id_list, include_empty_tag, include_empty_sharing)
        else:  # combined
            time_series_data = _get_combined_daily_time_series(db, tenant_id, logged_account_id, start_date_for_query, end_date_for_query, tag_id_list, subtag_id_list, partner_id_list, include_empty_tag, include_empty_sharing)
    else:
        # Usa granularidade mensal
        if source == "bank":
            time_series_data = _get_bank_time_series(db, tenant_id, logged_account_id, start_year, start_month, end_year, end_month, tag_id_list, subtag_id_list, partner_id_list, include_empty_tag, include_empty_sharing)
        elif source == "cards":
            time_series_data = _get_cards_time_series(db, tenant_id, logged_account_id, start_year, start_month, end_year, end_month, tag_id_list, subtag_id_list, partner_id_list, include_empty_tag, include_empty_sharing)
        else:  # combined
            time_series_data = _get_combined_time_series(db, tenant_id, logged_account_id, start_year, start_month, end_year, end_month, tag_id_list, subtag_id_list, partner_id_list, include_empty_tag, include_empty_sharing)

    # Calcula totais
    total_amount = sum(item.total for item in time_series_data)
    total_count = sum(item.count for item in time_series_data)

    # Calcula receitas e despesas separadamente
    total_income = sum(item.income for item in time_series_data)
    total_income_count = sum(item.income_count for item in time_series_data)
    total_expenses = sum(item.expenses for item in time_series_data)
    total_expenses_count = sum(item.expenses_count for item in time_series_data)

    # Define formato de data baseado na granularidade
    if use_daily_granularity:
        start_date_str = start_date_obj.strftime("%Y-%m-%d")
        end_date_str = end_date_obj.strftime("%Y-%m-%d")
    else:
        start_date_str = f"{start_year}-{str(start_month).zfill(2)}"
        end_date_str = f"{end_year}-{str(end_month).zfill(2)}"

    return TimeSeriesResponse(
        data=time_series_data,
        total_amount=total_amount,
        total_count=total_count,
        total_income=total_income,
        total_income_count=total_income_count,
        total_expenses=total_expenses,
        total_expenses_count=total_expenses_count,
        start_date=start_date_str,
        end_date=end_date_str,
        granularity=granularity
    )


def _get_bank_time_series(
    db: Session,
    tenant_id: int,
    account_id: int | None,
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
    tag_ids: List[int] | None = None,
    subtag_ids: List[int] | None = None,
    partner_ids: List[int] | None = None,
    include_empty_tag: bool = False,
    include_empty_sharing: bool = False
) -> List[MonthlyData]:
    """Busca série temporal de extratos bancários (filtra pela data da transação)"""
    from sqlalchemy import case

    query = db.query(
        extract('year', BankStatement.date).label('year'),
        extract('month', BankStatement.date).label('month'),
        func.sum(BankStatement.amount).label('total'),
        func.count(BankStatement.id).label('count'),
        func.sum(case((BankStatement.amount > 0, BankStatement.amount), else_=0)).label('income'),
        func.sum(case((BankStatement.amount < 0, BankStatement.amount), else_=0)).label('expenses'),
        func.count(case((BankStatement.amount > 0, BankStatement.id), else_=None)).label('income_count'),
        func.count(case((BankStatement.amount < 0, BankStatement.id), else_=None)).label('expenses_count')
    ).filter(
        BankStatement.tenant_id == tenant_id
        # NOTA: BankStatement NÃO tem campo 'active' (não usa soft delete)
    )

    # Filtra por account_id se fornecido
    if account_id:
        query = query.filter(BankStatement.account_id == account_id)

    # Aplica filtros de período
    query = query.filter(
        or_(
            and_(
                extract('year', BankStatement.date) == start_year,
                extract('month', BankStatement.date) >= start_month
            ),
            extract('year', BankStatement.date) > start_year
        ),
        or_(
            and_(
                extract('year', BankStatement.date) == end_year,
                extract('month', BankStatement.date) <= end_month
            ),
            extract('year', BankStatement.date) < end_year
        )
    )

    # Aplica filtros de tags/subtags (com suporte a "Vazio")
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

    # Aplica filtros de compartilhamento (com suporte a "Vazio")
    if partner_ids or include_empty_sharing:
        sharing_conditions = []
        if partner_ids:
            sharing_conditions.append(BankStatement.expense_sharing_id.in_(partner_ids))
        if include_empty_sharing:
            sharing_conditions.append(BankStatement.expense_sharing_id.is_(None))
        if sharing_conditions:
            query = query.filter(or_(*sharing_conditions))

    results = query.group_by(
        extract('year', BankStatement.date),
        extract('month', BankStatement.date)
    ).order_by('year', 'month').all()

    return [
        MonthlyData(
            year=int(r.year),
            month=int(r.month),
            year_month=f"{int(r.year)}-{str(int(r.month)).zfill(2)}",
            total=r.total or Decimal(0),
            count=r.count or 0,
            income=r.income or Decimal(0),
            expenses=r.expenses or Decimal(0),
            income_count=r.income_count or 0,
            expenses_count=r.expenses_count or 0
        )
        for r in results
    ]


def _get_cards_time_series(
    db: Session,
    tenant_id: int,
    account_id: int | None,
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
    tag_ids: List[int] | None = None,
    subtag_ids: List[int] | None = None,
    partner_ids: List[int] | None = None,
    include_empty_tag: bool = False,
    include_empty_sharing: bool = False
) -> List[MonthlyData]:
    """Busca série temporal de faturas de cartão (filtra pela data da transação, não year_month)"""
    from sqlalchemy import case

    query = db.query(
        extract('year', CreditCardInvoice.date).label('year'),
        extract('month', CreditCardInvoice.date).label('month'),
        func.sum(CreditCardInvoice.amount).label('total'),
        func.count(CreditCardInvoice.id).label('count'),
        func.sum(case((CreditCardInvoice.amount > 0, CreditCardInvoice.amount), else_=0)).label('income'),
        func.sum(case((CreditCardInvoice.amount < 0, CreditCardInvoice.amount), else_=0)).label('expenses'),
        func.count(case((CreditCardInvoice.amount > 0, CreditCardInvoice.id), else_=None)).label('income_count'),
        func.count(case((CreditCardInvoice.amount < 0, CreditCardInvoice.id), else_=None)).label('expenses_count')
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id
        # NOTA: CreditCardInvoice NÃO tem campo 'active' (não usa soft delete)
    )

    # Filtra por account_id se fornecido
    if account_id:
        query = query.filter(CreditCardInvoice.account_id == account_id)

    # Aplica filtros de período
    query = query.filter(
        or_(
            and_(
                extract('year', CreditCardInvoice.date) == start_year,
                extract('month', CreditCardInvoice.date) >= start_month
            ),
            extract('year', CreditCardInvoice.date) > start_year
        ),
        or_(
            and_(
                extract('year', CreditCardInvoice.date) == end_year,
                extract('month', CreditCardInvoice.date) <= end_month
            ),
            extract('year', CreditCardInvoice.date) < end_year
        )
    )

    # Aplica filtros de tags/subtags (com suporte a "Vazio")
    if subtag_ids or tag_ids or include_empty_tag:
        tag_conditions = []
        if subtag_ids:
            tag_conditions.append(CreditCardInvoice.subtag_id.in_(subtag_ids))
        elif tag_ids:
            subtag_query = db.query(Subtag.id).filter(Subtag.tag_id.in_(tag_ids))
            tag_conditions.append(CreditCardInvoice.subtag_id.in_(subtag_query))
        if include_empty_tag:
            tag_conditions.append(CreditCardInvoice.subtag_id.is_(None))
        if tag_conditions:
            query = query.filter(or_(*tag_conditions))

    # Aplica filtros de compartilhamento (com suporte a "Vazio")
    if partner_ids or include_empty_sharing:
        sharing_conditions = []
        if partner_ids:
            sharing_conditions.append(CreditCardInvoice.expense_sharing_id.in_(partner_ids))
        if include_empty_sharing:
            sharing_conditions.append(CreditCardInvoice.expense_sharing_id.is_(None))
        if sharing_conditions:
            query = query.filter(or_(*sharing_conditions))

    results = query.group_by(
        extract('year', CreditCardInvoice.date),
        extract('month', CreditCardInvoice.date)
    ).order_by('year', 'month').all()

    return [
        MonthlyData(
            year=int(r.year),
            month=int(r.month),
            year_month=f"{int(r.year)}-{str(int(r.month)).zfill(2)}",
            total=r.total or Decimal(0),
            count=r.count or 0,
            income=r.income or Decimal(0),
            expenses=r.expenses or Decimal(0),
            income_count=r.income_count or 0,
            expenses_count=r.expenses_count or 0
        )
        for r in results
    ]


def _get_combined_time_series(
    db: Session,
    tenant_id: int,
    account_id: int | None,
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
    tag_ids: List[int] | None = None,
    subtag_ids: List[int] | None = None,
    partner_ids: List[int] | None = None,
    include_empty_tag: bool = False,
    include_empty_sharing: bool = False
) -> List[MonthlyData]:
    """
    Busca série temporal combinada (extratos + cartões).
    Usa o campo 'date' de ambas as tabelas para alinhar as datas.
    """
    # Busca extratos bancários
    from sqlalchemy import case

    bank_query = db.query(
        extract('year', BankStatement.date).label('year'),
        extract('month', BankStatement.date).label('month'),
        func.sum(BankStatement.amount).label('total'),
        func.count(BankStatement.id).label('count'),
        func.sum(case((BankStatement.amount > 0, BankStatement.amount), else_=0)).label('income'),
        func.sum(case((BankStatement.amount < 0, BankStatement.amount), else_=0)).label('expenses'),
        func.count(case((BankStatement.amount > 0, BankStatement.id), else_=None)).label('income_count'),
        func.count(case((BankStatement.amount < 0, BankStatement.amount), else_=None)).label('expenses_count')
    ).filter(
        BankStatement.tenant_id == tenant_id
        # NOTA: BankStatement NÃO tem campo 'active' (não usa soft delete)
    )

    # Filtra por account_id se fornecido
    if account_id:
        bank_query = bank_query.filter(BankStatement.account_id == account_id)

    # Aplica filtros de período para extratos
    bank_query = bank_query.filter(
        or_(
            and_(
                extract('year', BankStatement.date) == start_year,
                extract('month', BankStatement.date) >= start_month
            ),
            extract('year', BankStatement.date) > start_year
        ),
        or_(
            and_(
                extract('year', BankStatement.date) == end_year,
                extract('month', BankStatement.date) <= end_month
            ),
            extract('year', BankStatement.date) < end_year
        )
    )

    # Aplica filtros de tags/subtags para extratos (com suporte a "Vazio")
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
            bank_query = bank_query.filter(or_(*tag_conditions))

    # Aplica filtros de compartilhamento para extratos (com suporte a "Vazio")
    if partner_ids or include_empty_sharing:
        sharing_conditions = []
        if partner_ids:
            sharing_conditions.append(BankStatement.expense_sharing_id.in_(partner_ids))
        if include_empty_sharing:
            sharing_conditions.append(BankStatement.expense_sharing_id.is_(None))
        if sharing_conditions:
            bank_query = bank_query.filter(or_(*sharing_conditions))

    bank_results = bank_query.group_by(
        extract('year', BankStatement.date),
        extract('month', BankStatement.date)
    ).all()

    # Busca faturas de cartão (usando date, não year_month)
    card_query = db.query(
        extract('year', CreditCardInvoice.date).label('year'),
        extract('month', CreditCardInvoice.date).label('month'),
        func.sum(CreditCardInvoice.amount).label('total'),
        func.count(CreditCardInvoice.id).label('count'),
        func.sum(case((CreditCardInvoice.amount > 0, CreditCardInvoice.amount), else_=0)).label('income'),
        func.sum(case((CreditCardInvoice.amount < 0, CreditCardInvoice.amount), else_=0)).label('expenses'),
        func.count(case((CreditCardInvoice.amount > 0, CreditCardInvoice.id), else_=None)).label('income_count'),
        func.count(case((CreditCardInvoice.amount < 0, CreditCardInvoice.id), else_=None)).label('expenses_count')
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id
        # NOTA: CreditCardInvoice NÃO tem campo 'active' (não usa soft delete)
    )

    # Filtra por account_id se fornecido
    if account_id:
        card_query = card_query.filter(CreditCardInvoice.account_id == account_id)

    # Aplica filtros de período para cartões
    card_query = card_query.filter(
        or_(
            and_(
                extract('year', CreditCardInvoice.date) == start_year,
                extract('month', CreditCardInvoice.date) >= start_month
            ),
            extract('year', CreditCardInvoice.date) > start_year
        ),
        or_(
            and_(
                extract('year', CreditCardInvoice.date) == end_year,
                extract('month', CreditCardInvoice.date) <= end_month
            ),
            extract('year', CreditCardInvoice.date) < end_year
        )
    )

    # Aplica filtros de tags/subtags para cartões (com suporte a "Vazio")
    if subtag_ids or tag_ids or include_empty_tag:
        tag_conditions = []
        if subtag_ids:
            tag_conditions.append(CreditCardInvoice.subtag_id.in_(subtag_ids))
        elif tag_ids:
            subtag_query = db.query(Subtag.id).filter(Subtag.tag_id.in_(tag_ids))
            tag_conditions.append(CreditCardInvoice.subtag_id.in_(subtag_query))
        if include_empty_tag:
            tag_conditions.append(CreditCardInvoice.subtag_id.is_(None))
        if tag_conditions:
            card_query = card_query.filter(or_(*tag_conditions))

    # Aplica filtros de compartilhamento para cartões (com suporte a "Vazio")
    if partner_ids or include_empty_sharing:
        sharing_conditions = []
        if partner_ids:
            sharing_conditions.append(CreditCardInvoice.expense_sharing_id.in_(partner_ids))
        if include_empty_sharing:
            sharing_conditions.append(CreditCardInvoice.expense_sharing_id.is_(None))
        if sharing_conditions:
            card_query = card_query.filter(or_(*sharing_conditions))

    card_results = card_query.group_by(
        extract('year', CreditCardInvoice.date),
        extract('month', CreditCardInvoice.date)
    ).all()

    # Busca extratos de cartões de benefícios
    benefit_query = db.query(
        extract('year', BenefitCardStatement.date).label('year'),
        extract('month', BenefitCardStatement.date).label('month'),
        func.sum(BenefitCardStatement.amount).label('total'),
        func.count(BenefitCardStatement.id).label('count'),
        func.sum(case((BenefitCardStatement.amount > 0, BenefitCardStatement.amount), else_=0)).label('income'),
        func.sum(case((BenefitCardStatement.amount < 0, BenefitCardStatement.amount), else_=0)).label('expenses'),
        func.count(case((BenefitCardStatement.amount > 0, BenefitCardStatement.id), else_=None)).label('income_count'),
        func.count(case((BenefitCardStatement.amount < 0, BenefitCardStatement.id), else_=None)).label('expenses_count')
    ).filter(
        BenefitCardStatement.tenant_id == tenant_id
        # NOTA: BenefitCardStatement NÃO tem campo 'active' (não usa soft delete)
    )

    # Filtra por account_id se fornecido
    if account_id:
        benefit_query = benefit_query.filter(BenefitCardStatement.account_id == account_id)

    # Aplica filtros de período para benefícios
    benefit_query = benefit_query.filter(
        or_(
            and_(
                extract('year', BenefitCardStatement.date) == start_year,
                extract('month', BenefitCardStatement.date) >= start_month
            ),
            extract('year', BenefitCardStatement.date) > start_year
        ),
        or_(
            and_(
                extract('year', BenefitCardStatement.date) == end_year,
                extract('month', BenefitCardStatement.date) <= end_month
            ),
            extract('year', BenefitCardStatement.date) < end_year
        )
    )

    # Aplica filtros de tags/subtags para benefícios (com suporte a "Vazio")
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
            benefit_query = benefit_query.filter(or_(*tag_conditions))

    # Aplica filtros de compartilhamento para benefícios (com suporte a "Vazio")
    if partner_ids or include_empty_sharing:
        sharing_conditions = []
        if partner_ids:
            sharing_conditions.append(BenefitCardStatement.expense_sharing_id.in_(partner_ids))
        if include_empty_sharing:
            sharing_conditions.append(BenefitCardStatement.expense_sharing_id.is_(None))
        if sharing_conditions:
            benefit_query = benefit_query.filter(or_(*sharing_conditions))

    benefit_results = benefit_query.group_by(
        extract('year', BenefitCardStatement.date),
        extract('month', BenefitCardStatement.date)
    ).all()

    # Combina resultados em um dicionário
    combined = {}

    for r in bank_results:
        key = (int(r.year), int(r.month))
        combined[key] = {
            'total': r.total or Decimal(0),
            'count': r.count or 0,
            'income': r.income or Decimal(0),
            'expenses': r.expenses or Decimal(0),
            'income_count': r.income_count or 0,
            'expenses_count': r.expenses_count or 0
        }

    for r in card_results:
        key = (int(r.year), int(r.month))
        if key in combined:
            combined[key]['total'] += r.total or Decimal(0)
            combined[key]['count'] += r.count or 0
            combined[key]['income'] += r.income or Decimal(0)
            combined[key]['expenses'] += r.expenses or Decimal(0)
            combined[key]['income_count'] += r.income_count or 0
            combined[key]['expenses_count'] += r.expenses_count or 0
        else:
            combined[key] = {
                'total': r.total or Decimal(0),
                'count': r.count or 0,
                'income': r.income or Decimal(0),
                'expenses': r.expenses or Decimal(0),
                'income_count': r.income_count or 0,
                'expenses_count': r.expenses_count or 0
            }

    # Adiciona resultados de cartões de benefícios
    for r in benefit_results:
        key = (int(r.year), int(r.month))
        if key in combined:
            combined[key]['total'] += r.total or Decimal(0)
            combined[key]['count'] += r.count or 0
            combined[key]['income'] += r.income or Decimal(0)
            combined[key]['expenses'] += r.expenses or Decimal(0)
            combined[key]['income_count'] += r.income_count or 0
            combined[key]['expenses_count'] += r.expenses_count or 0
        else:
            combined[key] = {
                'total': r.total or Decimal(0),
                'count': r.count or 0,
                'income': r.income or Decimal(0),
                'expenses': r.expenses or Decimal(0),
                'income_count': r.income_count or 0,
                'expenses_count': r.expenses_count or 0
            }

    # Converte para lista ordenada
    return [
        MonthlyData(
            year=year,
            month=month,
            year_month=f"{year}-{str(month).zfill(2)}",
            total=data['total'],
            count=data['count'],
            income=data['income'],
            expenses=data['expenses'],
            income_count=data['income_count'],
            expenses_count=data['expenses_count']
        )
        for (year, month), data in sorted(combined.items())
    ]


def _get_bank_daily_time_series(
    db: Session,
    tenant_id: int,
    account_id: int | None,
    start_date: date,
    end_date: date,
    tag_ids: List[int] | None = None,
    subtag_ids: List[int] | None = None,
    partner_ids: List[int] | None = None,
    include_empty_tag: bool = False,
    include_empty_sharing: bool = False
) -> List[DailyData]:
    """Busca série temporal diária de extratos bancários"""
    from sqlalchemy import case, Date

    query = db.query(
        func.cast(BankStatement.date, Date).label('date'),
        func.sum(BankStatement.amount).label('total'),
        func.count(BankStatement.id).label('count'),
        func.sum(case((BankStatement.amount > 0, BankStatement.amount), else_=0)).label('income'),
        func.sum(case((BankStatement.amount < 0, BankStatement.amount), else_=0)).label('expenses'),
        func.count(case((BankStatement.amount > 0, BankStatement.id), else_=None)).label('income_count'),
        func.count(case((BankStatement.amount < 0, BankStatement.id), else_=None)).label('expenses_count')
    ).filter(
        BankStatement.tenant_id == tenant_id,
        # NOTA: BankStatement NÃO tem campo 'active' (não usa soft delete)
        BankStatement.date >= start_date,
        BankStatement.date <= end_date
    )

    # Filtra por account_id se fornecido
    if account_id:
        query = query.filter(BankStatement.account_id == account_id)

    # Aplica filtros de tags/subtags (com suporte a "Vazio")
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

    # Aplica filtros de compartilhamento (com suporte a "Vazio")
    if partner_ids or include_empty_sharing:
        sharing_conditions = []
        if partner_ids:
            sharing_conditions.append(BankStatement.expense_sharing_id.in_(partner_ids))
        if include_empty_sharing:
            sharing_conditions.append(BankStatement.expense_sharing_id.is_(None))
        if sharing_conditions:
            query = query.filter(or_(*sharing_conditions))

    results = query.group_by(func.cast(BankStatement.date, Date)).all()

    return [
        DailyData(
            date=r.date.strftime('%Y-%m-%d'),
            total=r.total or Decimal(0),
            count=r.count or 0,
            income=r.income or Decimal(0),
            expenses=r.expenses or Decimal(0),
            income_count=r.income_count or 0,
            expenses_count=r.expenses_count or 0
        )
        for r in results
    ]


def _get_cards_daily_time_series(
    db: Session,
    tenant_id: int,
    account_id: int | None,
    start_date: date,
    end_date: date,
    tag_ids: List[int] | None = None,
    subtag_ids: List[int] | None = None,
    partner_ids: List[int] | None = None,
    include_empty_tag: bool = False,
    include_empty_sharing: bool = False
) -> List[DailyData]:
    """Busca série temporal diária de faturas de cartão"""
    from sqlalchemy import case, Date

    query = db.query(
        func.cast(CreditCardInvoice.date, Date).label('date'),
        func.sum(CreditCardInvoice.amount).label('total'),
        func.count(CreditCardInvoice.id).label('count'),
        func.sum(case((CreditCardInvoice.amount > 0, CreditCardInvoice.amount), else_=0)).label('income'),
        func.sum(case((CreditCardInvoice.amount < 0, CreditCardInvoice.amount), else_=0)).label('expenses'),
        func.count(case((CreditCardInvoice.amount > 0, CreditCardInvoice.id), else_=None)).label('income_count'),
        func.count(case((CreditCardInvoice.amount < 0, CreditCardInvoice.id), else_=None)).label('expenses_count')
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        # NOTA: CreditCardInvoice NÃO tem campo 'active' (não usa soft delete)
        CreditCardInvoice.date >= start_date,
        CreditCardInvoice.date <= end_date
    )

    # Filtra por account_id se fornecido
    if account_id:
        query = query.filter(CreditCardInvoice.account_id == account_id)

    # Aplica filtros de tags/subtags (com suporte a "Vazio")
    if subtag_ids or tag_ids or include_empty_tag:
        tag_conditions = []
        if subtag_ids:
            tag_conditions.append(CreditCardInvoice.subtag_id.in_(subtag_ids))
        elif tag_ids:
            subtag_query = db.query(Subtag.id).filter(Subtag.tag_id.in_(tag_ids))
            tag_conditions.append(CreditCardInvoice.subtag_id.in_(subtag_query))
        if include_empty_tag:
            tag_conditions.append(CreditCardInvoice.subtag_id.is_(None))
        if tag_conditions:
            query = query.filter(or_(*tag_conditions))

    # Aplica filtros de compartilhamento (com suporte a "Vazio")
    if partner_ids or include_empty_sharing:
        sharing_conditions = []
        if partner_ids:
            sharing_conditions.append(CreditCardInvoice.expense_sharing_id.in_(partner_ids))
        if include_empty_sharing:
            sharing_conditions.append(CreditCardInvoice.expense_sharing_id.is_(None))
        if sharing_conditions:
            query = query.filter(or_(*sharing_conditions))

    results = query.group_by(func.cast(CreditCardInvoice.date, Date)).all()

    return [
        DailyData(
            date=r.date.strftime('%Y-%m-%d'),
            total=r.total or Decimal(0),
            count=r.count or 0,
            income=r.income or Decimal(0),
            expenses=r.expenses or Decimal(0),
            income_count=r.income_count or 0,
            expenses_count=r.expenses_count or 0
        )
        for r in results
    ]


def _get_combined_daily_time_series(
    db: Session,
    tenant_id: int,
    account_id: int | None,
    start_date: date,
    end_date: date,
    tag_ids: List[int] | None = None,
    subtag_ids: List[int] | None = None,
    partner_ids: List[int] | None = None,
    include_empty_tag: bool = False,
    include_empty_sharing: bool = False
) -> List[DailyData]:
    """Busca série temporal diária combinada (extratos + cartões)"""
    from sqlalchemy import case, Date

    # Converte start_date e end_date para DATETIME para comparação correta
    # BankStatement.date e CreditCardInvoice.date são DATETIME
    start_datetime = datetime.combine(start_date, datetime.min.time())

    # Prepara filtros de data para extratos bancários
    bank_date_filters = [
        BankStatement.tenant_id == tenant_id,
        BankStatement.date >= start_datetime
    ]
    if end_date is not None:
        end_datetime = datetime.combine(end_date, datetime.min.time())
        bank_date_filters.append(BankStatement.date < end_datetime)

    # Adiciona filtro de account_id se fornecido
    if account_id:
        bank_date_filters.append(BankStatement.account_id == account_id)

    # Busca extratos bancários
    bank_query = db.query(
        func.cast(BankStatement.date, Date).label('date'),
        func.sum(BankStatement.amount).label('total'),
        func.count(BankStatement.id).label('count'),
        func.sum(case((BankStatement.amount > 0, BankStatement.amount), else_=0)).label('income'),
        func.sum(case((BankStatement.amount < 0, BankStatement.amount), else_=0)).label('expenses'),
        func.count(case((BankStatement.amount > 0, BankStatement.id), else_=None)).label('income_count'),
        func.count(case((BankStatement.amount < 0, BankStatement.id), else_=None)).label('expenses_count')
    ).filter(
        *bank_date_filters
        # NOTA: BankStatement NÃO tem campo 'active' (não usa soft delete)
    )

    # Aplica filtros de tags/subtags para extratos (com suporte a "Vazio")
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
            bank_query = bank_query.filter(or_(*tag_conditions))

    # Aplica filtros de compartilhamento para extratos (com suporte a "Vazio")
    if partner_ids or include_empty_sharing:
        sharing_conditions = []
        if partner_ids:
            sharing_conditions.append(BankStatement.expense_sharing_id.in_(partner_ids))
        if include_empty_sharing:
            sharing_conditions.append(BankStatement.expense_sharing_id.is_(None))
        if sharing_conditions:
            bank_query = bank_query.filter(or_(*sharing_conditions))

    bank_results = bank_query.group_by(func.cast(BankStatement.date, Date)).all()

    # Prepara filtros de data para faturas de cartão
    card_date_filters = [
        CreditCardInvoice.tenant_id == tenant_id,
        CreditCardInvoice.date >= start_datetime
    ]
    if end_date is not None:
        card_date_filters.append(CreditCardInvoice.date < end_datetime)

    # Adiciona filtro de account_id se fornecido
    if account_id:
        card_date_filters.append(CreditCardInvoice.account_id == account_id)

    # Busca faturas de cartão
    card_query = db.query(
        func.cast(CreditCardInvoice.date, Date).label('date'),
        func.sum(CreditCardInvoice.amount).label('total'),
        func.count(CreditCardInvoice.id).label('count'),
        func.sum(case((CreditCardInvoice.amount > 0, CreditCardInvoice.amount), else_=0)).label('income'),
        func.sum(case((CreditCardInvoice.amount < 0, CreditCardInvoice.amount), else_=0)).label('expenses'),
        func.count(case((CreditCardInvoice.amount > 0, CreditCardInvoice.id), else_=None)).label('income_count'),
        func.count(case((CreditCardInvoice.amount < 0, CreditCardInvoice.id), else_=None)).label('expenses_count')
    ).filter(
        *card_date_filters
        # NOTA: CreditCardInvoice NÃO tem campo 'active' (não usa soft delete)
    )

    # Aplica filtros de tags/subtags para cartões (com suporte a "Vazio")
    if subtag_ids or tag_ids or include_empty_tag:
        tag_conditions = []
        if subtag_ids:
            tag_conditions.append(CreditCardInvoice.subtag_id.in_(subtag_ids))
        elif tag_ids:
            subtag_query = db.query(Subtag.id).filter(Subtag.tag_id.in_(tag_ids))
            tag_conditions.append(CreditCardInvoice.subtag_id.in_(subtag_query))
        if include_empty_tag:
            tag_conditions.append(CreditCardInvoice.subtag_id.is_(None))
        if tag_conditions:
            card_query = card_query.filter(or_(*tag_conditions))

    # Aplica filtros de compartilhamento para cartões (com suporte a "Vazio")
    if partner_ids or include_empty_sharing:
        sharing_conditions = []
        if partner_ids:
            sharing_conditions.append(CreditCardInvoice.expense_sharing_id.in_(partner_ids))
        if include_empty_sharing:
            sharing_conditions.append(CreditCardInvoice.expense_sharing_id.is_(None))
        if sharing_conditions:
            card_query = card_query.filter(or_(*sharing_conditions))

    card_results = card_query.group_by(func.cast(CreditCardInvoice.date, Date)).all()

    # Prepara filtros de data para cartões de benefícios
    # NOTA: BenefitCardStatement NÃO tem campo 'active' (não usa soft delete)
    benefit_date_filters = [
        BenefitCardStatement.tenant_id == tenant_id,
        BenefitCardStatement.date >= start_datetime
    ]
    if end_date is not None:
        benefit_date_filters.append(BenefitCardStatement.date < end_datetime)

    # Adiciona filtro de account_id se fornecido
    if account_id:
        benefit_date_filters.append(BenefitCardStatement.account_id == account_id)

    # Busca extratos de cartões de benefícios
    benefit_query = db.query(
        func.cast(BenefitCardStatement.date, Date).label('date'),
        func.sum(BenefitCardStatement.amount).label('total'),
        func.count(BenefitCardStatement.id).label('count'),
        func.sum(case((BenefitCardStatement.amount > 0, BenefitCardStatement.amount), else_=0)).label('income'),
        func.sum(case((BenefitCardStatement.amount < 0, BenefitCardStatement.amount), else_=0)).label('expenses'),
        func.count(case((BenefitCardStatement.amount > 0, BenefitCardStatement.id), else_=None)).label('income_count'),
        func.count(case((BenefitCardStatement.amount < 0, BenefitCardStatement.id), else_=None)).label('expenses_count')
    ).filter(
        *benefit_date_filters
    )

    # Aplica filtros de tags/subtags para benefícios (com suporte a "Vazio")
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
            benefit_query = benefit_query.filter(or_(*tag_conditions))

    # Aplica filtros de compartilhamento para benefícios (com suporte a "Vazio")
    if partner_ids or include_empty_sharing:
        sharing_conditions = []
        if partner_ids:
            sharing_conditions.append(BenefitCardStatement.expense_sharing_id.in_(partner_ids))
        if include_empty_sharing:
            sharing_conditions.append(BenefitCardStatement.expense_sharing_id.is_(None))
        if sharing_conditions:
            benefit_query = benefit_query.filter(or_(*sharing_conditions))

    benefit_results = benefit_query.group_by(func.cast(BenefitCardStatement.date, Date)).all()

    # Combina resultados em um dicionário
    combined = {}

    for r in bank_results:
        date_str = r.date.strftime('%Y-%m-%d')
        combined[date_str] = {
            'total': r.total or Decimal(0),
            'count': r.count or 0,
            'income': r.income or Decimal(0),
            'expenses': r.expenses or Decimal(0),
            'income_count': r.income_count or 0,
            'expenses_count': r.expenses_count or 0
        }

    for r in card_results:
        date_str = r.date.strftime('%Y-%m-%d')
        if date_str in combined:
            combined[date_str]['total'] += r.total or Decimal(0)
            combined[date_str]['count'] += r.count or 0
            combined[date_str]['income'] += r.income or Decimal(0)
            combined[date_str]['expenses'] += r.expenses or Decimal(0)
            combined[date_str]['income_count'] += r.income_count or 0
            combined[date_str]['expenses_count'] += r.expenses_count or 0
        else:
            combined[date_str] = {
                'total': r.total or Decimal(0),
                'count': r.count or 0,
                'income': r.income or Decimal(0),
                'expenses': r.expenses or Decimal(0),
                'income_count': r.income_count or 0,
                'expenses_count': r.expenses_count or 0
            }

    # Adiciona resultados de cartões de benefícios
    for r in benefit_results:
        date_str = r.date.strftime('%Y-%m-%d')
        if date_str in combined:
            combined[date_str]['total'] += r.total or Decimal(0)
            combined[date_str]['count'] += r.count or 0
            combined[date_str]['income'] += r.income or Decimal(0)
            combined[date_str]['expenses'] += r.expenses or Decimal(0)
            combined[date_str]['income_count'] += r.income_count or 0
            combined[date_str]['expenses_count'] += r.expenses_count or 0
        else:
            combined[date_str] = {
                'total': r.total or Decimal(0),
                'count': r.count or 0,
                'income': r.income or Decimal(0),
                'expenses': r.expenses or Decimal(0),
                'income_count': r.income_count or 0,
                'expenses_count': r.expenses_count or 0
            }

    # Converte para lista ordenada
    return [
        DailyData(
            date=date_str,
            total=data['total'],
            count=data['count'],
            income=data['income'],
            expenses=data['expenses'],
            income_count=data['income_count'],
            expenses_count=data['expenses_count']
        )
        for date_str, data in sorted(combined.items())
    ]


@router.get("/tags", response_model=List[TagOption])
async def get_tags(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Retorna lista de tags disponíveis para filtro com contagem de transações"""
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    # NOTA: Tag NÃO tem campo 'active' (não usa soft delete)
    # Filtra por account_id para evitar duplicação (cada conta tem suas próprias tags)
    query = db.query(Tag).filter(Tag.tenant_id == tenant_id)
    if account_id:
        query = query.filter(Tag.account_id == account_id)
    tags = query.order_by(Tag.name).all()

    # Calcula count para cada tag (soma de bank_statements + credit_card_invoices + benefit_card_statements)
    from app.models.unified_models import BenefitCardStatement

    result = []
    for tag in tags:
        # Busca subtags desta tag
        subtag_ids = [s.id for s in db.query(Subtag.id).filter(Subtag.tag_id == tag.id).all()]

        if not subtag_ids:
            result.append(TagOption(id=tag.id, name=tag.name, count=0))
            continue

        # Conta transações em bank_statements
        bank_count = db.query(func.count(BankStatement.id)).filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.subtag_id.in_(subtag_ids)
        ).scalar() or 0

        # Conta transações em credit_card_invoices
        card_count = db.query(func.count(CreditCardInvoice.id)).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.subtag_id.in_(subtag_ids)
        ).scalar() or 0

        # Conta transações em benefit_card_statements
        benefit_count = db.query(func.count(BenefitCardStatement.id)).filter(
            BenefitCardStatement.tenant_id == tenant_id,
            BenefitCardStatement.subtag_id.in_(subtag_ids)
        ).scalar() or 0

        total_count = bank_count + card_count + benefit_count
        result.append(TagOption(id=tag.id, name=tag.name, count=total_count))

    return result


@router.get("/subtags", response_model=List[SubtagOption])
async def get_subtags(
    tag_id: int | None = Query(None, description="Filtrar por tag_id"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Retorna lista de subtags disponíveis para filtro com contagem de transações"""
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
    # Filtra por account_id para evitar duplicação (cada conta tem suas próprias subtags)
    query = db.query(
        Subtag,
        Tag.name.label('tag_name')
    ).join(
        Tag, Subtag.tag_id == Tag.id
    ).filter(
        Subtag.tenant_id == tenant_id
    )
    if account_id:
        query = query.filter(Subtag.account_id == account_id)

    if tag_id:
        query = query.filter(Subtag.tag_id == tag_id)

    results = query.order_by(Tag.name, Subtag.name).all()

    # Calcula count para cada subtag
    from app.models.unified_models import BenefitCardStatement

    result = []
    for subtag, tag_name in results:
        # Conta transações em bank_statements
        bank_count = db.query(func.count(BankStatement.id)).filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.subtag_id == subtag.id
        ).scalar() or 0

        # Conta transações em credit_card_invoices
        card_count = db.query(func.count(CreditCardInvoice.id)).filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.subtag_id == subtag.id
        ).scalar() or 0

        # Conta transações em benefit_card_statements
        benefit_count = db.query(func.count(BenefitCardStatement.id)).filter(
            BenefitCardStatement.tenant_id == tenant_id,
            BenefitCardStatement.subtag_id == subtag.id
        ).scalar() or 0

        total_count = bank_count + card_count + benefit_count

        result.append(SubtagOption(
            id=subtag.id,
            name=subtag.name,
            tag_id=subtag.tag_id,
            tag_name=tag_name,
            tag_type=subtag.type,  # Agora tipo está na subtag
            count=total_count
        ))

    return result


@router.get("/detailed", response_model=DetailedReportResponse)
async def get_detailed_report(
    source: str = Query("combined", description="Fontes separadas por vírgula: bank,cards,benefits"),
    start_date: str | None = Query(None, description="Data inicial (YYYY-MM-DD)"),
    end_date: str | None = Query(None, description="Data final (YYYY-MM-DD)"),
    # Mantém compatibilidade com filtros antigos
    start_year: int | None = Query(None),
    start_month: int | None = Query(None),
    end_year: int | None = Query(None),
    end_month: int | None = Query(None),
    tag_ids: str | None = Query(None, description="IDs de tags separados por vírgula"),
    subtag_ids: str | None = Query(None, description="IDs de subtags separados por vírgula"),
    partner_ids: str | None = Query(None, description="IDs de parceiros separados por vírgula"),
    account_ids: str | None = Query(None, description="IDs de contas separados por vírgula"),
    card_ids: str | None = Query(None, description="IDs de cartões separados por vírgula"),
    origin: str | None = Query(None, description="Filtro de origem: manual, inverted (separados por vírgula)"),
    include_empty_tag: bool = Query(False, description="Incluir itens sem tag (subtag_id IS NULL)"),
    include_empty_sharing: bool = Query(False, description="Incluir itens sem compartilhamento (expense_sharing_id IS NULL)"),
    limit: int = Query(100, description="Limite de registros detalhados"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Retorna relatório detalhado com top gastos e lista de despesas.

    Filtros de data:
    - start_date/end_date: Datas exatas (YYYY-MM-DD) - RECOMENDADO
    - start_year/start_month/end_year/end_month: Filtros antigos (compatibilidade)

    Fontes:
    - bank: Extratos bancários
    - cards: Faturas de cartão
    - benefits: Cartões de benefícios
    - combined: Todas as fontes (padrão)
    - Pode combinar: "bank,cards" ou "bank,benefits", etc.

    Para cartões: filtra pela data da FATURA (year_month), não pela data da compra.
    Para extratos e benefícios: filtra pela data da transação.
    """
    tenant_id = current_user.get("tenant_id", 1)
    logged_account_id = current_user.get("account_id")

    # Parse filtros
    tag_id_list = [int(x) for x in tag_ids.split(',')] if tag_ids else None
    subtag_id_list = [int(x) for x in subtag_ids.split(',')] if subtag_ids else None
    partner_id_list = [int(x) for x in partner_ids.split(',')] if partner_ids else None
    account_id_list = [int(x) for x in account_ids.split(',')] if account_ids else None
    card_id_list = [int(x) for x in card_ids.split(',')] if card_ids else None
    origin_list = [x.strip() for x in origin.split(',')] if origin else None

    # IMPORTANTE: Sempre filtra pela conta logada
    if logged_account_id:
        if account_id_list:
            # Se já tem filtro de contas, adiciona a conta logada
            if logged_account_id not in account_id_list:
                account_id_list.append(logged_account_id)
        else:
            # Se não tem filtro, usa apenas a conta logada
            account_id_list = [logged_account_id]

    # Parse fontes
    sources = source.split(',') if source else []
    # Normaliza "combined" para incluir todas as fontes
    if "combined" in sources or not sources:
        sources = ["bank", "cards", "benefits"]

    # Se houver filtro de cartão, remove "bank" das fontes (extratos bancários não têm cartão)
    if card_id_list and "bank" in sources:
        sources = [s for s in sources if s != "bank"]

    # Define período - prioriza start_date/end_date
    if start_date and end_date:
        # Filtro COM DATAS: end_date sempre será o valor do campo + 1 dia
        # Exemplo: se usuário escolhe 2026-01-31, end_date vira 2026-02-01 00:00:00
        start_date_obj = datetime.strptime(start_date, "%Y-%m-%d").date()
        end_date_obj = datetime.strptime(end_date, "%Y-%m-%d").date() + timedelta(days=1)
    elif start_date:
        # Filtro APENAS START_DATE: usa apenas >= start_date (sem end_date)
        start_date_obj = datetime.strptime(start_date, "%Y-%m-%d").date()
        end_date_obj = None
    elif start_year or end_year or start_month or end_month:
        # Fallback para filtros antigos (ano/mês) - DEPRECATED
        now = datetime.now()
        end_year = end_year or now.year
        end_month = end_month or now.month
        start_year = start_year or end_year
        start_month = start_month or 1
        start_date_obj = date(start_year, start_month, 1)
        # Último dia do mês final
        if end_month == 12:
            end_date_obj = date(end_year, 12, 31) + timedelta(days=1)
        else:
            end_date_obj = date(end_year, end_month + 1, 1)
    else:
        # SEM FILTRO DE DATA: retorna TUDO
        start_date_obj = None
        end_date_obj = None

    # Busca despesas
    expenses = []
    total_amount = Decimal(0)
    total_count = 0

    if "bank" in sources:
        bank_expenses = _get_bank_expenses_by_date(
            db, tenant_id, start_date_obj, end_date_obj,
            tag_id_list, subtag_id_list, partner_id_list, account_id_list, limit,
            include_empty_tag, include_empty_sharing, logged_account_id, origin_list
        )
        expenses.extend(bank_expenses)

    if "cards" in sources:
        # Filtro de origem "manual" só se aplica a bank_statements
        # Se filtro de origem for apenas "manual", não busca cartões
        should_include_cards = True
        if origin_list and 'manual' in origin_list and 'inverted' not in origin_list:
            should_include_cards = False
        if should_include_cards:
            card_expenses = _get_card_expenses_by_date(
                db, tenant_id, start_date_obj, end_date_obj,
                tag_id_list, subtag_id_list, partner_id_list, account_id_list, card_id_list, limit,
                include_empty_tag, include_empty_sharing, logged_account_id
            )
            expenses.extend(card_expenses)

    if "benefits" in sources:
        # Filtro de origem "manual" só se aplica a bank_statements
        # Se filtro de origem for apenas "manual", não busca benefícios
        should_include_benefits = True
        if origin_list and 'manual' in origin_list and 'inverted' not in origin_list:
            should_include_benefits = False
        if should_include_benefits:
            benefit_expenses = _get_benefit_expenses_by_date(
                db, tenant_id, start_date_obj, end_date_obj,
                tag_id_list, subtag_id_list, partner_id_list, account_id_list, card_id_list, limit,
                include_empty_tag, include_empty_sharing, logged_account_id
            )
            expenses.extend(benefit_expenses)

    # Calcula totais ANTES de limitar (para ter o total real do período)
    total_amount = sum(e.amount for e in expenses)
    total_count = len(expenses)

    # Separa receitas (positivos) e despesas (negativos)
    total_income = sum(e.amount for e in expenses if e.amount > 0)
    total_income_count = len([e for e in expenses if e.amount > 0])
    total_expenses = sum(e.amount for e in expenses if e.amount < 0)
    total_expenses_count = len([e for e in expenses if e.amount < 0])

    # Calcula tendências mês a mês
    expenses_trend = None
    income_trend = None

    # Agrupa por mês para calcular tendências
    from collections import defaultdict
    monthly_expenses = defaultdict(lambda: Decimal(0))
    monthly_income = defaultdict(lambda: Decimal(0))

    # Primeiro, identifica todos os meses do período (mesmo sem transações)
    all_months = set()
    for expense in expenses:
        year_month = f"{expense.date.year}-{expense.date.month:02d}"
        all_months.add(year_month)
        if expense.amount < 0:
            monthly_expenses[year_month] += expense.amount
        elif expense.amount > 0:
            monthly_income[year_month] += expense.amount

    # Garante que todos os meses estão representados (com 0 se não houver transações)
    for month in all_months:
        if month not in monthly_expenses:
            monthly_expenses[month] = Decimal(0)
        if month not in monthly_income:
            monthly_income[month] = Decimal(0)

    # Calcula tendência de despesas (se houver pelo menos 2 meses)
    if len(monthly_expenses) >= 2:
        sorted_months = sorted(monthly_expenses.items())
        mid_point = len(sorted_months) // 2
        first_half_avg = sum(v for _, v in sorted_months[:mid_point]) / mid_point if mid_point > 0 else Decimal(0)
        second_half_avg = sum(v for _, v in sorted_months[mid_point:]) / (len(sorted_months) - mid_point)

        if first_half_avg != 0:
            diff_percentage = abs((second_half_avg - first_half_avg) / first_half_avg * 100)
            if diff_percentage > 10:
                if second_half_avg < first_half_avg:  # Mais negativo = gastando mais
                    expenses_trend = 'up'
                else:  # Menos negativo = gastando menos
                    expenses_trend = 'down'
            else:
                expenses_trend = 'stable'

    # Calcula tendência de receitas (se houver pelo menos 2 meses)
    if len(monthly_income) >= 2:
        sorted_months = sorted(monthly_income.items())
        mid_point = len(sorted_months) // 2
        first_half_avg = sum(v for _, v in sorted_months[:mid_point]) / mid_point if mid_point > 0 else Decimal(0)
        second_half_avg = sum(v for _, v in sorted_months[mid_point:]) / (len(sorted_months) - mid_point)

        # Calcula diferença absoluta e percentual
        diff_absolute = second_half_avg - first_half_avg

        # Se a primeira metade tinha receitas mas a segunda não tem (ou tem muito menos)
        if first_half_avg > 0:
            diff_percentage = abs(diff_absolute / first_half_avg * 100)
            if diff_percentage > 10:
                if second_half_avg > first_half_avg:  # Mais positivo = recebendo mais
                    income_trend = 'up'
                else:  # Menos positivo = recebendo menos
                    income_trend = 'down'
            else:
                income_trend = 'stable'
        # Se a primeira metade não tinha receitas mas a segunda tem
        elif first_half_avg == 0 and second_half_avg > 0:
            income_trend = 'up'
        # Se ambas são zero
        elif first_half_avg == 0 and second_half_avg == 0:
            income_trend = 'stable'

    # Ordena por valor (maior primeiro) e limita para exibição
    expenses.sort(key=lambda x: x.amount, reverse=True)
    expenses_limited = expenses[:limit]

    # Agrupa por descrição para top gastos (usa TODOS os expenses, não limitados)
    description_totals = {}
    for expense in expenses:
        desc = expense.description
        if desc not in description_totals:
            description_totals[desc] = {'total': Decimal(0), 'count': 0, 'dates': [], 'amounts': []}
        description_totals[desc]['total'] += expense.amount
        description_totals[desc]['count'] += 1
        description_totals[desc]['dates'].append(expense.date)
        description_totals[desc]['amounts'].append(expense.amount)

    # Top 10 gastos (filtra apenas valores negativos e ordena por valor absoluto)
    top_expenses = []
    # Filtra apenas despesas (valores negativos) e ordena por valor absoluto
    negative_expenses = {desc: data for desc, data in description_totals.items() if data['total'] < 0}
    for desc, data in sorted(negative_expenses.items(), key=lambda x: abs(x[1]['total']), reverse=True)[:10]:
        # Percentual sempre positivo (proporção em relação ao total)
        percentage = float(abs(data['total']) / abs(total_amount) * 100) if total_amount != 0 else 0

        # Valor médio por ocorrência
        average_amount = data['total'] / data['count'] if data['count'] > 0 else Decimal(0)

        # Datas e intervalo médio entre ocorrências
        first_date = None
        last_date = None
        average_days_interval = None
        trend = None

        if len(data['dates']) > 0:
            # Ordena por data junto com os valores
            date_amount_pairs = sorted(zip(data['dates'], data['amounts']), key=lambda x: x[0])
            sorted_dates = [pair[0] for pair in date_amount_pairs]
            sorted_amounts = [pair[1] for pair in date_amount_pairs]

            # Converte datetime para date (schema TopExpense espera date, não datetime)
            first_date = sorted_dates[0].date() if isinstance(sorted_dates[0], datetime) else sorted_dates[0]
            last_date = sorted_dates[-1].date() if isinstance(sorted_dates[-1], datetime) else sorted_dates[-1]

            # Intervalo médio (em dias) - só faz sentido se houver 2+ ocorrências
            if data['count'] > 1:
                total_days = (sorted_dates[-1] - sorted_dates[0]).days
                # Intervalo médio = total de dias / (número de ocorrências - 1)
                average_days_interval = total_days / (data['count'] - 1) if data['count'] > 1 else 0

            # Calcula tendência agrupando por mês (não por ocorrência individual)
            if data['count'] >= 2:
                # Agrupa valores por mês
                monthly_totals = defaultdict(lambda: Decimal(0))
                for expense_date, amount in date_amount_pairs:
                    year_month = f"{expense_date.year}-{expense_date.month:02d}"
                    monthly_totals[year_month] += amount

                # Se houver pelo menos 2 meses diferentes
                if len(monthly_totals) >= 2:
                    sorted_months = sorted(monthly_totals.items())
                    mid_point = len(sorted_months) // 2
                    first_half_avg = sum(v for _, v in sorted_months[:mid_point]) / mid_point if mid_point > 0 else Decimal(0)
                    second_half_avg = sum(v for _, v in sorted_months[mid_point:]) / (len(sorted_months) - mid_point)

                    # Valores são negativos, então se second_half é MAIS negativo, está crescendo
                    if first_half_avg != 0:
                        diff_percentage = abs((second_half_avg - first_half_avg) / first_half_avg * 100)

                        if diff_percentage > 10:  # Mudança significativa > 10%
                            if second_half_avg < first_half_avg:  # Mais negativo = gastando mais
                                trend = 'up'
                            else:  # Menos negativo = gastando menos
                                trend = 'down'
                        else:
                            trend = 'stable'

        top_expenses.append(TopExpense(
            description=desc,
            total=data['total'],
            count=data['count'],
            percentage=round(percentage, 2),
            average_amount=average_amount,
            average_days_interval=round(average_days_interval, 1) if average_days_interval is not None else None,
            first_date=first_date,
            last_date=last_date,
            trend=trend
        ))

    return DetailedReportResponse(
        total_amount=total_amount,
        total_count=total_count,
        total_income=total_income,
        total_income_count=total_income_count,
        total_expenses=total_expenses,
        total_expenses_count=total_expenses_count,
        expenses_trend=expenses_trend,
        income_trend=income_trend,
        top_expenses=top_expenses,
        expenses=expenses_limited
    )


def _get_bank_expenses_by_date(
    db: Session,
    tenant_id: int,
    start_date: date | None,
    end_date: date | None,
    tag_ids: List[int] | None,
    subtag_ids: List[int] | None,
    partner_id_list: List[int] | None,
    account_ids: List[int] | None,
    limit: int,
    include_empty_tag: bool = False,
    include_empty_sharing: bool = False,
    logged_account_id: int | None = None,
    origin_list: List[str] | None = None
) -> List[ExpenseDetail]:
    """Busca despesas de extratos bancários por range de datas

    origin_list: Filtro de origem
        - 'manual': category IS NULL AND migrated_from_account_id IS NULL
        - 'inverted': migrated_from_account_id IS NOT NULL
    """
    from app.models.unified_models import ExpenseSharingSetting, Account, Bank

    # Subqueries para buscar dados da conta compartilhada
    from sqlalchemy import select, case, literal
    from app.models.unified_models import Bank as SharedBank

    # Alias para a conta de migração (quando item foi invertido)
    MigratedAccount = aliased(Account)
    MigratedBank = aliased(Bank)

    # Alias para conta principal do sharing (quando logado como parceiro - bidirecional)
    MainAccount = aliased(Account)
    MainBank = aliased(Bank)

    # Subqueries para shared_account (quando logado é a conta principal do sharing)
    shared_account_name_subquery = (
        select(Account.name)
        .where(Account.id == ExpenseSharingSetting.shared_account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    shared_account_bank_subquery = (
        select(SharedBank.name)
        .join(Account, SharedBank.id == Account.bank_id)
        .where(Account.id == ExpenseSharingSetting.shared_account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    shared_account_agency_subquery = (
        select(Account.agency)
        .where(Account.id == ExpenseSharingSetting.shared_account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    shared_account_number_subquery = (
        select(Account.__table__.c.account_number)
        .where(Account.id == ExpenseSharingSetting.shared_account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )

    # Subqueries para account_id do sharing (quando logado é o parceiro - bidirecional)
    main_account_name_subquery = (
        select(Account.name)
        .where(Account.id == ExpenseSharingSetting.account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    main_account_bank_subquery = (
        select(SharedBank.name)
        .join(Account, SharedBank.id == Account.bank_id)
        .where(Account.id == ExpenseSharingSetting.account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    main_account_agency_subquery = (
        select(Account.agency)
        .where(Account.id == ExpenseSharingSetting.account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    main_account_number_subquery = (
        select(Account.__table__.c.account_number)
        .where(Account.id == ExpenseSharingSetting.account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )

    # Lógica bidirecional:
    # 1. Se migrated_from_account_id existe → usa conta de origem (item invertido)
    # 2. Se logged_account_id == account_id do sharing → usa shared_account_id (eu sou o principal)
    # 3. Senão → usa account_id do sharing (eu sou o parceiro)
    query = db.query(
        BankStatement.id,
        BankStatement.date,
        BankStatement.description,
        BankStatement.amount,
        BankStatement.category,
        BankStatement.subtag_id,
        BankStatement.ownership_percentage,
        BankStatement.expense_sharing_id,
        BankStatement.account_id,
        BankStatement.migrated_from_account_id,
        Subtag.name.label('subtag_name'),
        Tag.name.label('tag_name'),
        # shared_partner_id: prioridade migrated_from > bidirecional
        case(
            (BankStatement.migrated_from_account_id.isnot(None), BankStatement.migrated_from_account_id),
            (ExpenseSharingSetting.account_id == logged_account_id, ExpenseSharingSetting.shared_account_id),
            else_=ExpenseSharingSetting.account_id
        ).label('shared_partner_id'),
        case(
            (BankStatement.migrated_from_account_id.isnot(None), MigratedAccount.name),
            (ExpenseSharingSetting.account_id == logged_account_id, shared_account_name_subquery),
            else_=main_account_name_subquery
        ).label('shared_partner_name'),
        case(
            (BankStatement.migrated_from_account_id.isnot(None), MigratedBank.name),
            (ExpenseSharingSetting.account_id == logged_account_id, shared_account_bank_subquery),
            else_=main_account_bank_subquery
        ).label('shared_partner_bank'),
        case(
            (BankStatement.migrated_from_account_id.isnot(None), MigratedAccount.agency),
            (ExpenseSharingSetting.account_id == logged_account_id, shared_account_agency_subquery),
            else_=main_account_agency_subquery
        ).label('shared_partner_agency'),
        case(
            (BankStatement.migrated_from_account_id.isnot(None), MigratedAccount.account_number),
            (ExpenseSharingSetting.account_id == logged_account_id, shared_account_number_subquery),
            else_=main_account_number_subquery
        ).label('shared_partner_account_number'),
        Account.name.label('account_name'),
        Bank.code.label('bank_code'),
        Bank.name.label('bank_name'),
        Account.agency.label('account_agency'),
        Account.__table__.c.account_number.label('account_number')
    ).outerjoin(
        Subtag, BankStatement.subtag_id == Subtag.id
    ).outerjoin(
        Tag, Subtag.tag_id == Tag.id
    ).outerjoin(
        ExpenseSharingSetting, BankStatement.expense_sharing_id == ExpenseSharingSetting.id
    ).outerjoin(
        Account, BankStatement.account_id == Account.id
    ).outerjoin(
        Bank, Account.bank_id == Bank.id
    ).outerjoin(
        MigratedAccount, BankStatement.migrated_from_account_id == MigratedAccount.id
    ).outerjoin(
        MigratedBank, MigratedAccount.bank_id == MigratedBank.id
    )

    # Aplica filtros de data
    # IMPORTANTE: BankStatement.date é DATETIME, então convertemos start_date/end_date para DATETIME
    # start_date: início do dia (00:00:00)
    # end_date: início do dia seguinte (00:00:00) - já foi incrementado em 1 dia no backend
    filters = [
        BankStatement.tenant_id == tenant_id
    ]

    # Se start_date foi fornecido, adiciona filtro de data inicial
    if start_date is not None:
        start_datetime = datetime.combine(start_date, datetime.min.time())
        filters.append(BankStatement.date >= start_datetime)

    # Se end_date foi fornecido, adiciona filtro de limite superior
    if end_date is not None:
        end_datetime = datetime.combine(end_date, datetime.min.time())
        filters.append(BankStatement.date < end_datetime)

    query = query.filter(*filters)

    # Aplica filtros de tags/subtags (com suporte a "Vazio")
    from sqlalchemy import or_
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

    # Aplica filtros de compartilhamento (com suporte a "Vazio")
    if partner_id_list or include_empty_sharing:
        sharing_conditions = []
        if partner_id_list:
            sharing_conditions.append(BankStatement.expense_sharing_id.in_(partner_id_list))
        if include_empty_sharing:
            sharing_conditions.append(BankStatement.expense_sharing_id.is_(None))
        if sharing_conditions:
            query = query.filter(or_(*sharing_conditions))

    # Aplica filtro de contas
    if account_ids:
        query = query.filter(BankStatement.account_id.in_(account_ids))

    # Aplica filtro de origem (manual/inverted)
    if origin_list:
        origin_conditions = []
        if 'manual' in origin_list:
            # Manual: category IS NULL AND migrated_from_account_id IS NULL
            origin_conditions.append(
                and_(
                    BankStatement.category.is_(None),
                    BankStatement.migrated_from_account_id.is_(None)
                )
            )
        if 'inverted' in origin_list:
            # Inverted: migrated_from_account_id IS NOT NULL
            origin_conditions.append(BankStatement.migrated_from_account_id.isnot(None))
        if origin_conditions:
            query = query.filter(or_(*origin_conditions))

    # Não aplica limite - retorna TODOS os registros (paginação no frontend)
    results = query.order_by(BankStatement.date.desc()).all()

    # Calcula adjustment_type manualmente (é uma @property, não uma coluna)
    def get_adjustment_type(expense_sharing_id):
        if expense_sharing_id is not None:
            return 'compartilhado'
        else:
            return 'proprio'

    return [
        ExpenseDetail(
            id=r.id,
            date=r.date,  # Mantém datetime completo
            description=r.description,
            amount=r.amount,
            source="bank",
            card_number=None,
            category=r.category,
            subtag_id=r.subtag_id,
            subtag_name=r.subtag_name,
            tag_name=r.tag_name,
            current_installment=None,
            total_installments=None,
            adjustment_type=get_adjustment_type(r.expense_sharing_id),
            ownership_percentage=r.ownership_percentage,
            expense_sharing_id=r.expense_sharing_id,
            shared_partner_id=r.shared_partner_id,
            shared_partner_name=r.shared_partner_name,
            shared_partner_bank=r.shared_partner_bank,
            shared_partner_agency=str(r.shared_partner_agency) if r.shared_partner_agency is not None else None,
            shared_partner_account_number=str(r.shared_partner_account_number) if r.shared_partner_account_number is not None else None,
            account_id=r.account_id,
            account_name=r.account_name,
            bank_code=r.bank_code,
            bank_name=r.bank_name,
            account_agency=str(r.account_agency) if r.account_agency is not None else None,
            account_number=str(r.account_number) if r.account_number is not None else None,
            migrated_from_account_id=r.migrated_from_account_id
        )
        for r in results
    ]


def _get_card_expenses_by_date(
    db: Session,
    tenant_id: int,
    start_date: date | None,
    end_date: date | None,
    tag_ids: List[int] | None,
    subtag_ids: List[int] | None,
    partner_id_list: List[int] | None,
    account_ids: List[int] | None,
    card_ids: List[int] | None,
    limit: int,
    include_empty_tag: bool = False,
    include_empty_sharing: bool = False,
    logged_account_id: int | None = None
) -> List[ExpenseDetail]:
    """
    Busca despesas de faturas de cartão por range de datas.

    IMPORTANTE: Filtra pela data da FATURA (year_month), não pela data da compra!
    Exemplo: Se filtro é 2024-01-01 a 2024-01-31, busca faturas com year_month='2024-01'
    e inclui TODAS as compras dessa fatura, mesmo que a compra seja de dezembro/2023.

    Se start_date e end_date forem None, retorna TODAS as faturas.
    """
    from app.models.unified_models import ExpenseSharingSetting, Account, Bank
    from sqlalchemy import select, case

    # Subqueries para buscar dados da conta compartilhada
    from app.models.unified_models import Bank as SharedBank

    # Subqueries para shared_account (quando logado é a conta principal do sharing)
    shared_account_name_subquery = (
        select(Account.name)
        .where(Account.id == ExpenseSharingSetting.shared_account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    shared_account_bank_subquery = (
        select(SharedBank.name)
        .join(Account, SharedBank.id == Account.bank_id)
        .where(Account.id == ExpenseSharingSetting.shared_account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    shared_account_agency_subquery = (
        select(Account.agency)
        .where(Account.id == ExpenseSharingSetting.shared_account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    shared_account_number_subquery = (
        select(Account.__table__.c.account_number)
        .where(Account.id == ExpenseSharingSetting.shared_account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )

    # Subqueries para account_id do sharing (quando logado é o parceiro - bidirecional)
    main_account_name_subquery = (
        select(Account.name)
        .where(Account.id == ExpenseSharingSetting.account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    main_account_bank_subquery = (
        select(SharedBank.name)
        .join(Account, SharedBank.id == Account.bank_id)
        .where(Account.id == ExpenseSharingSetting.account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    main_account_agency_subquery = (
        select(Account.agency)
        .where(Account.id == ExpenseSharingSetting.account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    main_account_number_subquery = (
        select(Account.__table__.c.account_number)
        .where(Account.id == ExpenseSharingSetting.account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )

    # Lógica bidirecional:
    # Se logged_account_id == account_id do sharing → usa shared_account_id (eu sou o principal)
    # Senão → usa account_id do sharing (eu sou o parceiro)
    query = db.query(
        CreditCardInvoice.id,
        CreditCardInvoice.date,
        CreditCardInvoice.description,
        CreditCardInvoice.amount,
        CreditCardInvoice.credit_card_id,  # Adiciona o ID do cartão para debug
        CreditCardInvoice.year_month,  # Ano/mês da fatura (para exportação)
        Cartao.number.label('card_number'),
        Cartao.name.label('card_name'),
        CreditCardInvoice.subtag_id,
        CreditCardInvoice.current_installment,
        CreditCardInvoice.total_installments,
        CreditCardInvoice.ownership_percentage,
        CreditCardInvoice.expense_sharing_id,
        Cartao.account_id,
        case(
            (ExpenseSharingSetting.account_id == logged_account_id, ExpenseSharingSetting.shared_account_id),
            else_=ExpenseSharingSetting.account_id
        ).label('shared_partner_id'),
        case(
            (ExpenseSharingSetting.account_id == logged_account_id, shared_account_name_subquery),
            else_=main_account_name_subquery
        ).label('shared_partner_name'),
        case(
            (ExpenseSharingSetting.account_id == logged_account_id, shared_account_bank_subquery),
            else_=main_account_bank_subquery
        ).label('shared_partner_bank'),
        case(
            (ExpenseSharingSetting.account_id == logged_account_id, shared_account_agency_subquery),
            else_=main_account_agency_subquery
        ).label('shared_partner_agency'),
        case(
            (ExpenseSharingSetting.account_id == logged_account_id, shared_account_number_subquery),
            else_=main_account_number_subquery
        ).label('shared_partner_account_number'),
        Account.name.label('account_name'),
        Bank.code.label('bank_code'),
        Bank.name.label('bank_name'),
        Account.agency.label('account_agency'),
        Account.__table__.c.account_number.label('account_number'),
        Subtag.name.label('subtag_name'),
        Tag.name.label('tag_name')
    ).join(
        Cartao, CreditCardInvoice.credit_card_id == Cartao.id
    ).outerjoin(
        Subtag, CreditCardInvoice.subtag_id == Subtag.id
    ).outerjoin(
        Tag, Subtag.tag_id == Tag.id
    ).outerjoin(
        ExpenseSharingSetting, CreditCardInvoice.expense_sharing_id == ExpenseSharingSetting.id
    ).outerjoin(
        Account, Cartao.account_id == Account.id
    ).outerjoin(
        Bank, Account.bank_id == Bank.id
    )

    # Aplica filtros de data usando a coluna 'date' diretamente
    # (mesmo padrão usado em _get_bank_expenses_by_date)
    filters = [
        CreditCardInvoice.tenant_id == tenant_id
        # NOTA: CreditCardInvoice NÃO tem campo 'active' (não usa soft delete)
    ]

    # Se start_date foi fornecido, adiciona filtro de data inicial
    if start_date is not None:
        filters.append(CreditCardInvoice.date >= start_date)

    # Se end_date foi fornecido, adiciona filtro de limite superior
    if end_date is not None:
        filters.append(CreditCardInvoice.date < end_date)

    query = query.filter(*filters)

    # Aplica filtros de tags/subtags (com suporte a "Vazio")
    from sqlalchemy import or_
    if subtag_ids or tag_ids or include_empty_tag:
        tag_conditions = []
        if subtag_ids:
            tag_conditions.append(CreditCardInvoice.subtag_id.in_(subtag_ids))
        elif tag_ids:
            subtag_query = db.query(Subtag.id).filter(Subtag.tag_id.in_(tag_ids))
            tag_conditions.append(CreditCardInvoice.subtag_id.in_(subtag_query))
        if include_empty_tag:
            tag_conditions.append(CreditCardInvoice.subtag_id.is_(None))
        if tag_conditions:
            query = query.filter(or_(*tag_conditions))

    # Aplica filtros de compartilhamento (com suporte a "Vazio")
    if partner_id_list or include_empty_sharing:
        sharing_conditions = []
        if partner_id_list:
            sharing_conditions.append(CreditCardInvoice.expense_sharing_id.in_(partner_id_list))
        if include_empty_sharing:
            sharing_conditions.append(CreditCardInvoice.expense_sharing_id.is_(None))
        if sharing_conditions:
            query = query.filter(or_(*sharing_conditions))

    # Aplica filtro de contas
    # Usa CreditCardInvoice.account_id se existir, senão usa Cartao.account_id
    # Isso é importante para itens que foram "invertidos" (migrados de uma conta para outra)
    if account_ids:
        query = query.filter(
            func.coalesce(CreditCardInvoice.account_id, Cartao.account_id).in_(account_ids)
        )

    # Aplica filtro de cartões
    if card_ids:
        query = query.filter(CreditCardInvoice.credit_card_id.in_(card_ids))

    # Não aplica limite - retorna TODOS os registros (paginação no frontend)
    results = query.order_by(CreditCardInvoice.date.desc()).all()

    # Calcula adjustment_type manualmente (é uma @property, não uma coluna)
    def get_adjustment_type(expense_sharing_id):
        if expense_sharing_id is not None:
            return 'compartilhado'
        else:
            return 'proprio'

    return [
        ExpenseDetail(
            id=r.id,
            date=r.date,  # Mantém datetime completo
            description=r.description,
            amount=r.amount,
            source="card",
            card_number=r.card_number,
            card_name=r.card_name,
            category=None,
            subtag_id=r.subtag_id,
            subtag_name=r.subtag_name,
            tag_name=r.tag_name,
            current_installment=r.current_installment,
            total_installments=r.total_installments,
            adjustment_type=get_adjustment_type(r.expense_sharing_id),
            ownership_percentage=r.ownership_percentage,
            expense_sharing_id=r.expense_sharing_id,
            shared_partner_id=r.shared_partner_id,
            shared_partner_name=r.shared_partner_name,
            shared_partner_bank=r.shared_partner_bank,
            shared_partner_agency=str(r.shared_partner_agency) if r.shared_partner_agency is not None else None,
            shared_partner_account_number=str(r.shared_partner_account_number) if r.shared_partner_account_number is not None else None,
            account_id=r.account_id,
            account_name=r.account_name,
            bank_code=r.bank_code,
            bank_name=r.bank_name,
            account_agency=str(r.account_agency) if r.account_agency is not None else None,
            account_number=str(r.account_number) if r.account_number is not None else None,
            year_month=r.year_month  # Ano/mês da fatura (YYYY-MM)
        )
        for r in results
    ]


def _get_benefit_expenses_by_date(
    db: Session,
    tenant_id: int,
    start_date: date | None,
    end_date: date | None,
    tag_ids: List[int] | None,
    subtag_ids: List[int] | None,
    partner_id_list: List[int] | None,
    account_ids: List[int] | None,
    card_ids: List[int] | None,
    limit: int,
    include_empty_tag: bool = False,
    include_empty_sharing: bool = False,
    logged_account_id: int | None = None
) -> List[ExpenseDetail]:
    """Busca despesas de cartões de benefícios por range de datas. Se start_date e end_date forem None, retorna TODAS."""
    from app.models.unified_models import ExpenseSharingSetting, Account, BenefitCardStatement, Bank
    from sqlalchemy import select, case

    # Subqueries para buscar dados da conta compartilhada
    from app.models.unified_models import Bank as SharedBank

    # Subqueries para shared_account (quando logado é a conta principal do sharing)
    shared_account_name_subquery = (
        select(Account.name)
        .where(Account.id == ExpenseSharingSetting.shared_account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    shared_account_bank_subquery = (
        select(SharedBank.name)
        .join(Account, SharedBank.id == Account.bank_id)
        .where(Account.id == ExpenseSharingSetting.shared_account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    shared_account_agency_subquery = (
        select(Account.agency)
        .where(Account.id == ExpenseSharingSetting.shared_account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    shared_account_number_subquery = (
        select(Account.__table__.c.account_number)
        .where(Account.id == ExpenseSharingSetting.shared_account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )

    # Subqueries para account_id do sharing (quando logado é o parceiro - bidirecional)
    main_account_name_subquery = (
        select(Account.name)
        .where(Account.id == ExpenseSharingSetting.account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    main_account_bank_subquery = (
        select(SharedBank.name)
        .join(Account, SharedBank.id == Account.bank_id)
        .where(Account.id == ExpenseSharingSetting.account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    main_account_agency_subquery = (
        select(Account.agency)
        .where(Account.id == ExpenseSharingSetting.account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )
    main_account_number_subquery = (
        select(Account.__table__.c.account_number)
        .where(Account.id == ExpenseSharingSetting.account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )

    # Lógica bidirecional:
    # Se logged_account_id == account_id do sharing → usa shared_account_id (eu sou o principal)
    # Senão → usa account_id do sharing (eu sou o parceiro)
    query = db.query(
        BenefitCardStatement.id,
        BenefitCardStatement.date.label('date'),
        BenefitCardStatement.description,
        BenefitCardStatement.amount,
        BenefitCardStatement.credit_card_id,  # Adiciona o ID do cartão para debug
        Cartao.number.label('card_number'),
        Cartao.name.label('card_name'),
        BenefitCardStatement.subtag_id,
        BenefitCardStatement.ownership_percentage,
        BenefitCardStatement.expense_sharing_id,
        Cartao.account_id,
        case(
            (ExpenseSharingSetting.account_id == logged_account_id, ExpenseSharingSetting.shared_account_id),
            else_=ExpenseSharingSetting.account_id
        ).label('shared_partner_id'),
        case(
            (ExpenseSharingSetting.account_id == logged_account_id, shared_account_name_subquery),
            else_=main_account_name_subquery
        ).label('shared_partner_name'),
        case(
            (ExpenseSharingSetting.account_id == logged_account_id, shared_account_bank_subquery),
            else_=main_account_bank_subquery
        ).label('shared_partner_bank'),
        case(
            (ExpenseSharingSetting.account_id == logged_account_id, shared_account_agency_subquery),
            else_=main_account_agency_subquery
        ).label('shared_partner_agency'),
        case(
            (ExpenseSharingSetting.account_id == logged_account_id, shared_account_number_subquery),
            else_=main_account_number_subquery
        ).label('shared_partner_account_number'),
        Account.name.label('account_name'),
        Bank.code.label('bank_code'),
        Bank.name.label('bank_name'),
        Account.agency.label('account_agency'),
        Account.__table__.c.account_number.label('account_number'),
        Subtag.name.label('subtag_name'),
        Tag.name.label('tag_name')
    ).join(
        Cartao, BenefitCardStatement.credit_card_id == Cartao.id
    ).outerjoin(
        Subtag, BenefitCardStatement.subtag_id == Subtag.id
    ).outerjoin(
        Tag, Subtag.tag_id == Tag.id
    ).outerjoin(
        ExpenseSharingSetting, BenefitCardStatement.expense_sharing_id == ExpenseSharingSetting.id
    ).outerjoin(
        Account, Cartao.account_id == Account.id
    ).outerjoin(
        Bank, Account.bank_id == Bank.id
    )

    # Aplica filtros de data
    filters = [BenefitCardStatement.tenant_id == tenant_id]

    if start_date is not None:
        filters.append(BenefitCardStatement.date >= start_date)

    if end_date is not None:
        filters.append(BenefitCardStatement.date < end_date)  # Usa < porque end_date já foi incrementado em 1 dia

    query = query.filter(*filters)

    # Aplica filtros de tags/subtags (com suporte a "Vazio")
    from sqlalchemy import or_
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

    # Aplica filtros de compartilhamento (com suporte a "Vazio")
    if partner_id_list or include_empty_sharing:
        sharing_conditions = []
        if partner_id_list:
            sharing_conditions.append(BenefitCardStatement.expense_sharing_id.in_(partner_id_list))
        if include_empty_sharing:
            sharing_conditions.append(BenefitCardStatement.expense_sharing_id.is_(None))
        if sharing_conditions:
            query = query.filter(or_(*sharing_conditions))

    # Aplica filtro de contas (via cartão)
    if account_ids:
        query = query.filter(Cartao.account_id.in_(account_ids))

    # Aplica filtro de cartões
    if card_ids:
        query = query.filter(BenefitCardStatement.credit_card_id.in_(card_ids))

    # Não aplica limite - retorna TODOS os registros (paginação no frontend)
    results = query.order_by(BenefitCardStatement.date.desc()).all()

    # Calcula adjustment_type manualmente (é uma @property, não uma coluna)
    def get_adjustment_type(expense_sharing_id):
        if expense_sharing_id is not None:
            return 'compartilhado'
        else:
            return 'proprio'

    return [
        ExpenseDetail(
            id=r.id,
            date=r.date,  # Mantém datetime completo (benefit_card_statements usa 'datetime' como nome do campo)
            description=r.description,
            amount=r.amount,
            source="benefit",
            card_number=r.card_number,
            card_name=r.card_name,
            category=None,
            subtag_id=r.subtag_id,
            subtag_name=r.subtag_name,
            tag_name=r.tag_name,
            current_installment=None,
            total_installments=None,
            adjustment_type=get_adjustment_type(r.expense_sharing_id),
            ownership_percentage=r.ownership_percentage,
            expense_sharing_id=r.expense_sharing_id,
            shared_partner_id=r.shared_partner_id,
            shared_partner_name=r.shared_partner_name,
            shared_partner_bank=r.shared_partner_bank,
            shared_partner_agency=str(r.shared_partner_agency) if r.shared_partner_agency is not None else None,
            shared_partner_account_number=str(r.shared_partner_account_number) if r.shared_partner_account_number is not None else None,
            account_id=r.account_id,
            account_name=r.account_name,
            bank_code=r.bank_code,
            bank_name=r.bank_name,
            account_agency=str(r.account_agency) if r.account_agency is not None else None,
            account_number=str(r.account_number) if r.account_number is not None else None
        )
        for r in results
    ]


def _get_bank_expenses(
    db: Session,
    tenant_id: int,
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
    tag_ids: List[int] | None,
    subtag_ids: List[int] | None,
    limit: int
) -> List[ExpenseDetail]:
    """Busca despesas de extratos bancários"""
    query = db.query(
        BankStatement.id,
        BankStatement.date,
        BankStatement.description,
        BankStatement.amount,
        BankStatement.category,
        BankStatement.subtag_id,
        Subtag.name.label('subtag_name'),
        Tag.name.label('tag_name')
    ).outerjoin(
        Subtag, BankStatement.subtag_id == Subtag.id
    ).outerjoin(
        Tag, Subtag.tag_id == Tag.id
    ).filter(
        BankStatement.tenant_id == tenant_id
        # NOTA: BankStatement NÃO tem campo 'active' (não usa soft delete)
    )

    # Aplica filtros de período
    query = query.filter(
        or_(
            and_(
                extract('year', BankStatement.date) == start_year,
                extract('month', BankStatement.date) >= start_month
            ),
            extract('year', BankStatement.date) > start_year
        ),
        or_(
            and_(
                extract('year', BankStatement.date) == end_year,
                extract('month', BankStatement.date) <= end_month
            ),
            extract('year', BankStatement.date) < end_year
        )
    )

    # Aplica filtros de tags/subtags
    if subtag_ids:
        query = query.filter(BankStatement.subtag_id.in_(subtag_ids))
    elif tag_ids:
        subtag_query = db.query(Subtag.id).filter(Subtag.tag_id.in_(tag_ids))
        query = query.filter(BankStatement.subtag_id.in_(subtag_query))

    results = query.order_by(BankStatement.amount.desc()).limit(limit).all()

    return [
        ExpenseDetail(
            id=r.id,
            date=r.date,
            description=r.description,
            amount=r.amount,
            source="bank",
            card_number=None,
            category=r.category,
            subtag_id=r.subtag_id,
            subtag_name=r.subtag_name,
            tag_name=r.tag_name,
            current_installment=None,
            total_installments=None
        )
        for r in results
    ]


def _get_card_expenses(
    db: Session,
    tenant_id: int,
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
    tag_ids: List[int] | None,
    subtag_ids: List[int] | None,
    limit: int
) -> List[ExpenseDetail]:
    """Busca despesas de faturas de cartão"""
    query = db.query(
        CreditCardInvoice.id,
        CreditCardInvoice.date,
        CreditCardInvoice.description,
        CreditCardInvoice.amount,
        Cartao.number.label('card_number'),
        CreditCardInvoice.subtag_id,
        CreditCardInvoice.current_installment,
        CreditCardInvoice.total_installments,
        Subtag.name.label('subtag_name'),
        Tag.name.label('tag_name')
    ).join(
        Cartao, CreditCardInvoice.credit_card_id == Cartao.id
    ).outerjoin(
        Subtag, CreditCardInvoice.subtag_id == Subtag.id
    ).outerjoin(
        Tag, Subtag.tag_id == Tag.id
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id
        # NOTA: CreditCardInvoice NÃO tem campo 'active' (não usa soft delete)
    )

    # Aplica filtros de tags/subtags
    if subtag_ids:
        query = query.filter(CreditCardInvoice.subtag_id.in_(subtag_ids))
    elif tag_ids:
        subtag_query = db.query(Subtag.id).filter(Subtag.tag_id.in_(tag_ids))
        query = query.filter(CreditCardInvoice.subtag_id.in_(subtag_query))

    results = query.order_by(CreditCardInvoice.amount.desc()).limit(limit).all()

    return [
        ExpenseDetail(
            id=r.id,
            date=r.date,
            description=r.description,
            amount=r.amount,
            source="card",
            card_number=r.card_number,
            category=None,
            subtag_id=r.subtag_id,
            subtag_name=r.subtag_name,
            tag_name=r.tag_name,
            current_installment=r.current_installment,
            total_installments=r.total_installments
        )
        for r in results
    ]



# ===== RELATÓRIO DE GASTOS COMPARTILHADOS =====

class SharedExpenseMonthly(BaseModel):
    """Gastos compartilhados agrupados por mês"""
    year_month: str  # Formato: "2025-01"
    partner_id: int
    partner_name: str
    total_amount: Decimal  # Valor total das despesas compartilhadas
    count: int  # Quantidade de transações
    ownership_percentage: Decimal  # Percentual médio de propriedade
    user_amount: Decimal  # Valor que pertence ao usuário
    partner_amount: Decimal  # Valor que pertence ao parceiro


class SharedExpensesResponse(BaseModel):
    """Resposta com gastos compartilhados"""
    data: List[SharedExpenseMonthly]
    total_amount: Decimal  # Total geral de gastos compartilhados
    total_count: int  # Total de transações
    total_user_amount: Decimal  # Total que pertence ao usuário
    total_partner_amount: Decimal  # Total que pertence aos parceiros


@router.get("/shared-expenses", response_model=SharedExpensesResponse)
async def get_shared_expenses_report(
    start_date: str | None = Query(None, description="Data inicial (YYYY-MM-DD)"),
    end_date: str | None = Query(None, description="Data final (YYYY-MM-DD)"),
    partner_ids: str | None = Query(None, description="IDs dos parceiros (separados por vírgula)"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Retorna relatório de gastos compartilhados agrupados por mês e parceiro.

    Filtra apenas transações com adjustment_type = 'compartilhado'.
    """
    tenant_id = current_user.get("tenant_id", 1)

    # Parse filtros
    partner_id_list = [int(x) for x in partner_ids.split(',')] if partner_ids else None

    # Define período
    if start_date and end_date:
        start_date_obj = datetime.strptime(start_date, "%Y-%m-%d").date()
        end_date_obj = datetime.strptime(end_date, "%Y-%m-%d").date()
    else:
        # Padrão: ano corrente
        today = date.today()
        start_date_obj = date(today.year, 1, 1)
        end_date_obj = today

    # Subquery para buscar o nome da conta compartilhada
    from sqlalchemy import select
    from app.models.unified_models import Account
    shared_account_subquery = (
        select(Account.description)
        .where(Account.id == ExpenseSharingSetting.shared_account_id)
        .correlate(ExpenseSharingSetting)
        .scalar_subquery()
    )

    # Query para extratos bancários compartilhados
    bank_query = (
        db.query(
            func.to_char(BankStatement.date, 'YYYY-MM').label('year_month'),
            BankStatement.expense_sharing_id.label('partner_id'),
            shared_account_subquery.label('partner_name'),
            func.sum(func.abs(BankStatement.amount)).label('total_amount'),
            func.count(BankStatement.id).label('count'),
            func.avg(BankStatement.ownership_percentage).label('ownership_percentage')
        )
        .join(ExpenseSharingSetting, BankStatement.expense_sharing_id == ExpenseSharingSetting.id)
        .filter(
            BankStatement.tenant_id == tenant_id,
            # NOTA: BankStatement NÃO tem campo 'active' (não usa soft delete)
            BankStatement.expense_sharing_id.isnot(None),  # adjustment_type é @property, não coluna
            BankStatement.date >= start_date_obj,
            BankStatement.date <= end_date_obj
        )
    )

    if partner_id_list:
        bank_query = bank_query.filter(BankStatement.expense_sharing_id.in_(partner_id_list))

    bank_query = bank_query.group_by(
        func.to_char(BankStatement.date, 'YYYY-MM'),
        BankStatement.expense_sharing_id,
        shared_account_subquery
    )

    # Query para faturas de cartão compartilhadas
    card_query = (
        db.query(
            CreditCardInvoice.year_month.label('year_month'),
            CreditCardInvoice.expense_sharing_id.label('partner_id'),
            shared_account_subquery.label('partner_name'),
            func.sum(func.abs(CreditCardInvoice.amount)).label('total_amount'),
            func.count(CreditCardInvoice.id).label('count'),
            func.avg(CreditCardInvoice.ownership_percentage).label('ownership_percentage')
        )
        .join(ExpenseSharingSetting, CreditCardInvoice.expense_sharing_id == ExpenseSharingSetting.id)
        .filter(
            CreditCardInvoice.tenant_id == tenant_id,
            # NOTA: CreditCardInvoice NÃO tem campo 'active' (não usa soft delete)
            CreditCardInvoice.expense_sharing_id.isnot(None)  # adjustment_type é @property, não coluna
        )
    )

    # Filtra por período (year_month)
    start_year_month = start_date_obj.strftime('%Y-%m')
    end_year_month = end_date_obj.strftime('%Y-%m')
    card_query = card_query.filter(
        CreditCardInvoice.year_month >= start_year_month,
        CreditCardInvoice.year_month <= end_year_month
    )

    if partner_id_list:
        card_query = card_query.filter(CreditCardInvoice.expense_sharing_id.in_(partner_id_list))

    card_query = card_query.group_by(
        CreditCardInvoice.year_month,
        CreditCardInvoice.expense_sharing_id,
        shared_account_subquery
    )

    # Combina resultados
    bank_results = bank_query.all()
    card_results = card_query.all()

    # Agrupa por year_month + partner_id
    grouped = {}

    for r in bank_results + card_results:
        key = (r.year_month, r.partner_id)
        if key not in grouped:
            grouped[key] = {
                'year_month': r.year_month,
                'partner_id': r.partner_id,
                'partner_name': r.partner_name,
                'total_amount': Decimal(0),
                'count': 0,
                'ownership_percentage_sum': Decimal(0),
                'ownership_count': 0
            }

        grouped[key]['total_amount'] += r.total_amount
        grouped[key]['count'] += r.count
        grouped[key]['ownership_percentage_sum'] += r.ownership_percentage * r.count
        grouped[key]['ownership_count'] += r.count

    # Calcula valores finais
    data = []
    total_amount = Decimal(0)
    total_count = 0
    total_user_amount = Decimal(0)
    total_partner_amount = Decimal(0)

    for item in grouped.values():
        avg_ownership = item['ownership_percentage_sum'] / item['ownership_count'] if item['ownership_count'] > 0 else Decimal(50)
        user_amount = item['total_amount'] * (avg_ownership / 100)
        partner_amount = item['total_amount'] * ((100 - avg_ownership) / 100)

        data.append(SharedExpenseMonthly(
            year_month=item['year_month'],
            partner_id=item['partner_id'],
            partner_name=item['partner_name'],
            total_amount=item['total_amount'],
            count=item['count'],
            ownership_percentage=avg_ownership,
            user_amount=user_amount,
            partner_amount=partner_amount
        ))

        total_amount += item['total_amount']
        total_count += item['count']
        total_user_amount += user_amount
        total_partner_amount += partner_amount

    # Ordena por year_month desc
    data.sort(key=lambda x: x.year_month, reverse=True)

    return SharedExpensesResponse(
        data=data,
        total_amount=total_amount,
        total_count=total_count,
        total_user_amount=total_user_amount,
        total_partner_amount=total_partner_amount
    )


# Schema para relatório de faturas
class InvoiceReportItem(BaseModel):
    """Item individual de fatura"""
    id: int
    date: datetime
    description: str
    amount: Decimal
    year_month: str
    card_id: int
    card_name: str
    card_number: str
    subtag_id: int | None = None
    tag_name: str | None = None
    subtag_name: str | None = None
    # Campos de compartilhamento
    shared_partner_id: int | None = None  # expense_sharing_id
    shared_partner_name: str | None = None
    shared_partner_bank: str | None = None
    shared_partner_agency: str | None = None
    shared_partner_account_number: str | None = None
    ownership_percentage: Decimal | None = None


class InvoiceReportResponse(BaseModel):
    """Resposta do relatório de faturas"""
    items: List[InvoiceReportItem]


@router.get("/invoices", response_model=InvoiceReportResponse)
async def get_invoice_report(
    card_ids: str | None = Query(None, description="IDs dos cartões separados por vírgula (ex: 1,2,3)"),
    year: str | None = Query(None, description="Ano do fechamento (ex: 2025)"),
    month: str | None = Query(None, description="Mês do fechamento (ex: 01, 02, ..., 12)"),
    tag_ids: str | None = Query(None, description="IDs das tags separados por vírgula"),
    subtag_ids: str | None = Query(None, description="IDs das subtags separados por vírgula"),
    partner_ids: str | None = Query(None, description="IDs dos parceiros separados por vírgula"),
    include_empty_sharing: bool = Query(False, description="Incluir itens sem compartilhamento (expense_sharing_id IS NULL)"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Relatório de faturas de cartão de crédito.

    Retorna todas as transações de faturas de cartão.
    Filtros opcionais: cartões, ano/mês de fechamento, tags, subtags, parceiros.
    """
    tenant_id = current_user.get("tenant_id", 1)

    # Parse card_ids
    card_id_list = None
    if card_ids:
        try:
            card_id_list = [int(id.strip()) for id in card_ids.split(',') if id.strip()]
        except ValueError:
            raise HTTPException(status_code=400, detail="IDs de cartões inválidos")

    # Parse tag_ids
    tag_id_list = None
    if tag_ids:
        try:
            tag_id_list = [int(id.strip()) for id in tag_ids.split(',') if id.strip()]
        except ValueError:
            raise HTTPException(status_code=400, detail="IDs de tags inválidos")

    # Parse subtag_ids
    subtag_id_list = None
    if subtag_ids:
        try:
            subtag_id_list = [int(id.strip()) for id in subtag_ids.split(',') if id.strip()]
        except ValueError:
            raise HTTPException(status_code=400, detail="IDs de subtags inválidos")

    # Parse partner_ids
    partner_id_list = None
    if partner_ids:
        try:
            partner_id_list = [int(id.strip()) for id in partner_ids.split(',') if id.strip()]
        except ValueError:
            raise HTTPException(status_code=400, detail="IDs de parceiros inválidos")

    # Alias para a conta compartilhada e banco
    from sqlalchemy.orm import aliased
    SharedAccount = aliased(Account)
    SharedBank = aliased(Bank)

    # Query para buscar faturas
    query = db.query(
        CreditCardInvoice.id,
        CreditCardInvoice.date,
        CreditCardInvoice.description,
        CreditCardInvoice.amount,
        CreditCardInvoice.year_month,
        CreditCardInvoice.credit_card_id,
        CreditCardInvoice.ownership_percentage,
        CreditCardInvoice.subtag_id,
        CreditCardInvoice.expense_sharing_id,
        Cartao.name.label('card_name'),
        Cartao.number.label('card_number'),
        Tag.name.label('tag_name'),
        Subtag.name.label('subtag_name'),
        SharedAccount.name.label('shared_partner_name'),
        SharedBank.name.label('shared_partner_bank'),
        SharedAccount.agency.label('shared_partner_agency'),
        SharedAccount.account_number.label('shared_partner_account_number')
    ).join(
        Cartao, CreditCardInvoice.credit_card_id == Cartao.id
    ).outerjoin(
        Subtag, CreditCardInvoice.subtag_id == Subtag.id
    ).outerjoin(
        Tag, Subtag.tag_id == Tag.id
    ).outerjoin(
        ExpenseSharingSetting, CreditCardInvoice.expense_sharing_id == ExpenseSharingSetting.id
    ).outerjoin(
        SharedAccount, ExpenseSharingSetting.shared_account_id == SharedAccount.id
    ).outerjoin(
        SharedBank, SharedAccount.bank_id == SharedBank.id
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id
    )

    # Filtro por cartões
    if card_id_list:
        query = query.filter(CreditCardInvoice.credit_card_id.in_(card_id_list))

    # Filtro por ano/mês de fechamento
    if year and month:
        # Filtra pelo year_month exato (ex: "2025-01")
        year_month = f"{year}-{month.zfill(2)}"
        query = query.filter(CreditCardInvoice.year_month == year_month)
    elif year:
        # Filtra por todos os meses do ano
        query = query.filter(CreditCardInvoice.year_month.like(f"{year}-%"))

    # Filtro por subtags
    if subtag_id_list:
        query = query.filter(CreditCardInvoice.subtag_id.in_(subtag_id_list))
    elif tag_id_list:
        # Busca subtags das tags selecionadas
        subtag_query = db.query(Subtag.id).filter(Subtag.tag_id.in_(tag_id_list))
        query = query.filter(CreditCardInvoice.subtag_id.in_(subtag_query))

    # Filtro por parceiros (expense_sharing_id) com suporte a "Vazio"
    if partner_id_list or include_empty_sharing:
        sharing_conditions = []
        if partner_id_list:
            sharing_conditions.append(CreditCardInvoice.expense_sharing_id.in_(partner_id_list))
        if include_empty_sharing:
            sharing_conditions.append(CreditCardInvoice.expense_sharing_id.is_(None))
        if sharing_conditions:
            query = query.filter(or_(*sharing_conditions))

    # Ordenação
    query = query.order_by(CreditCardInvoice.date.desc())

    results = query.all()

    items = [
        InvoiceReportItem(
            id=r.id,
            date=r.date,
            description=r.description,
            amount=r.amount,
            year_month=r.year_month,
            card_id=r.credit_card_id,
            card_name=r.card_name,
            card_number=r.card_number,
            subtag_id=r.subtag_id,
            tag_name=r.tag_name,
            subtag_name=r.subtag_name,
            shared_partner_id=r.expense_sharing_id,
            shared_partner_name=r.shared_partner_name,
            shared_partner_bank=r.shared_partner_bank,
            shared_partner_agency=r.shared_partner_agency,
            shared_partner_account_number=r.shared_partner_account_number,
            ownership_percentage=r.ownership_percentage
        )
        for r in results
    ]

    return InvoiceReportResponse(items=items)

    return InvoiceReportResponse(items=items)

