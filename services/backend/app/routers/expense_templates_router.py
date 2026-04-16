"""
Router para gerenciamento de templates de lançamentos.
Fornece endpoints para CRUD de expense_templates e expense_template_items.
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session, joinedload
from typing import List
from decimal import Decimal
from pydantic import BaseModel
from datetime import datetime, date
from app.database import get_db
from app.models.unified_models import ExpenseTemplate, ExpenseTemplateItem, Subtag, Tag, BankStatement, ExpenseSharingSetting, Account
from app.dependencies.auth import get_current_user

router = APIRouter(prefix="/api/expense-templates", tags=["expense-templates"])


# ==================== SCHEMAS ====================

class SubtagInfo(BaseModel):
    """Informações básicas de uma subtag"""
    id: int
    name: str
    type: str  # 'receita' ou 'despesa'
    icon: str | None
    tag_id: int
    tag_name: str | None = None

    class Config:
        from_attributes = True


class BankInfo(BaseModel):
    """Informações básicas de um banco"""
    id: int
    code: str
    name: str
    full_name: str | None = None

    class Config:
        from_attributes = True


class AccountInfo(BaseModel):
    """Informações básicas de uma conta"""
    id: int
    name: str | None = None
    description: str | None = None
    bank: BankInfo | None = None
    agency: str | None = None
    account_number: str | None = None

    class Config:
        from_attributes = True


class ExpenseSharingInfo(BaseModel):
    """Informações básicas de compartilhamento"""
    id: int
    shared_account_id: int
    my_contribution_percentage: Decimal
    description: str | None
    shared_account: AccountInfo | None = None

    class Config:
        from_attributes = True


class ExpenseTemplateItemCreate(BaseModel):
    """Schema para criação de item de template"""
    description: str
    amount: Decimal | None = None
    day_of_month: int | None = None
    subtag_id: int | None = None
    ownership_percentage: Decimal = Decimal("100.00")
    expense_sharing_id: int | None = None
    display_order: int = 0


class ExpenseTemplateItemUpdate(BaseModel):
    """Schema para atualização de item de template"""
    description: str | None = None
    amount: Decimal | None = None
    day_of_month: int | None = None
    subtag_id: int | None = None
    ownership_percentage: Decimal | None = None
    expense_sharing_id: int | None = None
    display_order: int | None = None


class ExpenseTemplateItemResponse(BaseModel):
    """Schema de resposta para item de template"""
    id: int
    expense_template_id: int
    description: str
    amount: Decimal | None
    day_of_month: int | None
    subtag_id: int | None
    subtag: SubtagInfo | None = None
    ownership_percentage: Decimal
    expense_sharing_id: int | None
    expense_sharing: ExpenseSharingInfo | None = None
    display_order: int
    account_id: int
    created_at: datetime
    last_updated_at: datetime

    class Config:
        from_attributes = True


class ExpenseTemplateCreate(BaseModel):
    """Schema para criação de template"""
    name: str
    description: str | None = None
    icon: str = "FileText"
    items: List[ExpenseTemplateItemCreate] = []


class ExpenseTemplateUpdate(BaseModel):
    """Schema para atualização de template"""
    name: str | None = None
    description: str | None = None
    icon: str | None = None
    active: bool | None = None


class ExpenseTemplateResponse(BaseModel):
    """Schema de resposta para template"""
    id: int
    name: str
    description: str | None
    icon: str
    account_id: int
    active: bool
    items: List[ExpenseTemplateItemResponse] = []
    created_at: datetime
    last_updated_at: datetime

    class Config:
        from_attributes = True


class ApplyTemplateRequest(BaseModel):
    """Schema para aplicar template (criar bank_statements)"""
    items: List[dict]  # Lista de itens editados pelo usuário


class ApplyTemplateResponse(BaseModel):
    """Schema de resposta ao aplicar template"""
    created_count: int
    bank_statements: List[int]  # IDs dos bank_statements criados


# ==================== ENDPOINTS ====================

@router.get("/", response_model=List[ExpenseTemplateResponse])
async def listar_templates(
    incluir_inativos: bool = False,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Lista todos os templates de lançamentos da conta logada.
    """
    account_id = current_user.get("account_id")
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    query = db.query(ExpenseTemplate).options(
        joinedload(ExpenseTemplate.items).joinedload(ExpenseTemplateItem.subtag).joinedload(Subtag.tag),
        joinedload(ExpenseTemplate.items).joinedload(ExpenseTemplateItem.expense_sharing).joinedload(ExpenseSharingSetting.shared_account).joinedload(Account.bank)
    ).filter(ExpenseTemplate.account_id == account_id)

    if not incluir_inativos:
        query = query.filter(ExpenseTemplate.active == True)

    templates = query.order_by(ExpenseTemplate.name).all()

    # Enriquecer dados das subtags
    result = []
    for template in templates:
        template_dict = ExpenseTemplateResponse.model_validate(template).model_dump()

        # Enriquecer cada item com informações da subtag e tag
        for i, item in enumerate(template.items):
            if item.subtag:
                template_dict['items'][i]['subtag'] = SubtagInfo(
                    id=item.subtag.id,
                    name=item.subtag.name,
                    type=item.subtag.type,
                    icon=item.subtag.icon,
                    tag_id=item.subtag.tag_id,
                    tag_name=item.subtag.tag.name if item.subtag.tag else None
                )

        result.append(template_dict)

    return result


