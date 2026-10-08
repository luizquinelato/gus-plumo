# -*- coding: utf-8 -*-
"""Importação Excel de cadastros mestre (preview + apply)."""

from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_user, require_account
from app.services.import_batch import ImportBatch, ImportBatchPayload
from app.services.visual_cadastro_import_service import (
    apply_cartoes_import,
    apply_compartilhamentos_import,
    apply_contas_import,
    apply_tags_subtags_import,
    apply_templates_import,
    preview_cartoes_import,
    preview_compartilhamentos_import,
    preview_contas_import,
    preview_tags_subtags_import,
    preview_templates_import,
)

router = APIRouter(prefix="/api/cadastro-import", tags=["cadastro-import"])


class ImportPreviewResponse(BaseModel):
    summary: dict[str, Any]
    creates: list[dict[str, Any]]
    updates: list[dict[str, Any]]
    issues: list[dict[str, Any]]


class ImportApplyResponse(BaseModel):
    message: str
    stats: dict[str, Any]
    issues: list[dict[str, Any]]


class TagImportRow(BaseModel):
    row_index: int | None = None
    id: int | None = None
    name: str
    description: str | None = None
    icon: str | None = None


class SubtagImportRow(BaseModel):
    row_index: int | None = None
    id: int | None = None
    tag_id: int | None = None
    tag_name: str = ""
    name: str
    description: str | None = None
    type: str
    icon: str | None = None


class TagsSubtagsPayload(BaseModel):
    tags: List[TagImportRow] = Field(default_factory=list)
    subtags: List[SubtagImportRow] = Field(default_factory=list)


