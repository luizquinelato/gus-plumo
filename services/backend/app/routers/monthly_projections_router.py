"""Rotas da projeção mensal (receitas e despesas projetadas por mês)."""

import re
from datetime import date
from decimal import Decimal
from typing import Any, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_account
from app.models.unified_models import Cartao, MonthlyProjection
from app.services import monthly_projection_service as service
from app.services import whatsapp_service

router = APIRouter(prefix="/api/monthly-projections", tags=["monthly-projections"])

_YM = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _scope(current_user: dict) -> tuple[int, int, int]:
    tenant_id = current_user.get("tenant_id")
    account_id = current_user.get("account_id")
    user_id = current_user.get("user_id") or current_user.get("id")
    if tenant_id is None or account_id is None or user_id is None:
        raise HTTPException(status_code=400, detail="Conta ou usuário inválido no token")
    return int(tenant_id), int(account_id), int(user_id)


def _check_ym(year_month: str) -> str:
    if not _YM.match(year_month):
        raise HTTPException(status_code=422, detail="year_month deve estar no formato YYYY-MM")
    return year_month


def _is_editable(source: str) -> bool:
    return source not in service.AUTOMATIC_SOURCES


def _projection_link_flags(row: MonthlyProjection) -> tuple[bool, bool]:
    """(is_actual, extrato_actions) para itens de extrato na projeção."""
    from app.services.monthly_projection_service import OPENING_BALANCE_DESCRIPTION

    if row.source != service.BANK_STATEMENT_SOURCE:
        return False, False
    if row.source_table == "bank_statements" and row.source_id is not None:
        return True, True
    if (row.description or "").strip() == OPENING_BALANCE_DESCRIPTION:
        return True, False
    return False, False


class ProjectionIn(BaseModel):
    expected_date: date
    description: str = Field(..., min_length=1, max_length=255)
    # Valor com sinal: negativo = gasto, positivo = receita
    amount: Decimal = Field(..., max_digits=15, decimal_places=2)
    kind: Literal["fixed", "variable"] = "fixed"

    @field_validator("amount")
    @classmethod
    def _amount_not_zero(cls, v: Decimal) -> Decimal:
        if v == 0:
            raise ValueError("O valor deve ser diferente de zero")
        return v

    def apply_to(self, item: MonthlyProjection) -> None:
        """Receita (positivo) vira kind='income'; gasto (negativo) guarda o valor absoluto."""
        item.year_month = self.expected_date.strftime("%Y-%m")
        item.expected_date = self.expected_date
        item.description = self.description.strip()
        item.kind = "income" if self.amount > 0 else self.kind
        item.amount = item.my_amount = abs(self.amount)


class ProjectionOut(BaseModel):
    id: int
    year_month: str
    expected_date: date
    description: str
    amount: Decimal
    my_amount: Decimal
    kind: str
    source: str
    is_automatic: bool = False
    credit_card_id: Optional[int] = None
    invoice_group_id: Optional[int] = None
    breakdown: Optional[List[dict[str, Any]]] = None
    editable: bool = True
    is_actual: bool = False
    source_table: Optional[str] = None
    source_id: Optional[int] = None
    extrato_actions: bool = False

    class Config:
        from_attributes = True


class MonthTotals(BaseModel):
    fixed: Decimal
    variable: Decimal
    total: Decimal
    my_fixed: Decimal
    my_variable: Decimal
    my_total: Decimal


class IncomeOut(BaseModel):
    id: int
    editable: bool
    description: str
    amount: Decimal
    expected_date: date
    source: str
    is_automatic: bool = False
    is_actual: bool = False
    source_table: Optional[str] = None
    source_id: Optional[int] = None
    extrato_actions: bool = False


class MonthResponse(BaseModel):
    year_month: str
    items: List[ProjectionOut]
    totals: MonthTotals
    income: List[IncomeOut] = []
    income_total: Decimal = Decimal(0)


