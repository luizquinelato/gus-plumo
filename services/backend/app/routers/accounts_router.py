"""
Router para gerenciamento de contas bancárias.
Fornece endpoints para CRUD de contas.
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
from pydantic import BaseModel, field_serializer
from app.database import get_db
from app.models.unified_models import Account, Bank
from app.models.auth_models import Usuario
from app.dependencies.auth import get_current_user, require_page_access
from app.services.account_access import (
    filter_accounts_cadastro_mutable,
    filter_accounts_owned_or_admin,
    resolve_auth_flags,
)
from app.utils.account_import_password import set_account_import_file_password
from app.schemas.bulk_ops import BulkDeleteResponse, BulkIdsRequest

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


# Schemas Pydantic
class BankResponse(BaseModel):
    id: int
    code: str
    name: str
    full_name: str | None
    ispb: str | None
    active: bool

    class Config:
        from_attributes = True


class AccountCreate(BaseModel):
    name: str
    description: str | None = None
    account_type: str | None = None  # 'checking', 'savings', 'investment'
    bank_id: int | None = None
    agency: int | None = None
    account_number: int | None = None
    default_import_file_password: str | None = None


class AccountUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    account_type: str | None = None
    bank_id: int | None = None
    agency: int | None = None
    account_number: int | None = None
    active: bool | None = None
    default_import_file_password: str | None = None
    clear_default_import_file_password: bool = False


class AccountResponse(BaseModel):
    id: int
    user_id: int
    name: str | None
    description: str | None
    account_type: str | None
    bank_id: int | None
    bank: BankResponse | None
    agency: int | None
    account_number: int | None
    active: bool
    has_default_import_file_password: bool = False
    last_updated_at: datetime | None = None

    @field_serializer('last_updated_at')
    def serialize_last_updated_at(self, dt: datetime | None, _info):
        if dt is None:
            return None
        return dt.isoformat()

    class Config:
        from_attributes = True


class AccountValidationRequest(BaseModel):
    bank_id: int
    agency: int
    account_number: int


class AccountValidationResponse(BaseModel):
    valid: bool
    owner_name: str | None = None
    message: str | None = None


@router.get("/banks", response_model=List[BankResponse])
def listar_bancos(incluir_inativos: bool = False, db: Session = Depends(get_db)):
    """
    Lista bancos brasileiros cadastrados.

    Args:
        incluir_inativos: Se True, inclui bancos inativos na listagem
    """
    query = db.query(Bank)
    if not incluir_inativos:
        query = query.filter(Bank.active == True)
    bancos = query.order_by(Bank.name).all()
    return bancos


@router.post("/validate", response_model=AccountValidationResponse)
def validar_conta(validation_data: AccountValidationRequest, db: Session = Depends(get_db)):
    """
    Valida se uma conta existe com os dados fornecidos e retorna o nome do dono.

    IMPORTANTE: Não filtra por tenant_id para permitir parceiros de diferentes tenants.

    Args:
        validation_data: Dados da conta (bank_id, agency, account_number)

    Returns:
        AccountValidationResponse com valid=True e owner_name se encontrada
    """
    # Busca conta com os dados fornecidos (SEM filtrar por tenant_id)
    conta = db.query(Account).filter(
        Account.bank_id == validation_data.bank_id,
        Account.agency == validation_data.agency,
        Account.account_number == validation_data.account_number,
        Account.active == True
    ).first()

    if not conta:
        return AccountValidationResponse(
            valid=False,
            message="Conta não encontrada com os dados fornecidos"
        )

    # Busca o usuário dono da conta (SEM filtrar por tenant_id)
    usuario = db.query(Usuario).filter(
        Usuario.id == conta.user_id,
        Usuario.active == True
    ).first()

    if not usuario:
        return AccountValidationResponse(
            valid=False,
            message="Usuário da conta não encontrado"
        )

    # Monta o nome completo do usuário
    owner_name = f"{usuario.first_name} {usuario.last_name}".strip()
    if not owner_name:
        owner_name = usuario.email.split('@')[0]  # Fallback para email

    return AccountValidationResponse(
        valid=True,
        owner_name=owner_name,
        message="Conta validada com sucesso"
    )


@router.get("/", response_model=List[AccountResponse])
async def listar_contas(
    incluir_inativos: bool = False,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Lista contas bancárias.

    Args:
        incluir_inativos: Se True, inclui contas inativas na listagem
    """
    tenant_id, user_id, is_admin = resolve_auth_flags(current_user)

    query = db.query(Account)
    query = filter_accounts_owned_or_admin(query, tenant_id, user_id, is_admin)
    if not incluir_inativos:
        query = query.filter(Account.active == True)
    contas = query.order_by(Account.id).all()
    return contas


