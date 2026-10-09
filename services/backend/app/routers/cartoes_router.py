"""
Router para gerenciamento de cartões de crédito.
Fornece endpoints para CRUD de cartões.
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
from typing import List
from pydantic import BaseModel, Field
from app.database import get_db
from app.models.unified_models import Cartao, CreditCardInvoiceGroup, ExpenseSharingSetting
from app.dependencies.auth import get_current_user, require_account
from app.services import invoice_payment_match_service as match_service
from app.utils.card_invoice_calendar import apply_group_calendar_to_card
from app.schemas.bulk_ops import BulkDeleteResponse, BulkIdsRequest

router = APIRouter(prefix="/api/cartoes", tags=["cartoes"])


# Schemas Pydantic
class BankInfo(BaseModel):
    id: int
    code: str
    name: str

    class Config:
        from_attributes = True


class SharedAccountInfo(BaseModel):
    id: int
    name: str | None = None
    description: str | None = None
    bank: BankInfo | None = None
    agency: str | None = None
    account_number: str | None = None

    class Config:
        from_attributes = True


class ExpenseSharingInfo(BaseModel):
    id: int
    account_id: int
    shared_account_id: int
    my_contribution_percentage: float = Field(serialization_alias="my_contribution_percentage")
    revenue_contribution_percentage: float | None = None
    description: str | None = None
    active: bool
    shared_account: SharedAccountInfo | None = None

    class Config:
        from_attributes = True
        populate_by_name = True
class CartaoCreate(BaseModel):
    name: str
    description: str | None = None
    number: str
    type: str = 'credito'  # 'credito', 'beneficios'
    account_id: int | None = None
    expense_sharing_id: int | None = None
    expense_ownership_percentage: float | None = None
    revenue_ownership_percentage: float | None = None
    closing_day: int = Field(default=14, ge=1, le=30)
    due_day: int = Field(default=14, ge=1, le=30)
    invoice_group_id: int | None = None
    active: bool = True


class CartaoUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    number: str | None = None
    type: str | None = None
    account_id: int | None = None
    expense_sharing_id: int | None = None
    expense_ownership_percentage: float | None = None
    revenue_ownership_percentage: float | None = None
    active: bool | None = None
    closing_day: int | None = Field(default=None, ge=1, le=30)
    due_day: int | None = Field(default=None, ge=1, le=30)
    invoice_group_id: int | None = None
    update_existing_records: bool = False  # Flag para atualizar registros existentes


class CartaoResponse(BaseModel):
    id: int
    name: str
    description: str | None
    number: str
    type: str
    account_id: int | None
    account_name: str | None = None
    ownership_type: str  # Calculado automaticamente pela @property do modelo
    expense_sharing_id: int | None
    expense_ownership_percentage: float | None = None
    revenue_ownership_percentage: float | None = None
    expense_sharing: ExpenseSharingInfo | None = None
    active: bool
    closing_day: int
    due_day: int
    invoice_group_id: int | None = None
    invoice_group_name: str | None = None

    class Config:
        from_attributes = True


class InvoiceGroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    closing_day: int = Field(default=14, ge=1, le=30)
    due_day: int = Field(default=14, ge=1, le=30)
    card_ids: List[int] = []


class InvoiceGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    closing_day: int | None = Field(default=None, ge=1, le=30)
    due_day: int | None = Field(default=None, ge=1, le=30)
    active: bool | None = None
    card_ids: List[int] | None = None


class InvoiceGroupResponse(BaseModel):
    id: int
    name: str
    account_id: int
    active: bool
    closing_day: int
    due_day: int
    card_count: int = 0

    class Config:
        from_attributes = True


def _normalize_card_participation(payload: dict, db: Session, tenant_id: int) -> dict:
    """Valida participação: compartilhado exige sharing; senão 100% ou 0% (gerenciado)."""
    sharing_id = payload.get("expense_sharing_id")
    if sharing_id:
        sharing = db.query(ExpenseSharingSetting).filter(
            ExpenseSharingSetting.id == sharing_id,
            ExpenseSharingSetting.tenant_id == tenant_id,
        ).first()
        if not sharing:
            raise HTTPException(status_code=404, detail="Compartilhamento não encontrado")
        for key in ("expense_ownership_percentage", "revenue_ownership_percentage"):
            val = payload.get(key)
            if val is not None and (val < 0 or val > 100):
                raise HTTPException(
                    status_code=400,
                    detail=f"{key} deve estar entre 0 e 100",
                )
        return payload

    payload["expense_sharing_id"] = None
    expense_pct = payload.get("expense_ownership_percentage")
    revenue_pct = payload.get("revenue_ownership_percentage")
    if expense_pct is not None and float(expense_pct) == 0:
        payload["expense_ownership_percentage"] = 0
        payload["revenue_ownership_percentage"] = (
            0 if revenue_pct is None else revenue_pct
        )
    else:
        if expense_pct is None:
            payload["expense_ownership_percentage"] = 100
        if revenue_pct is None:
            payload["revenue_ownership_percentage"] = 100
    return payload


def _current_user_id(current_user: dict) -> int:
    user_id = current_user.get("user_id") or current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Usuário inválido no token")
    return int(user_id)


def _serialize_cartao(cartao: Cartao) -> dict:
    return {
        "id": cartao.id,
        "name": cartao.name,
        "description": cartao.description,
        "number": cartao.number,
        "type": cartao.type,
        "account_id": cartao.account_id,
        "account_name": None,
        "ownership_type": cartao.ownership_type,
        "expense_sharing_id": cartao.expense_sharing_id,
        "expense_ownership_percentage": float(cartao.expense_ownership_percentage) if cartao.expense_ownership_percentage is not None else None,
        "revenue_ownership_percentage": float(cartao.revenue_ownership_percentage) if cartao.revenue_ownership_percentage is not None else None,
        "expense_sharing": None,
        "active": cartao.active,
        "closing_day": int(cartao.closing_day or 14),
        "due_day": int(cartao.due_day or 14),
        "invoice_group_id": cartao.invoice_group_id,
        "invoice_group_name": cartao.invoice_group.name if getattr(cartao, "invoice_group", None) else None,
    }


def _shared_account_info(account) -> dict | None:
    if account is None:
        return None
    return {
        "id": account.id,
        "name": account.name,
        "description": account.description,
        "bank": {"id": account.bank.id, "code": account.bank.code, "name": account.bank.name} if account.bank else None,
        "agency": str(account.agency) if account.agency is not None else None,
        "account_number": str(account.account_number) if account.account_number is not None else None,
    }


def _sharing_info_for_account(setting: ExpenseSharingSetting, account_id: int | None) -> dict:
    """Compartilhamento visto pela conta do cartão (inverte quando a config pertence ao parceiro)."""
    my_pct = float(setting.my_contribution_percentage) if setting.my_contribution_percentage is not None else 0.0
    revenue_pct = (
        float(setting.revenue_contribution_percentage)
        if setting.revenue_contribution_percentage is not None
        else None
    )
    inverted = account_id is not None and setting.account_id != account_id
    return {
        "id": setting.id,
        "account_id": setting.shared_account_id if inverted else setting.account_id,
        "shared_account_id": setting.account_id if inverted else setting.shared_account_id,
        "my_contribution_percentage": 100.0 - my_pct if inverted else my_pct,
        "revenue_contribution_percentage": (
            100.0 - revenue_pct if inverted and revenue_pct is not None else revenue_pct
        ),
        "description": setting.description,
        "active": setting.active,
        "shared_account": _shared_account_info(setting.account if inverted else setting.shared_account),
    }


def _current_account_id(current_user: dict) -> int | None:
    account_id = current_user.get("account_id")
    return int(account_id) if account_id is not None else None


def _require_account_id(current_user: dict) -> int:
    account_id = _current_account_id(current_user)
    if account_id is None:
        raise HTTPException(status_code=400, detail="Nenhuma conta selecionada. Por favor, selecione uma conta primeiro.")
    return account_id


def _validate_invoice_group(
    db: Session,
    tenant_id: int,
    account_id: int | None,
    invoice_group_id: int | None,
    card_type: str | None,
) -> int | None:
    if card_type == "beneficios" or invoice_group_id is None:
        return None
    if account_id is None:
        raise HTTPException(status_code=400, detail="Selecione uma conta para vincular o cartão a um grupo de fatura")
    group = db.query(CreditCardInvoiceGroup).filter(
        CreditCardInvoiceGroup.id == invoice_group_id,
        CreditCardInvoiceGroup.tenant_id == tenant_id,
        CreditCardInvoiceGroup.account_id == account_id,
        CreditCardInvoiceGroup.active == True,
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="Grupo de fatura não encontrado")
    return group.id


def _serialize_invoice_group(group: CreditCardInvoiceGroup) -> dict:
    cards = group.credit_cards or []
    return {
        "id": group.id,
        "name": group.name,
        "account_id": group.account_id,
        "active": group.active,
        "closing_day": int(group.closing_day or 14),
        "due_day": int(group.due_day or 14),
        "card_count": len([c for c in cards if c.type == "credito"]),
    }


def _load_invoice_group(
    db: Session,
    tenant_id: int,
    account_id: int,
    invoice_group_id: int,
) -> CreditCardInvoiceGroup:
    group = db.query(CreditCardInvoiceGroup).filter(
        CreditCardInvoiceGroup.id == invoice_group_id,
        CreditCardInvoiceGroup.tenant_id == tenant_id,
        CreditCardInvoiceGroup.account_id == account_id,
        CreditCardInvoiceGroup.active == True,
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="Grupo de fatura não encontrado")
    return group


def _resolve_card_calendar_days(
    db: Session,
    tenant_id: int,
    account_id: int | None,
    card_type: str | None,
    invoice_group_id: int | None,
    requested_closing: int | None,
    requested_due: int | None,
) -> tuple[int, int]:
    if card_type == "beneficios" or not invoice_group_id:
        return (
            int(requested_closing or 14),
            int(requested_due or 14),
        )
    if account_id is None:
        raise HTTPException(status_code=400, detail="Selecione uma conta para vincular o cartão a um grupo de fatura")
    group = _load_invoice_group(db, tenant_id, account_id, invoice_group_id)
    return (
        int(group.closing_day or 14),
        int(group.due_day or 14),
    )


def _sync_group_members_calendar(group: CreditCardInvoiceGroup) -> None:
    for card in group.credit_cards or []:
        apply_group_calendar_to_card(card, group)


def _reload_invoice_group(db: Session, group_id: int, tenant_id: int, account_id: int) -> CreditCardInvoiceGroup:
    group = db.query(CreditCardInvoiceGroup).options(
        joinedload(CreditCardInvoiceGroup.credit_cards)
    ).filter(
        CreditCardInvoiceGroup.id == group_id,
        CreditCardInvoiceGroup.tenant_id == tenant_id,
        CreditCardInvoiceGroup.account_id == account_id,
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="Grupo de fatura não encontrado")
    return group


def _set_group_cards(
    db: Session,
    tenant_id: int,
    account_id: int,
    group: CreditCardInvoiceGroup,
    card_ids: List[int],
) -> None:
    group_id = group.id
    unique_ids = list(dict.fromkeys(card_ids))
    if len(unique_ids) < 2:
        raise HTTPException(status_code=400, detail="Selecione pelo menos dois cartões de crédito")

    cards = db.query(Cartao).filter(
        Cartao.tenant_id == tenant_id,
        Cartao.account_id == account_id,
        Cartao.id.in_(unique_ids),
        Cartao.type == "credito",
    ).all()
    if len(cards) != len(unique_ids):
        raise HTTPException(status_code=400, detail="Só cartões de crédito da conta podem entrar no grupo")

    db.query(Cartao).filter(
        Cartao.tenant_id == tenant_id,
        Cartao.account_id == account_id,
        Cartao.invoice_group_id == group_id,
        ~Cartao.id.in_(unique_ids),
    ).update({Cartao.invoice_group_id: None}, synchronize_session=False)

    for card in cards:
        card.invoice_group_id = group_id
        apply_group_calendar_to_card(card, group)


@router.get("/", response_model=List[CartaoResponse])
async def listar_cartoes(
    incluir_inativos: bool = False,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Lista cartões com dados enriquecidos (nomes de conta, compartilhamento).
    Filtra por tenant_id e account_id (se disponível no token).

    Args:
        incluir_inativos: Se True, inclui cartões inativos na listagem
    """
    from app.models.unified_models import Account, ExpenseSharingSetting, Bank

    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    # Filtra por tenant_id e carrega relacionamentos
    query = db.query(Cartao).options(
        joinedload(Cartao.account).joinedload(Account.bank),
        joinedload(Cartao.expense_sharing).joinedload(ExpenseSharingSetting.shared_account).joinedload(Account.bank),
        joinedload(Cartao.expense_sharing).joinedload(ExpenseSharingSetting.account).joinedload(Account.bank),
        joinedload(Cartao.invoice_group),
    ).filter(Cartao.tenant_id == tenant_id)

    # Se account_id estiver disponível no token, filtra por ele
    if account_id is not None:
        query = query.filter(Cartao.account_id == account_id)

    if not incluir_inativos:
        query = query.filter(Cartao.active == True)
    cartoes = query.order_by(Cartao.name, Cartao.number).all()

    # Enriquecer os dados com nomes de conta e expense_sharing completo
    resultado = []
    for cartao in cartoes:
        cartao_dict = _serialize_cartao(cartao)

        # Buscar dados completos da conta (já carregado via joinedload)
        if cartao.account:
            conta = cartao.account
            # Formato: "Nome • Banco • Agência/Conta"
            account_display = conta.name or "Conta"

            # Adiciona banco se disponível
            if conta.bank:
                account_display += f" • {conta.bank.name}"

            # Adiciona agência/conta se disponíveis
            if conta.agency and conta.account_number:
                account_display += f" • {conta.agency}/{conta.account_number}"
            elif conta.account_number:
                account_display += f" • {conta.account_number}"

            cartao_dict["account_name"] = account_display

        # Incluir dados completos do expense_sharing (já carregado via joinedload)
        if cartao.expense_sharing:
            try:
                cartao_dict["expense_sharing"] = _sharing_info_for_account(cartao.expense_sharing, cartao.account_id)
            except Exception as e:
                print(f"Erro ao processar expense_sharing para cartão {cartao.id}: {e}")
                cartao_dict["expense_sharing"] = None

        resultado.append(cartao_dict)

    return resultado


