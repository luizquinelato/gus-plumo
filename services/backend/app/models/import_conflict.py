# -*- coding: utf-8 -*-
"""
Modelos para conflitos de importação.

Define estruturas de dados para detectar e resolver conflitos
quando registros existentes têm diferenças em tag/subtag ou valor.
"""
from typing import Optional, List
from pydantic import BaseModel
from decimal import Decimal


class TagConflict(BaseModel):
    """Conflito de Tag/Subtag entre registro existente e novo."""
    original_tag_id: Optional[int] = None
    original_tag_name: Optional[str] = None
    original_subtag_id: Optional[int] = None
    original_subtag_name: Optional[str] = None
    new_tag_id: Optional[int] = None
    new_tag_name: Optional[str] = None
    new_subtag_id: Optional[int] = None
    new_subtag_name: Optional[str] = None


class AmountConflict(BaseModel):
    """Conflito de valor entre registro existente e novo."""
    original_amount: float
    new_amount: float


class MatchCandidate(BaseModel):
    """
    Representa um registro candidato quando múltiplos matches são encontrados.

    Quando a chave (date sem segundos, description) retorna múltiplos registros,
    cada um é listado para o usuário escolher qual atualizar.
    """
    id: int
    amount: float
    subtag_id: Optional[int] = None
    subtag_name: Optional[str] = None
    tag_name: Optional[str] = None


class ImportConflict(BaseModel):
    """
    Representa um conflito detectado durante importação.

    Quando um registro existente é encontrado e possui diferenças
    em tag/subtag ou valor, um ImportConflict é criado para que
    o usuário possa decidir se aceita ou rejeita as mudanças.

    CASO ESPECIAL - Múltiplos Matches:
    Quando a chave (date, description) retorna múltiplos registros (comum quando
    timestamps não têm segundos), o sistema:
    1. Primeiro busca por valor igual → se achar, verifica só conflito de tag
    2. Se não achar valor igual → apresenta todos os candidatos para seleção
    """
    # Identificação do registro existente (pode ser None se multiple_matches)
    existing_id: Optional[int] = None
    record_type: str  # 'bank_statement', 'credit_card_invoice', 'benefit_statement'

    # Dados para exibição
    date: str
    description: str

    # Conflitos (presentes apenas se houver diferença)
    tag_conflict: Optional[TagConflict] = None
    amount_conflict: Optional[AmountConflict] = None

    # Dados adicionais do registro (para contexto)
    year_month: Optional[str] = None  # Para faturas
    credit_card_name: Optional[str] = None  # Para faturas
    account_name: Optional[str] = None  # Para extratos

    # Múltiplos matches - quando a chave retorna mais de um registro
    # e nenhum tem o mesmo valor do arquivo
    multiple_matches: Optional[List[MatchCandidate]] = None
    selected_match_id: Optional[int] = None  # ID selecionado pelo usuário
    new_amount: Optional[float] = None  # Valor do arquivo para exibição


class ConflictResolution(BaseModel):
    """
    Resolução de um conflito individual.

    O usuário pode aceitar ou rejeitar cada tipo de mudança
    independentemente (tag/subtag e valor).
    """
    existing_id: int
    record_type: str  # 'bank_statement', 'credit_card_invoice', 'benefit_statement'
    accept_tag_change: bool = False
    accept_amount_change: bool = False

    # Valores a aplicar se aceitar (para referência)
    new_subtag_id: Optional[int] = None
    new_amount: Optional[float] = None

    # Para múltiplos matches - qual registro foi selecionado
    selected_from_multiple: bool = False


class ConflictResolutionRequest(BaseModel):
    """Request para resolver múltiplos conflitos de uma vez."""
    resolutions: List[ConflictResolution]


class ImportResultWithConflicts(BaseModel):
    """
    Resultado de importação que pode incluir conflitos pendentes.
    
    Se conflicts estiver preenchido, o frontend deve exibir
    a UI de resolução de conflitos antes de finalizar.
    """
    success: bool
    created: int = 0
    duplicates: int = 0  # Atualizados sem conflito
    skipped: int = 0
    unmapped: int = 0
    
    # Conflitos pendentes que precisam de resolução
    conflicts: List[ImportConflict] = []
    
    # Outros dados
    errors: List[str] = []
    unmapped_records: List[dict] = []