@router.get("/{account_id}", response_model=AccountResponse)
async def obter_conta(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Obtém uma conta específica por ID com dados do banco."""
    from sqlalchemy.orm import joinedload

    tenant_id, user_id, is_admin = resolve_auth_flags(current_user)

    query = db.query(Account).options(joinedload(Account.bank)).filter(
        Account.id == account_id,
        Account.active == True,
    )
    conta = filter_accounts_owned_or_admin(query, tenant_id, user_id, is_admin).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    return conta


@router.post("/", response_model=AccountResponse, status_code=201)
async def criar_conta(
    account_data: AccountCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_page_access("configuracoes.contas", write=True)),
):
    """Cria uma nova conta bancária."""
    tenant_id = current_user.get("tenant_id", 1)
    user_id = current_user.get("user_id", 1)

    # Verifica se já existe uma conta com o mesmo nome
    existing = db.query(Account).filter(
        Account.tenant_id == tenant_id,
        Account.user_id == user_id,
        Account.name == account_data.name,
        Account.active == True
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Já existe uma conta com este nome")

    create_fields = account_data.model_dump(
        exclude={"default_import_file_password"}
    )
    nova_conta = Account(
        tenant_id=tenant_id,
        user_id=user_id,
        created_by=user_id,
        **create_fields,
    )
    if account_data.default_import_file_password:
        set_account_import_file_password(
            nova_conta, account_data.default_import_file_password
        )
    db.add(nova_conta)
    db.commit()
    db.refresh(nova_conta)
    return nova_conta


@router.put("/{account_id}", response_model=AccountResponse)
async def atualizar_conta(
    account_id: int,
    account_data: AccountUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_page_access("configuracoes.contas", write=True)),
):
    """Atualiza uma conta existente."""
    tenant_id, user_id, is_admin = resolve_auth_flags(current_user)

    # Removido filtro Account.active == True para permitir inativar/reativar
    query = db.query(Account).filter(Account.id == account_id)
    conta = filter_accounts_cadastro_mutable(query, tenant_id, user_id, is_admin).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta não encontrada")

    update_data = account_data.model_dump(
        exclude_unset=True,
        exclude={
            "default_import_file_password",
            "clear_default_import_file_password",
        },
    )
    for field, value in update_data.items():
        setattr(conta, field, value)

    fields_set = account_data.model_fields_set
    if (
        "default_import_file_password" in fields_set
        and account_data.default_import_file_password
    ):
        set_account_import_file_password(
            conta, account_data.default_import_file_password
        )
    elif account_data.clear_default_import_file_password:
        set_account_import_file_password(conta, None)

    db.commit()
    db.refresh(conta)
    return conta


@router.post("/bulk-delete", response_model=BulkDeleteResponse)
async def bulk_deletar_contas(
    body: BulkIdsRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_page_access("configuracoes.contas", write=True)),
):
    """Exclui permanentemente várias contas bancárias do usuário."""
    if not body.ids:
        raise HTTPException(status_code=400, detail="Nenhuma conta selecionada")

    tenant_id, user_id, is_admin = resolve_auth_flags(current_user)
    unique_ids = list(dict.fromkeys(body.ids))

    query = db.query(Account).filter(Account.id.in_(unique_ids))
    contas = filter_accounts_cadastro_mutable(query, tenant_id, user_id, is_admin).all()
    found_ids = {c.id for c in contas}
    for conta in contas:
        db.delete(conta)

    db.commit()
    deleted = len(contas)
    skipped = len(unique_ids) - deleted
    return BulkDeleteResponse(deleted=deleted, skipped=skipped)


@router.delete("/{account_id}", status_code=204)
async def deletar_conta(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_page_access("configuracoes.contas", write=True)),
):
    """Deleta permanentemente uma conta bancária."""
    tenant_id, user_id, is_admin = resolve_auth_flags(current_user)

    query = db.query(Account).filter(Account.id == account_id)
    conta = filter_accounts_cadastro_mutable(query, tenant_id, user_id, is_admin).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta não encontrada")

    # Hard delete - deleta permanentemente
    db.delete(conta)
    db.commit()
    return None

