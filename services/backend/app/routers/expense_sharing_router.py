"""
Router para gerenciamento de configurações de compartilhamento de despesas.
Fornece endpoints para CRUD de expense_sharing_settings.
"""

import logging
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_
from typing import List
from decimal import Decimal
from pydantic import BaseModel, field_validator

from app.database import get_db
from app.models.unified_models import ExpenseSharingSetting, Account, Bank
from app.dependencies.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/expense-sharing", tags=["expense-sharing"])


# Schemas Pydantic
class BankInfo(BaseModel):
    id: int
    code: str
    name: str
    full_name: str | None

    class Config:
        from_attributes = True


class AccountInfo(BaseModel):
    id: int
    name: str | None
    description: str | None
    bank: BankInfo | None
    agency: int | None
    account_number: str | None

    @field_validator('account_number', mode='before')
    @classmethod
    def convert_account_number_to_str(cls, v):
        if v is not None and isinstance(v, (int, float)):
            return str(int(v))
        return v

    class Config:
        from_attributes = True


class ExpenseSharingCreate(BaseModel):
    shared_account_id: int
    my_contribution_percentage: Decimal = Decimal("50.00")
    description: str | None = None


class ExpenseSharingUpdate(BaseModel):
    my_contribution_percentage: Decimal | None = None
    description: str | None = None


class ExpenseSharingResponse(BaseModel):
    id: int
    account_id: int
    shared_account_id: int
    my_contribution_percentage: Decimal
    description: str | None
    active: bool
    shared_account: AccountInfo | None = None
    is_inverse: bool = False  # True quando visualizado pela contraparte (bidirecional)

    class Config:
        from_attributes = True


