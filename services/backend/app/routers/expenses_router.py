"""
Router para gerenciamento de despesas e mapeamentos
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, func
from typing import Any, List, Literal
from pydantic import BaseModel, field_validator, Field
from decimal import Decimal
import logging

from app.database import get_db
from app.models.unified_models import Tag, Subtag, TransactionMapping, BankStatement, CreditCardInvoice, BenefitCardStatement, Cartao, ExpenseSharingSetting, Account, Bank
from app.models.auth_models import ConfiguracaoSistema, Usuario
from app.dependencies.auth import get_current_user, require_account
from app.utils.card_helper import CardHelper
from app.utils.sharing_percentage import resolve_ownership_percentage
from app.services.account_period_closure_service import (
    AccountPeriodClosedError,
    ensure_period_open,
)
from app.services.mapping_remap_service import (
    apply_mapping_remap,
    ensure_account_has_remap_transaction_data,
    sort_mappings_for_remap,
)
from app.services.closed_period_edit_service import (
    after_bank_statement_updated,
    _account_id_for_benefit,
    after_benefit_subtag_updated,
    after_credit_card_updated,
    ensure_bank_update_allowed,
    _account_id_for_card_invoice,
    ensure_credit_card_update_allowed,
    ensure_mapping_remap_allowed,
    finalize_mapping_remap_closures,
    merge_closure_impacts,
    post_batch_update_closure_sync,
    after_expense_split,
    after_new_transaction_in_closed_period,
    ensure_new_transaction_in_closed_period_allowed,
    ensure_closed_period_change_allowed,
    ensure_batch_update_closure_allowed,
    closure_impact_confirmation_prompt,
)
from app.services.import_batch import ImportBatch, ImportBatchPayload
from app.services.visual_extrato_import_service import (
    apply_visual_extrato_import,
    preview_visual_extrato_import,
)
from app.services.visual_fatura_import_service import (
    apply_visual_fatura_import,
    preview_visual_fatura_import,
)
from app.services.visual_mapping_import_service import (
    apply_visual_mapping_import,
    preview_visual_mapping_import,
)
from app.schemas.bulk_ops import BulkDeleteResponse, BulkDeleteTagsRequest, BulkIdsRequest
import json
import re
from datetime import datetime
import hashlib

# Logger para este módulo
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/expenses", tags=["expenses"])


def _mapping_apply_percentage(db: Session, mapping: TransactionMapping, is_receita: bool) -> Decimal:
    sharing = None
    if mapping.expense_sharing_id:
        sharing = db.query(ExpenseSharingSetting).filter(ExpenseSharingSetting.id == mapping.expense_sharing_id).first()
    return resolve_ownership_percentage(
        kind='revenue' if is_receita else 'expense',
        mapping=mapping,
        sharing=sharing,
    )


def _guard_closed_account_period(db: Session, tenant_id: int, account_id: int | None, *dates) -> None:
    if account_id is None:
        return
    try:
        ensure_period_open(db, tenant_id, account_id, *dates)
    except AccountPeriodClosedError as exc:
        raise HTTPException(status_code=409, detail=exc.message) from exc


# Schemas
class TagResponse(BaseModel):
    id: int
    name: str
    description: str | None
    icon: str | None

    class Config:
        from_attributes = True


class SubtagResponse(BaseModel):
    id: int
    tag_id: int
    name: str
    description: str | None
    type: str  # 'receita' ou 'despesa'
    icon: str | None
    tag_name: str | None = None

    class Config:
        from_attributes = True


class TransactionMappingResponse(BaseModel):
    id: int
    original_description: str | None = None  # Pode ser None para pattern/regex
    mapped_description: str | None
    subtag_id: int
    subtag_name: str | None = None
    subtag_icon: str | None = None  # ← ADICIONADO
    subtag_type: str | None = None  # 'receita' ou 'despesa'
    tag_name: str | None = None
    tag_icon: str | None = None  # ← ADICIONADO
    shared_partner_id: int | None = Field(None, serialization_alias='shared_partner_id')
    shared_partner_name: str | None = Field(None, serialization_alias='shared_partner_name')
    shared_partner_bank: str | None = Field(None, serialization_alias='shared_partner_bank')
    shared_partner_agency: str | None = Field(None, serialization_alias='shared_partner_agency')
    shared_partner_account_number: str | None = Field(None, serialization_alias='shared_partner_account_number')
    my_contribution_percentage: float | None = None
    revenue_contribution_percentage: float | None = None
    mapping_type: str = 'exact'  # 'exact', 'pattern', 'regex'
    pattern: str | None = None
    regex_pattern: str | None = None
    priority: int = 0
    is_sensitive: bool = False
    created_at: str | None = None
    last_updated_at: str | None = None
    closure_impact: dict | None = None

    class Config:
        from_attributes = True
        populate_by_name = True  # Permite usar tanto o nome original quanto o alias


class TransactionMappingCreate(BaseModel):
    original_description: str | None = None  # Required apenas para mapping_type='exact'
    mapped_description: str | None = None
    subtag_id: int
    expense_sharing_id: int | None = None
    my_contribution_percentage: float | None = None
    revenue_contribution_percentage: float | None = None
    mapping_type: str = 'exact'  # 'exact', 'pattern', 'regex'
    pattern: str | None = None
    regex_pattern: str | None = None
    priority: int = 1  # 0=Alta, 1=Média, 2=Baixa (definido automaticamente pelo mapping_type)
    is_sensitive: bool = False
    apply_to_existing: bool = False  # Se True, aplica o mapeamento a registros existentes
    overwrite_sharing: bool = False  # Só com apply_to_existing: altera compartilhamento nas transações
    confirm_closed_closure_impact: bool = False

    @field_validator('my_contribution_percentage')
    @classmethod
    def validate_percentage(cls, v):
        if v is not None and (v < 0 or v > 100):
            raise ValueError('Percentual deve estar entre 0 e 100')
        return v

    @field_validator('revenue_contribution_percentage')
    @classmethod
    def validate_revenue_percentage(cls, v):
        if v is not None and (v < 0 or v > 100):
            raise ValueError('Percentual de receita deve estar entre 0 e 100')
        return v

    @field_validator('priority')
    @classmethod
    def validate_priority(cls, v):
        if v < 0 or v > 2:
            raise ValueError('Prioridade deve estar entre 0 (Alta) e 2 (Baixa)')
        return v


class TransactionMappingUpdate(BaseModel):
    original_description: str | None = None
    mapped_description: str | None = None
    subtag_id: int | None = None
    expense_sharing_id: int | None = None
    my_contribution_percentage: float | None = None
    revenue_contribution_percentage: float | None = None
    mapping_type: str | None = None
    pattern: str | None = None
    regex_pattern: str | None = None
    priority: int | None = None  # 0=Alta, 1=Média, 2=Baixa
    is_sensitive: bool | None = None
    apply_to_existing: bool = False  # Se True, aplica o mapeamento a registros existentes
    overwrite_sharing: bool = False  # Só com apply_to_existing: altera compartilhamento nas transações
    confirm_closed_closure_impact: bool = False

    @field_validator('my_contribution_percentage')
    @classmethod
    def validate_percentage(cls, v):
        if v is not None and (v < 0 or v > 100):
            raise ValueError('Percentual deve estar entre 0 e 100')
        return v

    @field_validator('revenue_contribution_percentage')
    @classmethod
    def validate_revenue_percentage(cls, v):
        if v is not None and (v < 0 or v > 100):
            raise ValueError('Percentual de receita deve estar entre 0 e 100')
        return v

    @field_validator('priority')
    @classmethod
    def validate_priority(cls, v):
        if v is not None and (v < 0 or v > 2):
            raise ValueError('Prioridade deve estar entre 0 (Alta) e 2 (Baixa)')
        return v


def _closure_impact_http_detail(exc: AccountPeriodClosedError):
    detail: dict | str = exc.message
    if exc.payload:
        detail = {"message": exc.message, **exc.payload}
    return detail


class RemapOptionsRequest(BaseModel):
    """Opções para controlar o que aplicar no remapeamento / apply_to_existing."""
    skip_subtag_if_null: bool = False  # Não usado atualmente (subtag é obrigatória)
    skip_sharing_if_null: bool = True  # Legado; preferir overwrite_sharing
    overwrite_sharing: bool = False  # True = aplicar compartilhamento do mapeamento (null limpa)
    confirm_closed_closure_impact: bool = False


def _ensure_mappings_remap_closure_allowed(
    db: Session,
    tenant_id: int,
    account_id: int,
    mappings: list[TransactionMapping],
    options: RemapOptionsRequest,
) -> None:
    """Uma passada de preview de fechamento antes de remapear vários mapeamentos."""
    if options.confirm_closed_closure_impact or not mappings:
        return
    merged: dict | None = None
    blocked = False
    for mapping in mappings:
        try:
            ensure_mapping_remap_allowed(
                db,
                tenant_id,
                account_id,
                mapping,
                overwrite_sharing=options.overwrite_sharing,
                confirm_closed_closure_impact=False,
                records_updated_estimate=0,
            )
        except AccountPeriodClosedError as exc:
            blocked = True
            if exc.payload:
                merged = merge_closure_impacts(merged, exc.payload)
    if not blocked:
        return
    if not merged or merged.get("impact_type") == "none" or not merged.get("year_months"):
        merged = closure_impact_confirmation_prompt(
            "split_recalc" if options.overwrite_sharing else "classification",
            message="Remapeamento afetará meses fechados. Confirme para continuar.",
        )
    raise AccountPeriodClosedError(
        merged.get("message", "Confirme o impacto nos fechamentos."),
        merged,
    )


def _apply_mapping_remap_with_closure(
    db: Session,
    tenant_id: int,
    account_id: int,
    mapping: TransactionMapping,
    options: RemapOptionsRequest,
    *,
    verify_transaction_data: bool = True,
    verify_closure_precheck: bool = True,
) -> tuple[int, int, int, dict | None]:
    if verify_transaction_data:
        ensure_account_has_remap_transaction_data(db, tenant_id, account_id)
    if verify_closure_precheck:
        try:
            ensure_mapping_remap_allowed(
                db,
                tenant_id,
                account_id,
                mapping,
                overwrite_sharing=options.overwrite_sharing,
                confirm_closed_closure_impact=options.confirm_closed_closure_impact,
                records_updated_estimate=0,
            )
        except AccountPeriodClosedError as exc:
            raise HTTPException(status_code=409, detail=_closure_impact_http_detail(exc)) from exc

    updated_bank, updated_cc, updated_benefit = apply_mapping_remap(
        db, tenant_id, account_id, mapping, options, _mapping_apply_percentage
    )
    total = updated_bank + updated_cc + updated_benefit
    impact = finalize_mapping_remap_closures(
        db,
        tenant_id,
        account_id,
        mapping,
        overwrite_sharing=options.overwrite_sharing,
        records_updated=total,
    )
    if impact.get("impact_type") == "none":
        impact = None
    return updated_bank, updated_cc, updated_benefit, impact


class TagCreate(BaseModel):
    name: str
    description: str | None = None
    icon: str | None = 'Tag'


class TagUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    icon: str | None = None


class SubtagCreate(BaseModel):
    tag_id: int
    name: str
    description: str | None = None
    type: str  # 'receita' ou 'despesa'
    icon: str | None = 'Tags'


class SubtagUpdate(BaseModel):
    tag_id: int | None = None
    name: str | None = None
    description: str | None = None
    type: str | None = None  # 'receita' ou 'despesa'
    icon: str | None = None


@router.get("/available-icons")
async def get_available_icons(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Retorna a lista de ícones disponíveis do lucide-react (sem duplicatas)."""
    tenant_id = current_user.get("tenant_id", 1)

    setting = db.query(ConfiguracaoSistema).filter(
        ConfiguracaoSistema.tenant_id == tenant_id,
        ConfiguracaoSistema.setting_key == "available_icons",
        ConfiguracaoSistema.active == True
    ).first()

    if not setting:
        return []

    try:
        icons = json.loads(setting.setting_value)
        # Remove duplicatas mantendo a ordem (usando dict.fromkeys)
        unique_icons = list(dict.fromkeys(icons))
        return unique_icons
    except:
        return []


