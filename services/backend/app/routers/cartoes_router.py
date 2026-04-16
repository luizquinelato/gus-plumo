"""
Router para gerenciamento de cartões de crédito.
Fornece endpoints para CRUD de cartões.
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session, joinedload
from typing import List
from pydantic import BaseModel, Field
from app.database import get_db
from app.models.unified_models import Cartao
from app.dependencies.auth import get_current_user

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
    closing_day: int = Field(default=14, ge=1, le=30)


class CartaoUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    number: str | None = None
    type: str | None = None
    account_id: int | None = None
    expense_sharing_id: int | None = None
    active: bool | None = None
    closing_day: int | None = Field(default=None, ge=1, le=30)
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
    expense_sharing: ExpenseSharingInfo | None = None
    active: bool
    closing_day: int

    class Config:
        from_attributes = True


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
        joinedload(Cartao.expense_sharing).joinedload(ExpenseSharingSetting.shared_account).joinedload(Account.bank)
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
        cartao_dict = {
            "id": cartao.id,
            "name": cartao.name,
            "description": cartao.description,
            "number": cartao.number,
            "type": cartao.type,
            "account_id": cartao.account_id,
            "account_name": None,
            "ownership_type": cartao.ownership_type,
            "expense_sharing_id": cartao.expense_sharing_id,
            "expense_sharing": None,
            "active": cartao.active,
            "closing_day": cartao.closing_day
        }

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
                cartao_dict["expense_sharing"] = {
                    "id": cartao.expense_sharing.id,
                    "account_id": cartao.expense_sharing.account_id,
                    "shared_account_id": cartao.expense_sharing.shared_account_id,
                    "my_contribution_percentage": float(cartao.expense_sharing.my_contribution_percentage) if cartao.expense_sharing.my_contribution_percentage else 0.0,
                    "description": cartao.expense_sharing.description,
                    "active": cartao.expense_sharing.active,
                    "shared_account": None
                }

                # Incluir dados da shared_account se disponível
                if cartao.expense_sharing.shared_account:
                    shared_acc = cartao.expense_sharing.shared_account
                    cartao_dict["expense_sharing"]["shared_account"] = {
                        "id": shared_acc.id,
                        "name": shared_acc.name,
                        "description": shared_acc.description,
                        "bank": None,
                        "agency": shared_acc.agency,
                        "account_number": shared_acc.account_number
                    }

                    # Incluir dados do banco se disponível
                    if shared_acc.bank:
                        cartao_dict["expense_sharing"]["shared_account"]["bank"] = {
                            "id": shared_acc.bank.id,
                            "code": shared_acc.bank.code,
                            "name": shared_acc.bank.name
                        }
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
                        "account_id": c.account_id
                    }
                    for c in cartoes
                ]
            })

    return resultado


@router.get("/{cartao_id}", response_model=CartaoResponse)
async def obter_cartao(
    cartao_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Obtém um cartão específico por ID."""
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    query = db.query(Cartao).filter(
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
    return cartao


@router.post("/", response_model=CartaoResponse, status_code=201)
async def criar_cartao(
    cartao_data: CartaoCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Cria um novo cartão."""
    tenant_id = current_user.get("tenant_id", 1)

    # Validações
    if cartao_data.type not in ['credito', 'beneficios']:
        raise HTTPException(status_code=400, detail="type deve ser 'credito' ou 'beneficios'")

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
            # Reativa o cartão se estava inativo
            cartao_existente.active = True
            db.commit()
            db.refresh(cartao_existente)
            return cartao_existente

    # Cria novo cartão
    user_id = current_user.get("user_id", 1)
    novo_cartao = Cartao(
        tenant_id=tenant_id,
        created_by=user_id,
        **cartao_data.model_dump()
    )
    db.add(novo_cartao)
    db.commit()
    db.refresh(novo_cartao)
    return novo_cartao


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

    if 'type' in update_data:
        if update_data['type'] not in ['credito', 'beneficios']:
            raise HTTPException(status_code=400, detail="type deve ser 'credito' ou 'beneficios'")

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

    # Se update_existing_records=True e expense_sharing_id mudou, atualiza registros existentes
    if update_existing_records and 'expense_sharing_id' in update_data:
        new_expense_sharing_id = update_data['expense_sharing_id']

        # Busca os dados do novo compartilhamento (se houver)
        if new_expense_sharing_id:
            expense_sharing = db.query(ExpenseSharingSetting).filter(
                ExpenseSharingSetting.id == new_expense_sharing_id,
                ExpenseSharingSetting.tenant_id == tenant_id
            ).first()

            if not expense_sharing:
                raise HTTPException(status_code=404, detail="Compartilhamento não encontrado")

            # Calcula as porcentagens
            my_percentage = expense_sharing.my_contribution_percentage
            partner_percentage = 100 - my_percentage

            # Atualiza credit_card_invoices
            db.query(CreditCardInvoice).filter(
                CreditCardInvoice.credit_card_id == cartao_id,
                CreditCardInvoice.tenant_id == tenant_id
            ).update({
                'expense_sharing_id': new_expense_sharing_id,
                'ownership_percentage': my_percentage
            }, synchronize_session=False)

            # Atualiza benefit_card_statements
            db.query(BenefitCardStatement).filter(
                BenefitCardStatement.credit_card_id == cartao_id,
                BenefitCardStatement.tenant_id == tenant_id
            ).update({
                'expense_sharing_id': new_expense_sharing_id,
                'ownership_percentage': my_percentage
            }, synchronize_session=False)
        else:
            # Se expense_sharing_id for None, remove o compartilhamento dos registros
            db.query(CreditCardInvoice).filter(
                CreditCardInvoice.credit_card_id == cartao_id,
                CreditCardInvoice.tenant_id == tenant_id
            ).update({
                'expense_sharing_id': None,
                'ownership_percentage': 100.0
            }, synchronize_session=False)

            db.query(BenefitCardStatement).filter(
                BenefitCardStatement.credit_card_id == cartao_id,
                BenefitCardStatement.tenant_id == tenant_id
            ).update({
                'expense_sharing_id': None,
                'ownership_percentage': 100.0
            }, synchronize_session=False)

    # Atualiza apenas os campos fornecidos no cartão
    for field, value in update_data.items():
        setattr(cartao, field, value)

    db.commit()
    db.refresh(cartao)
    return cartao


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
    return cartao