@router.get("/", response_model=List[ExpenseSharingResponse])
async def listar_compartilhamentos(
    incluir_inativos: bool = False,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Lista todas as configurações de compartilhamento da conta logada.

    Busca BIDIRECIONAL:
    - Compartilhamentos onde account_id == conta logada (diretos)
    - Compartilhamentos onde shared_account_id == conta logada (inversos)

    Para compartilhamentos inversos, os campos são ajustados para a perspectiva
    da conta logada (shared_account_id vira a outra conta, porcentagem é invertida).

    Nota: my_contribution_percentage indica:
        - 0%: Outra conta paga 100%
        - 50%: Compartilhado meio a meio
        - 100%: Eu pago 100%
    """
    account_id = current_user.get("account_id")
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Busca compartilhamentos diretos (onde sou o account_id)
    query_direto = db.query(ExpenseSharingSetting).options(
        joinedload(ExpenseSharingSetting.shared_account).joinedload(Account.bank)
    ).filter(ExpenseSharingSetting.account_id == account_id)

    if not incluir_inativos:
        query_direto = query_direto.filter(ExpenseSharingSetting.active == True)

    compartilhamentos_diretos = query_direto.order_by(ExpenseSharingSetting.id).all()

    # Busca compartilhamentos inversos (onde sou o shared_account_id)
    query_inverso = db.query(ExpenseSharingSetting).options(
        joinedload(ExpenseSharingSetting.account).joinedload(Account.bank)
    ).filter(ExpenseSharingSetting.shared_account_id == account_id)

    if not incluir_inativos:
        query_inverso = query_inverso.filter(ExpenseSharingSetting.active == True)

    compartilhamentos_inversos = query_inverso.order_by(ExpenseSharingSetting.id).all()

    # Monta lista de resultados
    resultados = []

    # Adiciona compartilhamentos diretos (como estão)
    for c in compartilhamentos_diretos:
        resultados.append(c)

    # Adiciona compartilhamentos inversos (com campos ajustados)
    for c in compartilhamentos_inversos:
        # Verifica se já não existe um compartilhamento direto com esse parceiro
        ja_existe_direto = any(
            d.shared_account_id == c.account_id for d in compartilhamentos_diretos
        )
        if ja_existe_direto:
            continue

        # Cria um objeto "virtual" com os campos invertidos
        # A porcentagem de contribuição é invertida (100 - original)
        # is_inverse=True indica que é visualizado pela contraparte (somente leitura)
        resultados.append(ExpenseSharingResponse(
            id=c.id,
            account_id=account_id,  # Agora sou eu
            shared_account_id=c.account_id,  # O dono original é meu parceiro
            my_contribution_percentage=Decimal("100.00") - c.my_contribution_percentage,
            description=c.description,
            active=c.active,
            shared_account=AccountInfo(
                id=c.account.id,
                name=c.account.name,
                description=c.account.description,
                bank=BankInfo(
                    id=c.account.bank.id,
                    code=c.account.bank.code,
                    name=c.account.bank.name,
                    full_name=c.account.bank.full_name
                ) if c.account.bank else None,
                agency=c.account.agency,
                account_number=str(c.account.account_number) if c.account.account_number else None
            ) if c.account else None,
            is_inverse=True  # Contraparte - somente visualização
        ))

    return resultados


@router.get("/my-other-accounts", response_model=List[AccountInfo])
async def listar_minhas_outras_contas(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Lista todas as outras contas do mesmo tenant (exceto a conta logada)
    que ainda NÃO têm compartilhamento configurado com a conta logada.

    Usado para popular o dropdown de "Compartilhar com" ao criar novo compartilhamento.
    Filtra contas que já têm compartilhamento em qualquer direção (bidirecional).
    """
    try:
        account_id = current_user.get("account_id")
        tenant_id = current_user.get("tenant_id")

        if not account_id or not tenant_id:
            raise HTTPException(status_code=400, detail="account_id ou tenant_id não encontrado no token")

        # Busca IDs das contas que já têm compartilhamento com a conta logada (em qualquer direção)
        contas_com_compartilhamento = db.query(ExpenseSharingSetting).filter(
            ExpenseSharingSetting.active == True,
            or_(
                ExpenseSharingSetting.account_id == account_id,
                ExpenseSharingSetting.shared_account_id == account_id
            )
        ).all()

        # Extrai os IDs das contas parceiras (a outra conta do par)
        ids_ja_compartilhados = set()
        for c in contas_com_compartilhamento:
            if c.account_id == account_id:
                ids_ja_compartilhados.add(c.shared_account_id)
            else:
                ids_ja_compartilhados.add(c.account_id)

        # Busca outras contas excluindo as que já têm compartilhamento
        outras_contas = db.query(Account).options(
            joinedload(Account.bank)
        ).filter(
            Account.tenant_id == tenant_id,
            Account.id != account_id,
            Account.active == True,
            ~Account.id.in_(ids_ja_compartilhados) if ids_ja_compartilhados else True
        ).order_by(Account.description).all()

        return outras_contas

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao listar outras contas:")
        raise HTTPException(status_code=500, detail=f"Erro ao listar outras contas: {str(e)}")


@router.post("/", response_model=ExpenseSharingResponse, status_code=201)
async def criar_compartilhamento(
    sharing_data: ExpenseSharingCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Cria uma nova configuração de compartilhamento de despesas.

    Cria APENAS 1 registro (sem duplicação).
    account_id sempre vem do JWT (conta logada).
    shared_account_id vem do formulário (conta com quem compartilha).

    my_contribution_percentage:
        - 0%: Outra conta paga 100%
        - 50%: Compartilhado meio a meio
        - 100%: Eu pago 100%
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    user_id = current_user.get("id")  # O campo é 'id', não 'user_id'

    if not account_id or not tenant_id or not user_id:
        raise HTTPException(status_code=400, detail="Dados do usuário incompletos no token")

    # Valida porcentagem
    if sharing_data.my_contribution_percentage < 0 or sharing_data.my_contribution_percentage > 100:
        raise HTTPException(status_code=400, detail="A porcentagem de contribuição deve estar entre 0 e 100")

    # Valida que não está tentando compartilhar consigo mesmo
    if account_id == sharing_data.shared_account_id:
        raise HTTPException(status_code=400, detail="Não é possível compartilhar uma conta consigo mesma")

    # Verifica se a conta compartilhada existe e pertence ao mesmo tenant
    shared_account = db.query(Account).filter(
        Account.id == sharing_data.shared_account_id,
        Account.tenant_id == tenant_id,
        Account.active == True
    ).first()
    if not shared_account:
        raise HTTPException(status_code=404, detail="Conta compartilhada não encontrada ou não pertence ao mesmo tenant")

    # Verifica se já existe compartilhamento entre essas contas (em qualquer direção)
    # O sistema é bidirecional: apenas 1 registro por par de contas
    existing = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.active == True,
        or_(
            # Direção direta: conta logada → conta parceira
            and_(
                ExpenseSharingSetting.account_id == account_id,
                ExpenseSharingSetting.shared_account_id == sharing_data.shared_account_id
            ),
            # Direção inversa: conta parceira → conta logada
            and_(
                ExpenseSharingSetting.account_id == sharing_data.shared_account_id,
                ExpenseSharingSetting.shared_account_id == account_id
            )
        )
    ).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail="Já existe uma configuração de compartilhamento entre essas contas. O sistema é bidirecional - apenas uma configuração é necessária por par de contas."
        )

    # Cria APENAS 1 registro (sem duplicação)
    novo_compartilhamento = ExpenseSharingSetting(
        tenant_id=tenant_id,
        created_by=user_id,
        account_id=account_id,  # Sempre a conta logada
        shared_account_id=sharing_data.shared_account_id,
        my_contribution_percentage=sharing_data.my_contribution_percentage,
        description=sharing_data.description
    )
    db.add(novo_compartilhamento)
    db.commit()
    db.refresh(novo_compartilhamento)

    # Carrega o relacionamento shared_account
    db.refresh(novo_compartilhamento, ['shared_account'])

    return novo_compartilhamento