@router.get("/{template_id}", response_model=ExpenseTemplateResponse)
async def obter_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Obtém um template específico com todos os seus itens.
    """
    account_id = current_user.get("account_id")
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    template = db.query(ExpenseTemplate).options(
        joinedload(ExpenseTemplate.items).joinedload(ExpenseTemplateItem.subtag).joinedload(Subtag.tag),
        joinedload(ExpenseTemplate.items).joinedload(ExpenseTemplateItem.expense_sharing).joinedload(ExpenseSharingSetting.shared_account).joinedload(Account.bank)
    ).filter(
        ExpenseTemplate.id == template_id,
        ExpenseTemplate.account_id == account_id
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template não encontrado")

    # Enriquecer dados
    template_dict = ExpenseTemplateResponse.model_validate(template).model_dump()

    for i, item in enumerate(template.items):
        if item.subtag:
            template_dict['items'][i]['subtag'] = SubtagInfo(
                id=item.subtag.id,
                name=item.subtag.name,
                type=item.subtag.type,
                icon=item.subtag.icon,
                tag_id=item.subtag.tag_id,
                tag_name=item.subtag.tag.name if item.subtag.tag else None
            )

    return template_dict


@router.post("/", response_model=ExpenseTemplateResponse, status_code=201)
async def criar_template(
    template_data: ExpenseTemplateCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Cria um novo template de lançamentos com seus itens.
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    user_id = current_user.get("id")  # O auth service retorna 'id', não 'user_id'

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Verificar se já existe template com mesmo nome
    existing = db.query(ExpenseTemplate).filter(
        ExpenseTemplate.account_id == account_id,
        ExpenseTemplate.name == template_data.name,
        ExpenseTemplate.active == True
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Já existe um template com este nome")

    # Criar template
    novo_template = ExpenseTemplate(
        tenant_id=tenant_id,
        created_by=user_id,
        account_id=account_id,
        name=template_data.name,
        description=template_data.description,
        icon=template_data.icon
    )

    db.add(novo_template)
    db.flush()  # Para obter o ID do template

    # Criar itens
    for item_data in template_data.items:
        # Verificar se subtag existe (apenas se foi fornecida)
        if item_data.subtag_id is not None:
            subtag = db.query(Subtag).filter(
                Subtag.id == item_data.subtag_id,
                Subtag.account_id == account_id
            ).first()

            if not subtag:
                raise HTTPException(status_code=404, detail=f"Subtag {item_data.subtag_id} não encontrada")

        novo_item = ExpenseTemplateItem(
            tenant_id=tenant_id,
            created_by=user_id,
            account_id=account_id,
            expense_template_id=novo_template.id,
            **item_data.model_dump()
        )
        db.add(novo_item)

    db.commit()
    db.refresh(novo_template)

    # Retornar com dados enriquecidos
    return await obter_template(novo_template.id, db, current_user)


@router.put("/{template_id}", response_model=ExpenseTemplateResponse)
async def atualizar_template(
    template_id: int,
    template_data: ExpenseTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Atualiza um template existente (apenas campos do cabeçalho).
    Para gerenciar itens, use os endpoints específicos de itens.
    """
    account_id = current_user.get("account_id")
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    template = db.query(ExpenseTemplate).filter(
        ExpenseTemplate.id == template_id,
        ExpenseTemplate.account_id == account_id
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template não encontrado")

    # Atualizar campos
    if template_data.name is not None:
        # Verificar duplicação de nome
        existing = db.query(ExpenseTemplate).filter(
            ExpenseTemplate.account_id == account_id,
            ExpenseTemplate.name == template_data.name,
            ExpenseTemplate.id != template_id,
            ExpenseTemplate.active == True
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Já existe um template com este nome")
        template.name = template_data.name

    if template_data.description is not None:
        template.description = template_data.description
    if template_data.icon is not None:
        template.icon = template_data.icon
    if template_data.active is not None:
        template.active = template_data.active

    db.commit()
    db.refresh(template)

    return await obter_template(template_id, db, current_user)


@router.delete("/{template_id}", status_code=204)
async def deletar_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Deleta (soft delete) um template.
    Os itens são deletados em cascata.
    """
    account_id = current_user.get("account_id")
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    template = db.query(ExpenseTemplate).filter(
        ExpenseTemplate.id == template_id,
        ExpenseTemplate.account_id == account_id
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template não encontrado")

    # Soft delete
    template.active = False
    db.commit()

    return None


@router.post("/{template_id}/apply", response_model=ApplyTemplateResponse)
async def aplicar_template(
    template_id: int,
    request: ApplyTemplateRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Aplica um template criando bank_statements.

    O frontend envia os itens editados pelo usuário (com datas completas, valores ajustados, etc).
    Cada item é convertido em um BankStatement.
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    user_id = current_user.get("id")  # O auth service retorna 'id', não 'user_id'

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Verificar se template existe
    template = db.query(ExpenseTemplate).filter(
        ExpenseTemplate.id == template_id,
        ExpenseTemplate.account_id == account_id,
        ExpenseTemplate.active == True
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template não encontrado")

    created_ids = []

    # Criar bank_statements a partir dos itens editados
    for item_dict in request.items:
        # Validar campos obrigatórios (subtag_id é opcional)
        if 'date' not in item_dict or 'description' not in item_dict or 'amount' not in item_dict:
            raise HTTPException(status_code=400, detail="Campos obrigatórios: date, description, amount")

        # Converter data se necessário
        item_date = item_dict['date']
        if isinstance(item_date, str):
            item_date = datetime.fromisoformat(item_date.replace('Z', '+00:00'))

        # Criar bank_statement (subtag_id é opcional)
        novo_statement = BankStatement(
            tenant_id=tenant_id,
            created_by=user_id,
            account_id=account_id,
            date=item_date,
            description=item_dict['description'],
            amount=Decimal(str(item_dict['amount'])),
            subtag_id=item_dict.get('subtag_id'),  # Opcional - pode ser None
            ownership_percentage=Decimal(str(item_dict.get('ownership_percentage', 100.00))),
            expense_sharing_id=item_dict.get('expense_sharing_id'),
            adjustment_notes=item_dict.get('adjustment_notes')
        )

        db.add(novo_statement)
        db.flush()
        created_ids.append(novo_statement.id)

    db.commit()

    return ApplyTemplateResponse(
        created_count=len(created_ids),
        bank_statements=created_ids
    )


# ==================== ENDPOINTS DE ITENS ====================

@router.post("/{template_id}/items", response_model=ExpenseTemplateItemResponse, status_code=201)
async def adicionar_item(
    template_id: int,
    item_data: ExpenseTemplateItemCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Adiciona um novo item a um template existente.
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    user_id = current_user.get("id")  # O auth service retorna 'id', não 'user_id'

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Verificar se template existe
    template = db.query(ExpenseTemplate).filter(
        ExpenseTemplate.id == template_id,
        ExpenseTemplate.account_id == account_id,
        ExpenseTemplate.active == True
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Template não encontrado")

    # Verificar se subtag existe (apenas se foi fornecida)
    if item_data.subtag_id is not None:
        subtag = db.query(Subtag).filter(
            Subtag.id == item_data.subtag_id,
            Subtag.account_id == account_id
        ).first()

        if not subtag:
            raise HTTPException(status_code=404, detail="Subtag não encontrada")

    # Criar item
    novo_item = ExpenseTemplateItem(
        tenant_id=tenant_id,
        created_by=user_id,
        account_id=account_id,
        expense_template_id=template_id,
        **item_data.model_dump()
    )

    db.add(novo_item)
    db.commit()
    db.refresh(novo_item)

    # Carregar relacionamentos
    db.refresh(novo_item, ['subtag', 'expense_sharing'])
    if novo_item.subtag:
        db.refresh(novo_item.subtag, ['tag'])

    return novo_item


@router.put("/{template_id}/items/{item_id}", response_model=ExpenseTemplateItemResponse)
async def atualizar_item(
    template_id: int,
    item_id: int,
    item_data: ExpenseTemplateItemUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Atualiza um item existente de um template.
    """
    account_id = current_user.get("account_id")
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Verificar se item existe e pertence ao template
    item = db.query(ExpenseTemplateItem).filter(
        ExpenseTemplateItem.id == item_id,
        ExpenseTemplateItem.expense_template_id == template_id,
        ExpenseTemplateItem.account_id == account_id
    ).first()

    if not item:
        raise HTTPException(status_code=404, detail="Item não encontrado")

    # Atualizar campos
    if item_data.description is not None:
        item.description = item_data.description
    if item_data.amount is not None:
        item.amount = item_data.amount
    if item_data.day_of_month is not None:
        item.day_of_month = item_data.day_of_month
    if item_data.subtag_id is not None:
        # Verificar se subtag existe
        subtag = db.query(Subtag).filter(
            Subtag.id == item_data.subtag_id,
            Subtag.account_id == account_id
        ).first()
        if not subtag:
            raise HTTPException(status_code=404, detail="Subtag não encontrada")
        item.subtag_id = item_data.subtag_id
    if item_data.ownership_percentage is not None:
        item.ownership_percentage = item_data.ownership_percentage
    if item_data.expense_sharing_id is not None:
        item.expense_sharing_id = item_data.expense_sharing_id
    if item_data.display_order is not None:
        item.display_order = item_data.display_order

    db.commit()
    db.refresh(item)

    # Carregar relacionamentos
    db.refresh(item, ['subtag', 'expense_sharing'])
    if item.subtag:
        db.refresh(item.subtag, ['tag'])

    return item


@router.delete("/{template_id}/items/{item_id}", status_code=204)
async def deletar_item(
    template_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Deleta (hard delete) um item de um template.
    """
    account_id = current_user.get("account_id")
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Verificar se item existe e pertence ao template
    item = db.query(ExpenseTemplateItem).filter(
        ExpenseTemplateItem.id == item_id,
        ExpenseTemplateItem.expense_template_id == template_id,
        ExpenseTemplateItem.account_id == account_id
    ).first()

    if not item:
        raise HTTPException(status_code=404, detail="Item não encontrado")

    # Hard delete
    db.delete(item)
    db.commit()

    return None

