"""
Router para fechamentos de balanço compartilhado.
Fornece endpoints para criar, listar e gerenciar fechamentos de balanço.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, desc, or_
from typing import List
from decimal import Decimal
from datetime import datetime, timedelta
from pydantic import BaseModel

from app.database import get_db
from app.models.unified_models import (
    BalanceClosure, ExpenseSharingSetting,
    Account, Bank, BankStatement, CreditCardInvoice, BenefitCardStatement,
    Tag, Subtag, Cartao, Loan, LoanPayment
)
from app.dependencies.auth import get_current_user

router = APIRouter(prefix="/api/balance/closures", tags=["balance-closures"])


# ==================== SCHEMAS ====================

class LoanPaymentInput(BaseModel):
    """Input para pagamento de empréstimo no fechamento"""
    loan_id: int
    amount: Decimal  # Valor a pagar (deve ser <= corrected_balance)
    corrected_balance: Decimal  # Saldo corrigido com juros (calculado pelo frontend)

    class Config:
        from_attributes = True


class BalanceClosureCreate(BaseModel):
    """Request para criar um fechamento de balanço"""
    expense_sharing_id: int
    year: int
    month: int
    period_start_date: str  # ✅ Timestamp de início (YYYY-MM-DD HH:MM:SS ou YYYY-MM-DD) - vem do frontend
    period_end_date: str    # ✅ Timestamp de fim (YYYY-MM-DD HH:MM:SS ou YYYY-MM-DD) - vem do frontend
    closure_data: dict      # Dados completos do balanço calculado (snapshot do frontend)
    notes: str | None = None
    closing_date: str | None = None  # ✅ Data/hora exata do clique em "Aplicar" (YYYY-MM-DD HH:MM:SS) - evita gaps
    loan_payments: List[LoanPaymentInput] | None = None  # ✅ Pagamentos de empréstimos (opcional)

    class Config:
        from_attributes = True


class BalanceClosureItemResponse(BaseModel):
    """Response de um item de fechamento"""
    id: int
    source_table: str
    expense_id: int | None
    amount: Decimal
    date: datetime
    item_data: dict
    created_at: datetime

    class Config:
        from_attributes = True


class BalanceClosureResponse(BaseModel):
    """Response de um fechamento de balanço"""
    id: int
    expense_sharing_id: int
    account_id: int
    shared_account_id: int
    period_start_date: datetime
    closing_date: datetime
    year: int
    month: int
    total_to_receive: Decimal
    total_to_pay: Decimal
    net_balance: Decimal
    notes: str | None
    is_settled: bool
    settled_at: datetime | None
    settlement_notes: str | None
    closure_data: dict
    created_at: datetime
    tenant_id: int
    created_by: int

    class Config:
        from_attributes = True


class BalanceClosureCheckResponse(BaseModel):
    """Response para verificação de fechamento existente"""
    exists: bool
    closure_id: int | None
    year: int
    month: int
    closing_date: datetime | None

    class Config:
        from_attributes = True


class BalanceClosureWithItemsResponse(BaseModel):
    """Response de um fechamento com seus itens"""
    closure: BalanceClosureResponse
    items: List[BalanceClosureItemResponse]


class BalanceClosureSettleRequest(BaseModel):
    """Request para marcar fechamento como quitado"""
    settlement_notes: str | None = None

    class Config:
        from_attributes = True


class BalanceClosureListResponse(BaseModel):
    """Response de listagem de fechamentos"""
    closures: List[BalanceClosureResponse]
    total: int


class ClosedPeriodValidationResponse(BaseModel):
    """Response para validação de período fechado"""
    is_closed: bool
    closure_id: int | None = None
    closure_year: int | None = None
    closure_month: int | None = None
    is_settled: bool = False
    next_open_date: str | None = None  # Data sugerida para o próximo período aberto (YYYY-MM-DD)
    message: str | None = None

    class Config:
        from_attributes = True


class PeriodOverlapValidationResponse(BaseModel):
    """Response para validação de sobreposição de períodos ao criar fechamento"""
    has_overlap: bool
    start_date_conflict: bool = False  # Data inicial está dentro de período fechado
    end_date_conflict: bool = False    # Data final está dentro de período fechado
    both_dates_conflict: bool = False  # Ambas as datas estão dentro do mesmo período fechado
    conflicting_closure_id: int | None = None
    conflicting_period_start: str | None = None  # YYYY-MM-DD HH:MM:SS
    conflicting_period_end: str | None = None    # YYYY-MM-DD HH:MM:SS
    suggested_start_date: str | None = None      # YYYY-MM-DD HH:MM:SS
    suggested_end_date: str | None = None        # YYYY-MM-DD HH:MM:SS
    message: str | None = None

    class Config:
        from_attributes = True


# ==================== HELPER FUNCTIONS ====================

def calculate_period_dates(year: int, month: int, closing_day: int | None):
    """
    Calcula as datas de início e fim do período de fechamento.

    Regra: O período vai do dia seguinte ao fechamento do mês anterior
    até o dia do fechamento do mês atual.

    Exemplo: closing_day = 19
    - Para Jan/2026: 20/Dez/2025 00:00:00 até 19/Jan/2026 23:59:59
    """
    import calendar
    from dateutil.relativedelta import relativedelta

    if closing_day:
        # Data de fim: closing_day do mês atual
        last_day_of_month = calendar.monthrange(year, month)[1]
        end_day = min(closing_day, last_day_of_month)
        period_end = datetime(year, month, end_day, 23, 59, 59)

        # Data de início: dia seguinte ao closing_day do mês anterior
        # Calcula o mês anterior
        previous_month_date = datetime(year, month, 1) - relativedelta(months=1)
        prev_year = previous_month_date.year
        prev_month = previous_month_date.month

        # Dia de início é closing_day + 1 do mês anterior
        last_day_prev_month = calendar.monthrange(prev_year, prev_month)[1]
        start_day = min(closing_day + 1, last_day_prev_month)

        # Se closing_day + 1 ultrapassar o último dia do mês anterior,
        # começa no dia 1 do mês atual
        if closing_day + 1 > last_day_prev_month:
            period_start = datetime(year, month, 1, 0, 0, 0)
        else:
            period_start = datetime(prev_year, prev_month, start_day, 0, 0, 0)
    else:
        # Sem closing_day: período é o mês inteiro
        period_start = datetime(year, month, 1, 0, 0, 0)
        last_day = calendar.monthrange(year, month)[1]
        period_end = datetime(year, month, last_day, 23, 59, 59)

    return period_start, period_end


def build_closure_data(
    sharing: ExpenseSharingSetting,
    main_account: Account,
    shared_account: Account,
    period_start: datetime,
    period_end: datetime,
    year: int,
    month: int,
    my_total_expenses: Decimal,
    my_total_revenues: Decimal,
    shared_total_expenses: Decimal,
    shared_total_revenues: Decimal,
    my_expenses_count: int,
    my_revenues_count: int,
    shared_expenses_count: int,
    shared_revenues_count: int,
    user_email: str
) -> dict:
    """Constrói o JSON do cabeçalho do fechamento"""
    return {
        "version": "1.0",
        "calculation_timestamp": datetime.now().isoformat(),
        "user_email": user_email,

        "period": {
            "start_date": period_start.isoformat(),
            "end_date": period_end.isoformat(),
            "year": year,
            "month": month,
            "total_days": (period_end - period_start).days + 1
        },

        "sharing": {
            "description": sharing.description,
            "my_contribution_percentage": float(sharing.my_contribution_percentage)
        },

        "main_account": {
            "name": main_account.name,
            "description": main_account.description,
            "bank_code": main_account.bank.code if main_account.bank else None,
            "bank_name": main_account.bank.name if main_account.bank else None,
            "agency": main_account.agency,
            "account_number": main_account.account_number
        },

        "shared_account": {
            "name": shared_account.name,
            "description": shared_account.description,
            "bank_code": shared_account.bank.code if shared_account.bank else None,
            "bank_name": shared_account.bank.name if shared_account.bank else None,
            "agency": shared_account.agency,
            "account_number": shared_account.account_number
        },

        "summary": {
            "main_account": {
                "total_to_receive": float(my_total_expenses),   # Positivo (despesas que EU paguei)
                "total_to_pay": float(-my_total_revenues),      # Negativo (despesas do PARCEIRO)
                "net_amount": float(my_total_expenses - my_total_revenues),
                "expenses_count": my_expenses_count,
                "revenues_count": my_revenues_count
            },
            "shared_account": {
                "total_to_receive": float(shared_total_expenses),   # Positivo
                "total_to_pay": float(-shared_total_revenues),      # Negativo
                "net_amount": float(shared_total_expenses - shared_total_revenues),
                "expenses_count": shared_expenses_count,
                "revenues_count": shared_revenues_count
            }
        }
    }


def build_item_data(
    description: str,
    original_description: str | None,
    amount: Decimal,
    date: datetime,
    account: Account,
    tag: Tag | None,
    subtag: Subtag | None,
    ownership_percentage: Decimal | None,
    shared_account: Account | None,
    card: Cartao | None,
    adjustment_notes: str | None
) -> dict:
    """Constrói o JSON de um item de fechamento"""
    return {
        "description": description,
        "original_description": original_description,
        "amount": float(amount),
        "date": date.isoformat(),

        "account": {
            "name": account.name,
            "bank_code": account.bank.code if account.bank else None,
            "bank_name": account.bank.name if account.bank else None,
            "agency": account.agency,
            "account_number": account.account_number
        },

        "tag": {
            "name": tag.name if tag else None,
            "type": tag.type if tag else None
        } if tag else None,

        "subtag": {
            "name": subtag.name if subtag else None
        } if subtag else None,

        "sharing": {
            "ownership_percentage": float(ownership_percentage) if ownership_percentage else None,
            "shared_account_name": shared_account.name if shared_account else None,
            "shared_account_bank_code": shared_account.bank.code if (shared_account and shared_account.bank) else None,
            "shared_account_bank_name": shared_account.bank.name if (shared_account and shared_account.bank) else None,
            "shared_account_agency": shared_account.agency if shared_account else None,
            "shared_account_number": shared_account.account_number if shared_account else None
        } if ownership_percentage or shared_account else None,

        "card": {
            "name": card.name if card else None,
            "description": card.description if card else None,
            "number": card.number if card else None,
            "type": card.type if card else None,
            "closing_day": card.closing_day if card else None,
            "active": card.active if card else None
        } if card else None,

        "adjustment_notes": adjustment_notes
    }


# ==================== ENDPOINTS ====================

@router.post("", response_model=BalanceClosureResponse, status_code=201)
def create_balance_closure(
    request: BalanceClosureCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Cria um novo fechamento de balanço.

    Salva um snapshot completo dos dados já calculados pelo frontend.
    NÃO recalcula nada - apenas persiste os dados recebidos.
    """
    tenant_id = current_user["tenant_id"]
    user_id = current_user["id"]

    # Buscar configuração de compartilhamento
    sharing = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.id == request.expense_sharing_id,
        ExpenseSharingSetting.tenant_id == tenant_id,
        ExpenseSharingSetting.active == True
    ).options(
        joinedload(ExpenseSharingSetting.account).joinedload(Account.bank),
        joinedload(ExpenseSharingSetting.shared_account).joinedload(Account.bank)
    ).first()

    if not sharing:
        raise HTTPException(status_code=404, detail="Configuração de compartilhamento não encontrada")

    # Buscar TODOS os sharings entre as duas contas (bidirecional)
    all_sharings = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.tenant_id == tenant_id,
        or_(
            and_(
                ExpenseSharingSetting.account_id == sharing.account_id,
                ExpenseSharingSetting.shared_account_id == sharing.shared_account_id
            ),
            and_(
                ExpenseSharingSetting.account_id == sharing.shared_account_id,
                ExpenseSharingSetting.shared_account_id == sharing.account_id
            )
        ),
        ExpenseSharingSetting.active == True
    ).all()

    sharing_ids = [s.id for s in all_sharings]

    # Parse das datas do request (vem do frontend já calculadas)
    # ✅ Tenta parsear com timestamp completo primeiro, senão usa apenas data
    try:
        period_start = datetime.strptime(request.period_start_date, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        period_start = datetime.strptime(request.period_start_date, "%Y-%m-%d")

    try:
        period_end = datetime.strptime(request.period_end_date, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        period_end = datetime.strptime(request.period_end_date, "%Y-%m-%d")

    # ✅ Verificar sobreposição de períodos usando TIMESTAMPS COMPLETOS
    # Buscar todos os fechamentos que podem conflitar
    all_closures = db.query(BalanceClosure).filter(
        BalanceClosure.expense_sharing_id.in_(sharing_ids),
        BalanceClosure.tenant_id == tenant_id
    ).all()

    # Verificar se data inicial ou final estão dentro de algum período fechado
    start_conflict_closure = None
    end_conflict_closure = None

    for closure in all_closures:
        # ✅ Usa timestamps completos (datetime) ao invés de apenas .date()
        # Isso permite múltiplos fechamentos no mesmo dia em horários diferentes
        closure_start = closure.period_start_date if isinstance(closure.period_start_date, datetime) else datetime.combine(closure.period_start_date, datetime.min.time())
        closure_end = closure.closing_date if isinstance(closure.closing_date, datetime) else datetime.combine(closure.closing_date, datetime.max.time())

        # ✅ REGRA: Novo período NÃO pode começar ANTES do closing_date de um fechamento existente
        # Permite: period_start > closure_end (começar APÓS o fechamento)
        # Bloqueia: period_start <= closure_end (começar DURANTE ou ANTES do fechamento)
        if closure_start <= period_start < closure_end:
            start_conflict_closure = closure

        # ✅ REGRA: Novo período NÃO pode terminar DURANTE um fechamento existente
        # Permite: period_end <= closure_start (terminar ANTES do fechamento começar)
        # Bloqueia: closure_start < period_end <= closure_end (terminar DURANTE o fechamento)
        if closure_start < period_end <= closure_end:
            end_conflict_closure = closure

    # Se houver conflito, retornar erro com sugestões
    if start_conflict_closure or end_conflict_closure:
        # Caso 1: Ambas as datas estão dentro do MESMO período fechado
        if start_conflict_closure and end_conflict_closure and start_conflict_closure.id == end_conflict_closure.id:
            raise HTTPException(
                status_code=400,
                detail=f"O período selecionado ({period_start.strftime('%d/%m/%Y %H:%M:%S')} até {period_end.strftime('%d/%m/%Y %H:%M:%S')}) está completamente dentro de um fechamento já existente ({start_conflict_closure.period_start_date.strftime('%d/%m/%Y %H:%M:%S')} até {start_conflict_closure.closing_date.strftime('%d/%m/%Y %H:%M:%S')}). Não é possível criar este fechamento. ID: {start_conflict_closure.id}"
            )

        # Caso 2: Apenas data inicial está dentro de um período fechado
        elif start_conflict_closure:
            # Sugerir: próximo segundo após o closing_date do fechamento conflitante
            suggested_start = start_conflict_closure.closing_date + timedelta(seconds=1)
            raise HTTPException(
                status_code=400,
                detail={
                    "message": f"A data inicial ({period_start.strftime('%d/%m/%Y %H:%M:%S')}) está dentro de um período já fechado ({start_conflict_closure.period_start_date.strftime('%d/%m/%Y %H:%M:%S')} até {start_conflict_closure.closing_date.strftime('%d/%m/%Y %H:%M:%S')}). ID: {start_conflict_closure.id}",
                    "suggested_start_date": suggested_start.strftime("%Y-%m-%d %H:%M:%S"),
                    "conflict_type": "start_date"
                }
            )

        # Caso 3: Apenas data final está dentro de um período fechado
        elif end_conflict_closure:
            # Sugerir: um segundo antes do início do período fechado
            suggested_end = end_conflict_closure.closing_date - timedelta(seconds=1)
            raise HTTPException(
                status_code=400,
                detail={
                    "message": f"A data final ({period_end.strftime('%d/%m/%Y %H:%M:%S')}) está dentro de um período já fechado ({end_conflict_closure.period_start_date.strftime('%d/%m/%Y %H:%M:%S')} até {end_conflict_closure.closing_date.strftime('%d/%m/%Y %H:%M:%S')}). ID: {end_conflict_closure.id}",
                    "suggested_end_date": suggested_end.strftime("%Y-%m-%d %H:%M:%S"),
                    "conflict_type": "end_date"
                }
            )

    # Extrair totais do closure_data (já calculados pelo frontend)
    main_account_card = request.closure_data.get('main_account_card', {})

    # ✅ Nova estrutura de campos:
    # - net_amount_before_loans: saldo antes de empréstimos (positivo = a receber)
    # - loan_to_receive: empréstimos a receber (positivo)
    # - loan_to_pay: empréstimos a pagar (negativo)
    # - net_amount: soma de tudo (positivo = a receber, negativo = a pagar)

    # Calcular total_to_receive e total_to_pay a partir do net_amount
    # net_amount já inclui empréstimos com sinais corretos
    net_amount = main_account_card.get('net_amount', 0)
    if net_amount is None:
        net_amount = 0
    net_balance = Decimal(str(net_amount))

    # total_to_receive = parte positiva (a receber)
    # total_to_pay = parte negativa (a pagar) em valor absoluto
    if net_balance >= 0:
        total_to_receive = abs(net_balance)
        total_to_pay = Decimal('0')
    else:
        total_to_receive = Decimal('0')
        total_to_pay = abs(net_balance)

    # ✅ Usar closing_date do request se fornecido (timestamp do clique em "Aplicar")
    # Caso contrário, usar datetime.now() (comportamento antigo)
    if request.closing_date:
        try:
            # Parse do timestamp (YYYY-MM-DD HH:MM:SS)
            closing_datetime = datetime.strptime(request.closing_date, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            # Fallback se formato estiver incorreto
            closing_datetime = datetime.now()
    else:
        closing_datetime = datetime.now()

    # ==================== VALIDAR LOAN PAYMENTS ====================
    # Preparar lista de empréstimos e valores para criar após o fechamento
    loan_payments_to_create = []
    loan_payments_info = []

    if request.loan_payments:
        account_id = current_user.get("account_id")

        for lp_input in request.loan_payments:
            # Buscar empréstimo
            loan = db.query(Loan).filter(
                Loan.id == lp_input.loan_id,
                Loan.account_id == account_id,
                Loan.tenant_id == tenant_id,
                Loan.status == 'open',
                Loan.active == True
            ).options(joinedload(Loan.payments)).first()

            if not loan:
                raise HTTPException(
                    status_code=400,
                    detail=f"Empréstimo ID {lp_input.loan_id} não encontrado ou não pertence à conta logada"
                )

            # ✅ Usar o saldo corrigido enviado pelo frontend (já calculado com juros)
            remaining = lp_input.corrected_balance

            # Validar valor
            if lp_input.amount <= 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Valor de pagamento deve ser positivo. Empréstimo ID {lp_input.loan_id}"
                )

            if lp_input.amount > remaining:
                raise HTTPException(
                    status_code=400,
                    detail=f"Valor de pagamento (R$ {lp_input.amount:.2f}) excede o saldo corrigido (R$ {remaining:.2f}). Empréstimo ID {lp_input.loan_id}"
                )

            new_remaining = remaining - lp_input.amount

            # Guardar para criar depois (com balance_closure_id)
            loan_payments_to_create.append({
                "loan": loan,
                "amount": lp_input.amount,
                "new_remaining": new_remaining
            })

            # Info para o JSON
            loan_payments_info.append({
                "loan_id": loan.id,
                "loan_type": loan.loan_type,
                "description": loan.description,
                "original_amount": float(loan.principal_amount),
                "remaining_before": float(remaining),
                "amount_paid": float(lp_input.amount),
                "remaining_after": float(new_remaining),
                "is_settled": new_remaining <= 0,
                "period_start": period_start.strftime("%Y-%m-%d %H:%M:%S"),
                "period_end": closing_datetime.strftime("%Y-%m-%d %H:%M:%S")
            })

    # Adicionar loan_payments ao closure_data
    closure_data = request.closure_data.copy()
    if loan_payments_info:
        closure_data['loan_payments'] = loan_payments_info

    # ==================== CRIAR FECHAMENTO ====================
    closure = BalanceClosure(
        expense_sharing_id=sharing.id,
        account_id=sharing.account_id,
        shared_account_id=sharing.shared_account_id,
        period_start_date=period_start,
        closing_date=closing_datetime,  # ✅ Data de fim do período = timestamp do clique em "Aplicar"
        year=request.year,
        month=request.month,
        total_to_receive=total_to_receive,
        total_to_pay=total_to_pay,
        net_balance=net_balance,
        notes=request.notes,
        closure_data=closure_data,  # ✅ Salva o JSON completo com loan_payments
        tenant_id=tenant_id,
        created_by=user_id
    )

    db.add(closure)
    db.flush()  # Obter ID do fechamento antes do commit

    # ==================== CRIAR LOAN PAYMENTS COM FK ====================
    account_id = current_user.get("account_id")
    for lp_data in loan_payments_to_create:
        loan = lp_data["loan"]

        loan_payment = LoanPayment(
            loan_id=loan.id,
            amount=lp_data["amount"],
            payment_date=closing_datetime,
            source_table=None,  # NULL = pagamento via fechamento de balanço
            source_id=None,
            balance_closure_id=closure.id,  # ✅ FK para o fechamento
            notes=f"Pagamento via fechamento de balanço - {closing_datetime.strftime('%d/%m/%Y %H:%M:%S')}",
            account_id=account_id,
            tenant_id=tenant_id,
            created_by=user_id,
            active=True
        )
        db.add(loan_payment)

        # Verificar se empréstimo foi totalmente quitado
        if lp_data["new_remaining"] <= 0:
            loan.status = 'settled'
            loan.settled_at = closing_datetime

    db.commit()
    db.refresh(closure)

    return closure


@router.get("/check", response_model=BalanceClosureCheckResponse)
def check_balance_closure_exists(
    expense_sharing_id: int = Query(..., description="ID da configuração de compartilhamento"),
    year: int = Query(..., description="Ano do fechamento"),
    month: int = Query(..., description="Mês do fechamento (1-12)"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Verifica se já existe um fechamento para o período especificado.
    Busca em todos os sharings entre as duas contas envolvidas.
    """
    tenant_id = current_user["tenant_id"]

    # Primeiro, buscar o sharing para obter as contas envolvidas
    sharing = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.id == expense_sharing_id,
        ExpenseSharingSetting.tenant_id == tenant_id
    ).first()

    if not sharing:
        return BalanceClosureCheckResponse(
            exists=False,
            closure_id=None,
            year=year,
            month=month,
            closing_date=None
        )

    # Buscar TODOS os sharings entre as duas contas
    all_sharings = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.tenant_id == tenant_id,
        or_(
            and_(
                ExpenseSharingSetting.account_id == sharing.account_id,
                ExpenseSharingSetting.shared_account_id == sharing.shared_account_id
            ),
            and_(
                ExpenseSharingSetting.account_id == sharing.shared_account_id,
                ExpenseSharingSetting.shared_account_id == sharing.account_id
            )
        ),
        ExpenseSharingSetting.active == True
    ).all()

    sharing_ids = [s.id for s in all_sharings]

    # Buscar fechamento existente em qualquer um dos sharings
    closure = db.query(BalanceClosure).filter(
        BalanceClosure.expense_sharing_id.in_(sharing_ids),
        BalanceClosure.year == year,
        BalanceClosure.month == month,
        BalanceClosure.tenant_id == tenant_id
    ).first()

    if closure:
        return BalanceClosureCheckResponse(
            exists=True,
            closure_id=closure.id,
            year=year,
            month=month,
            closing_date=closure.closing_date
        )
    else:
        return BalanceClosureCheckResponse(
            exists=False,
            closure_id=None,
            year=year,
            month=month,
            closing_date=None
        )


@router.get("/validate-date", response_model=ClosedPeriodValidationResponse)
def validate_date_against_closures(
    expense_sharing_id: int = Query(..., description="ID da configuração de compartilhamento"),
    date: str = Query(..., description="Data a validar no formato YYYY-MM-DD"),
    time: str | None = Query(None, description="Hora a validar no formato HH:MM:SS (opcional)"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Valida se uma data/hora está dentro de um período já fechado.

    Retorna informações sobre o fechamento e sugere a próxima data disponível
    caso a data esteja em um período fechado.

    Se 'time' for fornecido, compara com o closing_date (timestamp) do fechamento.
    Caso contrário, compara apenas a data.
    """
    from dateutil.relativedelta import relativedelta
    import calendar

    tenant_id = current_user["tenant_id"]

    # Parse da data/hora
    try:
        if time:
            # Combinar data + hora
            target_datetime = datetime.strptime(f"{date} {time}", "%Y-%m-%d %H:%M:%S")
        else:
            # Apenas data (considera início do dia)
            target_datetime = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Data/hora inválida. Use YYYY-MM-DD para data e HH:MM:SS para hora")

    # Buscar o sharing
    sharing = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.id == expense_sharing_id,
        ExpenseSharingSetting.tenant_id == tenant_id
    ).first()

    if not sharing:
        return ClosedPeriodValidationResponse(
            is_closed=False,
            message="Configuração de compartilhamento não encontrada"
        )

    # Buscar TODOS os sharings entre as duas contas
    all_sharings = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.tenant_id == tenant_id,
        or_(
            and_(
                ExpenseSharingSetting.account_id == sharing.account_id,
                ExpenseSharingSetting.shared_account_id == sharing.shared_account_id
            ),
            and_(
                ExpenseSharingSetting.account_id == sharing.shared_account_id,
                ExpenseSharingSetting.shared_account_id == sharing.account_id
            )
        ),
        ExpenseSharingSetting.active == True
    ).all()

    sharing_ids = [s.id for s in all_sharings]

    # Buscar todos os fechamentos ordenados por data
    closures = db.query(BalanceClosure).filter(
        BalanceClosure.expense_sharing_id.in_(sharing_ids),
        BalanceClosure.tenant_id == tenant_id
    ).order_by(BalanceClosure.year.desc(), BalanceClosure.month.desc()).all()

    if not closures:
        return ClosedPeriodValidationResponse(
            is_closed=False,
            message="Nenhum fechamento encontrado"
        )

    # Verificar se a data/hora está dentro de algum período fechado
    for closure in closures:
        # ✅ Usar period_start_date e closing_date salvos no fechamento
        period_start = closure.period_start_date.date() if isinstance(closure.period_start_date, datetime) else closure.period_start_date
        period_end = closure.closing_date.date() if isinstance(closure.closing_date, datetime) else closure.closing_date  # ✅ Usa closing_date

        # Verificar se a data está dentro do período
        if period_start <= target_datetime.date() <= period_end:
            # ✅ Se hora foi fornecida, comparar com closing_date (timestamp)
            if time:
                # Comparar timestamp completo
                if target_datetime <= closure.closing_date:
                    # Transação está ANTES ou NO MOMENTO do fechamento → BLOQUEADA
                    latest_closure = closures[0]
                    # Próxima data disponível é o timestamp do fechamento + 1 segundo
                    next_open_datetime = closure.closing_date + relativedelta(seconds=1)

                    return ClosedPeriodValidationResponse(
                        is_closed=True,
                        closure_id=closure.id,
                        closure_year=closure.year,
                        closure_month=closure.month,
                        is_settled=closure.is_settled,
                        next_open_date=next_open_datetime.strftime("%Y-%m-%d"),
                        message=f"A data/hora {target_datetime.strftime('%d/%m/%Y %H:%M:%S')} está dentro do período fechado em {closure.closing_date.strftime('%d/%m/%Y %H:%M:%S')}."
                    )
                else:
                    # Transação está DEPOIS do fechamento → PERMITIDA
                    continue
            else:
                # Sem hora fornecida → validação apenas por data (comportamento antigo)
                latest_closure = closures[0]
                latest_end = latest_closure.closing_date.date() if isinstance(latest_closure.closing_date, datetime) else latest_closure.closing_date  # ✅ Usa closing_date
                next_open_date = latest_end + relativedelta(days=1)

                return ClosedPeriodValidationResponse(
                    is_closed=True,
                    closure_id=closure.id,
                    closure_year=closure.year,
                    closure_month=closure.month,
                    is_settled=closure.is_settled,
                    next_open_date=next_open_date.strftime("%Y-%m-%d"),
                    message=f"A data {target_datetime.strftime('%d/%m/%Y')} está dentro do período fechado de {period_start.strftime('%d/%m/%Y')} até {period_end.strftime('%d/%m/%Y')}."
                )

    # Data não está em nenhum período fechado
    return ClosedPeriodValidationResponse(
        is_closed=False,
        message="Data está em período aberto"
    )


@router.get("", response_model=BalanceClosureListResponse)
def list_balance_closures(
    expense_sharing_id: int | None = Query(None, description="Filtrar por configuração de compartilhamento"),
    year: int | None = Query(None, description="Filtrar por ano"),
    month: int | None = Query(None, description="Filtrar por mês"),
    is_settled: bool | None = Query(None, description="Filtrar por status de quitação"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Lista fechamentos de balanço com filtros opcionais.
    """
    tenant_id = current_user["tenant_id"]
    account_id = current_user.get("account_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Query base - busca fechamentos onde a conta logada é account_id OU shared_account_id
    # Isso permite que ambas as contas vejam os mesmos fechamentos
    query = db.query(BalanceClosure).filter(
        BalanceClosure.tenant_id == tenant_id,
        or_(
            BalanceClosure.account_id == account_id,
            BalanceClosure.shared_account_id == account_id
        )
    )

    # Aplicar filtros
    if expense_sharing_id is not None:
        # Buscar o sharing para obter as contas envolvidas
        sharing = db.query(ExpenseSharingSetting).filter(
            ExpenseSharingSetting.id == expense_sharing_id,
            ExpenseSharingSetting.tenant_id == tenant_id
        ).first()

        if sharing:
            # Buscar TODOS os sharings entre as duas contas
            all_sharings = db.query(ExpenseSharingSetting).filter(
                ExpenseSharingSetting.tenant_id == tenant_id,
                or_(
                    and_(
                        ExpenseSharingSetting.account_id == sharing.account_id,
                        ExpenseSharingSetting.shared_account_id == sharing.shared_account_id
                    ),
                    and_(
                        ExpenseSharingSetting.account_id == sharing.shared_account_id,
                        ExpenseSharingSetting.shared_account_id == sharing.account_id
                    )
                ),
                ExpenseSharingSetting.active == True
            ).all()

            sharing_ids = [s.id for s in all_sharings]
            query = query.filter(BalanceClosure.expense_sharing_id.in_(sharing_ids))
        else:
            # Se não encontrar o sharing, filtra pelo ID passado (comportamento original)
            query = query.filter(BalanceClosure.expense_sharing_id == expense_sharing_id)

    if year is not None:
        query = query.filter(BalanceClosure.year == year)

    if month is not None:
        query = query.filter(BalanceClosure.month == month)

    if is_settled is not None:
        query = query.filter(BalanceClosure.is_settled == is_settled)

    # Contar total
    total = query.count()

    # Ordenar e paginar
    closures = query.order_by(desc(BalanceClosure.closing_date)).offset(skip).limit(limit).all()

    return BalanceClosureListResponse(closures=closures, total=total)


@router.get("/{closure_id}", response_model=BalanceClosureWithItemsResponse)
def get_balance_closure(
    closure_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Busca um fechamento de balanço específico com todos os seus itens.
    Extrai os itens do closure_data JSON (não usa mais a tabela balance_closure_items).
    """
    tenant_id = current_user["tenant_id"]
    account_id = current_user.get("account_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Buscar fechamento - permite acesso se a conta logada é account_id OU shared_account_id
    closure = db.query(BalanceClosure).filter(
        BalanceClosure.id == closure_id,
        BalanceClosure.tenant_id == tenant_id,
        or_(
            BalanceClosure.account_id == account_id,
            BalanceClosure.shared_account_id == account_id
        )
    ).first()

    if not closure:
        raise HTTPException(status_code=404, detail="Fechamento não encontrado")

    # Extrair itens do closure_data JSON
    items = []
    closure_data = closure.closure_data or {}

    # Processar itens da conta principal
    main_account_card = closure_data.get('main_account_card', {})
    for expense_item in main_account_card.get('expense_items', []):
        items.append(_convert_to_closure_item(expense_item, closure_id))
    for revenue_item in main_account_card.get('revenue_items', []):
        items.append(_convert_to_closure_item(revenue_item, closure_id))

    # Processar itens da conta parceira
    partner_account_card = closure_data.get('partner_account_card', {})
    for expense_item in partner_account_card.get('expense_items', []):
        items.append(_convert_to_closure_item(expense_item, closure_id))
    for revenue_item in partner_account_card.get('revenue_items', []):
        items.append(_convert_to_closure_item(revenue_item, closure_id))

    # Ordenar por data (mais recente primeiro)
    items.sort(key=lambda x: x.date, reverse=True)

    return BalanceClosureWithItemsResponse(closure=closure, items=items)


def _convert_to_closure_item(item_data: dict, closure_id: int) -> BalanceClosureItemResponse:
    """
    Converte um item do closure_data JSON para o formato BalanceClosureItemResponse.
    """
    # Determinar source_table baseado no tipo
    source_table = "bank_statements"  # default
    if item_data.get('card_name'):
        if item_data.get('card_type') == 'benefício':
            source_table = "benefit_card_statements"
        else:
            source_table = "credit_card_invoices"

    # Parse da data
    date_str = item_data.get('date', '')
    try:
        date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
    except:
        date = datetime.now()

    return BalanceClosureItemResponse(
        id=item_data.get('id', 0),
        source_table=source_table,
        expense_id=item_data.get('id'),
        amount=Decimal(str(item_data.get('amount', 0))),
        date=date,
        item_data=item_data,
        created_at=datetime.now()
    )


@router.put("/{closure_id}/settle", response_model=BalanceClosureResponse)
def settle_balance_closure(
    closure_id: int,
    request: BalanceClosureSettleRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Marca um fechamento de balanço como quitado.
    """
    tenant_id = current_user["tenant_id"]
    user_id = current_user["id"]

    # Buscar fechamento
    closure = db.query(BalanceClosure).filter(
        BalanceClosure.id == closure_id,
        BalanceClosure.tenant_id == tenant_id
    ).first()

    if not closure:
        raise HTTPException(status_code=404, detail="Fechamento não encontrado")

    if closure.is_settled:
        raise HTTPException(status_code=400, detail="Fechamento já está quitado")

    # Marcar como quitado
    closure.is_settled = True
    closure.settled_at = datetime.now()
    closure.settled_by = user_id
    closure.settlement_notes = request.settlement_notes

    db.commit()
    db.refresh(closure)

    return closure


@router.delete("/{closure_id}/settle", response_model=BalanceClosureResponse)
def unsettle_balance_closure(
    closure_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Remove a marcação de quitação de um fechamento.
    """
    tenant_id = current_user["tenant_id"]

    # Buscar fechamento
    closure = db.query(BalanceClosure).filter(
        BalanceClosure.id == closure_id,
        BalanceClosure.tenant_id == tenant_id
    ).first()

    if not closure:
        raise HTTPException(status_code=404, detail="Fechamento não encontrado")

    if not closure.is_settled:
        raise HTTPException(status_code=400, detail="Fechamento não está quitado")

    # Remover quitação
    closure.is_settled = False
    closure.settled_at = None
    closure.settled_by = None
    closure.settlement_notes = None

    db.commit()
    db.refresh(closure)

    return closure


@router.delete("/{closure_id}", status_code=204)
def delete_balance_closure(
    closure_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Reabre (deleta) um fechamento de balanço.
    Permite criar um novo fechamento para o mesmo período.

    Não é possível reabrir um fechamento que já foi quitado.
    """
    tenant_id = current_user["tenant_id"]
    account_id = current_user.get("account_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Buscar fechamento - permite que ambas as contas envolvidas possam reabrir
    closure = db.query(BalanceClosure).filter(
        BalanceClosure.id == closure_id,
        BalanceClosure.tenant_id == tenant_id,
        or_(
            BalanceClosure.account_id == account_id,
            BalanceClosure.shared_account_id == account_id
        )
    ).first()

    if not closure:
        raise HTTPException(status_code=404, detail="Fechamento não encontrado")

    # Impedir reabertura de fechamentos já quitados
    if closure.is_settled:
        raise HTTPException(
            status_code=400,
            detail="Não é possível reabrir um fechamento já quitado. Remova a quitação primeiro."
        )

    # ==================== DELETAR LOAN PAYMENTS ASSOCIADOS ====================
    # Buscar pagamentos vinculados a este fechamento pela FK balance_closure_id
    linked_payments = db.query(LoanPayment).filter(
        LoanPayment.balance_closure_id == closure.id,
        LoanPayment.tenant_id == tenant_id,
        LoanPayment.active == True
    ).all()

    for loan_payment in linked_payments:
        # Verificar se o empréstimo foi marcado como settled e reverter
        loan = db.query(Loan).filter(Loan.id == loan_payment.loan_id).first()
        if loan and loan.status == 'settled':
            loan.status = 'open'
            loan.settled_at = None

        db.delete(loan_payment)

    # Deletar o fechamento (itens estão no JSON closure_data)
    db.delete(closure)
    db.commit()

    return None


class RemoveLoanPaymentsRequest(BaseModel):
    """Request para remover liquidações específicas de empréstimos"""
    loan_ids: List[int]  # Lista de loan_ids a remover (não payment_ids)

    class Config:
        from_attributes = True


@router.delete("/{closure_id}/loan-payments", status_code=200)
def delete_closure_loan_payments(
    closure_id: int,
    request: RemoveLoanPaymentsRequest = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Remove liquidações de empréstimos de um fechamento.
    Se loan_ids for fornecido, remove apenas os empréstimos especificados.
    Se loan_ids for vazio ou None, remove todos.
    Atualiza o JSON closure_data mantendo os itens não removidos.
    """
    tenant_id = current_user["tenant_id"]
    account_id = current_user.get("account_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Buscar o fechamento (owner ou contraparte)
    closure = db.query(BalanceClosure).filter(
        BalanceClosure.id == closure_id,
        BalanceClosure.tenant_id == tenant_id,
        or_(
            BalanceClosure.account_id == account_id,
            BalanceClosure.shared_account_id == account_id
        )
    ).first()

    if not closure:
        raise HTTPException(status_code=404, detail="Fechamento não encontrado")

    # Verificar se o fechamento está quitado
    if closure.is_settled:
        raise HTTPException(
            status_code=400,
            detail="Não é possível remover liquidações de um fechamento quitado. Remova a quitação primeiro."
        )

    # Determinar quais loan_ids remover
    loan_ids_to_remove = set(request.loan_ids) if request and request.loan_ids else None
    remove_all = loan_ids_to_remove is None or len(loan_ids_to_remove) == 0

    # ==================== DELETAR LOAN PAYMENTS ASSOCIADOS ====================
    query = db.query(LoanPayment).filter(
        LoanPayment.balance_closure_id == closure.id,
        LoanPayment.tenant_id == tenant_id,
        LoanPayment.active == True
    )

    if not remove_all:
        query = query.filter(LoanPayment.loan_id.in_(loan_ids_to_remove))

    linked_payments = query.all()

    deleted_count = 0
    deleted_loan_ids = set()
    for loan_payment in linked_payments:
        # Verificar se o empréstimo foi marcado como settled e reverter
        loan = db.query(Loan).filter(Loan.id == loan_payment.loan_id).first()
        if loan and loan.status == 'settled':
            loan.status = 'open'
            loan.settled_at = None

        deleted_loan_ids.add(loan_payment.loan_id)
        db.delete(loan_payment)
        deleted_count += 1

    # ==================== ATUALIZAR JSON CLOSURE_DATA ====================
    if closure.closure_data:
        closure_data = dict(closure.closure_data)

        def update_card_loans(card_key: str):
            """Atualiza campos de empréstimos de um card"""
            if card_key not in closure_data or not closure_data[card_key]:
                return

            card = dict(closure_data[card_key])
            loan_payments = card.get('loan_payments', [])

            if remove_all:
                # Remover todos
                card.pop('loan_payments', None)
                card.pop('loan_to_receive', None)
                card.pop('loan_to_pay', None)
            else:
                # Filtrar apenas os que NÃO foram removidos
                remaining_payments = [lp for lp in loan_payments if lp.get('loan_id') not in deleted_loan_ids]

                if len(remaining_payments) == 0:
                    # Removeu todos, limpar campos
                    card.pop('loan_payments', None)
                    card.pop('loan_to_receive', None)
                    card.pop('loan_to_pay', None)
                else:
                    card['loan_payments'] = remaining_payments

                    # Recalcular loan_to_receive e loan_to_pay
                    loan_to_receive = 0
                    loan_to_pay = 0
                    for lp in remaining_payments:
                        if lp.get('loan_type') == 'lent':
                            loan_to_receive += float(lp.get('amount_paid', 0))
                        else:
                            loan_to_pay -= float(lp.get('amount_paid', 0))

                    if loan_to_receive > 0:
                        card['loan_to_receive'] = loan_to_receive
                    else:
                        card.pop('loan_to_receive', None)

                    if loan_to_pay < 0:
                        card['loan_to_pay'] = loan_to_pay
                    else:
                        card.pop('loan_to_pay', None)

            # Recalcular net_amount
            total_to_receive = float(card.get('total_to_receive', 0))
            total_to_pay = float(card.get('total_to_pay', 0))
            loan_to_receive = float(card.get('loan_to_receive', 0))
            loan_to_pay = float(card.get('loan_to_pay', 0))
            card['net_amount'] = total_to_receive + total_to_pay + loan_to_receive + loan_to_pay

            closure_data[card_key] = card

        update_card_loans('main_account_card')
        update_card_loans('partner_account_card')

        # Remover loan_payments da raiz se existir
        if remove_all:
            closure_data.pop('loan_payments', None)
        elif 'loan_payments' in closure_data:
            remaining_root = [lp for lp in closure_data['loan_payments'] if lp.get('loan_id') not in deleted_loan_ids]
            if len(remaining_root) == 0:
                closure_data.pop('loan_payments', None)
            else:
                closure_data['loan_payments'] = remaining_root

        closure.closure_data = closure_data

    # ==================== RECALCULAR TOTAIS DO FECHAMENTO ====================
    if closure.closure_data and 'main_account_card' in closure.closure_data:
        main_card = closure.closure_data['main_account_card']
        # total_to_receive e total_to_pay não incluem empréstimos
        closure.total_to_receive = float(main_card.get('total_to_receive', 0))
        closure.total_to_pay = float(main_card.get('total_to_pay', 0))
        # net_balance inclui empréstimos restantes
        closure.net_balance = float(main_card.get('net_amount', 0))

    db.commit()
    db.refresh(closure)

    return {
        "message": f"Removidas {deleted_count} liquidações de empréstimos do fechamento",
        "deleted_count": deleted_count,
        "deleted_loan_ids": list(deleted_loan_ids),
        "closure_id": closure.id
    }


class CloseAndSettleAllRequest(BaseModel):
    """Request para fechar e quitar todos os períodos passados"""
    year: int
    account_id: int
    shared_account_id: int

    class Config:
        from_attributes = True


class CloseAndSettleAllResponse(BaseModel):
    """Response de fechar e quitar todos os períodos"""
    closed_count: int
    settled_count: int
    total_processed: int
    details: List[dict]

    class Config:
        from_attributes = True


@router.post("/close-and-settle-all", response_model=CloseAndSettleAllResponse)
def close_and_settle_all_past_periods(
    request: CloseAndSettleAllRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Fecha e quita todos os períodos em aberto de um ano específico.

    - Cria fechamentos para todos os meses que ainda não foram fechados
    - Quita todos os fechamentos que ainda não foram quitados

    Só funciona para anos anteriores ao ano corrente.
    """
    tenant_id = current_user["tenant_id"]
    user_id = current_user["id"]
    user_email = current_user.get("email", "unknown")

    # Validar que o ano é anterior ao ano corrente
    current_year = datetime.now().year
    if request.year >= current_year:
        raise HTTPException(
            status_code=400,
            detail=f"Só é possível fechar períodos de anos anteriores ao ano corrente ({current_year})"
        )

    # Buscar configuração de compartilhamento
    sharing = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.account_id == request.account_id,
        ExpenseSharingSetting.shared_account_id == request.shared_account_id,
        ExpenseSharingSetting.tenant_id == tenant_id,
        ExpenseSharingSetting.active == True
    ).first()

    if not sharing:
        raise HTTPException(status_code=404, detail="Configuração de compartilhamento não encontrada")

    # Buscar todos os sharings entre as duas contas (bidirecional)
    all_sharings = db.query(ExpenseSharingSetting).filter(
        or_(
            and_(
                ExpenseSharingSetting.account_id == request.account_id,
                ExpenseSharingSetting.shared_account_id == request.shared_account_id
            ),
            and_(
                ExpenseSharingSetting.account_id == request.shared_account_id,
                ExpenseSharingSetting.shared_account_id == request.account_id
            )
        ),
        ExpenseSharingSetting.tenant_id == tenant_id,
        ExpenseSharingSetting.active == True
    ).all()

    sharing_ids = [s.id for s in all_sharings]

    # Buscar contas
    main_account = db.query(Account).options(joinedload(Account.bank)).filter(
        Account.id == request.account_id,
        Account.tenant_id == tenant_id
    ).first()

    shared_account = db.query(Account).options(joinedload(Account.bank)).filter(
        Account.id == request.shared_account_id,
        Account.tenant_id == tenant_id
    ).first()

    if not main_account or not shared_account:
        raise HTTPException(status_code=404, detail="Conta não encontrada")

    closed_count = 0
    settled_count = 0
    details = []

    # Processar todos os 12 meses do ano
    for month in range(1, 13):
        # Verificar se já existe fechamento para este mês
        existing_closure = db.query(BalanceClosure).filter(
            BalanceClosure.expense_sharing_id.in_(sharing_ids),
            BalanceClosure.year == request.year,
            BalanceClosure.month == month,
            BalanceClosure.tenant_id == tenant_id
        ).first()

        if existing_closure:
            # Fechamento já existe - verificar se precisa quitar
            if not existing_closure.is_settled:
                existing_closure.is_settled = True
                existing_closure.settled_at = datetime.now()
                existing_closure.settled_by = user_id
                existing_closure.settlement_notes = f"Quitado automaticamente via 'Fechar e Quitar Todos os Períodos Passados' do ano {request.year}"
                settled_count += 1
                details.append({
                    "month": month,
                    "action": "settled",
                    "closure_id": existing_closure.id
                })
            else:
                details.append({
                    "month": month,
                    "action": "already_settled",
                    "closure_id": existing_closure.id
                })
        else:
            # Criar novo fechamento
            try:
                # Calcular período
                period_start, period_end = calculate_period_dates(
                    request.year,
                    month,
                    sharing.closing_day
                )

                # Calcular balanço (reutilizando lógica do endpoint de criação)
                from app.routers.balance_router import calculate_balance

                balance_data = calculate_balance(
                    db=db,
                    tenant_id=tenant_id,
                    account_id=request.account_id,
                    shared_account_id=request.shared_account_id,
                    year=request.year,
                    month=month
                )

                # Extrair totais do closure_data JSON
                main_card = balance_data.get("main_account_card", {})
                partner_card = balance_data.get("partner_account_card", {})

                # Campos: total_to_receive (positivo), total_to_pay (negativo)
                my_total_to_receive = abs(Decimal(str(main_card.get("total_to_receive", 0))))
                my_total_to_pay = abs(Decimal(str(main_card.get("total_to_pay", 0))))
                shared_total_to_receive = abs(Decimal(str(partner_card.get("total_to_receive", 0))))
                shared_total_to_pay = abs(Decimal(str(partner_card.get("total_to_pay", 0))))

                # Calcular saldo líquido
                total_to_receive = my_total_to_receive
                total_to_pay = my_total_to_pay
                net_balance = total_to_pay - total_to_receive

                # Contar itens
                my_expenses_count = len(main_card.get("expense_items", []))
                my_revenues_count = len(main_card.get("revenue_items", []))
                shared_expenses_count = len(partner_card.get("expense_items", []))
                shared_revenues_count = len(partner_card.get("revenue_items", []))

                # Construir closure_data
                closure_data = build_closure_data(
                    sharing=sharing,
                    main_account=main_account,
                    shared_account=shared_account,
                    period_start=period_start,
                    period_end=period_end,
                    year=request.year,
                    month=month,
                    my_total_expenses=my_total_to_receive,  # Renomeado: total_to_receive
                    my_total_revenues=my_total_to_pay,      # Renomeado: total_to_pay
                    shared_total_expenses=shared_total_to_receive,
                    shared_total_revenues=shared_total_to_pay,
                    my_expenses_count=my_expenses_count,
                    my_revenues_count=my_revenues_count,
                    shared_expenses_count=shared_expenses_count,
                    shared_revenues_count=shared_revenues_count,
                    user_email=user_email
                )

                # Criar fechamento
                closure = BalanceClosure(
                    expense_sharing_id=sharing.id,
                    account_id=sharing.account_id,
                    shared_account_id=sharing.shared_account_id,
                    closing_date=datetime.now(),
                    period_start_date=period_start,
                    period_end_date=period_end,
                    year=request.year,
                    month=month,
                    total_to_receive=total_to_receive,
                    total_to_pay=total_to_pay,
                    net_balance=net_balance,
                    notes=f"Fechamento automático via 'Fechar e Quitar Todos os Períodos Passados' do ano {request.year}",
                    closure_data=closure_data,
                    tenant_id=tenant_id,
                    created_by=user_id,
                    is_settled=True,  # Já criar como quitado
                    settled_at=datetime.now(),
                    settled_by=user_id,
                    settlement_notes=f"Quitado automaticamente via 'Fechar e Quitar Todos os Períodos Passados' do ano {request.year}"
                )

                db.add(closure)
                db.flush()  # Para obter o ID

                # Salvar itens do fechamento
                save_closure_items(
                    db=db,
                    closure_id=closure.id,
                    tenant_id=tenant_id,
                    main_card=main_card,
                    partner_card=partner_card
                )

                closed_count += 1
                settled_count += 1
                details.append({
                    "month": month,
                    "action": "created_and_settled",
                    "closure_id": closure.id
                })

            except Exception as e:
                # Se houver erro em algum mês, registrar mas continuar
                details.append({
                    "month": month,
                    "action": "error",
                    "error": str(e)
                })

    # Commit de todas as mudanças
    db.commit()

    return CloseAndSettleAllResponse(
        closed_count=closed_count,
        settled_count=settled_count,
        total_processed=closed_count + settled_count,
        details=details
    )