class CloneRequest(BaseModel):
    source_year_month: str
    months: int = Field(1, ge=1, le=24)
    include_cards: bool = True


class CloneResponse(BaseModel):
    target_year_month: str
    copied: int


class LaunchIncomeRequest(BaseModel):
    year_month: str
    periods: int = Field(1, ge=1, le=24)
    advance_on_day_15: bool = True


class LaunchCardsRequest(BaseModel):
    year_month: str
    card_ids: List[int] = Field(..., min_length=1)
    mode: Literal["invoice", "installments"]
    sharing: Literal["own", "mine"] = "mine"


class InvoicePreviewOut(BaseModel):
    card_id: int
    card_name: str
    card_number: str
    invoice_year_month: str
    due_day: int
    has_invoice: bool
    amount: Decimal
    my_amount: Decimal


class PayrollConfirmationItemOut(BaseModel):
    description: str
    amount: Decimal
    expected_day: int
    matched_in_extrato: bool


class LaunchResponse(BaseModel):
    created: int
    payroll_confirmation: list[PayrollConfirmationItemOut] | None = None


class InstallmentPreviewOut(BaseModel):
    card_id: int
    card_name: str
    card_number: str
    description: str
    installment: int
    total_installments: int
    amount: Decimal
    my_amount: Decimal