@router.post("/tags-subtags/preview", response_model=ImportPreviewResponse)
async def tags_subtags_preview(
    body: TagsSubtagsPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    account_id = current_user.get("account_id")
    tenant_id = int(current_user.get("tenant_id") or 1)
    if not body.tags and not body.subtags:
        raise HTTPException(status_code=400, detail="Planilha vazia")
    return preview_tags_subtags_import(
        db,
        tenant_id,
        int(account_id),
        tags=[r.model_dump() for r in body.tags],
        subtags=[r.model_dump() for r in body.subtags],
    )


@router.post("/tags-subtags", response_model=ImportApplyResponse)
async def tags_subtags_apply(
    body: TagsSubtagsPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    account_id = int(current_user.get("account_id"))
    tenant_id = int(current_user.get("tenant_id") or 1)
    user_id = int(current_user.get("user_id") or current_user.get("id") or 0)
    result = apply_tags_subtags_import(
        db,
        tenant_id,
        account_id,
        user_id,
        tags=[r.model_dump() for r in body.tags],
        subtags=[r.model_dump() for r in body.subtags],
    )
    db.commit()
    return ImportApplyResponse(**result)


class ContaImportRow(BaseModel):
    row_index: int | None = None
    id: int | None = None
    name: str
    description: str | None = None
    account_type: str | None = None
    bank_code: str = ""
    agency: int | None = None
    account_number: int | None = None
    active: bool = True


class ContasPayload(BaseModel):
    rows: List[ContaImportRow] = Field(default_factory=list)


@router.post("/contas/preview", response_model=ImportPreviewResponse)
async def contas_preview(
    body: ContasPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    if not body.rows:
        raise HTTPException(status_code=400, detail="Planilha vazia")
    tenant_id = int(current_user.get("tenant_id") or 1)
    user_id = int(current_user.get("user_id") or current_user.get("id") or 0)
    return preview_contas_import(db, tenant_id, user_id, [r.model_dump() for r in body.rows])


@router.post("/contas", response_model=ImportApplyResponse)
async def contas_apply(
    body: ContasPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    tenant_id = int(current_user.get("tenant_id") or 1)
    user_id = int(current_user.get("user_id") or current_user.get("id") or 0)
    result = apply_contas_import(db, tenant_id, user_id, [r.model_dump() for r in body.rows])
    db.commit()
    return ImportApplyResponse(**result)


class CompartilhamentoImportRow(BaseModel):
    row_index: int | None = None
    id: int | None = None
    shared_account_id: int | None = None
    partner_name: str = ""
    bank_code: str = ""
    agency: int | None = None
    account_number: int | None = None
    my_contribution_percentage: float | None = None
    revenue_contribution_percentage: float | None = None
    description: str | None = None
    active: bool = True


class CompartilhamentosPayload(BaseModel):
    rows: List[CompartilhamentoImportRow] = Field(default_factory=list)
    batch: ImportBatchPayload | None = None


@router.post("/compartilhamentos/preview", response_model=ImportPreviewResponse)
async def compartilhamentos_preview(
    body: CompartilhamentosPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    account_id = current_user.get("account_id")
    if not account_id:
        raise HTTPException(status_code=400, detail="Conta não selecionada")
    if not body.rows:
        raise HTTPException(status_code=400, detail="Planilha vazia")
    tenant_id = int(current_user.get("tenant_id") or 1)
    return preview_compartilhamentos_import(
        db,
        tenant_id,
        int(account_id),
        [r.model_dump() for r in body.rows],
        batch=ImportBatch(body.batch),
    )


@router.post("/compartilhamentos", response_model=ImportApplyResponse)
async def compartilhamentos_apply(
    body: CompartilhamentosPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    account_id = current_user.get("account_id")
    if not account_id:
        raise HTTPException(status_code=400, detail="Conta não selecionada")
    tenant_id = int(current_user.get("tenant_id") or 1)
    user_id = int(current_user.get("user_id") or current_user.get("id") or 0)
    result = apply_compartilhamentos_import(
        db, tenant_id, int(account_id), user_id, [r.model_dump() for r in body.rows],
    )
    db.commit()
    return ImportApplyResponse(**result)


class TemplateImportRow(BaseModel):
    row_index: int | None = None
    id: int | None = None
    name: str
    description: str | None = None
    icon: str = "FileText"
    active: bool = True


class TemplateItemImportRow(BaseModel):
    row_index: int | None = None
    template_id: int | None = None
    template_name: str = ""
    item_id: int | None = None
    description: str
    amount: float | None = None
    day_of_month: int | None = None
    tag_name: str = ""
    subtag_name: str = ""
    subtag_type: str = ""
    partner_name: str | None = None
    ownership_percentage: float = 100
    display_order: int = 0


class TemplatesPayload(BaseModel):
    templates: List[TemplateImportRow] = Field(default_factory=list)
    items: List[TemplateItemImportRow] = Field(default_factory=list)
    batch: ImportBatchPayload | None = None


@router.post("/templates/preview", response_model=ImportPreviewResponse)
async def templates_preview(
    body: TemplatesPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    account_id = int(current_user.get("account_id"))
    tenant_id = int(current_user.get("tenant_id") or 1)
    if not body.templates and not body.items:
        raise HTTPException(status_code=400, detail="Planilha vazia")
    return preview_templates_import(
        db,
        tenant_id,
        account_id,
        templates=[r.model_dump() for r in body.templates],
        items=[r.model_dump() for r in body.items],
        batch=ImportBatch(body.batch),
    )


@router.post("/templates", response_model=ImportApplyResponse)
async def templates_apply(
    body: TemplatesPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    account_id = int(current_user.get("account_id"))
    tenant_id = int(current_user.get("tenant_id") or 1)
    user_id = int(current_user.get("user_id") or current_user.get("id") or 0)
    result = apply_templates_import(
        db,
        tenant_id,
        account_id,
        user_id,
        templates=[r.model_dump() for r in body.templates],
        items=[r.model_dump() for r in body.items],
    )
    db.commit()
    return ImportApplyResponse(**result)


class GroupImportRow(BaseModel):
    row_index: int | None = None
    id: int | None = None
    name: str
    closing_day: int = 14
    due_day: int = 14
    card_ids: List[int] = Field(default_factory=list)
    active: bool = True


class CardImportRow(BaseModel):
    row_index: int | None = None
    id: int | None = None
    name: str
    description: str | None = None
    number: str
    type: str = ""
    closing_day: int | None = None
    due_day: int | None = None
    group_id: int | None = None
    group_name: str | None = None
    expense_sharing_id: int | None = None
    partner_name: str | None = None
    expense_ownership_percentage: float | None = None
    revenue_ownership_percentage: float | None = None
    active: bool = True


class CartoesPayload(BaseModel):
    groups: List[GroupImportRow] = Field(default_factory=list)
    cards: List[CardImportRow] = Field(default_factory=list)
    batch: ImportBatchPayload | None = None


@router.post("/cartoes/preview", response_model=ImportPreviewResponse)
async def cartoes_preview(
    body: CartoesPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    account_id = int(current_user.get("account_id"))
    tenant_id = int(current_user.get("tenant_id") or 1)
    if not body.groups and not body.cards:
        raise HTTPException(status_code=400, detail="Planilha vazia")
    return preview_cartoes_import(
        db,
        tenant_id,
        account_id,
        groups=[r.model_dump() for r in body.groups],
        cards=[r.model_dump() for r in body.cards],
        batch=ImportBatch(body.batch),
    )


@router.post("/cartoes", response_model=ImportApplyResponse)
async def cartoes_apply(
    body: CartoesPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    account_id = int(current_user.get("account_id"))
    tenant_id = int(current_user.get("tenant_id") or 1)
    user_id = int(current_user.get("user_id") or current_user.get("id") or 0)
    result = apply_cartoes_import(
        db,
        tenant_id,
        account_id,
        user_id,
        groups=[r.model_dump() for r in body.groups],
        cards=[r.model_dump() for r in body.cards],
    )
    db.commit()
    return ImportApplyResponse(**result)