@router.get("/icon-names-pt")
async def get_icon_names_pt(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Retorna o mapeamento de ícones para nomes em português."""
    tenant_id = current_user.get("tenant_id", 1)

    setting = db.query(ConfiguracaoSistema).filter(
        ConfiguracaoSistema.tenant_id == tenant_id,
        ConfiguracaoSistema.setting_key == "icon_names_pt",
        ConfiguracaoSistema.active == True
    ).first()

    if not setting:
        return {}

    try:
        icon_names = json.loads(setting.setting_value)
        return icon_names
    except:
        return {}


@router.get("/tags", response_model=List[TagResponse])
async def list_tags(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Lista todas as tags ativas da conta."""
    account_id = current_user.get("account_id")

    tags = db.query(Tag).filter(
        Tag.account_id == account_id
    ).order_by(Tag.name).all()

    return tags


@router.get("/subtags", response_model=List[SubtagResponse])
async def list_subtags(
    tag_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Lista todas as subtags ativas da conta, opcionalmente filtradas por tag."""
    account_id = current_user.get("account_id")

    query = db.query(Subtag).filter(
        Subtag.account_id == account_id
    )

    if tag_id:
        query = query.filter(Subtag.tag_id == tag_id)

    subtags = query.order_by(Subtag.name).all()

    # Adicionar nome da tag
    result = []
    for subtag in subtags:
        tag = db.query(Tag).filter(Tag.id == subtag.tag_id).first()
        result.append(SubtagResponse(
            id=subtag.id,
            tag_id=subtag.tag_id,
            name=subtag.name,
            description=subtag.description,
            type=subtag.type,  # ← Tipo está na subtag
            icon=subtag.icon,
            tag_name=tag.name if tag else None
        ))

    return result


def _transaction_mapping_to_response(db: Session, mapping: TransactionMapping) -> TransactionMappingResponse:
    subtag = db.query(Subtag).filter(Subtag.id == mapping.subtag_id).first()
    tag = db.query(Tag).filter(Tag.id == subtag.tag_id).first() if subtag else None

    expense_sharing = None
    if mapping.expense_sharing_id:
        expense_sharing = db.query(ExpenseSharingSetting).filter(
            ExpenseSharingSetting.id == mapping.expense_sharing_id
        ).first()

    from app.utils.sensitive_mapping import MASK

    original_desc = mapping.original_description
    mapped_desc = mapping.mapped_description
    pattern = mapping.pattern
    regex_pattern = mapping.regex_pattern
    if mapping.is_sensitive:
        if original_desc:
            original_desc = MASK
        if mapped_desc:
            mapped_desc = MASK
        if pattern:
            pattern = MASK
        if regex_pattern:
            regex_pattern = MASK

    return TransactionMappingResponse(
        id=mapping.id,
        original_description=original_desc,
        mapped_description=mapped_desc,
        subtag_id=mapping.subtag_id,
        subtag_name=subtag.name if subtag else None,
        subtag_icon=subtag.icon if subtag else None,
        subtag_type=subtag.type if subtag else None,
        tag_name=tag.name if tag else None,
        tag_icon=tag.icon if tag else None,
        shared_partner_id=mapping.expense_sharing_id,
        shared_partner_name=expense_sharing.shared_account.name if expense_sharing and expense_sharing.shared_account else None,
        shared_partner_bank=expense_sharing.shared_account.bank.name if expense_sharing and expense_sharing.shared_account and expense_sharing.shared_account.bank else None,
        shared_partner_agency=str(expense_sharing.shared_account.agency) if expense_sharing and expense_sharing.shared_account and expense_sharing.shared_account.agency else None,
        shared_partner_account_number=str(expense_sharing.shared_account.account_number) if expense_sharing and expense_sharing.shared_account and expense_sharing.shared_account.account_number else None,
        my_contribution_percentage=float(mapping.my_contribution_percentage) if mapping.my_contribution_percentage is not None else None,
        revenue_contribution_percentage=float(mapping.revenue_contribution_percentage) if mapping.revenue_contribution_percentage is not None else None,
        mapping_type=mapping.mapping_type,
        pattern=pattern,
        regex_pattern=regex_pattern,
        priority=mapping.priority,
        is_sensitive=mapping.is_sensitive,
        created_at=mapping.created_at.isoformat() if mapping.created_at else None,
        last_updated_at=mapping.last_updated_at.isoformat() if mapping.last_updated_at else None,
    )


def _parse_csv_ints(value: str | None) -> list[int]:
    if not value or not value.strip():
        return []
    out: list[int] = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(int(part))
        except ValueError:
            continue
    return out


def _parse_csv_strings(value: str | None) -> list[str]:
    if not value or not value.strip():
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


@router.get("/mappings", response_model=List[TransactionMappingResponse])
async def list_mappings(
    tag_ids: str | None = None,
    subtag_ids: str | None = None,
    subtag_types: str | None = None,
    mapping_types: str | None = None,
    expense_sharing_ids: str | None = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Lista mapeamentos da conta, com filtros opcionais (CSV = multi-select)."""
    account_id = current_user.get("account_id")

    parsed_tag_ids = _parse_csv_ints(tag_ids)
    parsed_subtag_ids = _parse_csv_ints(subtag_ids)
    parsed_subtag_types = _parse_csv_strings(subtag_types)
    parsed_mapping_types = _parse_csv_strings(mapping_types)
    parsed_sharing_ids = _parse_csv_ints(expense_sharing_ids)

    query = db.query(TransactionMapping).filter(TransactionMapping.account_id == account_id)

    if parsed_subtag_ids:
        query = query.filter(TransactionMapping.subtag_id.in_(parsed_subtag_ids))
    if parsed_mapping_types:
        query = query.filter(TransactionMapping.mapping_type.in_(parsed_mapping_types))
    if parsed_sharing_ids:
        # 0 = opção "Sem" do filtro: mapeamentos sem compartilhamento.
        include_unshared = 0 in parsed_sharing_ids
        real_sharing_ids = [sharing_id for sharing_id in parsed_sharing_ids if sharing_id != 0]
        sharing_clauses = []
        if real_sharing_ids:
            sharing_clauses.append(TransactionMapping.expense_sharing_id.in_(real_sharing_ids))
        if include_unshared:
            sharing_clauses.append(TransactionMapping.expense_sharing_id.is_(None))
        if len(sharing_clauses) == 1:
            query = query.filter(sharing_clauses[0])
        elif sharing_clauses:
            query = query.filter(or_(*sharing_clauses))

    if parsed_tag_ids or parsed_subtag_types:
        query = query.join(Subtag, TransactionMapping.subtag_id == Subtag.id)
        query = query.filter(Subtag.account_id == account_id)
        if parsed_tag_ids:
            query = query.filter(Subtag.tag_id.in_(parsed_tag_ids))
        if parsed_subtag_types:
            query = query.filter(Subtag.type.in_(parsed_subtag_types))

    mappings = query.order_by(TransactionMapping.original_description).all()
    return [_transaction_mapping_to_response(db, mapping) for mapping in mappings]


@router.get("/mappings/{mapping_id}/reveal")
async def reveal_mapping(
    mapping_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Revela os valores criptografados de um mapeamento sensível (original_description e mapped_description)."""
    account_id = current_user.get("account_id")

    # Buscar mapeamento
    mapping = db.query(TransactionMapping).filter(
        TransactionMapping.id == mapping_id,
        TransactionMapping.account_id == account_id
    ).first()

    if not mapping:
        raise HTTPException(status_code=404, detail="Mapeamento não encontrado")

    # Se não for sensível, retorna os valores normais
    if not mapping.is_sensitive:
        return {
            "revealed_original": mapping.original_description,
            "revealed_mapped": mapping.mapped_description,
            "revealed_pattern": mapping.pattern if mapping.mapping_type == "pattern" else None,
            "revealed_regex": mapping.regex_pattern if mapping.mapping_type == "regex" else None,
        }

    from app.utils.sensitive_mapping import decrypt_field, decrypt_pattern_for_match, decrypt_regex_for_match

    try:
        revealed_original = (
            decrypt_field(mapping.original_description, True) if mapping.original_description else None
        )
        revealed_mapped = decrypt_field(mapping.mapped_description, True) if mapping.mapped_description else None
        revealed_pattern = (
            decrypt_pattern_for_match(mapping.pattern, True)
            if mapping.mapping_type == "pattern" and mapping.pattern
            else None
        )
        revealed_regex = (
            decrypt_regex_for_match(mapping.regex_pattern, True)
            if mapping.mapping_type == "regex" and mapping.regex_pattern
            else None
        )

        return {
            "revealed_original": revealed_original,
            "revealed_mapped": revealed_mapped,
            "revealed_pattern": revealed_pattern,
            "revealed_regex": revealed_regex,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao descriptografar: {str(e)}")


class ValidatePasswordRequest(BaseModel):
    """Schema para validação de senha"""
    password: str


@router.post("/validate-password")
async def validate_password(
    request: ValidatePasswordRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Valida a senha do usuário atual (usado para desmarcar flag sensível)."""
    user_id = current_user.get("user_id") or current_user.get("id")

    if not user_id:
        raise HTTPException(status_code=400, detail="ID do usuário não encontrado no token")

    # Buscar usuário
    user = db.query(Usuario).filter(Usuario.id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Validar senha (usando SHA256, mesmo método do login)
    try:
        # Gera hash SHA256 da senha fornecida
        password_hash = hashlib.sha256(request.password.encode()).hexdigest()

        if user.password_hash == password_hash:
            return {"valid": True}
        else:
            raise HTTPException(status_code=401, detail="Senha incorreta")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao validar senha: {str(e)}")


@router.post("/mappings", response_model=TransactionMappingResponse, status_code=201)
async def create_mapping(
    mapping_data: TransactionMappingCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Cria um novo mapeamento de transação (APENAS INSERE na tabela transaction_mappings, NÃO atualiza registros)."""
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    created_by = current_user.get("user_id") or current_user.get("id")

    # Verificar se subtag existe e pertence à conta
    subtag = db.query(Subtag).filter(
        Subtag.id == mapping_data.subtag_id,
        Subtag.account_id == account_id
    ).first()

    if not subtag:
        raise HTTPException(status_code=404, detail="Subtag não encontrada")

    # Validar que pelo menos um campo de matching está preenchido
    if mapping_data.mapping_type == 'exact' and not mapping_data.original_description:
        raise HTTPException(status_code=400, detail="Campo 'original_description' é obrigatório para tipo 'exact'")
    elif mapping_data.mapping_type == 'pattern' and not mapping_data.pattern:
        raise HTTPException(status_code=400, detail="Campo 'pattern' é obrigatório para tipo 'pattern'")
    elif mapping_data.mapping_type == 'regex' and not mapping_data.regex_pattern:
        raise HTTPException(status_code=400, detail="Campo 'regex_pattern' é obrigatório para tipo 'regex'")

    # VALIDAÇÃO: Se is_sensitive=True, mapped_description é obrigatória
    if mapping_data.is_sensitive and not mapping_data.mapped_description:
        raise HTTPException(status_code=400, detail="Descrição personalizada é obrigatória para mapeamentos sensíveis")

    # Normalizar campos para verificação de duplicatas (garantir busca case-insensitive)
    original_desc_check = mapping_data.original_description.lower() if mapping_data.original_description else None
    pattern_check = mapping_data.pattern.lower() if mapping_data.pattern else None

    # Obter o tipo da subtag selecionada (receita ou despesa)
    subtag_type = subtag.type

    # Duplicata só no mesmo mapping_type e no mesmo tipo de subtag (receita/despesa).
    # Um regex que também captura o texto não impede padrão nem exato:
    # na classificação, exato tem prioridade sobre padrão, e padrão sobre regex.
    existing_query = db.query(TransactionMapping).join(
        Subtag, TransactionMapping.subtag_id == Subtag.id
    ).filter(
        TransactionMapping.account_id == account_id,
        TransactionMapping.mapping_type == mapping_data.mapping_type,
        Subtag.type == subtag_type
    )

    if mapping_data.mapping_type == 'exact':
        existing_query = existing_query.filter(
            func.lower(TransactionMapping.original_description) == original_desc_check
        )
    elif mapping_data.mapping_type == 'pattern':
        existing_query = existing_query.filter(
            func.lower(TransactionMapping.pattern) == pattern_check
        )
    elif mapping_data.mapping_type == 'regex':
        existing_query = existing_query.filter(
            TransactionMapping.regex_pattern == mapping_data.regex_pattern
        )

    existing = existing_query.first()

    if existing:
        tipo_label = "receita" if subtag_type == "receita" else "despesa"
        match_labels = {"exact": "exato", "pattern": "padrão", "regex": "regex"}
        match_label = match_labels.get(mapping_data.mapping_type, mapping_data.mapping_type)
        raise HTTPException(
            status_code=400,
            detail=f"Já existe um mapeamento {match_label} de {tipo_label} com esse critério",
        )

    # Normalizar campos para lowercase (garantir busca case-insensitive)
    # NOTA: Salvamos em lowercase no banco para otimização, mas o MappingHelper
    # também aplica .lower() na busca (defesa em profundidade caso alguém edite direto no banco)
    from app.utils.sensitive_mapping import (
        encrypt_field,
        original_for_storage,
        pattern_for_storage,
        regex_for_storage,
    )

    original_desc_normalized = (
        original_for_storage(mapping_data.original_description, mapping_data.is_sensitive)
        if mapping_data.mapping_type == "exact"
        else None
    )
    pattern_normalized = (
        pattern_for_storage(mapping_data.pattern, mapping_data.is_sensitive)
        if mapping_data.mapping_type == "pattern"
        else (mapping_data.pattern.lower() if mapping_data.pattern else None)
    )
    regex_pattern_stored = (
        regex_for_storage(mapping_data.regex_pattern, mapping_data.is_sensitive)
        if mapping_data.mapping_type == "regex"
        else mapping_data.regex_pattern
    )

    mapped_desc = mapping_data.mapped_description
    if mapping_data.is_sensitive and mapped_desc:
        mapped_desc = encrypt_field(mapped_desc)

    # Criar mapeamento (APENAS INSERE, NÃO ATUALIZA REGISTROS)
    new_mapping = TransactionMapping(
        account_id=account_id,
        tenant_id=tenant_id,
        created_by=created_by,
        original_description=original_desc_normalized,
        mapped_description=mapped_desc,
        subtag_id=mapping_data.subtag_id,
        expense_sharing_id=mapping_data.expense_sharing_id,
        my_contribution_percentage=mapping_data.my_contribution_percentage,
        revenue_contribution_percentage=mapping_data.revenue_contribution_percentage,
        mapping_type=mapping_data.mapping_type,
        pattern=pattern_normalized,
        regex_pattern=regex_pattern_stored,
        priority=mapping_data.priority,
        is_sensitive=mapping_data.is_sensitive
    )

    db.add(new_mapping)
    db.flush()
    db.refresh(new_mapping)

    # Aplica na mesma transação. Se o remap falhar, o mapeamento novo não fica gravado
    # (senão a próxima tentativa esbarra em duplicata).
    closure_impact = None
    if mapping_data.apply_to_existing:
        remap_opts = RemapOptionsRequest(
            overwrite_sharing=mapping_data.overwrite_sharing,
            confirm_closed_closure_impact=mapping_data.confirm_closed_closure_impact,
        )
        _, _, _, closure_impact = _apply_mapping_remap_with_closure(
            db, tenant_id, account_id, new_mapping, remap_opts,
        )
    db.commit()
    db.refresh(new_mapping)

    # Buscar tag e compartilhamento
    tag = db.query(Tag).filter(Tag.id == subtag.tag_id).first()

    expense_sharing = None
    if new_mapping.expense_sharing_id:
        expense_sharing = db.query(ExpenseSharingSetting).filter(ExpenseSharingSetting.id == new_mapping.expense_sharing_id).first()

    return TransactionMappingResponse(
        id=new_mapping.id,
        original_description=new_mapping.original_description,
        mapped_description=new_mapping.mapped_description,
        subtag_id=new_mapping.subtag_id,
        subtag_name=subtag.name,
        subtag_type=subtag.type,
        tag_name=tag.name if tag else None,
        shared_partner_id=new_mapping.expense_sharing_id,
        shared_partner_name=expense_sharing.shared_account.name if expense_sharing and expense_sharing.shared_account else None,
        shared_partner_bank=expense_sharing.shared_account.bank.name if expense_sharing and expense_sharing.shared_account and expense_sharing.shared_account.bank else None,
        shared_partner_agency=str(expense_sharing.shared_account.agency) if expense_sharing and expense_sharing.shared_account and expense_sharing.shared_account.agency else None,
        shared_partner_account_number=str(expense_sharing.shared_account.account_number) if expense_sharing and expense_sharing.shared_account and expense_sharing.shared_account.account_number else None,
        my_contribution_percentage=float(new_mapping.my_contribution_percentage) if new_mapping.my_contribution_percentage is not None else None,
        revenue_contribution_percentage=float(new_mapping.revenue_contribution_percentage) if new_mapping.revenue_contribution_percentage is not None else None,
        mapping_type=new_mapping.mapping_type,
        pattern=new_mapping.pattern,
        regex_pattern=new_mapping.regex_pattern,
        priority=new_mapping.priority,
        is_sensitive=new_mapping.is_sensitive,
        created_at=new_mapping.created_at.isoformat() if new_mapping.created_at else None,
        last_updated_at=new_mapping.last_updated_at.isoformat() if new_mapping.last_updated_at else None,
        closure_impact=closure_impact,
    )


class BulkMappingCreate(BaseModel):
    """Schema para criação em lote de mapeamentos"""
    mappings: List[TransactionMappingCreate]


class BulkMappingResponse(BaseModel):
    """Response para criação em lote"""
    created: int
    skipped: int
    errors: List[str]


@router.post("/mappings/bulk", response_model=BulkMappingResponse, status_code=201)
async def create_bulk_mappings(
    bulk_data: BulkMappingCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Cria múltiplos mapeamentos de uma vez (APENAS INSERE na tabela transaction_mappings, NÃO atualiza registros)."""
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    created_by = current_user.get("user_id") or current_user.get("id")

    created = 0
    skipped = 0
    errors = []

    for mapping_data in bulk_data.mappings:
        try:

            # Verificar se subtag existe e pertence à conta
            subtag = db.query(Subtag).filter(
                Subtag.id == mapping_data.subtag_id,
                Subtag.account_id == account_id
            ).first()

            if not subtag:
                errors.append(f"Subtag {mapping_data.subtag_id} não encontrada para '{mapping_data.original_description}'")
                skipped += 1
                continue

            # Verificar se já existe mapeamento para essa descrição COM A MESMA SUBTAG (por conta)
            existing = db.query(TransactionMapping).filter(
                TransactionMapping.account_id == account_id,
                TransactionMapping.original_description == mapping_data.original_description,
                TransactionMapping.subtag_id == mapping_data.subtag_id
            ).first()

            if existing:
                # Se já existe, apenas pula (não atualiza registros)
                skipped += 1
                continue

            # Criar mapeamento (APENAS INSERE, NÃO ATUALIZA REGISTROS)
            new_mapping = TransactionMapping(
                account_id=account_id,
                tenant_id=tenant_id,
                created_by=created_by,
                original_description=mapping_data.original_description,
                mapped_description=mapping_data.mapped_description,
                subtag_id=mapping_data.subtag_id,
                expense_sharing_id=mapping_data.expense_sharing_id,
                my_contribution_percentage=mapping_data.my_contribution_percentage,
                revenue_contribution_percentage=mapping_data.revenue_contribution_percentage,
                mapping_type=mapping_data.mapping_type,
                pattern=mapping_data.pattern,
                regex_pattern=mapping_data.regex_pattern,
                priority=mapping_data.priority
            )

            db.add(new_mapping)
            created += 1

        except Exception as e:
            errors.append(f"Erro ao processar '{mapping_data.original_description}': {str(e)}")
            skipped += 1

    # Commit de todas as mudanças de uma vez
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao salvar mapeamentos: {str(e)}")

    return BulkMappingResponse(
        created=created,
        skipped=skipped,
        errors=errors
    )


# ==================== BULK UPDATE MAPPINGS ====================

class BulkMappingUpdateItem(BaseModel):
    """Item para atualização em lote de mapeamentos"""
    id: int
    subtag_id: int | None = None
    expense_sharing_id: int | None = None
    my_contribution_percentage: float | None = None


class BulkMappingUpdateRequest(BaseModel):
    """Request para atualização em lote de mapeamentos"""
    mapping_ids: List[int]
    subtag_id: int | None = None  # None = não alterar
    expense_sharing_id: int | None = None  # None = não alterar, 0 = remover compartilhamento
    my_contribution_percentage: float | None = None  # None = não alterar
    revenue_contribution_percentage: float | None = None
    update_sharing: bool = False  # Flag para indicar se deve atualizar compartilhamento


class BulkMappingUpdateResponse(BaseModel):
    """Response para atualização em lote"""
    success: bool
    updated: int
    errors: List[str]


@router.patch("/mappings/bulk-update", response_model=BulkMappingUpdateResponse)
async def bulk_update_mappings(
    request: BulkMappingUpdateRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """
    Atualiza múltiplos mapeamentos de uma vez.
    Apenas os campos não-None serão atualizados.
    Para compartilhamento, usa flag update_sharing para indicar se deve atualizar.
    """
    account_id = current_user.get("account_id")

    if not request.mapping_ids:
        raise HTTPException(status_code=400, detail="Nenhum mapeamento para atualizar")

    updated = 0
    errors = []

    # Busca todos os mapeamentos de uma vez
    mappings = db.query(TransactionMapping).filter(
        TransactionMapping.id.in_(request.mapping_ids),
        TransactionMapping.account_id == account_id
    ).all()

    # Verifica se todos foram encontrados
    found_ids = {m.id for m in mappings}
    missing_ids = set(request.mapping_ids) - found_ids
    if missing_ids:
        errors.append(f"Mapeamentos não encontrados: {list(missing_ids)}")

    # Verifica subtag se fornecida
    if request.subtag_id is not None:
        subtag = db.query(Subtag).filter(
            Subtag.id == request.subtag_id,
            Subtag.account_id == account_id
        ).first()
        if not subtag:
            raise HTTPException(status_code=404, detail="Subtag não encontrada")

    # Atualiza cada mapeamento
    for mapping in mappings:
        try:
            if request.subtag_id is not None:
                mapping.subtag_id = request.subtag_id

            # Só atualiza compartilhamento se a flag estiver ativa
            if request.update_sharing:
                # expense_sharing_id = 0 significa remover compartilhamento
                if request.expense_sharing_id == 0:
                    mapping.expense_sharing_id = None
                    mapping.my_contribution_percentage = None
                    mapping.revenue_contribution_percentage = None
                else:
                    mapping.expense_sharing_id = request.expense_sharing_id
                    mapping.my_contribution_percentage = request.my_contribution_percentage
                    mapping.revenue_contribution_percentage = getattr(request, 'revenue_contribution_percentage', None)

            updated += 1
        except Exception as e:
            errors.append(f"Erro ao atualizar mapeamento {mapping.id}: {str(e)}")

    # Commit de todas as mudanças de uma vez
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao salvar mapeamentos: {str(e)}")

    return BulkMappingUpdateResponse(
        success=len(errors) == 0,
        updated=updated,
        errors=errors
    )


@router.put("/mappings/{mapping_id}", response_model=TransactionMappingResponse)
async def update_mapping(
    mapping_id: int,
    mapping_data: TransactionMappingUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Atualiza um mapeamento existente. Apenas campos enviados no request são atualizados (partial update)."""
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")

    mapping = db.query(TransactionMapping).filter(
        TransactionMapping.id == mapping_id,
        TransactionMapping.account_id == account_id
    ).first()

    if not mapping:
        raise HTTPException(status_code=404, detail="Mapeamento não encontrado")

    # Campos que foram explicitamente enviados no request (Pydantic v2)
    fields_set = mapping_data.model_fields_set

    # VALIDAÇÃO: Se is_sensitive=True, mapped_description é obrigatória
    new_is_sensitive = mapping_data.is_sensitive if mapping_data.is_sensitive is not None else mapping.is_sensitive
    if new_is_sensitive and not mapping_data.mapped_description and not mapping.mapped_description:
        raise HTTPException(status_code=400, detail="Descrição personalizada é obrigatória para mapeamentos sensíveis")

    # Atualizar is_sensitive e lidar com criptografia/descriptografia
    old_is_sensitive = mapping.is_sensitive

    from app.utils.crypto_helper import get_crypto_helper
    crypto = get_crypto_helper()

    # Atualizar original_description (normalizar para lowercase e criptografar se necessário)
    if 'original_description' in fields_set:
        original_desc = mapping_data.original_description.lower() if mapping_data.original_description else None

        # Cenário 1: Não estava sensível e marca como sensível → criptografa
        if not old_is_sensitive and new_is_sensitive and original_desc:
            original_desc = crypto.encrypt(original_desc)
        elif old_is_sensitive and new_is_sensitive and original_desc:
            original_desc = crypto.encrypt(original_desc)
        elif old_is_sensitive and not new_is_sensitive:
            if mapping.original_description:
                try:
                    original_desc = crypto.decrypt(mapping.original_description)
                except Exception as e:
                    logger.warning(f"Erro ao descriptografar original_description: {e}")
                    # Se falhar, usa o valor que veio do frontend
                    original_desc = mapping_data.original_description.lower() if mapping_data.original_description else None

        mapping.original_description = original_desc

    # Atualizar mapped_description (permitir atualizar para None)
    if 'mapped_description' in fields_set:
        mapped_desc = mapping_data.mapped_description

        if not old_is_sensitive and new_is_sensitive and mapped_desc:
            mapped_desc = crypto.encrypt(mapped_desc)
        elif old_is_sensitive and new_is_sensitive and mapped_desc:
            mapped_desc = crypto.encrypt(mapped_desc)
        elif old_is_sensitive and not new_is_sensitive:
            # Descriptografa o valor atual do banco (não o que veio do frontend)
            if mapping.mapped_description:
                try:
                    mapped_desc = crypto.decrypt(mapping.mapped_description)
                except Exception as e:
                    logger.warning(f"Erro ao descriptografar mapped_description: {e}")
                    # Se falhar, mantém o valor que veio do frontend
                    mapped_desc = mapping_data.mapped_description

        # Cenário 4: Não estava sensível e continua não sensível → usa valor do frontend
        # (mapped_desc já está correto)

        mapping.mapped_description = mapped_desc

    # Atualizar is_sensitive
    if 'is_sensitive' in fields_set and mapping_data.is_sensitive is not None:
        mapping.is_sensitive = mapping_data.is_sensitive

    if 'subtag_id' in fields_set and mapping_data.subtag_id is not None:
        # Verificar se subtag existe
        subtag = db.query(Subtag).filter(
            Subtag.id == mapping_data.subtag_id,
            Subtag.account_id == account_id
        ).first()
        if not subtag:
            raise HTTPException(status_code=404, detail="Subtag não encontrada")
        mapping.subtag_id = mapping_data.subtag_id

    # Atualizar compartilhamento (permitir None para remover) - SÓ se enviado no request
    if 'expense_sharing_id' in fields_set:
        mapping.expense_sharing_id = mapping_data.expense_sharing_id

    # Atualizar percentual de contribuição (permitir None para usar o padrão) - SÓ se enviado no request
    if 'my_contribution_percentage' in fields_set:
        mapping.my_contribution_percentage = mapping_data.my_contribution_percentage
    if 'revenue_contribution_percentage' in fields_set:
        mapping.revenue_contribution_percentage = mapping_data.revenue_contribution_percentage

    # Atualizar campos de matching (normalizar pattern para lowercase) - SÓ se enviados no request
    if 'mapping_type' in fields_set and mapping_data.mapping_type is not None:
        mapping.mapping_type = mapping_data.mapping_type

    from app.utils.sensitive_mapping import resolve_pattern_update, resolve_regex_update

    if mapping.mapping_type == "pattern" and (
        "pattern" in fields_set
        or ("is_sensitive" in fields_set and mapping_data.is_sensitive is not None)
    ):
        mapping.pattern = resolve_pattern_update(
            fields_set=fields_set,
            mapping_data_pattern=mapping_data.pattern if "pattern" in fields_set else None,
            stored_pattern=mapping.pattern,
            old_is_sensitive=old_is_sensitive,
            new_is_sensitive=new_is_sensitive,
        )

    if mapping.mapping_type == "regex" and (
        "regex_pattern" in fields_set
        or ("is_sensitive" in fields_set and mapping_data.is_sensitive is not None)
    ):
        mapping.regex_pattern = resolve_regex_update(
            fields_set=fields_set,
            mapping_data_regex=mapping_data.regex_pattern if "regex_pattern" in fields_set else None,
            stored_regex=mapping.regex_pattern,
            old_is_sensitive=old_is_sensitive,
            new_is_sensitive=new_is_sensitive,
        )

    if 'priority' in fields_set and mapping_data.priority is not None:
        mapping.priority = mapping_data.priority

    db.flush()
    db.refresh(mapping)

    closure_impact = None
    if mapping_data.apply_to_existing:
        remap_opts = RemapOptionsRequest(
            overwrite_sharing=mapping_data.overwrite_sharing,
            confirm_closed_closure_impact=mapping_data.confirm_closed_closure_impact,
        )
        _, _, _, closure_impact = _apply_mapping_remap_with_closure(
            db, tenant_id, account_id, mapping, remap_opts,
        )
    db.commit()
    db.refresh(mapping)

    # Buscar subtag, tag e compartilhamento
    subtag = db.query(Subtag).filter(Subtag.id == mapping.subtag_id).first()
    tag = db.query(Tag).filter(Tag.id == subtag.tag_id).first() if subtag else None

    expense_sharing = None
    if mapping.expense_sharing_id:
        expense_sharing = db.query(ExpenseSharingSetting).filter(ExpenseSharingSetting.id == mapping.expense_sharing_id).first()

    return TransactionMappingResponse(
        id=mapping.id,
        original_description=mapping.original_description,
        mapped_description=mapping.mapped_description,
        subtag_id=mapping.subtag_id,
        subtag_name=subtag.name if subtag else None,
        subtag_type=subtag.type if subtag else None,
        tag_name=tag.name if tag else None,
        shared_partner_id=mapping.expense_sharing_id,
        shared_partner_name=expense_sharing.shared_account.name if expense_sharing and expense_sharing.shared_account else None,
        shared_partner_bank=expense_sharing.shared_account.bank.name if expense_sharing and expense_sharing.shared_account and expense_sharing.shared_account.bank else None,
        shared_partner_agency=str(expense_sharing.shared_account.agency) if expense_sharing and expense_sharing.shared_account and expense_sharing.shared_account.agency else None,
        shared_partner_account_number=str(expense_sharing.shared_account.account_number) if expense_sharing and expense_sharing.shared_account and expense_sharing.shared_account.account_number else None,
            my_contribution_percentage=float(mapping.my_contribution_percentage) if mapping.my_contribution_percentage is not None else None,
            revenue_contribution_percentage=float(mapping.revenue_contribution_percentage) if mapping.revenue_contribution_percentage is not None else None,
            mapping_type=mapping.mapping_type,
        pattern=mapping.pattern,
        regex_pattern=mapping.regex_pattern,
        priority=mapping.priority,
        is_sensitive=mapping.is_sensitive,
        created_at=mapping.created_at.isoformat() if mapping.created_at else None,
        last_updated_at=mapping.last_updated_at.isoformat() if mapping.last_updated_at else None,
        closure_impact=closure_impact,
    )


@router.post("/mappings/bulk-delete", response_model=BulkDeleteResponse)
async def bulk_delete_mappings(
    body: BulkIdsRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    if not body.ids:
        raise HTTPException(status_code=400, detail="Nenhum mapeamento selecionado")

    account_id = current_user.get("account_id")
    unique_ids = list(dict.fromkeys(body.ids))
    mappings = (
        db.query(TransactionMapping)
        .filter(
            TransactionMapping.id.in_(unique_ids),
            TransactionMapping.account_id == account_id,
        )
        .all()
    )
    for mapping in mappings:
        db.delete(mapping)

    db.commit()
    deleted = len(mappings)
    skipped = len(unique_ids) - deleted
    return BulkDeleteResponse(deleted=deleted, skipped=skipped)


@router.delete("/mappings/{mapping_id}", status_code=204)
async def delete_mapping(
    mapping_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Deleta permanentemente um mapeamento."""
    account_id = current_user.get("account_id")

    mapping = db.query(TransactionMapping).filter(
        TransactionMapping.id == mapping_id,
        TransactionMapping.account_id == account_id
    ).first()

    if not mapping:
        raise HTTPException(status_code=404, detail="Mapeamento não encontrado")

    # Deleta permanentemente
    db.delete(mapping)
    db.commit()

    return None


class RemapSingleResponse(BaseModel):
    """Resposta do endpoint de remapeamento de um mapeamento específico."""
    mapping_id: int
    bank_statements: int
    credit_card_invoices: int
    benefit_statements: int
    total_records_updated: int
    closure_impact: dict | None = None


class RemapAllResponse(BaseModel):
    mappings_processed: int
    mappings_failed: int
    bank_statements: int
    credit_card_invoices: int
    benefit_statements: int
    total_records_updated: int
    errors: List[str] = []
    closure_impact: dict | None = None


class BulkRemapRequest(BaseModel):
    """Mesmo padrão de ids do bulk-delete, com opções de remapeamento."""

    ids: List[int]
    overwrite_sharing: bool = False
    confirm_closed_closure_impact: bool = False


class RemapAllRequest(RemapOptionsRequest):
    """Remap-all; mapping_ids opcional (null = todos os mapeamentos da conta)."""

    mapping_ids: List[int] | None = None


def _run_remap_sequence(
    db: Session,
    tenant_id: int,
    account_id: int,
    mappings: list[TransactionMapping],
    options: RemapOptionsRequest,
) -> RemapAllResponse:
    """Valida lançamentos e fechamentos uma vez; aplica todos os mapeamentos na ordem correta."""
    if not mappings:
        return RemapAllResponse(
            mappings_processed=0,
            mappings_failed=0,
            bank_statements=0,
            credit_card_invoices=0,
            benefit_statements=0,
            total_records_updated=0,
            errors=[],
            closure_impact=None,
        )

    ensure_account_has_remap_transaction_data(db, tenant_id, account_id)
    try:
        _ensure_mappings_remap_closure_allowed(db, tenant_id, account_id, mappings, options)
    except AccountPeriodClosedError as exc:
        raise HTTPException(status_code=409, detail=_closure_impact_http_detail(exc)) from exc

    total_bank = 0
    total_cc = 0
    total_benefit = 0
    processed = 0
    failed = 0
    errors: List[str] = []
    merged_impact: dict | None = None

    for mapping in mappings:
        try:
            bank, cc, benefit, impact = _apply_mapping_remap_with_closure(
                db,
                tenant_id,
                account_id,
                mapping,
                options,
                verify_transaction_data=False,
                verify_closure_precheck=False,
            )
            merged_impact = merge_closure_impacts(merged_impact, impact)
            total_bank += bank
            total_cc += cc
            total_benefit += benefit
            processed += 1
        except HTTPException as e:
            failed += 1
            detail = e.detail if isinstance(e.detail, str) else str(e.detail)
            errors.append(f"Mapeamento #{mapping.id}: {detail}")
        except Exception as e:
            failed += 1
            errors.append(f"Mapeamento #{mapping.id}: {str(e)}")

    total = total_bank + total_cc + total_benefit
    return RemapAllResponse(
        mappings_processed=processed,
        mappings_failed=failed,
        bank_statements=total_bank,
        credit_card_invoices=total_cc,
        benefit_statements=total_benefit,
        total_records_updated=total,
        errors=errors,
        closure_impact=merged_impact,
    )


def _remap_mappings_query(
    db: Session,
    account_id: int,
    mapping_ids: List[int] | None,
) -> list[TransactionMapping]:
    base = db.query(TransactionMapping).filter(TransactionMapping.account_id == account_id)
    if mapping_ids is None:
        return base.all()
    unique_ids = list(dict.fromkeys(mapping_ids))
    if not unique_ids:
        raise HTTPException(status_code=400, detail="Nenhum mapeamento selecionado")
    mappings = base.filter(TransactionMapping.id.in_(unique_ids)).all()
    found = {m.id for m in mappings}
    missing = [i for i in unique_ids if i not in found]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Mapeamento(s) não encontrado(s): {', '.join(str(i) for i in missing)}",
        )
    return mappings


@router.post("/mappings/bulk-remap", response_model=RemapAllResponse)
async def bulk_remap_mappings(
    body: BulkRemapRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Remapeamento em lote dos IDs selecionados (validação única de lançamentos/fechamento)."""
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    options = RemapOptionsRequest(
        overwrite_sharing=body.overwrite_sharing,
        confirm_closed_closure_impact=body.confirm_closed_closure_impact,
    )
    mappings = _remap_mappings_query(db, account_id, body.ids)
    ordered = sort_mappings_for_remap(mappings)
    result = _run_remap_sequence(db, tenant_id, account_id, ordered, options)
    db.commit()
    return result


@router.post("/mappings/remap-all", response_model=RemapAllResponse)
async def remap_all_mappings(
    body: RemapAllRequest | None = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """
    Aplica mapeamentos da conta às transações (extrato, fatura, benefício).
    Sem mapping_ids: todos. Com mapping_ids: apenas os informados.
    Ordem: regex → pattern → exact (exato por último).
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")

    if body is None:
        body = RemapAllRequest()

    options = RemapOptionsRequest(
        skip_subtag_if_null=body.skip_subtag_if_null,
        skip_sharing_if_null=body.skip_sharing_if_null,
        overwrite_sharing=body.overwrite_sharing,
        confirm_closed_closure_impact=body.confirm_closed_closure_impact,
    )

    mappings = _remap_mappings_query(db, account_id, body.mapping_ids)
    ordered = sort_mappings_for_remap(mappings)
    result = _run_remap_sequence(db, tenant_id, account_id, ordered, options)
    db.commit()
    return result


class ClearTransactionClassificationsResponse(BaseModel):
    bank_statements: int
    credit_card_invoices: int
    benefit_statements: int
    total_records_updated: int


@router.post("/mappings/clear-transaction-classifications", response_model=ClearTransactionClassificationsResponse)
async def clear_transaction_classifications(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """
    Remove subtag_id de extrato, fatura e benefício da conta logada.
    Não apaga tags/subtags do cadastro nem os mapeamentos de transação.
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")

    updated_bank = (
        db.query(BankStatement)
        .filter(
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
            BankStatement.subtag_id.isnot(None),
        )
        .update({"subtag_id": None}, synchronize_session=False)
    )

    updated_cc = (
        db.query(CreditCardInvoice)
        .filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.account_id == account_id,
            CreditCardInvoice.subtag_id.isnot(None),
        )
        .update({"subtag_id": None}, synchronize_session=False)
    )

    benefit_ids = [
        row[0]
        for row in db.query(BenefitCardStatement.id)
        .join(Cartao, BenefitCardStatement.credit_card_id == Cartao.id)
        .filter(
            BenefitCardStatement.tenant_id == tenant_id,
            Cartao.account_id == account_id,
            BenefitCardStatement.subtag_id.isnot(None),
        )
        .all()
    ]
    updated_benefit = 0
    if benefit_ids:
        updated_benefit = db.query(BenefitCardStatement).filter(
            BenefitCardStatement.id.in_(benefit_ids)
        ).update({"subtag_id": None}, synchronize_session=False)

    db.commit()

    total = updated_bank + updated_cc + updated_benefit
    logger.info(
        "Classificações removidas conta=%s tenant=%s: bank=%s cc=%s benefit=%s",
        account_id,
        tenant_id,
        updated_bank,
        updated_cc,
        updated_benefit,
    )

    return ClearTransactionClassificationsResponse(
        bank_statements=updated_bank,
        credit_card_invoices=updated_cc,
        benefit_statements=updated_benefit,
        total_records_updated=total,
    )


@router.post("/mappings/{mapping_id}/remap", response_model=RemapSingleResponse)
async def remap_single_mapping(
    mapping_id: int,
    options: RemapOptionsRequest = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """
    Aplica UM mapeamento específico às 3 tabelas de transações.

    - Verifica o tipo (receita/despesa) da subtag
    - Aplica às transações que correspondem ao match_type (exact, pattern, regex)
    - Atualiza subtag_id, expense_sharing_id e ownership_percentage

    Opções:
    - skip_subtag_if_null: Se True, não atualiza subtag quando o mapeamento não tem (não aplicável - subtag é obrigatória)
    - overwrite_sharing: Se True, aplica expense_sharing_id/percentual do mapeamento (null limpa). Padrão False.
    - skip_sharing_if_null: legado; use overwrite_sharing quando possível
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")

    # Default options se não fornecidas
    if options is None:
        options = RemapOptionsRequest()

    # Buscar o mapeamento específico
    mapping = db.query(TransactionMapping).filter(
        TransactionMapping.id == mapping_id,
        TransactionMapping.account_id == account_id
    ).first()

    if not mapping:
        raise HTTPException(status_code=404, detail="Mapeamento não encontrado")

    updated_bank, updated_cc, updated_benefit, closure_impact = _apply_mapping_remap_with_closure(
        db, tenant_id, account_id, mapping, options,
    )

    db.commit()

    return RemapSingleResponse(
        mapping_id=mapping_id,
        bank_statements=updated_bank,
        credit_card_invoices=updated_cc,
        benefit_statements=updated_benefit,
        total_records_updated=updated_bank + updated_cc + updated_benefit,
        closure_impact=closure_impact,
    )


# ==================== TAGS CRUD ====================

@router.post("/tags", response_model=TagResponse, status_code=201)
async def create_tag(
    tag_data: TagCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Cria uma nova tag."""
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    created_by = current_user.get("user_id") or current_user.get("id")

    # Verificar se já existe tag com esse nome
    existing = db.query(Tag).filter(
        Tag.account_id == account_id,
        Tag.name == tag_data.name
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Já existe uma tag com esse nome")

    new_tag = Tag(
        account_id=account_id,
        tenant_id=tenant_id,
        created_by=created_by,
        name=tag_data.name,
        description=tag_data.description,
        icon=tag_data.icon
    )

    db.add(new_tag)
    db.commit()
    db.refresh(new_tag)

    return new_tag


@router.put("/tags/{tag_id}", response_model=TagResponse)
async def update_tag(
    tag_id: int,
    tag_data: TagUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Atualiza uma tag existente."""
    account_id = current_user.get("account_id")

    tag = db.query(Tag).filter(
        Tag.id == tag_id,
        Tag.account_id == account_id
    ).first()

    if not tag:
        raise HTTPException(status_code=404, detail="Tag não encontrada")

    if tag_data.name is not None:
        tag.name = tag_data.name
    if tag_data.description is not None:
        tag.description = tag_data.description
    if tag_data.icon is not None:
        tag.icon = tag_data.icon

    db.commit()
    db.refresh(tag)

    return tag


@router.delete("/tags/{tag_id}", status_code=204)
async def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Deleta permanentemente uma tag e todas as suas subtags."""
    account_id = current_user.get("account_id")

    tag = db.query(Tag).filter(
        Tag.id == tag_id,
        Tag.account_id == account_id
    ).first()

    if not tag:
        raise HTTPException(status_code=404, detail="Tag não encontrada")

    # Deletar permanentemente todas as subtags relacionadas
    db.query(Subtag).filter(
        Subtag.tag_id == tag_id,
        Subtag.account_id == account_id
    ).delete(synchronize_session=False)

    # Deletar permanentemente a tag
    db.delete(tag)
    db.commit()

    return None


@router.get("/tags/{tag_id}/usage-count")
async def get_tag_usage_count(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Retorna a quantidade de registros associados a uma tag (através de suas subtags)."""
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")

    # Verifica se a tag existe
    tag = db.query(Tag).filter(
        Tag.id == tag_id,
        Tag.account_id == account_id
    ).first()

    if not tag:
        raise HTTPException(status_code=404, detail="Tag não encontrada")

    # Busca todas as subtags da tag
    subtag_ids = [s.id for s in db.query(Subtag).filter(
        Subtag.tag_id == tag_id,
        Subtag.account_id == account_id
    ).all()]

    if not subtag_ids:
        return {
            "tag_id": tag_id,
            "tag_name": tag.name,
            "bank_statements_count": 0,
            "credit_card_invoices_count": 0,
            "total_count": 0
        }

    # Conta registros em bank_statements
    # NOTA: BankStatement NÃO tem campo 'active'
    bank_count = db.query(BankStatement).filter(
        BankStatement.subtag_id.in_(subtag_ids),
        BankStatement.tenant_id == tenant_id
    ).count()

    # Conta registros em credit_card_invoices
    # NOTA: CreditCardInvoice NÃO tem campo 'active'
    invoice_count = db.query(CreditCardInvoice).filter(
        CreditCardInvoice.subtag_id.in_(subtag_ids),
        CreditCardInvoice.tenant_id == tenant_id
    ).count()

    total_count = bank_count + invoice_count

    return {
        "tag_id": tag_id,
        "tag_name": tag.name,
        "bank_statements_count": bank_count,
        "credit_card_invoices_count": invoice_count,
        "total_count": total_count
    }


def _force_delete_tag_no_commit(
    db: Session,
    *,
    account_id: int,
    tenant_id: int,
    tag_id: int,
) -> bool:
    tag = db.query(Tag).filter(
        Tag.id == tag_id,
        Tag.account_id == account_id,
    ).first()
    if not tag:
        return False

    subtags = db.query(Subtag).filter(
        Subtag.tag_id == tag_id,
        Subtag.account_id == account_id,
    ).all()

    for subtag in subtags:
        db.query(BankStatement).filter(
            BankStatement.subtag_id == subtag.id,
            BankStatement.tenant_id == tenant_id,
        ).update({"subtag_id": None}, synchronize_session=False)

        db.query(CreditCardInvoice).filter(
            CreditCardInvoice.subtag_id == subtag.id,
            CreditCardInvoice.tenant_id == tenant_id,
        ).update({"subtag_id": None}, synchronize_session=False)

    db.query(Subtag).filter(
        Subtag.tag_id == tag_id,
        Subtag.account_id == account_id,
    ).delete(synchronize_session=False)

    db.delete(tag)
    return True


def _force_delete_subtag_no_commit(
    db: Session,
    *,
    account_id: int,
    tenant_id: int,
    subtag_id: int,
) -> bool:
    subtag = db.query(Subtag).filter(
        Subtag.id == subtag_id,
        Subtag.account_id == account_id,
    ).first()
    if not subtag:
        return False

    db.query(BankStatement).filter(
        BankStatement.subtag_id == subtag_id,
        BankStatement.tenant_id == tenant_id,
    ).update({"subtag_id": None}, synchronize_session=False)

    db.query(CreditCardInvoice).filter(
        CreditCardInvoice.subtag_id == subtag_id,
        CreditCardInvoice.tenant_id == tenant_id,
    ).update({"subtag_id": None}, synchronize_session=False)

    db.delete(subtag)
    return True


@router.post("/tags/bulk-delete-force", response_model=BulkDeleteResponse)
async def bulk_force_delete_tags(
    body: BulkDeleteTagsRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    if not body.tag_ids and not body.subtag_ids:
        raise HTTPException(status_code=400, detail="Nenhuma tag ou subtag selecionada")

    account_id = current_user["account_id"]
    tenant_id = current_user["tenant_id"]
    deleted = 0
    skipped = 0
    soft_deleted_tag_ids: set[int] = set()

    for tag_id in dict.fromkeys(body.tag_ids):
        if _force_delete_tag_no_commit(
            db, account_id=account_id, tenant_id=tenant_id, tag_id=tag_id
        ):
            soft_deleted_tag_ids.add(tag_id)
            deleted += 1
        else:
            skipped += 1

    for subtag_id in dict.fromkeys(body.subtag_ids):
        subtag = db.query(Subtag).filter(
            Subtag.id == subtag_id,
            Subtag.account_id == account_id,
        ).first()
        if not subtag:
            skipped += 1
            continue
        if subtag.tag_id in soft_deleted_tag_ids:
            skipped += 1
            continue
        if _force_delete_subtag_no_commit(
            db, account_id=account_id, tenant_id=tenant_id, subtag_id=subtag_id
        ):
            deleted += 1
        else:
            skipped += 1

    db.commit()
    return BulkDeleteResponse(deleted=deleted, skipped=skipped)


@router.delete("/tags/{tag_id}/force", status_code=204)
async def force_delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """
    Deleta permanentemente uma tag e todas as suas subtags, migrando todos os registros associados para NULL.

    Passos:
    1. Verifica se a tag existe
    2. Busca todas as subtags da tag
    3. Migra todos os registros para NULL (não categorizado)
    4. Deleta todas as subtags da tag
    5. Deleta a tag
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")

    if not _force_delete_tag_no_commit(
        db, account_id=account_id, tenant_id=tenant_id, tag_id=tag_id
    ):
        raise HTTPException(status_code=404, detail="Tag não encontrada")

    db.commit()

    return None


# ==================== SUBTAGS CRUD ====================

@router.post("/subtags", response_model=SubtagResponse, status_code=201)
async def create_subtag(
    subtag_data: SubtagCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Cria uma nova subtag."""
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    created_by = current_user.get("user_id") or current_user.get("id")

    # Verificar se tag existe
    tag = db.query(Tag).filter(
        Tag.id == subtag_data.tag_id,
        Tag.account_id == account_id
    ).first()

    if not tag:
        raise HTTPException(status_code=404, detail="Tag não encontrada")

    # Verificar se já existe subtag com esse nome, tag e tipo
    existing = db.query(Subtag).filter(
        Subtag.account_id == account_id,
        Subtag.tag_id == subtag_data.tag_id,
        Subtag.name == subtag_data.name,
        Subtag.type == subtag_data.type
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Já existe uma subtag com esse nome e tipo nesta tag")

    new_subtag = Subtag(
        account_id=account_id,
        tenant_id=tenant_id,
        created_by=created_by,
        tag_id=subtag_data.tag_id,
        name=subtag_data.name,
        description=subtag_data.description,
        type=subtag_data.type,
        icon=subtag_data.icon
    )

    db.add(new_subtag)
    db.commit()
    db.refresh(new_subtag)

    return SubtagResponse(
        id=new_subtag.id,
        tag_id=new_subtag.tag_id,
        name=new_subtag.name,
        description=new_subtag.description,
        type=new_subtag.type,  # ← Tipo está na subtag
        icon=new_subtag.icon,
        tag_name=tag.name
    )


@router.put("/subtags/{subtag_id}", response_model=SubtagResponse)
async def update_subtag(
    subtag_id: int,
    subtag_data: SubtagUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Atualiza uma subtag existente."""
    account_id = current_user.get("account_id")

    subtag = db.query(Subtag).filter(
        Subtag.id == subtag_id,
        Subtag.account_id == account_id
    ).first()

    if not subtag:
        raise HTTPException(status_code=404, detail="Subtag não encontrada")

    if subtag_data.tag_id is not None:
        # Verificar se nova tag existe
        tag = db.query(Tag).filter(
            Tag.id == subtag_data.tag_id,
            Tag.account_id == account_id
        ).first()
        if not tag:
            raise HTTPException(status_code=404, detail="Tag não encontrada")
        subtag.tag_id = subtag_data.tag_id

    if subtag_data.name is not None:
        subtag.name = subtag_data.name
    if subtag_data.description is not None:
        subtag.description = subtag_data.description
    if subtag_data.type is not None:
        subtag.type = subtag_data.type
    if subtag_data.icon is not None:
        subtag.icon = subtag_data.icon

    # Conflito de nome/tipo dentro da tag (ex.: mover subtag para outra tag)
    duplicate = db.query(Subtag).filter(
        Subtag.account_id == account_id,
        Subtag.tag_id == subtag.tag_id,
        Subtag.name == subtag.name,
        Subtag.type == subtag.type,
        Subtag.id != subtag_id,
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=400,
            detail="Já existe uma subtag com esse nome e tipo nesta tag",
        )

    db.commit()
    db.refresh(subtag)

    # Buscar tag atualizada
    tag = db.query(Tag).filter(Tag.id == subtag.tag_id).first()

    return SubtagResponse(
        id=subtag.id,
        tag_id=subtag.tag_id,
        name=subtag.name,
        description=subtag.description,
        type=subtag.type,  # ← Tipo está na subtag
        icon=subtag.icon,
        tag_name=tag.name if tag else None
    )


@router.delete("/subtags/{subtag_id}", status_code=204)
async def delete_subtag(
    subtag_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Deleta permanentemente uma subtag."""
    account_id = current_user.get("account_id")

    subtag = db.query(Subtag).filter(
        Subtag.id == subtag_id,
        Subtag.account_id == account_id
    ).first()

    if not subtag:
        raise HTTPException(status_code=404, detail="Subtag não encontrada")

    db.delete(subtag)
    db.commit()

    return None


@router.get("/subtags/{subtag_id}/usage-count")
async def get_subtag_usage_count(
    subtag_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Retorna a quantidade de registros associados a uma subtag."""
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")

    # Verifica se a subtag existe
    subtag = db.query(Subtag).filter(
        Subtag.id == subtag_id,
        Subtag.account_id == account_id
    ).first()

    if not subtag:
        raise HTTPException(status_code=404, detail="Subtag não encontrada")

    # Conta registros em bank_statements
    # NOTA: BankStatement NÃO tem campo 'active'
    bank_count = db.query(BankStatement).filter(
        BankStatement.subtag_id == subtag_id,
        BankStatement.tenant_id == tenant_id
    ).count()

    # Conta registros em credit_card_invoices
    # NOTA: CreditCardInvoice NÃO tem campo 'active'
    invoice_count = db.query(CreditCardInvoice).filter(
        CreditCardInvoice.subtag_id == subtag_id,
        CreditCardInvoice.tenant_id == tenant_id
    ).count()

    total_count = bank_count + invoice_count

    return {
        "subtag_id": subtag_id,
        "subtag_name": subtag.name,
        "bank_statements_count": bank_count,
        "credit_card_invoices_count": invoice_count,
        "total_count": total_count
    }


@router.delete("/subtags/{subtag_id}/force", status_code=204)
async def force_delete_subtag(
    subtag_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """
    Deleta permanentemente uma subtag e migra todos os registros associados para NULL.

    Passos:
    1. Verifica se a subtag existe
    2. Migra todos os registros para NULL (não categorizado)
    3. Deleta a subtag
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")

    if not _force_delete_subtag_no_commit(
        db, account_id=account_id, tenant_id=tenant_id, subtag_id=subtag_id
    ):
        raise HTTPException(status_code=404, detail="Subtag não encontrada")

    db.commit()

    return None


# ==================== UPDATE SUBTAG ====================

class UpdateSubtagRequest(BaseModel):
    """Request para atualizar subtag de um registro"""
    subtag_id: int


class UnmappedRecordResponse(BaseModel):
    """Response para registro não mapeado"""
    id: int
    date: str
    description: str
    amount: float
    source: str  # "bank" ou "card"
    card_number: str | None = None
    card_owner: str | None = None  # Nome do dono do cartão
    category: str | None = None
    tag_id: int | None = None
    subtag_id: int | None = None
    current_installment: int | None = None
    total_installments: int | None = None
    year_month: str | None = None  # Mês da fatura (YYYY-MM) para registros de cartão

    class Config:
        from_attributes = True


@router.patch("/bank-statements/{statement_id}/subtag", status_code=200)
async def update_bank_statement_subtag(
    statement_id: int,
    request: UpdateSubtagRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Atualiza o subtag_id de um extrato bancário."""
    tenant_id = current_user.get("tenant_id", 1)

    # Verificar se o statement existe
    # NOTA: BankStatement NÃO tem campo 'active'
    statement = db.query(BankStatement).filter(
        BankStatement.id == statement_id,
        BankStatement.tenant_id == tenant_id
    ).first()

    if not statement:
        raise HTTPException(status_code=404, detail="Extrato não encontrado")

    # Verificar se a subtag existe e pertence ao tenant
    # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
    subtag = db.query(Subtag).filter(
        Subtag.id == request.subtag_id,
        Subtag.tenant_id == tenant_id
    ).first()

    if not subtag:
        raise HTTPException(status_code=404, detail="Subtag não encontrada")

    # Atualizar subtag_id
    statement.subtag_id = request.subtag_id
    db.commit()

    return {"success": True, "message": "Subtag atualizada com sucesso"}


@router.patch("/credit-card-invoices/{invoice_id}/subtag", status_code=200)
async def update_credit_card_invoice_subtag(
    invoice_id: int,
    request: UpdateSubtagRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Atualiza o subtag_id de uma fatura de cartão."""
    tenant_id = current_user.get("tenant_id", 1)

    # Verificar se a invoice existe
    # NOTA: CreditCardInvoice NÃO tem campo 'active'
    invoice = db.query(CreditCardInvoice).filter(
        CreditCardInvoice.id == invoice_id,
        CreditCardInvoice.tenant_id == tenant_id
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")

    # Verificar se a subtag existe e pertence ao tenant
    # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
    subtag = db.query(Subtag).filter(
        Subtag.id == request.subtag_id,
        Subtag.tenant_id == tenant_id
    ).first()

    if not subtag:
        raise HTTPException(status_code=404, detail="Subtag não encontrada")

    # Atualizar subtag_id
    invoice.subtag_id = request.subtag_id
    db.commit()

    return {"success": True, "message": "Subtag atualizada com sucesso"}


@router.patch("/benefit-card-statements/{statement_id}/subtag", status_code=200)
async def update_benefit_card_statement_subtag(
    statement_id: int,
    request: UpdateSubtagRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Atualiza o subtag_id de um extrato de cartão de benefícios."""
    tenant_id = current_user.get("tenant_id", 1)

    # Verificar se o statement existe
    statement = db.query(BenefitCardStatement).filter(
        BenefitCardStatement.id == statement_id,
        BenefitCardStatement.tenant_id == tenant_id,
        BenefitCardStatement.active == True
    ).first()

    if not statement:
        raise HTTPException(status_code=404, detail="Extrato de benefício não encontrado")

    # Verificar se a subtag existe e pertence ao tenant
    # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
    subtag = db.query(Subtag).filter(
        Subtag.id == request.subtag_id,
        Subtag.tenant_id == tenant_id
    ).first()

    if not subtag:
        raise HTTPException(status_code=404, detail="Subtag não encontrada")

    # Atualizar subtag_id
    statement.subtag_id = request.subtag_id
    account_id = _account_id_for_benefit(db, statement)
    closure_impact = after_benefit_subtag_updated(db, tenant_id, account_id, statement)
    db.commit()

    return {
        "success": True,
        "message": "Subtag atualizada com sucesso",
        "closure_impact": closure_impact if closure_impact.get("impact_type") != "none" else None,
    }


# ==================== BULK UPDATE SUBTAGS ====================

class BulkUpdateSubtagItem(BaseModel):
    """Item para atualização em lote"""
    id: int
    source: Literal["bank", "card", "benefit"]
    subtag_id: int
    expense_sharing_id: int | None = None
    ownership_percentage: Decimal | None = None


class BulkUpdateSubtagRequest(BaseModel):
    """Request para atualização em lote de subtags"""
    records: List[BulkUpdateSubtagItem]


class BulkUpdateSubtagResponse(BaseModel):
    """Response para atualização em lote"""
    success: bool
    updated: int
    errors: List[str]


@router.patch("/bulk-update-subtags", response_model=BulkUpdateSubtagResponse, status_code=200)
async def bulk_update_subtags(
    request: BulkUpdateSubtagRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Atualiza subtag_id de múltiplos registros de uma vez."""
    tenant_id = current_user.get("tenant_id", 1)

    updated_count = 0
    errors = []

    for item in request.records:
        try:
            # Verificar se a subtag existe
            # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
            subtag = db.query(Subtag).filter(
                Subtag.id == item.subtag_id,
                Subtag.tenant_id == tenant_id
            ).first()

            if not subtag:
                errors.append(f"ID {item.id}: Subtag {item.subtag_id} não encontrada")
                continue

            # Verificar se expense_sharing_id foi explicitamente enviado no payload
            # (Pydantic v2: model_fields_set contém os campos que foram definidos explicitamente)
            sharing_explicitly_set = 'expense_sharing_id' in item.model_fields_set

            # Atualizar conforme o tipo
            if item.source == "bank":
                # NOTA: BankStatement NÃO tem campo 'active'
                statement = db.query(BankStatement).filter(
                    BankStatement.id == item.id,
                    BankStatement.tenant_id == tenant_id
                ).first()

                if not statement:
                    errors.append(f"ID {item.id}: Extrato não encontrado")
                    continue

                statement.subtag_id = item.subtag_id
                # Só atualiza compartilhamento se o campo foi EXPLICITAMENTE enviado no payload
                if sharing_explicitly_set:
                    if item.expense_sharing_id is not None:
                        # Definir novo compartilhamento
                        statement.expense_sharing_id = item.expense_sharing_id
                        statement.ownership_percentage = item.ownership_percentage if item.ownership_percentage is not None else Decimal('100.00')
                    else:
                        # Limpar compartilhamento (enviou null explicitamente)
                        statement.expense_sharing_id = None
                        statement.ownership_percentage = Decimal('100.00')
                # Se não foi enviado, mantém o valor atual (não faz nada)
                updated_count += 1

            elif item.source == "card":
                # NOTA: CreditCardInvoice NÃO tem campo 'active'
                invoice = db.query(CreditCardInvoice).filter(
                    CreditCardInvoice.id == item.id,
                    CreditCardInvoice.tenant_id == tenant_id
                ).first()

                if not invoice:
                    errors.append(f"ID {item.id}: Fatura não encontrada")
                    continue

                invoice.subtag_id = item.subtag_id
                # Só atualiza compartilhamento se o campo foi EXPLICITAMENTE enviado no payload
                if sharing_explicitly_set:
                    if item.expense_sharing_id is not None:
                        # Definir novo compartilhamento
                        invoice.expense_sharing_id = item.expense_sharing_id
                        invoice.ownership_percentage = item.ownership_percentage if item.ownership_percentage is not None else Decimal('100.00')
                    else:
                        # Limpar compartilhamento (enviou null explicitamente)
                        invoice.expense_sharing_id = None
                        invoice.ownership_percentage = Decimal('100.00')
                # Se não foi enviado, mantém o valor atual (não faz nada)
                updated_count += 1

            else:  # benefit
                benefit_statement = db.query(BenefitCardStatement).filter(
                    BenefitCardStatement.id == item.id,
                    BenefitCardStatement.tenant_id == tenant_id
                ).first()

                if not benefit_statement:
                    errors.append(f"ID {item.id}: Extrato de benefício não encontrado")
                    continue

                benefit_statement.subtag_id = item.subtag_id
                # Só atualiza compartilhamento se o campo foi EXPLICITAMENTE enviado no payload
                if sharing_explicitly_set:
                    if item.expense_sharing_id is not None:
                        # Definir novo compartilhamento
                        benefit_statement.expense_sharing_id = item.expense_sharing_id
                        benefit_statement.ownership_percentage = item.ownership_percentage if item.ownership_percentage is not None else Decimal('100.00')
                    else:
                        # Limpar compartilhamento (enviou null explicitamente)
                        benefit_statement.expense_sharing_id = None
                        benefit_statement.ownership_percentage = Decimal('100.00')
                # Se não foi enviado, mantém o valor atual (não faz nada)
                updated_count += 1

        except Exception as e:
            errors.append(f"ID {item.id}: {str(e)}")
            continue

    # Commit todas as alterações de uma vez
    db.commit()

    return BulkUpdateSubtagResponse(
        success=True,
        updated=updated_count,
        errors=errors[:10]  # Limita a 10 erros
    )


# ==================== UNMAPPED RECORDS ====================

@router.get("/unmapped-records", response_model=List[UnmappedRecordResponse])
async def get_unmapped_records(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Lista todos os registros não mapeados (subtag_id NULL).

    Registros aparecem na curadoria quando:
    - subtag_id é NULL (não foi possível mapear automaticamente)
    """
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # Busca extratos bancários não mapeados (subtag_id NULL)
    # NOTA: BankStatement NÃO tem campo 'active'
    bank_statements = db.query(BankStatement).filter(
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == account_id,  # ✅ FILTRO POR ACCOUNT_ID
        BankStatement.subtag_id == None
    ).order_by(BankStatement.date.desc()).all()

    # Busca faturas de cartão não mapeadas (subtag_id NULL)
    # NOTA: CreditCardInvoice NÃO tem campo 'active'
    credit_card_invoices = db.query(CreditCardInvoice).join(
        Cartao, CreditCardInvoice.credit_card_id == Cartao.id
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        CreditCardInvoice.account_id == account_id,  # ✅ FILTRO POR ACCOUNT_ID
        CreditCardInvoice.subtag_id == None
    ).order_by(CreditCardInvoice.date.desc()).all()

    # Busca extratos de cartão de benefícios não mapeados (subtag_id NULL)
    # NOTA: BenefitCardStatement NÃO tem campo 'active' (não usa soft delete)
    benefit_card_statements = db.query(BenefitCardStatement).join(
        Cartao, BenefitCardStatement.credit_card_id == Cartao.id
    ).filter(
        BenefitCardStatement.tenant_id == tenant_id,
        Cartao.account_id == account_id,  # ✅ FILTRO POR ACCOUNT_ID (via join)
        BenefitCardStatement.subtag_id == None
    ).order_by(BenefitCardStatement.date.desc()).all()

    # Combina resultados
    results = []

    for stmt in bank_statements:
        # Busca tag_id através da subtag
        tag_id = None
        if stmt.subtag_id:
            subtag = db.query(Subtag).filter(Subtag.id == stmt.subtag_id).first()
            if subtag:
                tag_id = subtag.tag_id

        results.append(UnmappedRecordResponse(
            id=stmt.id,
            date=stmt.date.strftime("%Y-%m-%d"),
            description=stmt.description,
            amount=float(stmt.amount),
            source="bank",
            card_number=None,
            card_owner=None,
            category=stmt.category,
            tag_id=tag_id,
            subtag_id=stmt.subtag_id,
            current_installment=None,
            total_installments=None,
            year_month=None
        ))

    for inv in credit_card_invoices:
        # Busca tag_id através da subtag
        tag_id = None
        if inv.subtag_id:
            subtag = db.query(Subtag).filter(Subtag.id == inv.subtag_id).first()
            if subtag:
                tag_id = subtag.tag_id

        results.append(UnmappedRecordResponse(
            id=inv.id,
            date=inv.date.strftime("%Y-%m-%d"),
            description=inv.description,
            amount=float(inv.amount),
            source="card",
            card_number=inv.credit_card.number if inv.credit_card else None,
            card_owner=inv.credit_card.name if inv.credit_card else None,
            category=None,
            tag_id=tag_id,
            subtag_id=inv.subtag_id,
            current_installment=inv.current_installment,
            total_installments=inv.total_installments,
            year_month=inv.year_month
        ))

    for benefit in benefit_card_statements:
        # Busca tag_id através da subtag
        tag_id = None
        if benefit.subtag_id:
            subtag = db.query(Subtag).filter(Subtag.id == benefit.subtag_id).first()
            if subtag:
                tag_id = subtag.tag_id

        results.append(UnmappedRecordResponse(
            id=benefit.id,
            date=benefit.date.strftime("%Y-%m-%d"),
            description=benefit.description,
            amount=float(benefit.amount),
            source="benefit",
            card_number=benefit.credit_card.number if benefit.credit_card else None,
            card_owner=benefit.credit_card.name if benefit.credit_card else None,
            category=None,
            tag_id=tag_id,
            subtag_id=benefit.subtag_id,
            current_installment=None,
            total_installments=None,
            year_month=None
        ))

    # Ordena por data (mais recente primeiro)
    results.sort(key=lambda x: x.date, reverse=True)

    return results


# ==================== BANK STATEMENTS UPDATE ====================

class BankStatementUpdate(BaseModel):
    """Schema para atualização de extrato bancário"""
    description: str
    amount: float
    date: datetime
    subtag_id: int | None = None
    shared_partner_id: int | None = None
    ownership_percentage: float | None = None
    confirm_closed_closure_impact: bool = False


@router.put("/bank-statements/{statement_id}", status_code=200)
async def update_bank_statement(
    statement_id: int,
    request: BankStatementUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Atualiza um extrato bancário."""
    tenant_id = current_user.get("tenant_id", 1)

    # NOTA: BankStatement NÃO tem campo 'active'
    statement = db.query(BankStatement).filter(
        BankStatement.id == statement_id,
        BankStatement.tenant_id == tenant_id
    ).first()

    if not statement:
        raise HTTPException(status_code=404, detail="Extrato não encontrado")

    old_date = statement.date
    try:
        change_kind = ensure_bank_update_allowed(
            db,
            tenant_id,
            statement.account_id,
            int(current_user.get("user_id") or current_user.get("id") or 0),
            statement,
            description=request.description,
            amount=request.amount,
            date=request.date,
            subtag_id=request.subtag_id,
            shared_partner_id=request.shared_partner_id,
            ownership_percentage=request.ownership_percentage,
            confirm_closed_closure_impact=request.confirm_closed_closure_impact,
        )
    except AccountPeriodClosedError as exc:
        detail: dict | str = exc.message
        if exc.payload:
            detail = {"message": exc.message, **exc.payload}
        raise HTTPException(status_code=409, detail=detail) from exc

    # Atualiza os campos
    statement.description = request.description
    statement.amount = request.amount
    statement.date = request.date
    statement.subtag_id = request.subtag_id
    statement.expense_sharing_id = request.shared_partner_id
    # Se ownership_percentage for None, usa 100.00 (despesa própria)
    statement.ownership_percentage = request.ownership_percentage if request.ownership_percentage is not None else 100.00

    closure_impact = after_bank_statement_updated(
        db,
        tenant_id,
        statement.account_id,
        int(current_user.get("user_id") or current_user.get("id") or 0),
        statement,
        kind=change_kind,
        old_date=old_date,
        note=f"Retificação extrato #{statement_id}",
    )

    db.commit()
    db.refresh(statement)

    return {
        "success": True,
        "message": "Extrato atualizado com sucesso",
        "id": statement_id,
        "closure_impact": closure_impact if closure_impact.get("impact_type") != "none" else None,
    }


# ==================== CREDIT CARD INVOICES UPDATE ====================

class CreditCardInvoiceUpdate(BaseModel):
    """Schema para atualização de fatura de cartão"""
    description: str
    amount: float
    date: datetime
    subtag_id: int | None = None
    card_number: str | None = None
    shared_partner_id: int | None = None
    ownership_percentage: float | None = None
    current_installment: int | None = Field(default=None, ge=1)
    total_installments: int | None = Field(default=None, ge=1)
    confirm_closed_closure_impact: bool = False


@router.put("/credit-card-invoices/{invoice_id}", status_code=200)
async def update_credit_card_invoice(
    invoice_id: int,
    request: CreditCardInvoiceUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Atualiza uma fatura de cartão."""
    tenant_id = current_user.get("tenant_id", 1)

    # NOTA: CreditCardInvoice NÃO tem campo 'active'
    invoice = db.query(CreditCardInvoice).filter(
        CreditCardInvoice.id == invoice_id,
        CreditCardInvoice.tenant_id == tenant_id
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")

    cur_inst = request.current_installment
    tot_inst = request.total_installments
    if (cur_inst is None) != (tot_inst is None):
        raise HTTPException(
            status_code=400,
            detail="Informe parcela atual e total de parcelas, ou deixe ambos vazios",
        )
    if cur_inst is not None and tot_inst is not None and cur_inst > tot_inst:
        raise HTTPException(
            status_code=400,
            detail="Parcela atual não pode ser maior que o total de parcelas",
        )

    card_account_id = _account_id_for_card_invoice(db, invoice)
    old_date = invoice.date
    try:
        change_kind = ensure_credit_card_update_allowed(
            db,
            tenant_id,
            card_account_id,
            int(current_user.get("user_id") or current_user.get("id") or 0),
            invoice,
            description=request.description,
            amount=request.amount,
            date=request.date,
            subtag_id=request.subtag_id,
            shared_partner_id=request.shared_partner_id,
            ownership_percentage=request.ownership_percentage,
            confirm_closed_closure_impact=request.confirm_closed_closure_impact,
        )
    except AccountPeriodClosedError as exc:
        raise HTTPException(status_code=409, detail=_closure_impact_http_detail(exc)) from exc

    # Atualiza os campos
    invoice.description = request.description
    invoice.amount = request.amount
    invoice.date = request.date
    invoice.subtag_id = request.subtag_id
    invoice.current_installment = cur_inst
    invoice.total_installments = tot_inst
    invoice.expense_sharing_id = request.shared_partner_id
    # Se ownership_percentage for None, usa 100.00 (despesa própria)
    invoice.ownership_percentage = request.ownership_percentage if request.ownership_percentage is not None else 100.00

    # Atualiza card_number e credit_card_id se fornecido
    if request.card_number is not None:
        # Busca o ID do cartão usando normalização de número
        card_id = CardHelper.get_card_id_by_number(db, request.card_number, tenant_id)

        if not card_id:
            raise HTTPException(status_code=404, detail=f"Cartão não encontrado: {request.card_number}")

        invoice.card_number = request.card_number
        invoice.credit_card_id = card_id
        card_account_id = _account_id_for_card_invoice(db, invoice)

    closure_impact = after_credit_card_updated(
        db,
        tenant_id,
        card_account_id,
        int(current_user.get("user_id") or current_user.get("id") or 0),
        invoice,
        kind=change_kind,
        old_date=old_date,
        note=f"Retificação fatura #{invoice_id}",
    )

    db.commit()
    db.refresh(invoice)

    return {
        "success": True,
        "message": "Fatura atualizada com sucesso",
        "id": invoice_id,
        "closure_impact": closure_impact if closure_impact.get("impact_type") != "none" else None,
    }


# ==================== BANK STATEMENTS DELETE ====================

@router.delete("/bank-statements/{statement_id}", status_code=204)
async def delete_bank_statement(
    statement_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Deleta permanentemente um extrato bancário (hard delete)."""
    tenant_id = current_user.get("tenant_id", 1)

    # NOTA: BankStatement NÃO tem campo 'active' - usa hard delete
    statement = db.query(BankStatement).filter(
        BankStatement.id == statement_id,
        BankStatement.tenant_id == tenant_id
    ).first()

    if not statement:
        raise HTTPException(status_code=404, detail="Extrato não encontrado")

    _guard_closed_account_period(db, tenant_id, statement.account_id, statement.date)

    db.delete(statement)
    db.commit()

    return None


# ==================== CREDIT CARD INVOICES DELETE ====================

@router.delete("/credit-card-invoices/{invoice_id}", status_code=204)
async def delete_credit_card_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Deleta permanentemente uma fatura de cartão (hard delete)."""
    tenant_id = current_user.get("tenant_id", 1)

    # NOTA: CreditCardInvoice NÃO tem campo 'active' - usa hard delete
    invoice = db.query(CreditCardInvoice).filter(
        CreditCardInvoice.id == invoice_id,
        CreditCardInvoice.tenant_id == tenant_id
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")

    db.delete(invoice)
    db.commit()

    return None


# ==================== SPLIT EXPENSES ====================

class SplitPart(BaseModel):
    """Representa uma parte da divisão de despesa"""
    amount: float
    subtag_id: int


class SplitExpenseRequest(BaseModel):
    """Request para dividir uma despesa em múltiplas partes"""
    parts: List[SplitPart]
    confirm_closed_closure_impact: bool = False


@router.post("/bank-statements/{statement_id}/split", status_code=200)
async def split_bank_statement(
    statement_id: int,
    request: SplitExpenseRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Divide um extrato bancário em múltiplas partes.

    O registro original é atualizado com a primeira parte,
    e novos registros são criados para as demais partes.
    """
    tenant_id = current_user.get("tenant_id", 1)
    user_id = int(current_user.get("user_id") or current_user.get("id") or 0)

    # Busca o registro original
    # NOTA: BankStatement NÃO tem campo 'active'
    original = db.query(BankStatement).filter(
        BankStatement.id == statement_id,
        BankStatement.tenant_id == tenant_id
    ).first()

    if not original:
        raise HTTPException(status_code=404, detail="Extrato não encontrado")

    # Validações
    if len(request.parts) < 2:
        raise HTTPException(status_code=400, detail="É necessário ter pelo menos 2 partes")

    total_parts = sum(part.amount for part in request.parts)
    # Converte para Decimal para comparação
    total_parts_decimal = Decimal(str(total_parts))
    if abs(total_parts_decimal - original.amount) > Decimal('0.01'):
        raise HTTPException(
            status_code=400,
            detail=f"A soma das partes ({total_parts}) deve ser igual ao valor original ({original.amount})"
        )

    # Verifica se todas as subtags existem
    # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
    for part in request.parts:
        subtag = db.query(Subtag).filter(
            Subtag.id == part.subtag_id,
            Subtag.tenant_id == tenant_id
        ).first()
        if not subtag:
            raise HTTPException(status_code=404, detail=f"Subtag {part.subtag_id} não encontrada")

    def apply_bank_split() -> None:
        first_part = request.parts[0]
        original.amount = first_part.amount
        original.subtag_id = first_part.subtag_id
        for part in request.parts[1:]:
            db.add(
                BankStatement(
                    tenant_id=tenant_id,
                    created_by=current_user.get("id"),
                    account_id=original.account_id,
                    date=original.date,
                    category=original.category,
                    transaction=original.transaction,
                    description=original.description,
                    amount=part.amount,
                    subtag_id=part.subtag_id,
                )
            )

    try:
        ensure_closed_period_change_allowed(
            db,
            tenant_id,
            original.account_id,
            user_id,
            original.date,
            request.confirm_closed_closure_impact,
            lambda: (apply_bank_split(), db.flush()),
        )
    except AccountPeriodClosedError as exc:
        detail: dict | str = exc.message
        if exc.payload:
            detail = {"message": exc.message, **exc.payload}
        raise HTTPException(status_code=409, detail=detail) from exc

    apply_bank_split()
    db.flush()
    closure_impact = after_expense_split(
        db,
        tenant_id,
        original.account_id,
        user_id,
        original.date,
        note=f"Divisão extrato #{statement_id}",
    )
    db.commit()

    impact_payload = closure_impact if closure_impact.get("impact_type") != "none" else None
    return {
        "success": True,
        "message": f"Extrato dividido em {len(request.parts)} partes",
        "original_id": statement_id,
        "parts_created": len(request.parts) - 1,
        "closure_impact": impact_payload,
    }


@router.post("/credit-card-invoices/{invoice_id}/split", status_code=200)
async def split_credit_card_invoice(
    invoice_id: int,
    request: SplitExpenseRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Divide uma fatura de cartão em múltiplas partes.

    O registro original é atualizado com a primeira parte,
    e novos registros são criados para as demais partes.
    """
    tenant_id = current_user.get("tenant_id", 1)
    user_id = int(current_user.get("user_id") or current_user.get("id") or 0)

    # Busca o registro original
    # NOTA: CreditCardInvoice NÃO tem campo 'active'
    original = db.query(CreditCardInvoice).filter(
        CreditCardInvoice.id == invoice_id,
        CreditCardInvoice.tenant_id == tenant_id
    ).first()

    if not original:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")

    # Validações
    if len(request.parts) < 2:
        raise HTTPException(status_code=400, detail="É necessário ter pelo menos 2 partes")

    total_parts = sum(part.amount for part in request.parts)
    # Converte para Decimal para comparação
    total_parts_decimal = Decimal(str(total_parts))
    if abs(total_parts_decimal - original.amount) > Decimal('0.01'):
        raise HTTPException(
            status_code=400,
            detail=f"A soma das partes ({total_parts}) deve ser igual ao valor original ({original.amount})"
        )

    # Verifica se todas as subtags existem
    # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
    for part in request.parts:
        subtag = db.query(Subtag).filter(
            Subtag.id == part.subtag_id,
            Subtag.tenant_id == tenant_id
        ).first()
        if not subtag:
            raise HTTPException(status_code=404, detail=f"Subtag {part.subtag_id} não encontrada")

    card_account_id = _account_id_for_card_invoice(db, original)

    def apply_card_split() -> None:
        first_part = request.parts[0]
        original.amount = first_part.amount
        original.subtag_id = first_part.subtag_id
        for part in request.parts[1:]:
            db.add(
                CreditCardInvoice(
                    tenant_id=tenant_id,
                    created_by=current_user.get("id"),
                    credit_card_id=original.credit_card_id,
                    date=original.date,
                    year_month=original.year_month,
                    description=original.description,
                    amount=part.amount,
                    current_installment=original.current_installment,
                    total_installments=original.total_installments,
                    subtag_id=part.subtag_id,
                    issuer=original.issuer or "btg",
                )
            )

    if card_account_id is not None:
        try:
            ensure_closed_period_change_allowed(
                db,
                tenant_id,
                card_account_id,
                user_id,
                original.date,
                request.confirm_closed_closure_impact,
                lambda: (apply_card_split(), db.flush()),
            )
        except AccountPeriodClosedError as exc:
            detail: dict | str = exc.message
            if exc.payload:
                detail = {"message": exc.message, **exc.payload}
            raise HTTPException(status_code=409, detail=detail) from exc

    apply_card_split()
    db.flush()
    closure_impact = after_expense_split(
        db,
        tenant_id,
        card_account_id,
        user_id,
        original.date,
        note=f"Divisão fatura #{invoice_id}",
    )
    db.commit()

    impact_payload = closure_impact if closure_impact.get("impact_type") != "none" else None
    return {
        "success": True,
        "message": f"Fatura dividida em {len(request.parts)} partes",
        "original_id": invoice_id,
        "parts_created": len(request.parts) - 1,
        "closure_impact": impact_payload,
    }


# ==================== LANÇAMENTO MANUAL ====================

class ManualTransactionCreate(BaseModel):
    """Schema para criação de lançamento manual."""
    account_id: int
    date: datetime
    description: str
    amount: Decimal
    subtag_id: int | None = None  # Opcional - se não informado, vai para curadoria
    expense_sharing_id: int | None = None
    ownership_percentage: Decimal = Decimal('100.00')
    adjustment_notes: str | None = None
    create_mapping: bool = False  # Flag para criar mapeamento automático
    confirm_closed_closure_impact: bool = False


class ManualTransactionResponse(BaseModel):
    """Schema de resposta para lançamento manual."""
    success: bool
    statement_id: int
    mapping_created: bool
    message: str
    closure_impact: dict | None = None


@router.post("/bank-statements/manual", response_model=ManualTransactionResponse, status_code=201)
async def create_manual_transaction(
    request: ManualTransactionCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Cria um lançamento manual de extrato bancário.

    Permite criar transações manualmente com todos os campos disponíveis:
    - Conta bancária
    - Data e descrição
    - Valor (positivo=receita, negativo=despesa)
    - Tag/Subtag
    - Parceiro compartilhado ou terceiro
    - Percentual de propriedade
    - Observações
    - Opção de criar mapeamento automático

    Args:
        request: Dados do lançamento manual
        db: Sessão do banco de dados
        current_user: Usuário autenticado

    Returns:
        Confirmação de criação com ID do statement e se mapeamento foi criado
    """
    tenant_id = current_user.get("tenant_id", 1)
    user_id = current_user.get("user_id", 1)

    # ========================================
    # VALIDAÇÕES
    # ========================================

    # 1. Validar conta bancária
    account = db.query(Account).filter(
        Account.id == request.account_id,
        Account.tenant_id == tenant_id,
        Account.active == True
    ).first()

    if not account:
        raise HTTPException(status_code=404, detail="Conta bancária não encontrada")

    # 2. Validar subtag (se fornecida)
    # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
    subtag = None
    if request.subtag_id:
        subtag = db.query(Subtag).filter(
            Subtag.id == request.subtag_id,
            Subtag.tenant_id == tenant_id
        ).first()

        if not subtag:
            raise HTTPException(status_code=404, detail="Subtag não encontrada")

        # 3. Validar tipo da subtag com o valor
        tipo_esperado = "receita" if request.amount > 0 else "despesa"
        if subtag.type != tipo_esperado:
            raise HTTPException(
                status_code=400,
                detail=f"Subtag do tipo '{subtag.type}' não pode ser usada para {tipo_esperado}. Valor: {request.amount}"
            )

    # 4. Validar compartilhamento (se fornecido)
    if request.expense_sharing_id:
        expense_sharing = db.query(ExpenseSharingSetting).filter(
            ExpenseSharingSetting.id == request.expense_sharing_id,
            ExpenseSharingSetting.tenant_id == tenant_id,
            ExpenseSharingSetting.active == True
        ).first()

        if not expense_sharing:
            raise HTTPException(status_code=404, detail="Compartilhamento não encontrado")

    # 5. Validar percentual de propriedade
    if request.ownership_percentage < 0 or request.ownership_percentage > 100:
        raise HTTPException(
            status_code=400,
            detail="Percentual de propriedade deve estar entre 0 e 100"
        )

    # ========================================
    # CRIAR LANÇAMENTO
    # ========================================

    new_statement = BankStatement(
        tenant_id=tenant_id,
        created_by=user_id,
        account_id=request.account_id,
        date=request.date,
        description=request.description,
        amount=request.amount,
        subtag_id=request.subtag_id,
        expense_sharing_id=request.expense_sharing_id,
        ownership_percentage=request.ownership_percentage,
        adjustment_notes=request.adjustment_notes,
        category=None,  # Lançamento manual não tem categoria do banco
        transaction=None  # Lançamento manual não tem tipo de transação do banco
        # NOTA: bank_statements NÃO tem coluna 'active' - usa hard delete
    )

    try:
        ensure_new_transaction_in_closed_period_allowed(
            db,
            tenant_id,
            request.account_id,
            int(user_id),
            request.date,
            request.confirm_closed_closure_impact,
            lambda: (db.add(new_statement), db.flush()),
        )
    except AccountPeriodClosedError as exc:
        detail: dict | str = exc.message
        if exc.payload:
            detail = {"message": exc.message, **exc.payload}
        raise HTTPException(status_code=409, detail=detail) from exc

    db.add(new_statement)
    db.flush()  # Para obter o ID

    # ========================================
    # CRIAR MAPEAMENTO (SE SOLICITADO E HOUVER SUBTAG)
    # ========================================

    mapping_created = False

    if request.create_mapping and request.subtag_id:
        # Verificar se já existe mapeamento para essa descrição
        # NOTA: TransactionMapping NÃO tem campo 'active' (não usa soft delete)
        existing_mapping = db.query(TransactionMapping).filter(
            TransactionMapping.tenant_id == tenant_id,
            TransactionMapping.account_id == request.account_id,
            TransactionMapping.mapping_type == 'exact',
            func.lower(TransactionMapping.original_description) == request.description.lower()
        ).first()

        if not existing_mapping:
            # Criar novo mapeamento
            new_mapping = TransactionMapping(
                tenant_id=tenant_id,
                account_id=request.account_id,
                created_by=user_id,
                mapping_type='exact',
                original_description=request.description.lower(),
                mapped_description=None,  # Usa a descrição original
                subtag_id=request.subtag_id,
                expense_sharing_id=request.expense_sharing_id,
                priority=0,
                is_sensitive=False
            )

            db.add(new_mapping)
            mapping_created = True

    closure_impact = after_new_transaction_in_closed_period(
        db,
        tenant_id,
        request.account_id,
        int(user_id),
        request.date,
        note="Lançamento manual",
    )

    db.commit()

    # ========================================
    # RESPOSTA
    # ========================================

    message = "Lançamento criado com sucesso!"
    if mapping_created:
        message += " Mapeamento automático criado."

    return ManualTransactionResponse(
        success=True,
        statement_id=new_statement.id,
        mapping_created=mapping_created,
        message=message,
        closure_impact=closure_impact if closure_impact.get("impact_type") != "none" else None,
    )


def _resolve_invoice_issuer_for_card(db: Session, tenant_id: int, credit_card_id: int) -> str:
    """Emissor mais frequente nos lançamentos já importados desse cartão."""
    row = (
        db.query(CreditCardInvoice.issuer, func.count().label("cnt"))
        .filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.credit_card_id == credit_card_id,
        )
        .group_by(CreditCardInvoice.issuer)
        .order_by(func.count().desc())
        .first()
    )
    if row and row[0] in ("btg", "mercadopago"):
        return row[0]
    return "btg"


class ManualCreditCardInvoiceCreate(BaseModel):
    """Schema para acerto manual em fatura de cartão."""

    credit_card_id: int
    year_month: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    date: datetime
    description: str = Field(..., min_length=1)
    amount: Decimal
    subtag_id: int | None = None
    expense_sharing_id: int | None = None
    ownership_percentage: Decimal = Decimal("100.00")
    current_installment: int | None = Field(default=None, ge=1)
    total_installments: int | None = Field(default=None, ge=1)
    issuer: str | None = None
    adjustment_notes: str | None = None
    create_mapping: bool = False
    confirm_closed_closure_impact: bool = False

    @field_validator("year_month")
    @classmethod
    def validate_year_month(cls, value: str) -> str:
        year_str, month_str = value.split("-", 1)
        month = int(month_str)
        if month < 1 or month > 12:
            raise ValueError("Mês inválido em year_month")
        int(year_str)
        return value

    @field_validator("issuer")
    @classmethod
    def validate_issuer(cls, value: str | None) -> str | None:
        if value is None:
            return None
        from app.converters.fatura_pdf import normalize_invoice_issuer

        normalized = normalize_invoice_issuer(value)
        if normalized not in ("btg", "mercadopago"):
            raise ValueError("Emissor inválido")
        return normalized


class ManualCreditCardInvoiceResponse(BaseModel):
    success: bool
    invoice_id: int
    mapping_created: bool
    message: str
    closure_impact: dict | None = None


@router.post(
    "/credit-card-invoices/manual",
    response_model=ManualCreditCardInvoiceResponse,
    status_code=201,
)
async def create_manual_credit_card_invoice(
    request: ManualCreditCardInvoiceCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """
    Cria um lançamento manual na fatura de um cartão (acerto), com os mesmos campos
    persistidos na importação: valor, tag/subtag, compartilhamento e parcelas.
    """
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")
    user_id = current_user.get("user_id") or current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Usuário inválido no token")

    cur_inst = request.current_installment
    tot_inst = request.total_installments
    if (cur_inst is None) != (tot_inst is None):
        raise HTTPException(
            status_code=400,
            detail="Informe parcela atual e total de parcelas, ou deixe ambos vazios",
        )
    if cur_inst is not None and tot_inst is not None and cur_inst > tot_inst:
        raise HTTPException(
            status_code=400,
            detail="Parcela atual não pode ser maior que o total de parcelas",
        )

    cartao = (
        db.query(Cartao)
        .filter(
            Cartao.id == request.credit_card_id,
            Cartao.tenant_id == tenant_id,
            Cartao.account_id == account_id,
            Cartao.active == True,
        )
        .first()
    )
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado")
    if cartao.type != "credito":
        raise HTTPException(
            status_code=400,
            detail="Acertos manuais de fatura só se aplicam a cartões de crédito",
        )

    if request.subtag_id:
        subtag = (
            db.query(Subtag)
            .filter(Subtag.id == request.subtag_id, Subtag.tenant_id == tenant_id)
            .first()
        )
        if not subtag:
            raise HTTPException(status_code=404, detail="Subtag não encontrada")
        tipo_esperado = "receita" if request.amount >= 0 else "despesa"
        if subtag.type != tipo_esperado:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Subtag do tipo '{subtag.type}' não pode ser usada para {tipo_esperado}. "
                    f"Valor: {request.amount}"
                ),
            )

    if request.expense_sharing_id:
        expense_sharing = (
            db.query(ExpenseSharingSetting)
            .filter(
                ExpenseSharingSetting.id == request.expense_sharing_id,
                ExpenseSharingSetting.tenant_id == tenant_id,
                ExpenseSharingSetting.active == True,
            )
            .first()
        )
        if not expense_sharing:
            raise HTTPException(status_code=404, detail="Compartilhamento não encontrado")

    if request.ownership_percentage < 0 or request.ownership_percentage > 100:
        raise HTTPException(
            status_code=400,
            detail="Percentual de propriedade deve estar entre 0 e 100",
        )

    description = request.description.strip()
    if not description:
        raise HTTPException(status_code=400, detail="Descrição é obrigatória")

    notes = (request.adjustment_notes or "").strip() or "Acerto manual"

    if request.issuer:
        issuer = request.issuer
    else:
        issuer = _resolve_invoice_issuer_for_card(db, tenant_id, cartao.id)

    card_account_id = cartao.account_id or account_id
    if card_account_id is None:
        raise HTTPException(status_code=400, detail="Conta do cartão não encontrada")

    new_invoice = CreditCardInvoice(
        tenant_id=tenant_id,
        created_by=int(user_id),
        account_id=card_account_id,
        credit_card_id=cartao.id,
        year_month=request.year_month,
        date=request.date,
        description=description,
        amount=request.amount,
        current_installment=cur_inst,
        total_installments=tot_inst,
        subtag_id=request.subtag_id,
        expense_sharing_id=request.expense_sharing_id,
        ownership_percentage=request.ownership_percentage,
        adjustment_notes=notes,
        issuer=issuer,
    )
    try:
        ensure_new_transaction_in_closed_period_allowed(
            db,
            tenant_id,
            int(card_account_id),
            int(user_id),
            request.date,
            request.confirm_closed_closure_impact,
            lambda: (db.add(new_invoice), db.flush()),
        )
    except AccountPeriodClosedError as exc:
        detail: dict | str = exc.message
        if exc.payload:
            detail = {"message": exc.message, **exc.payload}
        raise HTTPException(status_code=409, detail=detail) from exc

    db.add(new_invoice)
    db.flush()

    mapping_created = False
    if request.create_mapping and request.subtag_id and account_id:
        existing_mapping = (
            db.query(TransactionMapping)
            .filter(
                TransactionMapping.tenant_id == tenant_id,
                TransactionMapping.account_id == account_id,
                TransactionMapping.mapping_type == "exact",
                func.lower(TransactionMapping.original_description) == description.lower(),
            )
            .first()
        )
        if not existing_mapping:
            db.add(
                TransactionMapping(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    created_by=int(user_id),
                    mapping_type="exact",
                    original_description=description.lower(),
                    mapped_description=None,
                    subtag_id=request.subtag_id,
                    expense_sharing_id=request.expense_sharing_id,
                    priority=0,
                    is_sensitive=False,
                )
            )
            mapping_created = True

    closure_impact = after_new_transaction_in_closed_period(
        db,
        tenant_id,
        int(card_account_id),
        int(user_id),
        request.date,
        note="Acerto manual fatura",
    )

    db.commit()

    message = "Lançamento adicionado à fatura com sucesso!"
    if mapping_created:
        message += " Mapeamento automático criado."

    return ManualCreditCardInvoiceResponse(
        success=True,
        invoice_id=new_invoice.id,
        mapping_created=mapping_created,
        message=message,
        closure_impact=closure_impact if closure_impact.get("impact_type") != "none" else None,
    )


class ManualBenefitStatementCreate(BaseModel):
    """Schema para criação de lançamento manual em cartão de benefícios."""
    credit_card_id: int
    date: datetime
    description: str
    amount: Decimal
    subtag_id: int | None = None
    expense_sharing_id: int | None = None
    ownership_percentage: Decimal = Decimal("100.00")
    adjustment_notes: str | None = None
    create_mapping: bool = False
    payment_method: str | None = "Manual"
    confirm_closed_closure_impact: bool = False


class ManualBenefitStatementResponse(BaseModel):
    success: bool
    statement_id: int
    mapping_created: bool
    message: str
    closure_impact: dict | None = None


@router.post(
    "/benefit-card-statements/manual",
    response_model=ManualBenefitStatementResponse,
    status_code=201,
)
async def create_manual_benefit_statement(
    request: ManualBenefitStatementCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Cria um lançamento manual em extrato de cartão de benefícios."""
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")
    user_id = current_user.get("user_id") or current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Usuário inválido no token")

    cartao = (
        db.query(Cartao)
        .filter(
            Cartao.id == request.credit_card_id,
            Cartao.tenant_id == tenant_id,
            Cartao.account_id == account_id,
            Cartao.active == True,
        )
        .first()
    )
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado")
    if cartao.type != "beneficios":
        raise HTTPException(
            status_code=400,
            detail="Lançamento manual de benefício exige cartão do tipo 'beneficios'",
        )

    if request.subtag_id:
        subtag = (
            db.query(Subtag)
            .filter(Subtag.id == request.subtag_id, Subtag.tenant_id == tenant_id)
            .first()
        )
        if not subtag:
            raise HTTPException(status_code=404, detail="Subtag não encontrada")
        tipo_esperado = "receita" if request.amount >= 0 else "despesa"
        if subtag.type != tipo_esperado:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Subtag do tipo '{subtag.type}' não pode ser usada para {tipo_esperado}. "
                    f"Valor: {request.amount}"
                ),
            )

    if request.expense_sharing_id:
        expense_sharing = (
            db.query(ExpenseSharingSetting)
            .filter(
                ExpenseSharingSetting.id == request.expense_sharing_id,
                ExpenseSharingSetting.tenant_id == tenant_id,
                ExpenseSharingSetting.active == True,
            )
            .first()
        )
        if not expense_sharing:
            raise HTTPException(status_code=404, detail="Compartilhamento não encontrado")

    if request.ownership_percentage < 0 or request.ownership_percentage > 100:
        raise HTTPException(
            status_code=400,
            detail="Percentual de propriedade deve estar entre 0 e 100",
        )

    description = request.description.strip()
    if not description:
        raise HTTPException(status_code=400, detail="Descrição é obrigatória")

    card_account_id = cartao.account_id or account_id
    if card_account_id is None:
        raise HTTPException(status_code=400, detail="Conta do cartão não encontrada")

    new_statement = BenefitCardStatement(
        tenant_id=tenant_id,
        created_by=int(user_id),
        credit_card_id=cartao.id,
        account_id=card_account_id,
        date=request.date,
        description=description,
        amount=request.amount,
        payment_method=(request.payment_method or "Manual").strip() or "Manual",
        subtag_id=request.subtag_id,
        expense_sharing_id=request.expense_sharing_id,
        ownership_percentage=request.ownership_percentage,
        adjustment_notes=request.adjustment_notes,
    )
    try:
        ensure_new_transaction_in_closed_period_allowed(
            db,
            tenant_id,
            int(card_account_id),
            int(user_id),
            request.date,
            request.confirm_closed_closure_impact,
            lambda: (db.add(new_statement), db.flush()),
        )
    except AccountPeriodClosedError as exc:
        detail: dict | str = exc.message
        if exc.payload:
            detail = {"message": exc.message, **exc.payload}
        raise HTTPException(status_code=409, detail=detail) from exc

    db.add(new_statement)
    db.flush()

    mapping_created = False
    if request.create_mapping and request.subtag_id and account_id:
        existing_mapping = (
            db.query(TransactionMapping)
            .filter(
                TransactionMapping.tenant_id == tenant_id,
                TransactionMapping.account_id == account_id,
                TransactionMapping.mapping_type == "exact",
                func.lower(TransactionMapping.original_description) == description.lower(),
            )
            .first()
        )
        if not existing_mapping:
            db.add(
                TransactionMapping(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    created_by=int(user_id),
                    mapping_type="exact",
                    original_description=description.lower(),
                    mapped_description=None,
                    subtag_id=request.subtag_id,
                    expense_sharing_id=request.expense_sharing_id,
                    priority=0,
                    is_sensitive=False,
                )
            )
            mapping_created = True

    closure_impact = after_new_transaction_in_closed_period(
        db,
        tenant_id,
        int(card_account_id),
        int(user_id),
        request.date,
        note="Lançamento manual benefício",
    )

    db.commit()

    message = "Lançamento de benefício criado com sucesso!"
    if mapping_created:
        message += " Mapeamento automático criado."

    return ManualBenefitStatementResponse(
        success=True,
        statement_id=new_statement.id,
        mapping_created=mapping_created,
        message=message,
        closure_impact=closure_impact if closure_impact.get("impact_type") != "none" else None,
    )


# ==================== BATCH UPDATE ====================

class BatchUpdateItem(BaseModel):
    """Item para atualização em lote"""
    id: int
    source: str  # 'bank', 'card', 'benefit'


class BatchUpdateRequest(BaseModel):
    """Request para atualização em lote de despesas"""
    items: List[BatchUpdateItem]
    subtag_id: int | None = None  # None = não alterar, 0 = limpar (remover categoria), >0 = definir
    expense_sharing_id: int | None = None  # None = não alterar, 0 = limpar (próprio), >0 = compartilhado
    ownership_percentage: float | None = None
    clear_subtag: bool = False  # Flag explícita para limpar subtag
    target_credit_card_id: int | None = None  # Lançamentos de fatura: mover para outro cartão no mesmo ciclo
    confirm_closed_closure_impact: bool = False


class BatchUpdateResponse(BaseModel):
    """Response para atualização em lote"""
    success: bool
    updated_count: int
    message: str
    closure_impact: dict | None = None


@router.patch("/batch-update", response_model=BatchUpdateResponse)
async def batch_update_expenses(
    request: BatchUpdateRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """
    Atualiza múltiplas despesas em lote.
    Apenas os campos preenchidos (não None) serão atualizados.
    """
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    if not request.items:
        raise HTTPException(status_code=400, detail="Nenhum item para atualizar")

    # Separar itens por fonte (usado também na movimentação entre cartões)
    bank_ids = [item.id for item in request.items if item.source == 'bank']
    card_ids = [item.id for item in request.items if item.source == 'card']
    benefit_ids = [item.id for item in request.items if item.source == 'benefit']

    has_field_update = (
        request.clear_subtag
        or request.subtag_id is not None
        or request.expense_sharing_id is not None
        or request.ownership_percentage is not None
    )

    moved = 0
    if request.target_credit_card_id is not None:
        if bank_ids or benefit_ids or not card_ids:
            raise HTTPException(
                status_code=400,
                detail="Mover cartão só se aplica a lançamentos de fatura de cartão",
            )
        if len(card_ids) != len(request.items):
            raise HTTPException(
                status_code=400,
                detail="Todos os itens selecionados devem ser lançamentos de fatura",
            )

        target_card = db.query(Cartao).filter(
            Cartao.id == request.target_credit_card_id,
            Cartao.tenant_id == tenant_id,
        ).first()
        if not target_card:
            raise HTTPException(status_code=404, detail="Cartão de destino não encontrado")

        invoices = db.query(CreditCardInvoice).filter(
            CreditCardInvoice.id.in_(card_ids),
            CreditCardInvoice.tenant_id == tenant_id,
        ).all()
        if len(invoices) != len(card_ids):
            raise HTTPException(status_code=404, detail="Um ou mais lançamentos não foram encontrados")

        year_months = {inv.year_month for inv in invoices}
        if len(year_months) != 1:
            raise HTTPException(
                status_code=400,
                detail="Todos os itens devem pertencer à mesma fatura (mesmo mês)",
            )
        year_month = next(iter(year_months))

        target_in_cycle = db.query(CreditCardInvoice.id).filter(
            CreditCardInvoice.credit_card_id == request.target_credit_card_id,
            CreditCardInvoice.year_month == year_month,
            CreditCardInvoice.tenant_id == tenant_id,
        ).first()
        if not target_in_cycle:
            raise HTTPException(
                status_code=400,
                detail="O cartão de destino não possui lançamentos nesta fatura",
            )

        moved = db.query(CreditCardInvoice).filter(
            CreditCardInvoice.id.in_(card_ids),
            CreditCardInvoice.tenant_id == tenant_id,
        ).update(
            {"credit_card_id": request.target_credit_card_id},
            synchronize_session=False,
        )
        if not has_field_update:
            db.commit()
            return BatchUpdateResponse(
                success=True,
                updated_count=moved,
                message=f"{moved} lançamento(s) movido(s) para o cartão selecionado",
            )

    # Verificar se subtag existe (se fornecida)
    if request.subtag_id is not None:
        subtag = db.query(Subtag).filter(
            Subtag.id == request.subtag_id,
            Subtag.tenant_id == tenant_id
        ).first()
        if not subtag:
            raise HTTPException(status_code=404, detail="Subtag não encontrada")

    # Verificar se expense_sharing existe (se fornecido e maior que 0)
    # expense_sharing_id = 0 significa "limpar compartilhamento", não precisa verificar
    if request.expense_sharing_id is not None and request.expense_sharing_id > 0:
        sharing = db.query(ExpenseSharingSetting).filter(
            ExpenseSharingSetting.id == request.expense_sharing_id,
            ExpenseSharingSetting.tenant_id == tenant_id,
            ExpenseSharingSetting.active == True
        ).first()
        if not sharing:
            raise HTTPException(status_code=404, detail="Parceiro de compartilhamento não encontrado")

    updated_count = 0

    # Construir campos para atualização
    update_fields = {}

    # Limpar subtag (flag explícita ou subtag_id = 0)
    if request.clear_subtag or request.subtag_id == 0:
        update_fields['subtag_id'] = None
    elif request.subtag_id is not None and request.subtag_id > 0:
        update_fields['subtag_id'] = request.subtag_id

    if request.expense_sharing_id is not None:
        update_fields['expense_sharing_id'] = request.expense_sharing_id
    if request.ownership_percentage is not None:
        update_fields['ownership_percentage'] = Decimal(str(request.ownership_percentage))

    # Se expense_sharing_id for 0, significa "próprio" (remover compartilhamento)
    if request.expense_sharing_id == 0:
        update_fields['expense_sharing_id'] = None
        update_fields['ownership_percentage'] = Decimal('100.00')

    if not update_fields:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar")

    has_sharing_change = request.expense_sharing_id is not None
    user_id = int(current_user.get("user_id") or current_user.get("id") or 0)

    if account_id is not None:
        try:
            ensure_batch_update_closure_allowed(
                db,
                tenant_id,
                int(account_id),
                user_id,
                bank_ids=bank_ids,
                card_ids=card_ids,
                benefit_ids=benefit_ids,
                update_fields=update_fields,
                has_sharing_change=has_sharing_change,
                confirm=request.confirm_closed_closure_impact,
            )
        except AccountPeriodClosedError as exc:
            raise HTTPException(status_code=409, detail=_closure_impact_http_detail(exc)) from exc

    # Atualizar bank_statements
    if bank_ids:
        result = db.query(BankStatement).filter(
            BankStatement.id.in_(bank_ids),
            BankStatement.tenant_id == tenant_id
        ).update(update_fields, synchronize_session=False)
        updated_count += result

    # Atualizar credit_card_invoices
    if card_ids:
        result = db.query(CreditCardInvoice).filter(
            CreditCardInvoice.id.in_(card_ids),
            CreditCardInvoice.tenant_id == tenant_id
        ).update(update_fields, synchronize_session=False)
        updated_count += result

    # Atualizar benefit_card_statements
    if benefit_ids:
        result = db.query(BenefitCardStatement).filter(
            BenefitCardStatement.id.in_(benefit_ids),
            BenefitCardStatement.tenant_id == tenant_id
        ).update(update_fields, synchronize_session=False)
        updated_count += result

    has_subtag_change = (
        request.clear_subtag
        or request.subtag_id is not None
    )

    closure_impact = None
    if account_id is not None:
        impact = post_batch_update_closure_sync(
            db,
            tenant_id,
            int(account_id),
            bank_ids=bank_ids,
            card_ids=card_ids,
            benefit_ids=benefit_ids,
            has_subtag_change=has_subtag_change,
            has_sharing_change=has_sharing_change,
            updated_count=updated_count,
        )
        if impact.get("impact_type") != "none":
            closure_impact = impact

    db.commit()

    message = f"{updated_count} registro(s) atualizado(s) com sucesso"
    if moved:
        message += f"; {moved} movido(s) para o cartão selecionado"
    return BatchUpdateResponse(
        success=True,
        updated_count=updated_count,
        message=message,
        closure_impact=closure_impact,
    )


# ==================== VISUAL EXTRATO IMPORT (Excel exportado pelo Plumo) ====================


class VisualExtratoImportRow(BaseModel):
    row_index: int | None = None
    date: str
    description: str
    amount: float
    tag: str | None = None
    subtag: str | None = None
    partner_name: str | None = None
    ownership_percentage: float | None = None
    category: str | None = None
    transaction: str | None = None
    card_last4: str | None = None
    payment_method: str | None = None
    keep_existing: bool = False


class VisualExtratoImportRowsPayload(BaseModel):
    bank_rows: List[VisualExtratoImportRow] = Field(default_factory=list)
    benefit_rows: List[VisualExtratoImportRow] = Field(default_factory=list)
    batch: ImportBatchPayload | None = None


class VisualExtratoImportRequest(VisualExtratoImportRowsPayload):
    confirm_closed_closure_impact: bool = False


class VisualExtratoImportPreviewResponse(BaseModel):
    summary: dict[str, Any]
    creates: list[dict[str, Any]]
    updates: list[dict[str, Any]]
    issues: list[dict[str, Any]]


@router.post("/visual-import/preview", response_model=VisualExtratoImportPreviewResponse)
async def visual_extrato_import_preview(
    request: VisualExtratoImportRowsPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Pré-visualiza upsert da planilha exportada (somente dados, sem fechamentos)."""
    tenant_id = int(current_user.get("tenant_id") or 1)
    account_id = current_user.get("account_id")
    if account_id is None:
        raise HTTPException(status_code=400, detail="Conta não selecionada")
    if not request.bank_rows and not request.benefit_rows:
        raise HTTPException(status_code=400, detail="Nenhuma linha para analisar")
    result = preview_visual_extrato_import(
        db,
        tenant_id,
        int(account_id),
        bank_rows=[row.model_dump() for row in request.bank_rows],
        benefit_rows=[row.model_dump() for row in request.benefit_rows],
        batch=ImportBatch(request.batch),
    )
    return VisualExtratoImportPreviewResponse(**result)


class VisualExtratoImportResponse(BaseModel):
    success: bool
    stats: dict[str, Any]
    issues: list[dict[str, Any]]
    message: str
    closure_impact: dict | None = None


@router.post("/visual-import", response_model=VisualExtratoImportResponse)
async def visual_extrato_import(
    request: VisualExtratoImportRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Importa planilha exportada pelo relatório de extrato (upsert por data + descrição)."""
    tenant_id = int(current_user.get("tenant_id") or 1)
    account_id = current_user.get("account_id")
    if account_id is None:
        raise HTTPException(status_code=400, detail="Conta não selecionada")
    user_id = int(current_user.get("user_id") or current_user.get("id") or 0)
    if not request.bank_rows and not request.benefit_rows:
        raise HTTPException(status_code=400, detail="Nenhuma linha para importar")

    try:
        result = apply_visual_extrato_import(
            db,
            tenant_id,
            int(account_id),
            user_id,
            bank_rows=[row.model_dump() for row in request.bank_rows],
            benefit_rows=[row.model_dump() for row in request.benefit_rows],
            confirm_closed_closure_impact=request.confirm_closed_closure_impact,
        )
    except AccountPeriodClosedError as exc:
        detail: dict | str = exc.message
        if exc.payload:
            detail = {"message": exc.message, **exc.payload}
        raise HTTPException(status_code=409, detail=detail) from exc

    stats = result.get("stats") or {}
    message = (
        f"Importação concluída: {stats.get('bank_updated', 0)} extrato(s) atualizado(s), "
        f"{stats.get('bank_created', 0)} criado(s), "
        f"{stats.get('benefit_updated', 0)} benefício(s) atualizado(s), "
        f"{stats.get('benefit_created', 0)} criado(s)."
    )
    if stats.get("kept"):
        message += f" {stats['kept']} mantido(s) como estava."
    db.commit()
    return VisualExtratoImportResponse(
        success=True,
        stats=stats,
        issues=result.get("issues") or [],
        message=message,
        closure_impact=result.get("closure_impact"),
    )


# ==================== VISUAL FATURA IMPORT (Excel exportado pelo relatório) ====================


class VisualFaturaImportRow(BaseModel):
    row_index: int | None = None
    year_month: str | None = None
    date: str
    description: str
    amount: float
    card_last4: str | None = None
    card_name: str | None = None
    tag: str | None = None
    subtag: str | None = None
    partner_name: str | None = None
    ownership_percentage: float | None = None
    current_installment: int | None = None
    total_installments: int | None = None
    issuer: str | None = None
    keep_existing: bool = False


class VisualFaturaImportRowsPayload(BaseModel):
    rows: List[VisualFaturaImportRow] = Field(default_factory=list)
    batch: ImportBatchPayload | None = None


class VisualFaturaImportRequest(VisualFaturaImportRowsPayload):
    confirm_closed_closure_impact: bool = False


@router.post("/invoices/visual-import/preview", response_model=VisualExtratoImportPreviewResponse)
async def visual_fatura_import_preview(
    request: VisualFaturaImportRowsPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Pré-visualiza a planilha de faturas exportada pelo relatório."""
    tenant_id = int(current_user.get("tenant_id") or 1)
    account_id = current_user.get("account_id")
    if account_id is None:
        raise HTTPException(status_code=400, detail="Conta não selecionada")
    if not request.rows:
        raise HTTPException(status_code=400, detail="Nenhuma linha para analisar")
    result = preview_visual_fatura_import(
        db,
        tenant_id,
        int(account_id),
        rows=[row.model_dump() for row in request.rows],
        batch=ImportBatch(request.batch),
    )
    return VisualExtratoImportPreviewResponse(**result)


@router.post("/invoices/visual-import", response_model=VisualExtratoImportResponse)
async def visual_fatura_import(
    request: VisualFaturaImportRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Grava a planilha de faturas exportada pelo relatório."""
    tenant_id = int(current_user.get("tenant_id") or 1)
    account_id = current_user.get("account_id")
    if account_id is None:
        raise HTTPException(status_code=400, detail="Conta não selecionada")
    user_id = int(current_user.get("user_id") or current_user.get("id") or 0)
    if not request.rows:
        raise HTTPException(status_code=400, detail="Nenhuma linha para importar")
    try:
        result = apply_visual_fatura_import(
            db,
            tenant_id,
            int(account_id),
            user_id,
            rows=[row.model_dump() for row in request.rows],
            confirm_closed_closure_impact=request.confirm_closed_closure_impact,
        )
    except AccountPeriodClosedError as exc:
        detail: dict | str = exc.message
        if exc.payload:
            detail = {"message": exc.message, **exc.payload}
        raise HTTPException(status_code=409, detail=detail) from exc
    stats = result.get("stats") or {}
    message = (
        f"Importação concluída: {stats.get('updated', 0)} lançamento(s) atualizado(s), "
        f"{stats.get('created', 0)} criado(s)."
    )
    if stats.get("kept"):
        message += f" {stats['kept']} mantido(s) como estava."
    db.commit()
    return VisualExtratoImportResponse(
        success=True,
        stats=stats,
        issues=result.get("issues") or [],
        message=message,
        closure_impact=result.get("closure_impact"),
    )


# ==================== VISUAL MAPPING IMPORT (Excel exportado pelo Plumo) ====================


class VisualMappingImportRow(BaseModel):
    row_index: int | None = None
    mapping_id: int | None = None
    match: str
    criterion: str = ""
    priority: str | int | None = None
    mapped_description: str = ""
    subtag_type: str
    tag_name: str = ""
    subtag_name: str = ""
    partner_name: str = ""
    contribution_pct: float | None = None
    is_sensitive: str | bool = False


class VisualMappingImportRowsPayload(BaseModel):
    rows: List[VisualMappingImportRow] = Field(default_factory=list)
    batch: ImportBatchPayload | None = None


class VisualMappingImportRequest(VisualMappingImportRowsPayload):
    auto_run_remap: bool = True
    overwrite_sharing: bool = True
    confirm_closed_closure_impact: bool = False


class VisualMappingImportPreviewResponse(BaseModel):
    summary: dict[str, Any]
    creates: list[dict[str, Any]]
    updates: list[dict[str, Any]]
    issues: list[dict[str, Any]]
    corrections: list[dict[str, Any]] = Field(default_factory=list)


@router.post("/mappings/visual-import/preview", response_model=VisualMappingImportPreviewResponse)
async def visual_mapping_import_preview(
    request: VisualMappingImportRowsPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Pré-visualiza importação de mapeamentos a partir da planilha exportada."""
    tenant_id = int(current_user.get("tenant_id") or 1)
    account_id = current_user.get("account_id")
    if account_id is None:
        raise HTTPException(status_code=400, detail="Conta não selecionada")
    if not request.rows:
        raise HTTPException(status_code=400, detail="Nenhuma linha para analisar")
    result = preview_visual_mapping_import(
        db,
        tenant_id,
        int(account_id),
        rows=[row.model_dump() for row in request.rows],
        batch=ImportBatch(request.batch),
    )
    return VisualMappingImportPreviewResponse(**result)


class VisualMappingImportResponse(BaseModel):
    success: bool
    stats: dict[str, Any]
    issues: list[dict[str, Any]]
    message: str
    closure_impact: dict | None = None


@router.post("/mappings/visual-import", response_model=VisualMappingImportResponse)
async def visual_mapping_import(
    request: VisualMappingImportRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Importa mapeamentos da planilha exportada; opcionalmente remapeia lançamentos."""
    tenant_id = int(current_user.get("tenant_id") or 1)
    account_id = current_user.get("account_id")
    if account_id is None:
        raise HTTPException(status_code=400, detail="Conta não selecionada")
    user_id = int(current_user.get("user_id") or current_user.get("id") or 0)
    if not request.rows:
        raise HTTPException(status_code=400, detail="Nenhuma linha para importar")

    try:
        result = apply_visual_mapping_import(
            db,
            tenant_id,
            int(account_id),
            user_id,
            rows=[row.model_dump() for row in request.rows],
            auto_run_remap=request.auto_run_remap,
            overwrite_sharing=request.overwrite_sharing,
            confirm_closed_closure_impact=request.confirm_closed_closure_impact,
        )
    except AccountPeriodClosedError as exc:
        db.rollback()
        detail: dict | str = exc.message
        if exc.payload:
            detail = {"message": exc.message, **exc.payload}
        raise HTTPException(status_code=409, detail=detail) from exc

    stats = result.get("stats") or {}
    message = (
        f"Importação concluída: {stats.get('created', 0)} criado(s), "
        f"{stats.get('updated', 0)} atualizado(s), "
        f"{stats.get('unchanged', 0)} sem alteração."
    )
    if request.auto_run_remap:
        message += f" Remapeamento: {stats.get('remap_records', 0)} lançamento(s)."
    db.commit()
    return VisualMappingImportResponse(
        success=True,
        stats=stats,
        issues=result.get("issues") or [],
        message=message,
        closure_impact=result.get("closure_impact"),
    )


# ==================== BATCH DELETE ====================

class BatchDeleteRequest(BaseModel):
    """Request para exclusão em lote de despesas"""
    items: List[BatchUpdateItem]


class BatchDeleteResponse(BaseModel):
    """Response para exclusão em lote"""
    success: bool
    deleted_count: int
    message: str


@router.delete("/batch-delete", response_model=BatchDeleteResponse)
async def batch_delete_expenses(
    request: BatchDeleteRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Exclui múltiplas despesas em lote (hard delete).
    Essas tabelas não possuem campo 'active', então usam exclusão permanente.
    """
    tenant_id = current_user.get("tenant_id", 1)

    if not request.items:
        raise HTTPException(status_code=400, detail="Nenhum item para excluir")

    deleted_count = 0

    # Separar itens por fonte
    bank_ids = [item.id for item in request.items if item.source == 'bank']
    card_ids = [item.id for item in request.items if item.source == 'card']
    benefit_ids = [item.id for item in request.items if item.source == 'benefit']

    # Hard delete bank_statements
    if bank_ids:
        bank_rows = db.query(BankStatement).filter(
            BankStatement.id.in_(bank_ids),
            BankStatement.tenant_id == tenant_id
        ).all()
        for statement in bank_rows:
            _guard_closed_account_period(db, tenant_id, statement.account_id, statement.date)
        result = db.query(BankStatement).filter(
            BankStatement.id.in_(bank_ids),
            BankStatement.tenant_id == tenant_id
        ).delete(synchronize_session=False)
        deleted_count += result

    # Hard delete credit_card_invoices
    if card_ids:
        result = db.query(CreditCardInvoice).filter(
            CreditCardInvoice.id.in_(card_ids),
            CreditCardInvoice.tenant_id == tenant_id
        ).delete(synchronize_session=False)
        deleted_count += result

    # Hard delete benefit_card_statements
    if benefit_ids:
        result = db.query(BenefitCardStatement).filter(
            BenefitCardStatement.id.in_(benefit_ids),
            BenefitCardStatement.tenant_id == tenant_id
        ).delete(synchronize_session=False)
        deleted_count += result

    db.commit()

    return BatchDeleteResponse(
        success=True,
        deleted_count=deleted_count,
        message=f"{deleted_count} registro(s) excluído(s) com sucesso"
    )


# ===================== INVERSÃO DE COMPARTILHAMENTO EM LOTE =====================

class InvertSharingItem(BaseModel):
    """Item para inversão de compartilhamento."""
    id: int
    source: str  # 'bank', 'card', 'benefit'
    target_account_id: int  # ID da conta destino (shared_partner_id do frontend)


class BatchInvertSharingRequest(BaseModel):
    """Request para inverter compartilhamento em lote."""
    items: List[InvertSharingItem]


class BatchInvertSharingResponse(BaseModel):
    """Response da inversão de compartilhamento em lote."""
    success: bool
    updated_count: int
    message: str


@router.post("/batch-invert-sharing", response_model=BatchInvertSharingResponse)
async def batch_invert_sharing(
    request: BatchInvertSharingRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Inverte o compartilhamento de múltiplas despesas em lote.
    Cada item traz seu próprio target_account_id (conta destino), permitindo inversão para contas diferentes.

    Esta operação:
    1. Para bank_statements: atualiza account_id e ownership_percentage
    2. Para credit_card_invoices e benefit_card_statements:
       - Cria novo registro em bank_statements com dados migrados
       - Deleta o registro original
       - Adiciona rastreamento: migrated_from_account_id e migrated_from_table
    3. Inverte o ownership_percentage (0 → 100, 100 → 0, 50 → 50)
    """
    account_id = current_user.get("account_id")
    tenant_id = current_user.get("tenant_id")
    user_id = current_user.get("id")

    if not account_id or not tenant_id or not user_id:
        raise HTTPException(status_code=400, detail="account_id, tenant_id ou user_id não encontrado no token")

    if not request.items:
        raise HTTPException(status_code=400, detail="Nenhum item para inverter")

    # Função para inverter porcentagem
    def invert_percentage(pct):
        if pct is None:
            return 100
        pct = float(pct)
        if pct == 0:
            return 100
        elif pct == 100:
            return 0
        else:
            return pct  # 50 permanece 50

    # 1. Coleta todos os target_account_ids únicos e busca nomes em uma única query
    target_account_ids = list(set(item.target_account_id for item in request.items))
    target_accounts = db.query(Account).filter(Account.id.in_(target_account_ids)).all()
    account_names_map = {a.id: a.name or a.description or str(a.id) for a in target_accounts}
    target_accounts_names = set(account_names_map.values())

    # 2. Busca os expense_sharing_ids para os pares (account_id, target_account_id)
    # Isso é necessário para manter o FK no banco de dados
    sharing_pairs = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.tenant_id == tenant_id,
        ExpenseSharingSetting.active == True,
        or_(
            and_(ExpenseSharingSetting.account_id == account_id, ExpenseSharingSetting.shared_account_id.in_(target_account_ids)),
            and_(ExpenseSharingSetting.shared_account_id == account_id, ExpenseSharingSetting.account_id.in_(target_account_ids))
        )
    ).all()
    # Mapa de target_account_id -> expense_sharing_id
    sharing_map = {}
    for s in sharing_pairs:
        if s.account_id == account_id:
            sharing_map[s.shared_account_id] = s.id
        else:
            sharing_map[s.account_id] = s.id

    # 3. Separa itens por tipo de fonte (id, target_account_id)
    bank_items = [(i.id, i.target_account_id) for i in request.items if i.source == 'bank']
    card_items = [(i.id, i.target_account_id) for i in request.items if i.source == 'card']
    benefit_items = [(i.id, i.target_account_id) for i in request.items if i.source == 'benefit']

    updated_count = 0
    converted_count = 0

    # 4. Processa bank_statements em bulk
    if bank_items:
        bank_ids = [item[0] for item in bank_items]
        bank_records = db.query(BankStatement).filter(
            BankStatement.id.in_(bank_ids),
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id
        ).all()

        # Mapeia ID -> target_account_id do request
        bank_target_map = {item[0]: item[1] for item in bank_items}

        for record in bank_records:
            target_id = bank_target_map.get(record.id)
            if not target_id:
                continue
            expense_sharing_id = sharing_map.get(target_id)
            # Rastreia a conta de origem (migrated_from_table fica NULL pois não houve conversão de tipo)
            record.migrated_from_account_id = account_id
            record.account_id = target_id
            record.expense_sharing_id = expense_sharing_id
            record.ownership_percentage = invert_percentage(record.ownership_percentage)
            updated_count += 1

    # 5. Processa credit_card_invoices: busca em bulk, converte para BankStatement, deleta originais
    if card_items:
        card_ids = [item[0] for item in card_items]
        card_records = db.query(CreditCardInvoice).filter(
            CreditCardInvoice.id.in_(card_ids),
            CreditCardInvoice.tenant_id == tenant_id
        ).all()

        card_target_map = {item[0]: item[1] for item in card_items}
        new_statements = []
        delete_ids = []

        for record in card_records:
            target_id = card_target_map.get(record.id)
            if not target_id:
                continue
            expense_sharing_id = sharing_map.get(target_id)
            new_statements.append(BankStatement(
                description=record.description,
                date=record.date,
                amount=record.amount,
                subtag_id=record.subtag_id,
                account_id=target_id,
                ownership_percentage=invert_percentage(record.ownership_percentage),
                expense_sharing_id=expense_sharing_id,
                adjustment_notes=record.adjustment_notes,
                migrated_from_account_id=account_id,
                migrated_from_table='credit_card_invoices',
                tenant_id=tenant_id,
                created_by=user_id
            ))
            delete_ids.append(record.id)

        if new_statements:
            db.bulk_save_objects(new_statements)
            converted_count += len(new_statements)

        if delete_ids:
            db.query(CreditCardInvoice).filter(CreditCardInvoice.id.in_(delete_ids)).delete(synchronize_session=False)

    # 6. Processa benefit_card_statements: busca em bulk, converte para BankStatement, deleta originais
    if benefit_items:
        benefit_ids = [item[0] for item in benefit_items]
        benefit_records = db.query(BenefitCardStatement).filter(
            BenefitCardStatement.id.in_(benefit_ids),
            BenefitCardStatement.tenant_id == tenant_id
        ).all()

        benefit_target_map = {item[0]: item[1] for item in benefit_items}
        new_statements = []
        delete_ids = []

        for record in benefit_records:
            target_id = benefit_target_map.get(record.id)
            if not target_id:
                continue
            expense_sharing_id = sharing_map.get(target_id)
            new_statements.append(BankStatement(
                description=record.description,
                date=record.date,
                amount=record.amount,
                subtag_id=record.subtag_id,
                account_id=target_id,
                ownership_percentage=invert_percentage(record.ownership_percentage),
                expense_sharing_id=expense_sharing_id,
                adjustment_notes=record.adjustment_notes,
                migrated_from_account_id=account_id,
                migrated_from_table='benefit_card_statements',
                tenant_id=tenant_id,
                created_by=user_id
            ))
            delete_ids.append(record.id)

        if new_statements:
            db.bulk_save_objects(new_statements)
            converted_count += len(new_statements)

        if delete_ids:
            db.query(BenefitCardStatement).filter(BenefitCardStatement.id.in_(delete_ids)).delete(synchronize_session=False)

    db.commit()

    total = updated_count + converted_count
    message_parts = []
    if updated_count > 0:
        message_parts.append(f"{updated_count} extrato(s) atualizado(s)")
    if converted_count > 0:
        message_parts.append(f"{converted_count} item(ns) convertido(s) para extrato")

    accounts_str = ", ".join(sorted(target_accounts_names)) if target_accounts_names else "conta parceira"
    message = f"{' e '.join(message_parts)} para {accounts_str}"

    return BatchInvertSharingResponse(
        success=True,
        updated_count=total,
        message=message
    )