@router.get("/installments-preview", response_model=List[InstallmentPreviewOut])
async def installments_preview(
    year_month: str = Query(..., description="YYYY-MM"),
    card_ids: str = Query(..., description="IDs separados por vírgula"),
    sharing: str = Query("mine", pattern="^(own|mine)$"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    _check_ym(year_month)
    try:
        ids = [int(x) for x in card_ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(status_code=422, detail="card_ids inválido")
    return service.installments_for_month(db, tenant_id, account_id, year_month, ids, sharing)


@router.get("/invoice-preview", response_model=List[InvoicePreviewOut])
async def invoice_preview(
    year_month: str = Query(..., description="YYYY-MM"),
    card_ids: str = Query(..., description="IDs separados por vírgula"),
    sharing: str = Query("mine", pattern="^(own|mine)$"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    _check_ym(year_month)
    try:
        ids = [int(x) for x in card_ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(status_code=422, detail="card_ids inválido")
    return service.invoice_preview_for_month(db, tenant_id, account_id, year_month, ids, sharing)


def _month_response(db: Session, tenant_id: int, account_id: int, year_month: str) -> MonthResponse:
    rows = (
        db.query(MonthlyProjection)
        .filter(
            MonthlyProjection.tenant_id == tenant_id,
            MonthlyProjection.account_id == account_id,
            MonthlyProjection.year_month == year_month,
            MonthlyProjection.active.is_(True),
        )
        .order_by(MonthlyProjection.expected_date, MonthlyProjection.id)
        .all()
    )
    zero = Decimal(0)
    income_rows = [r for r in rows if r.kind == "income"]
    rows = [r for r in rows if r.kind != "income"]
    card_ids = {
        b["card_id"] for r in rows for b in (r.breakdown or []) if b.get("card_id")
    }
    inactive_ids = set()
    if card_ids:
        inactive_ids = {
            cid for (cid,) in db.query(Cartao.id).filter(
                Cartao.tenant_id == tenant_id, Cartao.id.in_(card_ids), Cartao.active.is_(False)
            )
        }
    items = []
    for r in rows:
        out = ProjectionOut.model_validate(r)
        out.editable = _is_editable(r.source)
        is_actual, extrato_actions = _projection_link_flags(r)
        out.is_actual = is_actual
        out.extrato_actions = extrato_actions
        if out.breakdown:
            out.breakdown = [{**b, "inactive": b.get("card_id") in inactive_ids} for b in out.breakdown]
        items.append(out)

    def _sum(kind: str, attr: str) -> Decimal:
        return sum((getattr(i, attr) for i in items if i.kind == kind), zero)

    totals = MonthTotals(
        fixed=_sum("fixed", "amount"), variable=_sum("variable", "amount"),
        total=sum((i.amount for i in items), zero),
        my_fixed=_sum("fixed", "my_amount"), my_variable=_sum("variable", "my_amount"),
        my_total=sum((i.my_amount for i in items), zero),
    )
    income = []
    for r in income_rows:
        is_actual, extrato_actions = _projection_link_flags(r)
        income.append(
            IncomeOut(
                id=r.id,
                editable=_is_editable(r.source),
                description=r.description,
                amount=r.amount,
                expected_date=r.expected_date,
                source=r.source,
                is_automatic=bool(r.is_automatic),
                is_actual=is_actual,
                source_table=r.source_table,
                source_id=r.source_id,
                extrato_actions=extrato_actions,
            )
        )
    return MonthResponse(
        year_month=year_month, items=items, totals=totals,
        income=income, income_total=sum((i.amount for i in income), zero),
    )


def _get_item(db: Session, tenant_id: int, account_id: int, item_id: int) -> MonthlyProjection:
    item = db.query(MonthlyProjection).filter(
        MonthlyProjection.id == item_id,
        MonthlyProjection.tenant_id == tenant_id,
        MonthlyProjection.account_id == account_id,
        MonthlyProjection.active.is_(True),
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item de projeção não encontrado")
    return item


class OverviewMonth(BaseModel):
    year_month: str
    income: Decimal
    expenses: Decimal
    result: Decimal
    # 1ª quinzena = dias 1–14, 2ª quinzena = dia 15 em diante
    income_h1: Decimal
    income_h2: Decimal
    expenses_h1: Decimal
    expenses_h2: Decimal


MAX_OVERVIEW_MONTHS = 24


@router.get("/overview", response_model=List[OverviewMonth])
async def get_overview(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Entradas, gastos e resultado do mês atual até o último mês com projeção lançada."""
    tenant_id, account_id, _user_id = _scope(current_user)
    today = date.today()
    current = f"{today.year}-{today.month:02d}"
    last = (
        db.query(func.max(MonthlyProjection.year_month))
        .filter(
            MonthlyProjection.tenant_id == tenant_id,
            MonthlyProjection.account_id == account_id,
            MonthlyProjection.active.is_(True),
        )
        .scalar()
    )
    months = [current]
    while last and months[-1] < last and len(months) < MAX_OVERVIEW_MONTHS:
        months.append(service.next_year_month(months[-1]))
    out = []
    for ym in months:
        month = _month_response(db, tenant_id, account_id, ym)
        zero = Decimal(0)
        out.append(OverviewMonth(
            year_month=ym, income=month.income_total, expenses=month.totals.total,
            result=month.income_total - month.totals.total,
            income_h1=sum((i.amount for i in month.income if i.expected_date.day < 15), zero),
            income_h2=sum((i.amount for i in month.income if i.expected_date.day >= 15), zero),
            expenses_h1=sum((i.amount for i in month.items if i.expected_date.day < 15), zero),
            expenses_h2=sum((i.amount for i in month.items if i.expected_date.day >= 15), zero),
        ))
    return out


@router.get("", response_model=MonthResponse)
async def get_month(
    year_month: str = Query(..., description="YYYY-MM"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    _check_ym(year_month)
    return _month_response(db, tenant_id, account_id, year_month)


class SendWhatsappRequest(BaseModel):
    date: date


class SendWhatsappResponse(BaseModel):
    sent: int
    total: Decimal


def _brl(value: Decimal) -> str:
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


@router.post("/send-whatsapp", response_model=SendWhatsappResponse)
async def send_whatsapp(
    body: SendWhatsappRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    month = _month_response(db, tenant_id, account_id, body.date.strftime("%Y-%m"))
    items = [i for i in month.items if i.expected_date == body.date]
    if not items:
        raise HTTPException(status_code=404, detail="Nenhuma despesa na projeção para este dia.")
    total = sum((i.amount for i in items), Decimal(0))
    lines = [f"Despesas de {body.date.strftime('%d/%m/%Y')}:"]
    lines += [f"• {i.description}: {_brl(i.amount)}" for i in items]
    lines.append(f"Total: {_brl(total)}")
    whatsapp_service.send_text("\n".join(lines))
    return SendWhatsappResponse(sent=len(items), total=total)


@router.post("", response_model=ProjectionOut, status_code=201)
async def create_item(
    body: ProjectionIn,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, user_id = _scope(current_user)
    item = MonthlyProjection(
        tenant_id=tenant_id, account_id=account_id, created_by=user_id,
        source="manual", is_automatic=False,
    )
    body.apply_to(item)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/{item_id}", response_model=ProjectionOut)
async def update_item(
    item_id: int,
    body: ProjectionIn,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    item = _get_item(db, tenant_id, account_id, item_id)
    if not _is_editable(item.source):
        raise HTTPException(status_code=400, detail="Itens automáticos não são editáveis; lance a projeção novamente")
    body.apply_to(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
async def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, _user_id = _scope(current_user)
    db.delete(_get_item(db, tenant_id, account_id, item_id))
    db.commit()


@router.delete("", status_code=204)
async def clear_month(
    year_month: str = Query(..., description="YYYY-MM"),
    scope: Literal["manual", "account", "card", "all"] = Query("all"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Limpar mês: exclui definitivamente os itens do escopo (manual, conta, cartão ou tudo)."""
    tenant_id, account_id, _user_id = _scope(current_user)
    _check_ym(year_month)
    service.clear_month(db, tenant_id, account_id, year_month, scope)


@router.post("/clone", response_model=CloneResponse)
async def clone_month(
    body: CloneRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, user_id = _scope(current_user)
    _check_ym(body.source_year_month)
    try:
        target, copied = service.clone_to_next_month(db, tenant_id, account_id, user_id, body.source_year_month, body.months, include_cards=body.include_cards)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return CloneResponse(target_year_month=target, copied=copied)


@router.post("/launch-income", response_model=LaunchResponse)
async def launch_income(
    body: LaunchIncomeRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, user_id = _scope(current_user)
    _check_ym(body.year_month)
    created = service.launch_income_projections(
        db,
        tenant_id,
        account_id,
        user_id,
        body.year_month,
        body.periods,
        advance_on_day_15=body.advance_on_day_15,
    )
    return LaunchResponse(created=created)


@router.post("/launch-cards", response_model=LaunchResponse)
async def launch_cards(
    body: LaunchCardsRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, user_id = _scope(current_user)
    _check_ym(body.year_month)
    try:
        created = service.launch_card_projections(
            db,
            tenant_id,
            account_id,
            user_id,
            body.year_month,
            body.card_ids,
            body.mode,
            sharing=body.sharing,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return LaunchResponse(created=created)


class LaunchStatementsRequest(BaseModel):
    year_month: str
    from_day: int | None = None
    payroll_reconcile: Literal["keep", "clear"] | None = None
    as_of: date | None = None


@router.post("/launch-statements", response_model=LaunchResponse)
async def launch_statements(
    body: LaunchStatementsRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id, account_id, user_id = _scope(current_user)
    _check_ym(body.year_month)
    result = service.launch_statement_projections(
        db,
        tenant_id,
        account_id,
        user_id,
        body.year_month,
        from_day=body.from_day,
        payroll_reconcile=body.payroll_reconcile,
        as_of=body.as_of,
    )
    payroll_confirmation = None
    if result.payroll_confirmation:
        payroll_confirmation = [
            PayrollConfirmationItemOut(
                description=item.description,
                amount=item.amount,
                expected_day=item.expected_day,
                matched_in_extrato=item.matched_in_extrato,
            )
            for item in result.payroll_confirmation
        ]
    return LaunchResponse(created=result.created, payroll_confirmation=payroll_confirmation)
