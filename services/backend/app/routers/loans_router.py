"""
Router para gerenciamento de empréstimos.
Fornece endpoints para criar, listar, atualizar e liquidar empréstimos.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import desc, or_, func
from typing import List, Optional
from decimal import Decimal
from datetime import datetime
from pydantic import BaseModel, Field

from app.database import get_db
from app.models.unified_models import (
    Loan, LoanPayment, Account, Bank,
    BankStatement, CreditCardInvoice, BenefitCardStatement
)
from app.dependencies.auth import require_account

router = APIRouter(prefix="/api/loans", tags=["loans"])


# ==================== SCHEMAS ====================

class LoanCreate(BaseModel):
    """Request para criar um empréstimo"""
    loan_type: str  # 'lent' ou 'borrowed'
    principal_amount: Decimal
    description: str
    loan_date: str  # ISO format
    due_date: Optional[str] = None

    # Juros (opcionais)
    interest_enabled: bool = False
    interest_type: Optional[str] = None  # 'simple' ou 'compound'
    interest_rate: Optional[Decimal] = None
    interest_period: Optional[str] = None  # 'daily', 'monthly', 'yearly'

    # Contraparte (uma das duas)
    counterpart_account_id: Optional[int] = None
    external_name: Optional[str] = None
    external_description: Optional[str] = None

    # Origem (NULL = manual, preenchido = vinculado a item importado)
    source_table: Optional[str] = None  # 'bank_statements', 'credit_card_invoices', 'benefit_card_statements'
    source_id: Optional[int] = None


class LoanUpdate(BaseModel):
    """Request para atualizar um empréstimo"""
    loan_type: Optional[str] = None  # 'lent' ou 'borrowed'
    principal_amount: Optional[Decimal] = None
    loan_date: Optional[str] = None  # ISO format
    description: Optional[str] = None
    due_date: Optional[str] = None
    interest_enabled: Optional[bool] = None
    interest_type: Optional[str] = None
    interest_rate: Optional[Decimal] = None
    interest_period: Optional[str] = None
    external_description: Optional[str] = None
    counterpart_account_id: Optional[int] = None
    external_name: Optional[str] = None


class LoanReopenRequest(BaseModel):
    """Request para reabrir um empréstimo quitado"""
    additional_amount: Decimal  # Valor a adicionar ao principal
    interest_enabled: Optional[bool] = None
    interest_type: Optional[str] = None
    interest_rate: Optional[Decimal] = None
    interest_period: Optional[str] = None
    notes: Optional[str] = None


class LoanPaymentCreate(BaseModel):
    """Request para criar uma liquidação"""
    amount: Decimal
    payment_date: str  # ISO format
    source_table: Optional[str] = None  # NULL = manual, ou nome da tabela: 'bank_statements', 'credit_card_invoices', 'benefit_card_statements'
    source_id: Optional[int] = None
    notes: Optional[str] = None


class LoanPaymentResponse(BaseModel):
    """Response de uma liquidação"""
    id: int
    loan_id: int
    amount: Decimal
    payment_date: datetime
    source_table: Optional[str]
    source_id: Optional[int]
    balance_closure_id: Optional[int]  # Se preenchido, pagamento está bloqueado
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class CounterpartInfo(BaseModel):
    """Informações da contraparte"""
    id: Optional[int] = None
    name: Optional[str] = None
    bank_name: Optional[str] = None
    agency: Optional[str] = None
    account_number: Optional[str] = None
    is_external: bool = False


class LoanResponse(BaseModel):
    """Response de um empréstimo"""
    id: int
    loan_type: str
    principal_amount: Decimal
    description: str
    loan_date: datetime
    due_date: Optional[datetime]
    interest_enabled: bool
    interest_type: Optional[str]
    interest_rate: Optional[Decimal]
    interest_period: Optional[str]
    counterpart_account_id: Optional[int]
    external_name: Optional[str]
    external_description: Optional[str]
    status: str
    settled_at: Optional[datetime]
    last_reopened_at: Optional[datetime]
    reopened_count: int
    source_table: Optional[str]
    source_id: Optional[int]
    account_id: int
    created_at: datetime

    # Campos calculados
    total_paid: Decimal = Decimal("0.00")
    remaining_balance: Decimal = Decimal("0.00")
    is_owner: bool = True  # Se o usuário logado é o dono do empréstimo
    counterpart: Optional[CounterpartInfo] = None
    payments: List[LoanPaymentResponse] = []

    class Config:
        from_attributes = True


class LoanListResponse(BaseModel):
    """Response para listagem de empréstimos"""
    loans: List[LoanResponse]
    total: int


class LoanSettleRequest(BaseModel):
    """Request para quitar empréstimo manualmente"""
    notes: Optional[str] = None
    corrected_amount: Optional[Decimal] = None  # Valor corrigido com juros (calculado no frontend)


# ==================== HELPERS ====================

def parse_date(date_str: str) -> datetime:
    """Parse de data ISO para datetime.

    Quando recebe apenas data (YYYY-MM-DD), adiciona horário à meia-noite.
    Isso é importante pois o frontend envia apenas a data para evitar
    problemas de timezone com toISOString().
    """
    try:
        if 'T' in date_str:
            return datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        # Apenas data: adiciona horário à meia-noite (12:00:00 para evitar problemas de timezone)
        return datetime.strptime(date_str + ' 12:00:00', '%Y-%m-%d %H:%M:%S')
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Formato de data inválido: {date_str}")


def get_counterpart_info(loan: Loan, db: Session) -> CounterpartInfo:
    """Retorna informações da contraparte"""
    if loan.external_name:
        return CounterpartInfo(
            name=loan.external_name,
            is_external=True
        )

    if loan.counterpart_account_id:
        account = db.query(Account).options(
            joinedload(Account.bank)
        ).filter(Account.id == loan.counterpart_account_id).first()

        if account:
            return CounterpartInfo(
                id=account.id,
                name=account.name,
                bank_name=account.bank.name if account.bank else None,
                agency=str(account.agency) if account.agency else None,
                account_number=str(account.account_number) if account.account_number else None,
                is_external=False
            )

    return CounterpartInfo(is_external=True)


def calculate_loan_totals(loan: Loan, db: Session) -> tuple[Decimal, Decimal]:
    """Calcula total pago e saldo restante (sem juros)"""
    total_paid = db.query(func.coalesce(func.sum(LoanPayment.amount), 0)).filter(
        LoanPayment.loan_id == loan.id,
        LoanPayment.active == True
    ).scalar() or Decimal("0.00")

    remaining = loan.principal_amount - Decimal(str(total_paid))
    return Decimal(str(total_paid)), remaining


def calculate_interest(
    principal: Decimal,
    loan_date: datetime,
    rate: Decimal,
    interest_type: str,  # 'simple' ou 'compound'
    interest_period: str  # 'daily', 'monthly', 'yearly'
) -> tuple[Decimal, Decimal]:
    """
    Calcula juros acumulados desde a data do empréstimo até hoje.

    Regras de carência:
    - Juros diário: sem carência
    - Juros mensal: carência no 1º mês
    - Juros anual: carência no 1º ano

    Returns:
        tuple[corrected_amount, interest_amount]
    """
    from datetime import datetime
    import math

    today = datetime.now()  # Usar timezone local (America/Sao_Paulo)
    diff_days = max(0, (today - loan_date).days)

    principal_num = float(abs(principal))
    rate_decimal = float(rate) / 100

    corrected_amount: float

    if interest_period == 'daily':
        # Juros diário: sem carência
        if interest_type == 'compound':
            corrected_amount = principal_num * math.pow(1 + rate_decimal, diff_days)
        else:
            corrected_amount = principal_num * (1 + rate_decimal * diff_days)

    elif interest_period == 'monthly':
        # Juros mensal: carência no 1º mês (30 dias)
        DAYS_IN_MONTH = 30

        if diff_days < DAYS_IN_MONTH:
            # Carência: sem juros
            corrected_amount = principal_num
        else:
            full_months = diff_days // DAYS_IN_MONTH
            extra_days = diff_days % DAYS_IN_MONTH
            total_periods = full_months + (extra_days / DAYS_IN_MONTH)

            if interest_type == 'compound':
                corrected_amount = principal_num * math.pow(1 + rate_decimal, total_periods)
            else:
                corrected_amount = principal_num * (1 + rate_decimal * total_periods)

    else:  # yearly
        # Juros anual: carência no 1º ano (365 dias)
        DAYS_IN_YEAR = 365
        DAYS_IN_MONTH = 30

        if diff_days < DAYS_IN_YEAR:
            # Carência: sem juros no primeiro ano
            corrected_amount = principal_num
        else:
            full_years = diff_days // DAYS_IN_YEAR
            remaining_days = diff_days % DAYS_IN_YEAR
            full_months_in_remainder = remaining_days // DAYS_IN_MONTH
            extra_days = remaining_days % DAYS_IN_MONTH

            total_periods = full_years + (full_months_in_remainder / 12) + (extra_days / DAYS_IN_YEAR)

            if interest_type == 'compound':
                corrected_amount = principal_num * math.pow(1 + rate_decimal, total_periods)
            else:
                corrected_amount = principal_num * (1 + rate_decimal * total_periods)

    interest_amount = corrected_amount - principal_num
    return Decimal(str(round(corrected_amount, 2))), Decimal(str(round(interest_amount, 2)))


def calculate_corrected_balance(loan: Loan, db: Session) -> tuple[Decimal, Decimal, Decimal]:
    """
    Calcula o saldo corrigido do empréstimo considerando juros.

    Returns:
        tuple[total_paid, corrected_balance, interest_amount]
    """
    total_paid, _ = calculate_loan_totals(loan, db)

    if loan.interest_enabled and loan.interest_rate and loan.interest_type and loan.interest_period:
        loan_date = loan.loan_date if isinstance(loan.loan_date, datetime) else datetime.fromisoformat(str(loan.loan_date))
        corrected_amount, interest_amount = calculate_interest(
            loan.principal_amount,
            loan_date,
            loan.interest_rate,
            loan.interest_type,
            loan.interest_period
        )
        corrected_balance = corrected_amount - total_paid
    else:
        # Sem juros
        corrected_balance = loan.principal_amount - total_paid
        interest_amount = Decimal("0.00")

    return total_paid, corrected_balance, interest_amount


def build_loan_response(loan: Loan, db: Session, current_account_id: int = None) -> LoanResponse:
    """Constrói response completo de um empréstimo"""
    total_paid, remaining = calculate_loan_totals(loan, db)
    counterpart = get_counterpart_info(loan, db)

    # Buscar pagamentos
    payments = db.query(LoanPayment).filter(
        LoanPayment.loan_id == loan.id,
        LoanPayment.active == True
    ).order_by(desc(LoanPayment.payment_date)).all()

    # Determinar se o usuário logado é o dono do empréstimo
    is_owner = current_account_id == loan.account_id if current_account_id else True

    return LoanResponse(
        id=loan.id,
        loan_type=loan.loan_type,
        principal_amount=loan.principal_amount,
        description=loan.description,
        loan_date=loan.loan_date,
        due_date=loan.due_date,
        interest_enabled=loan.interest_enabled,
        interest_type=loan.interest_type,
        interest_rate=loan.interest_rate,
        interest_period=loan.interest_period,
        counterpart_account_id=loan.counterpart_account_id,
        external_name=loan.external_name,
        external_description=loan.external_description,
        status=loan.status,
        settled_at=loan.settled_at,
        last_reopened_at=loan.last_reopened_at,
        reopened_count=loan.reopened_count or 0,
        source_table=loan.source_table,
        source_id=loan.source_id,
        account_id=loan.account_id,
        created_at=loan.created_at,
        total_paid=total_paid,
        remaining_balance=remaining,
        is_owner=is_owner,
        counterpart=counterpart,
        payments=[LoanPaymentResponse.model_validate(p) for p in payments]
    )


# ==================== ENDPOINTS ====================

@router.get("", response_model=LoanListResponse)
async def list_loans(
    status: Optional[str] = Query(None, description="Filtrar por status: open, settled"),
    loan_type: Optional[str] = Query(None, description="Filtrar por tipo: lent, borrowed"),
    include_as_counterpart: bool = Query(True, description="Incluir empréstimos onde sou contraparte"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Lista empréstimos da conta logada (como criador ou contraparte)"""

    account_id = current_user.get("account_id")

    # Base query
    query = db.query(Loan).filter(Loan.active == True)

    # Filtrar por conta (criador ou contraparte)
    if include_as_counterpart:
        query = query.filter(
            or_(
                Loan.account_id == account_id,
                Loan.counterpart_account_id == account_id
            )
        )
    else:
        query = query.filter(Loan.account_id == account_id)

    # Filtros opcionais
    if status:
        query = query.filter(Loan.status == status)
    if loan_type:
        query = query.filter(Loan.loan_type == loan_type)

    # Ordenar por data
    query = query.order_by(desc(Loan.loan_date))

    loans = query.all()

    return LoanListResponse(
        loans=[build_loan_response(loan, db, account_id) for loan in loans],
        total=len(loans)
    )