@router.put("/{sharing_id}", response_model=ExpenseSharingResponse)
async def atualizar_compartilhamento(
    sharing_id: int,
    sharing_data: ExpenseSharingUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Atualiza uma configuração de compartilhamento existente.
    """
    account_id = current_user.get("account_id")

    compartilhamento = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.id == sharing_id,
        ExpenseSharingSetting.account_id == account_id
    ).first()

    if not compartilhamento:
        raise HTTPException(status_code=404, detail="Configuração de compartilhamento não encontrada")

    # Valida porcentagem se fornecida
    if sharing_data.my_contribution_percentage is not None:
        if sharing_data.my_contribution_percentage < 0 or sharing_data.my_contribution_percentage > 100:
            raise HTTPException(status_code=400, detail="A porcentagem de contribuição deve estar entre 0 e 100")

    # Atualiza apenas os campos fornecidos
    if sharing_data.my_contribution_percentage is not None:
        compartilhamento.my_contribution_percentage = sharing_data.my_contribution_percentage
    if sharing_data.description is not None:
        compartilhamento.description = sharing_data.description

    db.commit()
    db.refresh(compartilhamento)
    return compartilhamento


@router.delete("/{sharing_id}", status_code=204)
async def deletar_compartilhamento(
    sharing_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Deleta permanentemente uma configuração de compartilhamento (hard delete).
    """
    account_id = current_user.get("account_id")

    compartilhamento = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.id == sharing_id,
        ExpenseSharingSetting.account_id == account_id
    ).first()

    if not compartilhamento:
        raise HTTPException(status_code=404, detail="Configuração de compartilhamento não encontrada")

    db.delete(compartilhamento)
    db.commit()
    return None


@router.put("/{sharing_id}/inactivate", response_model=ExpenseSharingResponse)
async def inativar_compartilhamento(
    sharing_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Inativa uma configuração de compartilhamento (soft delete).
    """
    account_id = current_user.get("account_id")

    compartilhamento = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.id == sharing_id,
        ExpenseSharingSetting.account_id == account_id
    ).first()

    if not compartilhamento:
        raise HTTPException(status_code=404, detail="Configuração de compartilhamento não encontrada")

    compartilhamento.active = False
    db.commit()
    db.refresh(compartilhamento)
    return compartilhamento


@router.put("/{sharing_id}/reactivate", response_model=ExpenseSharingResponse)
async def reativar_compartilhamento(
    sharing_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Reativa uma configuração de compartilhamento.
    """
    account_id = current_user.get("account_id")

    compartilhamento = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.id == sharing_id,
        ExpenseSharingSetting.account_id == account_id
    ).first()

    if not compartilhamento:
        raise HTTPException(status_code=404, detail="Configuração de compartilhamento não encontrada")

    compartilhamento.active = True
    db.commit()
    db.refresh(compartilhamento)
    return compartilhamento


logger.info("=" * 80)
logger.info("✅ expense_sharing_router.py CARREGADO COM SUCESSO!")
logger.info("=" * 80)
