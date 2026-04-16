"""
Router para gerenciamento de configurações.
Fornece endpoints para copiar configurações entre contas.
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.database import get_db
from app.models.unified_models import Tag, Subtag, TransactionMapping, Account
from app.dependencies.auth import get_current_user

router = APIRouter(prefix="/api/settings", tags=["settings"])


class CopySettingsRequest(BaseModel):
    """Request para copiar configurações entre contas."""
    source_account_id: int
    destination_account_id: int
    copy_tags: bool = True
    copy_subtags: bool = True
    copy_mappings: bool = True


class CopySettingsResponse(BaseModel):
    """Response para operação de cópia."""
    success: bool
    tags_copied: int
    subtags_copied: int
    mappings_copied: int
    message: str


@router.post("/copy-settings", response_model=CopySettingsResponse)
async def copy_settings(
    request: CopySettingsRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Copia configurações (tags, subtags, mappings) de uma conta para outra.

    Apenas o dono das contas pode copiar configurações entre elas.
    """
    user_id = current_user.get("user_id") or current_user.get("id")
    tenant_id = current_user.get("tenant_id")
    
    # Verifica se ambas as contas pertencem ao usuário
    source_account = db.query(Account).filter(
        Account.id == request.source_account_id,
        Account.user_id == user_id,
        Account.tenant_id == tenant_id,
        Account.active == True
    ).first()
    
    if not source_account:
        raise HTTPException(status_code=404, detail="Conta de origem não encontrada ou não pertence a você")
    
    destination_account = db.query(Account).filter(
        Account.id == request.destination_account_id,
        Account.user_id == user_id,
        Account.tenant_id == tenant_id,
        Account.active == True
    ).first()
    
    if not destination_account:
        raise HTTPException(status_code=404, detail="Conta de destino não encontrada ou não pertence a você")
    
    if request.source_account_id == request.destination_account_id:
        raise HTTPException(status_code=400, detail="Conta de origem e destino não podem ser iguais")
    
    tags_copied = 0
    subtags_copied = 0
    mappings_copied = 0
    tag_id_map = {}  # Mapeia IDs de tags antigas para novas
    subtag_id_map = {}  # Mapeia IDs de subtags antigas para novas
    
    # 1. Copiar Tags
    if request.copy_tags:
        source_tags = db.query(Tag).filter(
            Tag.account_id == request.source_account_id
        ).all()
        
        for source_tag in source_tags:
            # Verifica se já existe uma tag com o mesmo nome na conta de destino
            existing_tag = db.query(Tag).filter(
                Tag.account_id == request.destination_account_id,
                Tag.name == source_tag.name
            ).first()
            
            if not existing_tag:
                new_tag = Tag(
                    account_id=request.destination_account_id,
                    tenant_id=tenant_id,
                    created_by=user_id,
                    name=source_tag.name,
                    description=source_tag.description,
                    icon=source_tag.icon
                )
                db.add(new_tag)
                db.flush()  # Para obter o ID
                tag_id_map[source_tag.id] = new_tag.id
                tags_copied += 1
            else:
                tag_id_map[source_tag.id] = existing_tag.id
    
    # 2. Copiar Subtags
    if request.copy_subtags and request.copy_tags:
        source_subtags = db.query(Subtag).filter(
            Subtag.account_id == request.source_account_id
        ).all()
        
        for source_subtag in source_subtags:
            # Só copia se a tag foi copiada/existe
            if source_subtag.tag_id in tag_id_map:
                new_tag_id = tag_id_map[source_subtag.tag_id]
                
                # Verifica se já existe uma subtag com o mesmo nome e tag na conta de destino
                existing_subtag = db.query(Subtag).filter(
                    Subtag.account_id == request.destination_account_id,
                    Subtag.tag_id == new_tag_id,
                    Subtag.name == source_subtag.name,
                    Subtag.type == source_subtag.type
                ).first()
                
                if not existing_subtag:
                    new_subtag = Subtag(
                        account_id=request.destination_account_id,
                        tenant_id=tenant_id,
                        created_by=user_id,
                        tag_id=new_tag_id,
                        name=source_subtag.name,
                        description=source_subtag.description,
                        type=source_subtag.type,
                        icon=source_subtag.icon
                    )
                    db.add(new_subtag)
                    db.flush()
                    subtag_id_map[source_subtag.id] = new_subtag.id
                    subtags_copied += 1
                else:
                    subtag_id_map[source_subtag.id] = existing_subtag.id

    # 3. Copiar Mappings
    if request.copy_mappings and request.copy_subtags and request.copy_tags:
        source_mappings = db.query(TransactionMapping).filter(
            TransactionMapping.account_id == request.source_account_id
        ).all()

        for source_mapping in source_mappings:
            # Só copia se a subtag foi copiada/existe
            if source_mapping.subtag_id in subtag_id_map:
                new_subtag_id = subtag_id_map[source_mapping.subtag_id]

                # Verifica se já existe um mapping idêntico na conta de destino
                existing_mapping = db.query(TransactionMapping).filter(
                    TransactionMapping.account_id == request.destination_account_id,
                    TransactionMapping.original_description == source_mapping.original_description,
                    TransactionMapping.mapping_type == source_mapping.mapping_type
                ).first()

                if not existing_mapping:
                    new_mapping = TransactionMapping(
                        account_id=request.destination_account_id,
                        tenant_id=tenant_id,
                        created_by=user_id,
                        original_description=source_mapping.original_description,
                        mapped_description=source_mapping.mapped_description,
                        subtag_id=new_subtag_id,
                        expense_sharing_id=source_mapping.expense_sharing_id,  # Mantém a mesma configuração de compartilhamento
                        mapping_type=source_mapping.mapping_type,
                        pattern=source_mapping.pattern,
                        regex_pattern=source_mapping.regex_pattern,
                        priority=source_mapping.priority,
                        is_sensitive=source_mapping.is_sensitive
                    )
                    db.add(new_mapping)
                    mappings_copied += 1

    db.commit()

    return CopySettingsResponse(
        success=True,
        tags_copied=tags_copied,
        subtags_copied=subtags_copied,
        mappings_copied=mappings_copied,
        message=f"Configurações copiadas com sucesso! {tags_copied} tags, {subtags_copied} subtags e {mappings_copied} mapeamentos."
    )