@router.post("", response_model=LoanResponse, status_code=201)
async def create_loan(
    data: LoanCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Cria um novo empréstimo"""

    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    created_by = current_user.get("user_id") or current_user.get("id")

    # Validações
    if data.loan_type not in ['lent', 'borrowed']:
        raise HTTPException(status_code=400, detail="loan_type deve ser 'lent' ou 'borrowed'")

    if data.principal_amount <= 0:
        raise HTTPException(status_code=400, detail="principal_amount deve ser maior que zero")

    # Validar contraparte (uma das duas)
    if data.counterpart_account_id and data.external_name:
        raise HTTPException(status_code=400, detail="Informe counterpart_account_id OU external_name, não ambos")

    if not data.counterpart_account_id and not data.external_name:
        raise HTTPException(status_code=400, detail="Informe counterpart_account_id ou external_name")

    # Validar conta contraparte
    if data.counterpart_account_id:
        counterpart = db.query(Account).filter(
            Account.id == data.counterpart_account_id,
            Account.active == True
        ).first()
        if not counterpart:
            raise HTTPException(status_code=404, detail="Conta contraparte não encontrada")
        if data.counterpart_account_id == account_id:
            raise HTTPException(status_code=400, detail="Não é possível criar empréstimo para si mesmo")

    # Validar configuração de juros
    if data.interest_enabled:
        if not all([data.interest_type, data.interest_rate, data.interest_period]):
            raise HTTPException(
                status_code=400,
                detail="Se interest_enabled=true, informe interest_type, interest_rate e interest_period"
            )
        if data.interest_type not in ['simple', 'compound']:
            raise HTTPException(status_code=400, detail="interest_type deve ser 'simple' ou 'compound'")
        if data.interest_period not in ['daily', 'monthly', 'yearly']:
            raise HTTPException(status_code=400, detail="interest_period deve ser 'daily', 'monthly' ou 'yearly'")

    # Criar empréstimo
    loan = Loan(
        loan_type=data.loan_type,
        principal_amount=data.principal_amount,
        description=data.description,
        loan_date=parse_date(data.loan_date),
        due_date=parse_date(data.due_date) if data.due_date else None,
        interest_enabled=data.interest_enabled,
        interest_type=data.interest_type if data.interest_enabled else None,
        interest_rate=data.interest_rate if data.interest_enabled else None,
        interest_period=data.interest_period if data.interest_enabled else None,
        counterpart_account_id=data.counterpart_account_id,
        external_name=data.external_name,
        external_description=data.external_description,
        source_table=data.source_table,  # NULL = manual
        source_id=data.source_id,
        status='open',
        account_id=account_id,
        tenant_id=tenant_id,
        created_by=created_by
    )

    db.add(loan)
    db.commit()
    db.refresh(loan)

    return build_loan_response(loan, db, account_id)


@router.get("/{loan_id}", response_model=LoanResponse)
async def get_loan(
    loan_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Retorna detalhes de um empréstimo"""

    account_id = current_user.get("account_id")

    loan = db.query(Loan).filter(
        Loan.id == loan_id,
        Loan.active == True,
        or_(
            Loan.account_id == account_id,
            Loan.counterpart_account_id == account_id
        )
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail="Empréstimo não encontrado")

    return build_loan_response(loan, db, account_id)


@router.patch("/{loan_id}", response_model=LoanResponse)
async def update_loan(
    loan_id: int,
    data: LoanUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Atualiza um empréstimo (apenas o criador pode editar)"""

    account_id = current_user.get("account_id")

    loan = db.query(Loan).filter(
        Loan.id == loan_id,
        Loan.account_id == account_id,  # Apenas o criador
        Loan.active == True
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail="Empréstimo não encontrado ou sem permissão")

    # Atualizar campos básicos (apenas se não está quitado)
    if loan.status != 'settled':
        if data.loan_type is not None:
            if data.loan_type not in ['lent', 'borrowed']:
                raise HTTPException(status_code=400, detail="loan_type deve ser 'lent' ou 'borrowed'")
            loan.loan_type = data.loan_type
        if data.principal_amount is not None:
            if data.principal_amount <= 0:
                raise HTTPException(status_code=400, detail="principal_amount deve ser maior que zero")
            loan.principal_amount = data.principal_amount
        if data.loan_date is not None:
            loan.loan_date = parse_date(data.loan_date)

    if data.description is not None:
        loan.description = data.description
    if data.due_date is not None:
        loan.due_date = parse_date(data.due_date)
    if data.external_description is not None:
        loan.external_description = data.external_description

    # Atualizar contraparte (apenas se empréstimo não está quitado ou se está mudando apenas descrição)
    if data.counterpart_account_id is not None:
        loan.counterpart_account_id = data.counterpart_account_id
        loan.external_name = None  # Limpa nome externo se vinculou conta
    elif data.external_name is not None:
        loan.external_name = data.external_name
        loan.counterpart_account_id = None  # Limpa conta se definiu nome externo

    # Atualizar juros (apenas se não está quitado)
    if loan.status != 'settled' and data.interest_enabled is not None:
        loan.interest_enabled = data.interest_enabled
        if data.interest_enabled:
            if data.interest_type:
                loan.interest_type = data.interest_type
            if data.interest_rate is not None:
                loan.interest_rate = data.interest_rate
            if data.interest_period:
                loan.interest_period = data.interest_period
        else:
            loan.interest_type = None
            loan.interest_rate = None
            loan.interest_period = None

    db.commit()
    db.refresh(loan)

    return build_loan_response(loan, db, account_id)


@router.delete("/{loan_id}", status_code=204)
async def delete_loan(
    loan_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Exclui um empréstimo e suas liquidações (hard delete, apenas o criador)"""

    account_id = current_user.get("account_id")

    loan = db.query(Loan).filter(
        Loan.id == loan_id,
        Loan.account_id == account_id,  # Apenas o criador
        Loan.active == True
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail="Empréstimo não encontrado ou sem permissão")

    # Deletar todas as liquidações associadas
    db.query(LoanPayment).filter(LoanPayment.loan_id == loan_id).delete()

    # Deletar o empréstimo
    db.delete(loan)
    db.commit()

    return None


@router.post("/{loan_id}/pay", response_model=LoanResponse)
async def add_payment(
    loan_id: int,
    data: LoanPaymentCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Adiciona uma liquidação parcial ao empréstimo (apenas o criador)"""

    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    created_by = current_user.get("user_id") or current_user.get("id")

    loan = db.query(Loan).filter(
        Loan.id == loan_id,
        Loan.account_id == account_id,  # Apenas o criador
        Loan.active == True
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail="Empréstimo não encontrado ou sem permissão")

    if loan.status == 'settled':
        raise HTTPException(status_code=400, detail="Empréstimo já está quitado")

    # Validar valor
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Valor deve ser maior que zero")

    _, remaining = calculate_loan_totals(loan, db)
    if data.amount > remaining:
        raise HTTPException(
            status_code=400,
            detail=f"Valor excede saldo restante de R$ {remaining:.2f}"
        )

    # Criar pagamento (source_table = NULL significa manual)
    payment = LoanPayment(
        loan_id=loan_id,
        amount=data.amount,
        payment_date=parse_date(data.payment_date),
        source_table=data.source_table,  # NULL = manual
        source_id=data.source_id,
        notes=data.notes,
        account_id=account_id,
        tenant_id=tenant_id,
        created_by=created_by
    )

    db.add(payment)

    # Atualizar status do empréstimo
    new_remaining = remaining - data.amount
    if new_remaining <= 0:
        loan.status = 'settled'
        loan.settled_at = datetime.now()  # Usar timezone local (America/Sao_Paulo)
    # Se ainda tem saldo, mantém como 'open'

    db.commit()
    db.refresh(loan)

    return build_loan_response(loan, db, account_id)


@router.post("/{loan_id}/settle", response_model=LoanResponse)
async def settle_loan(
    loan_id: int,
    data: LoanSettleRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Quita manualmente um empréstimo (zera saldo restante)"""

    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    created_by = current_user.get("user_id") or current_user.get("id")

    loan = db.query(Loan).filter(
        Loan.id == loan_id,
        Loan.account_id == account_id,
        Loan.active == True
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail="Empréstimo não encontrado ou sem permissão")

    if loan.status == 'settled':
        raise HTTPException(status_code=400, detail="Empréstimo já está quitado")

    # Calcular saldo restante
    total_paid, _ = calculate_loan_totals(loan, db)

    # Se foi enviado valor corrigido (com juros), usar ele; senão, usar principal
    base_amount = data.corrected_amount if data.corrected_amount else loan.principal_amount
    remaining = base_amount - total_paid

    if remaining > 0:
        payment = LoanPayment(
            loan_id=loan_id,
            amount=remaining,
            payment_date=datetime.now(),  # Usar timezone local (America/Sao_Paulo)
            source_table=None,  # NULL = quitação manual
            source_id=None,
            notes=data.notes or "Quitação manual",
            account_id=account_id,
            tenant_id=tenant_id,
            created_by=created_by
        )
        db.add(payment)

    loan.status = 'settled'
    loan.settled_at = datetime.now()  # Usar timezone local (America/Sao_Paulo)

    db.commit()
    db.refresh(loan)

    return build_loan_response(loan, db, account_id)


@router.post("/{loan_id}/reopen", response_model=LoanResponse)
async def reopen_loan(
    loan_id: int,
    data: LoanReopenRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Reabre um empréstimo quitado, adicionando valor ao principal"""

    account_id = current_user.get("account_id")

    loan = db.query(Loan).filter(
        Loan.id == loan_id,
        Loan.account_id == account_id,
        Loan.active == True
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail="Empréstimo não encontrado ou sem permissão")

    if loan.status != 'settled':
        raise HTTPException(status_code=400, detail="Apenas empréstimos quitados podem ser reabertos")

    # Validar valor adicional
    if data.additional_amount <= 0:
        raise HTTPException(status_code=400, detail="Valor adicional deve ser maior que zero")

    # Aumentar o principal
    loan.principal_amount = loan.principal_amount + data.additional_amount

    # Atualizar juros se fornecido
    if data.interest_enabled is not None:
        loan.interest_enabled = data.interest_enabled
        if data.interest_enabled:
            if data.interest_type:
                loan.interest_type = data.interest_type
            if data.interest_rate is not None:
                loan.interest_rate = data.interest_rate
            if data.interest_period:
                loan.interest_period = data.interest_period
        else:
            loan.interest_type = None
            loan.interest_rate = None
            loan.interest_period = None

    # Reabrir o empréstimo
    loan.status = 'open'
    loan.settled_at = None
    loan.last_reopened_at = datetime.now()  # Usar timezone local (America/Sao_Paulo)
    loan.reopened_count = (loan.reopened_count or 0) + 1

    db.commit()
    db.refresh(loan)

    return build_loan_response(loan, db, account_id)


class LoanPaymentUpdate(BaseModel):
    """Request para atualizar uma liquidação"""
    amount: Optional[Decimal] = None
    payment_date: Optional[str] = None
    notes: Optional[str] = None


@router.patch("/{loan_id}/payments/{payment_id}", response_model=LoanResponse)
async def update_payment(
    loan_id: int,
    payment_id: int,
    data: LoanPaymentUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Atualiza uma liquidação existente"""

    account_id = current_user.get("account_id")

    # Verificar se o empréstimo existe e pertence ao usuário
    loan = db.query(Loan).filter(
        Loan.id == loan_id,
        Loan.account_id == account_id,
        Loan.active == True
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail="Empréstimo não encontrado ou sem permissão")

    # Buscar o pagamento
    payment = db.query(LoanPayment).filter(
        LoanPayment.id == payment_id,
        LoanPayment.loan_id == loan_id
    ).first()

    if not payment:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")

    # Verificar se o pagamento está vinculado a um fechamento de balanço
    if payment.balance_closure_id:
        raise HTTPException(
            status_code=400,
            detail="Este pagamento está vinculado a um fechamento de balanço. Para editá-lo, você deve excluir o fechamento primeiro."
        )

    # Atualizar campos
    if data.amount is not None:
        if data.amount <= 0:
            raise HTTPException(status_code=400, detail="Valor deve ser maior que zero")
        payment.amount = data.amount

    if data.payment_date is not None:
        payment.payment_date = parse_date(data.payment_date)

    if data.notes is not None:
        payment.notes = data.notes

    db.commit()

    # Recalcular status do empréstimo
    total_paid, remaining = calculate_loan_totals(loan, db)
    if remaining <= 0:
        loan.status = 'settled'
        loan.settled_at = datetime.now()  # Usar timezone local (America/Sao_Paulo)
    else:
        loan.status = 'open'

    db.commit()
    db.refresh(loan)

    return build_loan_response(loan, db, account_id)


@router.delete("/{loan_id}/payments/{payment_id}", status_code=204)
async def delete_payment(
    loan_id: int,
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Exclui uma liquidação"""

    account_id = current_user.get("account_id")

    # Verificar se o empréstimo existe e pertence ao usuário
    loan = db.query(Loan).filter(
        Loan.id == loan_id,
        Loan.account_id == account_id,
        Loan.active == True
    ).first()

    if not loan:
        raise HTTPException(status_code=404, detail="Empréstimo não encontrado ou sem permissão")

    # Buscar o pagamento
    payment = db.query(LoanPayment).filter(
        LoanPayment.id == payment_id,
        LoanPayment.loan_id == loan_id
    ).first()

    if not payment:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")

    # Verificar se o pagamento está vinculado a um fechamento de balanço
    if payment.balance_closure_id:
        raise HTTPException(
            status_code=400,
            detail="Este pagamento está vinculado a um fechamento de balanço. Para excluí-lo, você deve excluir o fechamento primeiro."
        )

    # Guardar status anterior para detectar reabertura
    was_settled = loan.status == 'settled'

    # Excluir pagamento
    db.delete(payment)
    db.commit()

    # Recalcular status do empréstimo
    total_paid, remaining = calculate_loan_totals(loan, db)
    if remaining <= 0:
        loan.status = 'settled'
        loan.settled_at = datetime.now()  # Usar timezone local (America/Sao_Paulo)
    else:
        loan.status = 'open'
        loan.settled_at = None

        # Se estava quitado e agora está aberto, é uma reabertura
        if was_settled:
            loan.reopened_count = (loan.reopened_count or 0) + 1
            loan.last_reopened_at = datetime.now()  # Usar timezone local (America/Sao_Paulo)

    db.commit()

    return None


class CreateFromSourceRequest(BaseModel):
    """Request para criar empréstimo ou pagamento a partir de despesa/receita"""
    source_table: str  # Nome real da tabela: 'bank_statements', 'credit_card_invoices', 'benefit_card_statements'
    source_id: int
    action: str  # 'new_loan' ou 'add_payment'
    loan_id: Optional[int] = None  # Required if action='add_payment'

    # Campos para novo empréstimo
    loan_type: Optional[str] = None  # 'lent' ou 'borrowed'
    description: Optional[str] = None  # Descrição customizada (se não informada, usa a do item fonte)
    counterpart_account_id: Optional[int] = None
    external_name: Optional[str] = None
    external_description: Optional[str] = None
    due_date: Optional[str] = None

    # Juros
    interest_enabled: bool = False
    interest_type: Optional[str] = None
    interest_rate: Optional[Decimal] = None
    interest_period: Optional[str] = None

    # Notas para pagamento
    notes: Optional[str] = None

    # Se True, limita o valor do pagamento ao saldo restante do empréstimo
    limit_to_balance: bool = False


@router.post("/create-from-source", response_model=LoanResponse)
async def create_from_source(
    data: CreateFromSourceRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Cria empréstimo ou adiciona pagamento a partir de uma despesa/receita existente"""

    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    created_by = current_user.get("user_id") or current_user.get("id")

    # Buscar item fonte baseado no nome real da tabela
    source_item = None
    if data.source_table == 'bank_statements':
        source_item = db.query(BankStatement).filter(
            BankStatement.id == data.source_id,
            BankStatement.account_id == account_id
        ).first()
    elif data.source_table == 'credit_card_invoices':
        source_item = db.query(CreditCardInvoice).filter(
            CreditCardInvoice.id == data.source_id,
            CreditCardInvoice.account_id == account_id
        ).first()
    elif data.source_table == 'benefit_card_statements':
        source_item = db.query(BenefitCardStatement).filter(
            BenefitCardStatement.id == data.source_id,
            BenefitCardStatement.account_id == account_id
        ).first()
    else:
        raise HTTPException(status_code=400, detail="source_table inválido. Use: 'bank_statements', 'credit_card_invoices' ou 'benefit_card_statements'")

    if not source_item:
        raise HTTPException(status_code=404, detail="Item fonte não encontrado")

    # Extrair dados do item fonte
    amount = abs(source_item.amount)
    source_description = source_item.description
    item_date = source_item.date

    if data.action == 'new_loan':
        # Criar novo empréstimo
        if not data.loan_type:
            raise HTTPException(status_code=400, detail="loan_type é obrigatório para novo empréstimo")

        if not data.counterpart_account_id and not data.external_name:
            raise HTTPException(status_code=400, detail="Informe counterpart_account_id ou external_name")

        # Usar descrição customizada se fornecida, senão usar a do item fonte
        loan_description = data.description.strip() if data.description else source_description

        loan = Loan(
            loan_type=data.loan_type,
            principal_amount=amount,
            description=loan_description,
            loan_date=item_date,
            due_date=parse_date(data.due_date) if data.due_date else None,
            interest_enabled=data.interest_enabled,
            interest_type=data.interest_type if data.interest_enabled else None,
            interest_rate=data.interest_rate if data.interest_enabled else None,
            interest_period=data.interest_period if data.interest_enabled else None,
            counterpart_account_id=data.counterpart_account_id,
            external_name=data.external_name,
            external_description=data.external_description,
            source_table=data.source_table,  # Nome real da tabela
            source_id=data.source_id,
            status='open',
            account_id=account_id,
            tenant_id=tenant_id,
            created_by=created_by
        )

        db.add(loan)
        db.commit()
        db.refresh(loan)

        return build_loan_response(loan, db, account_id)

    elif data.action == 'add_payment':
        # Adicionar pagamento a empréstimo existente
        if not data.loan_id:
            raise HTTPException(status_code=400, detail="loan_id é obrigatório para add_payment")

        loan = db.query(Loan).filter(
            Loan.id == data.loan_id,
            Loan.account_id == account_id,
            Loan.active == True
        ).first()

        if not loan:
            raise HTTPException(status_code=404, detail="Empréstimo não encontrado ou sem permissão")

        if loan.status == 'settled':
            raise HTTPException(status_code=400, detail="Empréstimo já está quitado")

        # Calcular saldo corrigido (com juros, se habilitado)
        _, corrected_balance, _ = calculate_corrected_balance(loan, db)

        # Se limit_to_balance, limitar o valor ao saldo corrigido (incluindo juros)
        payment_amount = amount
        if data.limit_to_balance and amount > corrected_balance:
            payment_amount = corrected_balance

        # Criar pagamento (usa descrição do item fonte se notes não informado)
        payment_notes = data.notes if data.notes else description
        payment = LoanPayment(
            loan_id=data.loan_id,
            amount=payment_amount,
            payment_date=item_date,
            source_table=data.source_table,  # Nome real da tabela (vinculado a item importado)
            source_id=data.source_id,
            notes=payment_notes,
            account_id=account_id,
            tenant_id=tenant_id,
            created_by=created_by
        )

        db.add(payment)

        # Atualizar status baseado no saldo corrigido após pagamento
        new_corrected_balance = corrected_balance - payment_amount
        if new_corrected_balance <= 0:
            loan.status = 'settled'
            loan.settled_at = datetime.now()  # Usar timezone local (America/Sao_Paulo)
        # Se ainda tem saldo, mantém como 'open'

        db.commit()
        db.refresh(loan)

        return build_loan_response(loan, db, account_id)

    else:
        raise HTTPException(status_code=400, detail="action deve ser 'new_loan' ou 'add_payment'")