@router.get("/agrupados-por-conta")
async def listar_cartoes_agrupados(
    incluir_inativos: bool = False,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Lista cartões agrupados por conta.
    Se account_id estiver no token, retorna apenas a conta selecionada.

    Args:
        incluir_inativos: Se True, inclui cartões inativos na listagem

    Returns:
        Lista de contas com seus respectivos cartões
    """
    from app.models.unified_models import Account

    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    # Busca contas do tenant
    query_contas = db.query(Account).filter(Account.tenant_id == tenant_id, Account.active == True)

    # Se account_id estiver disponível, filtra apenas essa conta
    if account_id is not None:
        query_contas = query_contas.filter(Account.id == account_id)

    contas = query_contas.all()

    resultado = []

    for conta in contas:
        # Busca cartões da conta
        query = db.query(Cartao).filter(
            Cartao.tenant_id == tenant_id,
            Cartao.account_id == conta.id
        )
        if not incluir_inativos:
            query = query.filter(Cartao.active == True)

        cartoes = query.order_by(Cartao.name, Cartao.number).all()

        # Só inclui a conta se tiver cartões (ou se incluir_inativos=True e tiver cartões inativos)
        if cartoes:
            resultado.append({
                "conta_id": conta.id,
                "conta_nome": conta.name or f"Conta {conta.account_number}",
                "conta_descricao": conta.description,
                "conta_tipo": conta.account_type,
                "banco_id": conta.bank_id,
                "banco_nome": conta.bank.name if conta.bank else None,
                "banco_codigo": conta.bank.code if conta.bank else None,
                "agencia": conta.agency,
                "numero_conta": conta.account_number,
                "cartoes": [
                    {
                        "id": c.id,
                        "name": c.name,
                        "description": c.description,
                        "number": c.number,
                        "type": c.type,
                        "ownership_type": c.ownership_type,
                        "active": c.active,
                        "account_id": c.account_id,
                        "invoice_group_id": c.invoice_group_id,
                    }
                    for c in cartoes
                ]
            })

    return resultado


@router.get("/invoice-groups", response_model=List[InvoiceGroupResponse])
async def listar_grupos_fatura(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id = current_user.get("tenant_id", 1)
    account_id = _require_account_id(current_user)
    groups = (
        db.query(CreditCardInvoiceGroup)
        .options(joinedload(CreditCardInvoiceGroup.credit_cards))
        .filter(
            CreditCardInvoiceGroup.tenant_id == tenant_id,
            CreditCardInvoiceGroup.account_id == account_id,
            CreditCardInvoiceGroup.active == True,
        )
        .order_by(CreditCardInvoiceGroup.name)
        .all()
    )
    return [_serialize_invoice_group(group) for group in groups]


@router.post("/invoice-groups", response_model=InvoiceGroupResponse, status_code=201)
async def criar_grupo_fatura(
    payload: InvoiceGroupCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id = current_user.get("tenant_id", 1)
    account_id = _require_account_id(current_user)
    user_id = _current_user_id(current_user)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome do grupo é obrigatório")

    existing = db.query(CreditCardInvoiceGroup).filter(
        CreditCardInvoiceGroup.tenant_id == tenant_id,
        CreditCardInvoiceGroup.account_id == account_id,
        CreditCardInvoiceGroup.name == name,
    ).first()
    if existing:
        if existing.active:
            raise HTTPException(status_code=400, detail="Já existe um grupo com este nome")
        existing.active = True
        existing.closing_day = payload.closing_day
        existing.due_day = payload.due_day
        try:
            _set_group_cards(db, tenant_id, account_id, existing, payload.card_ids)
            db.commit()
        except HTTPException:
            db.rollback()
            raise
        return _serialize_invoice_group(_reload_invoice_group(db, existing.id, tenant_id, account_id))

    group = CreditCardInvoiceGroup(
        name=name,
        account_id=account_id,
        tenant_id=tenant_id,
        created_by=user_id,
        active=True,
        closing_day=payload.closing_day,
        due_day=payload.due_day,
    )
    db.add(group)
    try:
        db.flush()
        _set_group_cards(db, tenant_id, account_id, group, payload.card_ids)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe um grupo com este nome")
    return _serialize_invoice_group(_reload_invoice_group(db, group.id, tenant_id, account_id))


@router.put("/invoice-groups/{group_id}", response_model=InvoiceGroupResponse)
async def atualizar_grupo_fatura(
    group_id: int,
    payload: InvoiceGroupUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id = current_user.get("tenant_id", 1)
    account_id = _require_account_id(current_user)
    group = db.query(CreditCardInvoiceGroup).options(
        joinedload(CreditCardInvoiceGroup.credit_cards)
    ).filter(
        CreditCardInvoiceGroup.id == group_id,
        CreditCardInvoiceGroup.tenant_id == tenant_id,
        CreditCardInvoiceGroup.account_id == account_id,
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="Grupo de fatura não encontrado")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        name = data["name"].strip()
        if not name:
            raise HTTPException(status_code=400, detail="Nome do grupo é obrigatório")
        group.name = name
    if "active" in data and data["active"] is not None:
        group.active = data["active"]
    calendar_changed = False
    if "closing_day" in data and data["closing_day"] is not None:
        group.closing_day = int(data["closing_day"])
        calendar_changed = True
    if "due_day" in data and data["due_day"] is not None:
        group.due_day = int(data["due_day"])
        calendar_changed = True
    if calendar_changed:
        _sync_group_members_calendar(group)
    if "card_ids" in data and data["card_ids"] is not None:
        try:
            _set_group_cards(db, tenant_id, account_id, group, data["card_ids"])
            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=400, detail="Já existe um grupo com este nome")
        return _serialize_invoice_group(_reload_invoice_group(db, group.id, tenant_id, account_id))

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe um grupo com este nome")
    return _serialize_invoice_group(_reload_invoice_group(db, group.id, tenant_id, account_id))


@router.delete("/invoice-groups/{group_id}", status_code=204)
async def deletar_grupo_fatura(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    tenant_id = current_user.get("tenant_id", 1)
    account_id = _require_account_id(current_user)
    group = db.query(CreditCardInvoiceGroup).filter(
        CreditCardInvoiceGroup.id == group_id,
        CreditCardInvoiceGroup.tenant_id == tenant_id,
        CreditCardInvoiceGroup.account_id == account_id,
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="Grupo de fatura não encontrado")

    match_service.unmatch_group_matches(db, tenant_id, account_id, group.id)
    db.delete(group)
    db.commit()
    return None


@router.get("/{cartao_id}", response_model=CartaoResponse)
async def obter_cartao(
    cartao_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Obtém um cartão específico por ID."""
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    query = db.query(Cartao).options(joinedload(Cartao.invoice_group)).filter(
        Cartao.id == cartao_id,
        Cartao.tenant_id == tenant_id,
        Cartao.active == True
    )

    # Se account_id estiver disponível, filtra por ele
    if account_id is not None:
        query = query.filter(Cartao.account_id == account_id)

    cartao = query.first()
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado")
    return _serialize_cartao(cartao)


@router.post("/", response_model=CartaoResponse, status_code=201)
async def criar_cartao(
    cartao_data: CartaoCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Cria um novo cartão."""
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")
    user_id = _current_user_id(current_user)

    # Validações
    if cartao_data.type not in ['credito', 'beneficios']:
        raise HTTPException(status_code=400, detail="type deve ser 'credito' ou 'beneficios'")

    payload = cartao_data.model_dump()
    if not payload.get("account_id"):
        payload["account_id"] = account_id
    payload["invoice_group_id"] = _validate_invoice_group(
        db, tenant_id, payload.get("account_id"), payload.get("invoice_group_id"), payload.get("type"),
    )
    closing, due = _resolve_card_calendar_days(
        db,
        tenant_id,
        payload.get("account_id"),
        payload.get("type"),
        payload.get("invoice_group_id"),
        payload.get("closing_day"),
        payload.get("due_day"),
    )
    payload["closing_day"] = closing
    payload["due_day"] = due
    _normalize_card_participation(payload, db, tenant_id)

    # Verifica se já existe um cartão com o mesmo name e número
    cartao_existente = db.query(Cartao).filter(
        Cartao.tenant_id == tenant_id,
        Cartao.name == cartao_data.name,
        Cartao.number == cartao_data.number
    ).first()

    if cartao_existente:
        if cartao_existente.active:
            raise HTTPException(status_code=400, detail="Cartão já existe")
        else:
            cartao_existente.active = True
            cartao_existente.description = payload.get("description")
            cartao_existente.type = payload.get("type") or cartao_existente.type
            cartao_existente.invoice_group_id = payload.get("invoice_group_id")
            cartao_existente.closing_day = payload.get("closing_day") or cartao_existente.closing_day
            cartao_existente.due_day = payload.get("due_day") or cartao_existente.due_day
            cartao_existente.expense_sharing_id = payload.get("expense_sharing_id")
            cartao_existente.expense_ownership_percentage = payload.get("expense_ownership_percentage")
            cartao_existente.revenue_ownership_percentage = payload.get("revenue_ownership_percentage")
            if payload.get("account_id"):
                cartao_existente.account_id = payload["account_id"]
            try:
                db.commit()
                db.refresh(cartao_existente)
            except IntegrityError:
                db.rollback()
                raise HTTPException(status_code=400, detail="Cartão já existe")
            return _serialize_cartao(cartao_existente)

    novo_cartao = Cartao(
        tenant_id=tenant_id,
        created_by=user_id,
        **payload
    )
    db.add(novo_cartao)
    try:
        db.commit()
        db.refresh(novo_cartao)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Não foi possível criar o cartão. Verifique nome, número e conta.")
    return _serialize_cartao(novo_cartao)


@router.put("/{cartao_id}", response_model=CartaoResponse)
async def atualizar_cartao(
    cartao_id: int,
    cartao_data: CartaoUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Atualiza um cartão existente."""
    from app.models.unified_models import BankStatement, CreditCardInvoice, BenefitCardStatement, ExpenseSharingSetting

    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    # Removido filtro Cartao.active == True para permitir inativar/reativar
    query = db.query(Cartao).filter(
        Cartao.id == cartao_id,
        Cartao.tenant_id == tenant_id
    )

    # Se account_id estiver disponível, filtra por ele
    if account_id is not None:
        query = query.filter(Cartao.account_id == account_id)

    cartao = query.first()
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado")

    # Validações
    update_data = cartao_data.model_dump(exclude_unset=True)

    # Remove o flag update_existing_records do update_data (não é campo do modelo)
    update_existing_records = update_data.pop('update_existing_records', False)

    if any(
        k in update_data
        for k in (
            "expense_sharing_id",
            "expense_ownership_percentage",
            "revenue_ownership_percentage",
        )
    ):
        merged = {
            "expense_sharing_id": update_data.get(
                "expense_sharing_id", cartao.expense_sharing_id
            ),
            "expense_ownership_percentage": update_data.get(
                "expense_ownership_percentage", cartao.expense_ownership_percentage
            ),
            "revenue_ownership_percentage": update_data.get(
                "revenue_ownership_percentage", cartao.revenue_ownership_percentage
            ),
        }
        _normalize_card_participation(merged, db, tenant_id)
        update_data.update(merged)

    if 'type' in update_data:
        if update_data['type'] not in ['credito', 'beneficios']:
            raise HTTPException(status_code=400, detail="type deve ser 'credito' ou 'beneficios'")

    card_type = update_data.get('type', cartao.type)
    if 'invoice_group_id' in update_data or 'type' in update_data:
        group_id = update_data.get('invoice_group_id', cartao.invoice_group_id)
        update_data['invoice_group_id'] = _validate_invoice_group(
            db, tenant_id, cartao.account_id, group_id, card_type,
        )

    final_group_id = update_data.get('invoice_group_id', cartao.invoice_group_id)
    if card_type == 'credito' and final_group_id:
        closing, due = _resolve_card_calendar_days(
            db,
            tenant_id,
            cartao.account_id,
            card_type,
            final_group_id,
            update_data.get('closing_day', cartao.closing_day),
            update_data.get('due_day', cartao.due_day),
        )
        update_data['closing_day'] = closing
        update_data['due_day'] = due
    elif cartao.invoice_group_id and card_type == 'credito':
        for key in ('closing_day', 'due_day'):
            update_data.pop(key, None)

    # Verifica se já existe outro cartão com o mesmo name e número
    if 'name' in update_data and 'number' in update_data:
        cartao_duplicado = db.query(Cartao).filter(
            Cartao.tenant_id == tenant_id,
            Cartao.name == update_data['name'],
            Cartao.number == update_data['number'],
            Cartao.id != cartao_id
        ).first()

        if cartao_duplicado:
            raise HTTPException(status_code=400, detail="Já existe um cartão com este nome e número")

    sharing_fields_changed = any(
        field in update_data
        for field in ('expense_sharing_id', 'expense_ownership_percentage', 'revenue_ownership_percentage')
    )
    if update_existing_records and sharing_fields_changed:
        from app.utils.sharing_percentage import resolve_ownership_percentage

        new_expense_sharing_id = update_data.get('expense_sharing_id', cartao.expense_sharing_id)
        expense_sharing = None
        if new_expense_sharing_id:
            expense_sharing = db.query(ExpenseSharingSetting).filter(
                ExpenseSharingSetting.id == new_expense_sharing_id,
                ExpenseSharingSetting.tenant_id == tenant_id
            ).first()
            if not expense_sharing:
                raise HTTPException(status_code=404, detail="Compartilhamento não encontrado")

        card_for_resolve = {
            'expense_ownership_percentage': update_data.get(
                'expense_ownership_percentage', cartao.expense_ownership_percentage
            ),
            'revenue_ownership_percentage': update_data.get(
                'revenue_ownership_percentage', cartao.revenue_ownership_percentage
            ),
        }

        if new_expense_sharing_id:
            expense_pct = resolve_ownership_percentage(
                kind='expense', sharing=expense_sharing, card=card_for_resolve
            )
            revenue_pct = resolve_ownership_percentage(
                kind='revenue', sharing=expense_sharing, card=card_for_resolve
            )
            for model in (CreditCardInvoice, BenefitCardStatement):
                db.query(model).filter(
                    model.credit_card_id == cartao_id,
                    model.tenant_id == tenant_id,
                    model.amount < 0,
                ).update({
                    'expense_sharing_id': new_expense_sharing_id,
                    'ownership_percentage': expense_pct,
                }, synchronize_session=False)
                db.query(model).filter(
                    model.credit_card_id == cartao_id,
                    model.tenant_id == tenant_id,
                    model.amount >= 0,
                ).update({
                    'expense_sharing_id': new_expense_sharing_id,
                    'ownership_percentage': revenue_pct,
                }, synchronize_session=False)
        else:
            expense_pct = resolve_ownership_percentage(
                kind="expense", sharing=None, card=card_for_resolve
            )
            revenue_pct = resolve_ownership_percentage(
                kind="revenue", sharing=None, card=card_for_resolve
            )
            for model in (CreditCardInvoice, BenefitCardStatement):
                db.query(model).filter(
                    model.credit_card_id == cartao_id,
                    model.tenant_id == tenant_id,
                    model.amount < 0,
                ).update({
                    "expense_sharing_id": None,
                    "ownership_percentage": float(expense_pct),
                }, synchronize_session=False)
                db.query(model).filter(
                    model.credit_card_id == cartao_id,
                    model.tenant_id == tenant_id,
                    model.amount >= 0,
                ).update({
                    "expense_sharing_id": None,
                    "ownership_percentage": float(revenue_pct),
                }, synchronize_session=False)

    # Atualiza apenas os campos fornecidos no cartão
    for field, value in update_data.items():
        setattr(cartao, field, value)

    db.commit()
    db.refresh(cartao)
    return _serialize_cartao(cartao)


@router.post("/bulk-delete", response_model=BulkDeleteResponse)
async def bulk_deletar_cartoes(
    body: BulkIdsRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    if not body.ids:
        raise HTTPException(status_code=400, detail="Nenhum cartão selecionado")

    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")
    unique_ids = list(dict.fromkeys(body.ids))

    query = db.query(Cartao).filter(
        Cartao.id.in_(unique_ids),
        Cartao.tenant_id == tenant_id,
    )
    if account_id is not None:
        query = query.filter(Cartao.account_id == account_id)

    cartoes = query.all()
    for cartao in cartoes:
        db.delete(cartao)

    db.commit()
    deleted = len(cartoes)
    skipped = len(unique_ids) - deleted
    return BulkDeleteResponse(deleted=deleted, skipped=skipped)


@router.delete("/{cartao_id}", status_code=204)
async def deletar_cartao(
    cartao_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Deleta permanentemente um cartão."""
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    # Removido filtro active == True para permitir deletar cartões inativos também
    query = db.query(Cartao).filter(
        Cartao.id == cartao_id,
        Cartao.tenant_id == tenant_id
    )

    # Se account_id estiver disponível, filtra por ele
    if account_id is not None:
        query = query.filter(Cartao.account_id == account_id)

    cartao = query.first()
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado")

    # Hard delete - deleta permanentemente
    db.delete(cartao)
    db.commit()
    return None


@router.post("/{cartao_id}/reativar", response_model=CartaoResponse)
async def reativar_cartao(
    cartao_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Reativa um cartão inativo."""
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    query = db.query(Cartao).filter(
        Cartao.id == cartao_id,
        Cartao.tenant_id == tenant_id
    )

    # Se account_id estiver disponível, filtra por ele
    if account_id is not None:
        query = query.filter(Cartao.account_id == account_id)

    cartao = query.first()
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado")

    if cartao.active:
        raise HTTPException(status_code=400, detail="Cartão já está ativo")

    cartao.active = True
    db.commit()
    db.refresh(cartao)
    return _serialize_cartao(cartao)

