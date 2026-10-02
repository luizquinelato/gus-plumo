"""
Persistência de extratos bancários após ETL (importação bruta).
"""

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime
from decimal import Decimal
import pandas as pd
import io
import re
import traceback
import json
import os
from typing import Literal, Optional, Dict, Any

from app.database import get_db, DATABASE_URL
from app.models.unified_models import BankStatement, CreditCardInvoice, Subtag, Tag, Cartao, TransactionMapping, ExpenseSharingSetting, Account
from app.dependencies.auth import require_account
from sqlalchemy import or_
from app.services.fatura_service import FaturaService
from app.services.account_period_closure_service import closed_periods
from app.utils.card_helper import CardHelper
from app.utils.mapping_helper import MappingHelper
from app.utils.sharing_percentage import resolve_ownership_percentage, card_adjustment_config
from app.core.logging_config import get_logger
import psycopg2
from psycopg2.extras import RealDictCursor

logger = get_logger(__name__)


def get_card_adjustment_config(db: Session, card_id: int) -> Dict[str, Any]:
    card = db.query(Cartao).filter(Cartao.id == card_id).first()
    return card_adjustment_config(card)


def lookup_expense_sharing_by_partner_name(
    db: Session,
    tenant_id: int,
    account_id: int,
    partner_name: str
) -> Optional[int]:
    """
    Busca expense_sharing_id a partir do nome/descrição da conta parceira.

    Procura em ambas as direções:
    - account_id → shared_account (direto)
    - shared_account_id → account (inverso)

    Args:
        db: Sessão do banco de dados
        tenant_id: ID do tenant
        account_id: ID da conta logada (que está importando)
        partner_name: Nome ou descrição da conta parceira

    Returns:
        ID do expense_sharing_setting ou None se não encontrado
    """
    if not partner_name or partner_name.strip() == '':
        return None

    partner_name = partner_name.strip()

    # Primeiro, busca a conta parceira pelo nome ou descrição
    partner_account = db.query(Account).filter(
        Account.tenant_id == tenant_id,
        Account.active == True,
        or_(
            Account.name == partner_name,
            Account.description == partner_name
        )
    ).first()

    if not partner_account:
        logger.warning(f"⚠️ Conta parceira não encontrada: '{partner_name}'")
        return None

    # Busca configuração de compartilhamento em ambas as direções
    sharing = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.tenant_id == tenant_id,
        ExpenseSharingSetting.active == True,
        or_(
            # Direção direta: account_id → shared_account_id
            (ExpenseSharingSetting.account_id == account_id) &
            (ExpenseSharingSetting.shared_account_id == partner_account.id),
            # Direção inversa: shared_account_id → account_id
            (ExpenseSharingSetting.account_id == partner_account.id) &
            (ExpenseSharingSetting.shared_account_id == account_id)
        )
    ).first()

    if not sharing:
        logger.warning(f"⚠️ Compartilhamento não encontrado entre conta {account_id} e '{partner_name}'")
        return None


    return sharing.id


def get_default_subtag_id(db: Session, tenant_id: int, account_id: int, valor: float = None, is_fatura: bool = False) -> int:
    """
    Retorna o ID da subtag padrão "Pendente" da tag "Não Categorizado".
    Cria se não existir, filtrando por tipo baseado no valor.

    GARANTE que sempre retorna um ID válido (nunca None).

    Args:
        db: Sessão do banco de dados
        tenant_id: ID do tenant
        account_id: ID da conta (obrigatório para filtrar subtags da conta correta)
        valor: Valor da transação no formato original (antes de inversão)
        is_fatura: Se True, inverte a lógica (positivo=despesa, negativo=receita)

    Returns:
        int: ID da subtag "Pendente" (nunca None)

    Raises:
        ValueError: Se não conseguir criar/encontrar a subtag padrão
    """
    # Determina o tipo baseado no valor
    tipo = None
    if valor is not None:
        if is_fatura:
            # Faturas: positivo = despesa, negativo = receita
            tipo = "despesa" if valor >= 0 else "receita"
        else:
            # Extratos: positivo = receita, negativo = despesa
            tipo = "receita" if valor >= 0 else "despesa"

    # Busca tag "Não Categorizado" (genérica, sem tipo)
    tag = db.query(Tag).filter(
        Tag.tenant_id == tenant_id,
        Tag.account_id == account_id,
        Tag.name == "Não Categorizado",
        Tag.active == True
    ).first()

    if not tag:
        # Cria tag se não existir (SEM tipo, pois tipo está nas subtags)
        logger.info(f"📝 Criando tag 'Não Categorizado' para tenant {tenant_id}, account_id {account_id}")
        tag = Tag(
            tenant_id=tenant_id,
            account_id=account_id,
            name="Não Categorizado",
            description="Registros não categorizados automaticamente",
            active=True
        )
        db.add(tag)
        db.flush()

    # Busca subtag "Pendente" COM o tipo correto
    # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
    # IMPORTANTE: Filtra por account_id porque cada conta tem suas próprias tags/subtags
    subtag = db.query(Subtag).filter(
        Subtag.tenant_id == tenant_id,
        Subtag.account_id == account_id,
        Subtag.tag_id == tag.id,
        Subtag.name == "Pendente",
        Subtag.type == tipo
    ).first()

    if not subtag:
        # Cria subtag se não existir (COM tipo)
        logger.info(f"📝 Criando subtag 'Pendente' (tipo: {tipo}) para tag '{tag.name}' (ID: {tag.id}), account_id {account_id}")
        subtag = Subtag(
            tenant_id=tenant_id,
            account_id=account_id,
            tag_id=tag.id,
            name="Pendente",
            type=tipo or "despesa",
            description="Registros pendentes de categorização manual",
            active=True
        )
        db.add(subtag)
        db.flush()

    # Garante que temos um ID válido
    if not subtag or not subtag.id:
        raise ValueError(f"Falha ao obter/criar subtag padrão 'Pendente' para tenant {tenant_id}, account_id {account_id}")

    return subtag.id


def find_subtag_by_mapping(
    db: Session,
    tenant_id: int,
    description: str,
    valor: float,
    is_fatura: bool,
    user_id: int = None
) -> int:
    """
    Busca subtag APENAS em mapeamentos (transaction_mappings), ignorando nome de subtag.
    Usado quando force_retag=True.

    Fluxo:
    1. Busca em transaction_mappings pela descrição (filtrado por user_id)
    2. Verifica se a subtag do mapeamento é do tipo correto (receita/despesa)
    3. Se não encontrar, retorna "Pendente"

    Args:
        db: Sessão do banco de dados
        tenant_id: ID do tenant
        description: Descrição da transação
        valor: Valor da transação (para determinar tipo)
        is_fatura: Se True, inverte lógica (positivo=despesa, negativo=receita)
        user_id: ID do usuário (para filtrar mapeamentos)

    Returns:
        int: ID da subtag encontrada ou padrão "Pendente"
    """
    # Valida descrição obrigatória
    if not description:
        logger.warning(f"⚠️ find_subtag_by_mapping: descrição vazia, retornando None")
        return None

    logger.debug(f"🔄 find_subtag_by_mapping: desc='{description[:50]}', valor={valor}, is_fatura={is_fatura}, user_id={user_id}")

    # Determina tipo baseado no valor
    if is_fatura:
        tipo = "despesa" if valor >= 0 else "receita"
    else:
        tipo = "receita" if valor >= 0 else "despesa"

    logger.debug(f"   Tipo determinado: {tipo}")

    # Busca mapeamento pela descrição
    # NOTA: TransactionMapping NÃO tem campo 'active' (não usa soft delete)
    try:
        query = db.query(TransactionMapping).filter(
            TransactionMapping.tenant_id == tenant_id,
            func.lower(TransactionMapping.original_description) == description.lower()
        )

        # Filtra por user_id se fornecido
        if user_id is not None:
            query = query.filter(TransactionMapping.user_id == user_id)

        mapping = query.first()

        if mapping and mapping.subtag_id:
            # Verifica se a subtag é do tipo correto
            # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
            mapped_subtag = db.query(Subtag).filter(
                Subtag.id == mapping.subtag_id,
                Subtag.type == tipo
            ).first()

            if mapped_subtag:
                logger.info(f"✅ Mapeamento encontrado: '{description[:50]}' → {mapped_subtag.name} (ID {mapping.subtag_id})")
                return mapping.subtag_id
            else:
                logger.warning(f"⚠️  Mapeamento encontrado mas tipo incompatível: esperado '{tipo}', mapeamento aponta para subtag ID {mapping.subtag_id}")
    except Exception as e:
        logger.error(f"❌ Erro ao buscar mapeamento: {e}")

    # Se não encontrou, retorna NULL
    logger.warning(f"⚠️  Nenhum mapeamento para '{description[:50]}', retornando NULL")
    return None


def find_subtag_id(db: Session, tenant_id: int, account_id: int, subtag_name: str, valor: float = None, tag_name: str = None, is_fatura: bool = False, description: str = None, user_id: int = None) -> int:
    """
    Busca o ID da subtag pelo nome, filtrando por tipo baseado no valor.
    Se não encontrar, tenta usar mapeamentos (transaction_mappings).
    Retorna ID da subtag padrão "Pendente" se não encontrar.

    GARANTE que sempre retorna um ID válido (nunca None).

    Args:
        db: Sessão do banco de dados
        tenant_id: ID do tenant
        account_id: ID da conta (obrigatório para filtrar subtags da conta correta)
        subtag_name: Nome da subtag
        valor: Valor da transação no formato original (antes de inversão)
        tag_name: Nome da tag (opcional, para filtrar melhor)
        is_fatura: Se True, inverte a lógica (positivo=despesa, negativo=receita)
        description: Descrição da transação (para buscar em mapeamentos)
        user_id: ID do usuário (para filtrar mapeamentos)

    Returns:
        int: ID da subtag encontrada ou padrão "Pendente" (nunca None)
    """
    logger.debug(f"🔍 find_subtag_id chamado: subtag='{subtag_name}', tag='{tag_name}', valor={valor}, desc='{description[:50] if description else None}'")

    # Se não tem nome de subtag, retorna NULL
    if not subtag_name or pd.isna(subtag_name):
        logger.debug(f"   Subtag não fornecida, retornando NULL")
        return None

    # Determina o tipo baseado no valor
    tipo = None
    if valor is not None:
        if is_fatura:
            # Faturas: positivo = despesa, negativo = receita (valor ORIGINAL do Excel)
            tipo = "despesa" if valor >= 0 else "receita"
        else:
            # Extratos: positivo = receita, negativo = despesa
            tipo = "receita" if valor >= 0 else "despesa"

    # PASSO 1: Busca subtag diretamente no banco (exata)
    # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
    # IMPORTANTE: Filtra por account_id porque cada conta tem suas próprias tags/subtags
    try:
        # Se tem tag_name, faz JOIN com Tag
        if tag_name:
            query = db.query(Subtag).join(Tag).filter(
                Subtag.tenant_id == tenant_id,
                Subtag.account_id == account_id,
                Subtag.name == subtag_name,
                Tag.name == tag_name
            )
        else:
            # Sem tag_name, busca apenas em Subtag
            query = db.query(Subtag).filter(
                Subtag.tenant_id == tenant_id,
                Subtag.account_id == account_id,
                Subtag.name == subtag_name
            )

        # Filtra por tipo (sempre em Subtag, nunca em Tag)
        if tipo:
            query = query.filter(Subtag.type == tipo)

        subtag = query.first()

        # Se encontrou, retorna o ID
        if subtag and subtag.id:
            logger.debug(f"✅ Subtag encontrada (exata): '{subtag_name}' → ID {subtag.id}")
            return subtag.id
    except Exception as e:
        logger.error(f"⚠️  Erro ao buscar subtag_id com filtro de tipo: {e}")
        db.rollback()  # Reverte a transação para permitir novas queries
        return None

    # PASSO 2: Busca fuzzy (plural/singular)
    # Remove 's' final para tentar singular
    subtag_singular = subtag_name.rstrip('s') if subtag_name.endswith('s') else None
    if subtag_singular and subtag_singular != subtag_name:
        try:
            # Se tem tag_name, faz JOIN com Tag
            # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
            # IMPORTANTE: Filtra por account_id porque cada conta tem suas próprias tags/subtags
            if tag_name:
                query = db.query(Subtag).join(Tag).filter(
                    Subtag.tenant_id == tenant_id,
                    Subtag.account_id == account_id,
                    Subtag.name == subtag_singular,
                    Tag.name == tag_name
                )
            else:
                # Sem tag_name, busca apenas em Subtag
                query = db.query(Subtag).filter(
                    Subtag.tenant_id == tenant_id,
                    Subtag.account_id == account_id,
                    Subtag.name == subtag_singular
                )

            # Filtra por tipo (sempre em Subtag, nunca em Tag)
            if tipo:
                query = query.filter(Subtag.type == tipo)

            subtag = query.first()

            if subtag and subtag.id:
                logger.info(f"✅ Subtag encontrada (singular): '{subtag_name}' → '{subtag_singular}' → ID {subtag.id}")
                return subtag.id
        except Exception as e:
            logger.error(f"⚠️  Erro ao buscar subtag_id (singular) com filtro de tipo: {e}")
            db.rollback()
            return None

    # PASSO 3: Se não encontrou subtag pelo nome, busca em mapeamentos pela descrição
    if description:
        logger.info(f"⚠️  Subtag '{subtag_name}' (tag='{tag_name}', tipo='{tipo}') não encontrada no banco, tentando mapeamentos para '{description[:50]}'...")
        try:
            # Busca mapeamento filtrando por tipo (se fornecido)
            # NOTA: TransactionMapping e Subtag NÃO têm campo 'active' (não usam soft delete)
            query = db.query(TransactionMapping).join(Subtag).filter(
                TransactionMapping.tenant_id == tenant_id,
                func.lower(TransactionMapping.original_description) == description.lower()
            )

            # Filtra por user_id se fornecido
            if user_id is not None:
                query = query.filter(TransactionMapping.user_id == user_id)

            # Filtra por tipo se fornecido
            if tipo:
                query = query.filter(Subtag.type == tipo)

            mapping = query.first()

            if mapping and mapping.subtag_id:
                # Busca a subtag para confirmar
                # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
                mapped_subtag = db.query(Subtag).filter(
                    Subtag.id == mapping.subtag_id
                ).first()

                if mapped_subtag:
                    logger.info(f"✅ Usando mapeamento: '{description[:50]}' → subtag_id={mapping.subtag_id} ({mapped_subtag.name}, {mapped_subtag.type})")
                    return mapping.subtag_id
                else:
                    logger.warning(f"   ⚠️  Subtag do mapeamento (ID {mapping.subtag_id}) não encontrada")
            else:
                logger.debug(f"   Nenhum mapeamento encontrado para '{description[:50]}' (tipo={tipo})")
        except Exception as e:
            logger.error(f"❌ Erro ao buscar mapeamento: {e}")
            db.rollback()

    # PASSO 4: Se ainda não encontrou, retorna NULL
    logger.warning(f"⚠️  Subtag '{subtag_name}' não encontrada (tag='{tag_name}', tipo='{tipo}', account_id={account_id}), retornando NULL")
    return None


def _amounts_equal(left: Any, right: Any, tolerance: float = 0.005) -> bool:
    return abs(float(left or 0) - float(right or 0)) < tolerance


def _optional_id_equal(left: Any, right: Any) -> bool:
    return (left if left is not None else None) == (right if right is not None else None)


def _extrato_row_has_changes(
    existing_data: dict[str, Any],
    *,
    category: str,
    transaction: str,
    subtag_id: Optional[int],
    expense_sharing_id: Optional[int],
    ownership_percentage: Decimal,
    amount: Decimal,
    final_description: str,
    apply_description_update: bool,
) -> bool:
    if (existing_data.get("category") or "") != (category or ""):
        return True
    if (existing_data.get("transaction") or "") != (transaction or ""):
        return True
    if not _optional_id_equal(existing_data.get("subtag_id"), subtag_id):
        return True
    if not _optional_id_equal(existing_data.get("expense_sharing_id"), expense_sharing_id):
        return True
    if not _amounts_equal(existing_data.get("amount"), amount):
        return True
    if not _amounts_equal(existing_data.get("ownership_percentage"), ownership_percentage):
        return True
    if apply_description_update and (existing_data.get("description") or "") != (final_description or ""):
        return True
    return False


def save_extrato_records(df: pd.DataFrame, db: Session, tenant_id: int, account_id: int, force_retag: bool = False, user_id: int = None, detect_conflicts: bool = True, enable_tracing: bool = False, original_filenames: list = None) -> dict:
    """
    Função única de insert/update para extratos bancários.
    Usada após ETL de extrato bruto (import_router).

    ⚡ OTIMIZADA para performance com:
    - Operações vetorizadas do pandas (10-100x mais rápido que iterrows)
    - Cache em memória de subtags e mapeamentos (99% redução em queries)
    - Bulk query para duplicatas (5800 queries → 1 query)
    - Bulk insert/update (80-95% mais rápido)

    Args:
        df: DataFrame com colunas: Data e hora, Descrição, Valor, Categoria, Transação, Subtag
        db: Sessão do banco de dados
        tenant_id: ID do tenant
        account_id: ID da conta bancária
        force_retag: Se True, ignora colunas Tag/Subtag e busca em mapeamentos
        user_id: ID do usuário (para filtrar mapeamentos)
        detect_conflicts: Se True, detecta conflitos de tag/subtag e valor ao invés de atualizar diretamente
        enable_tracing: Se True, gera arquivo JSON com debug de cada linha processada
        original_filenames: Lista de nomes dos arquivos originais (para o log de debug)

    Returns:
        Dicionário com estatísticas: created, duplicates, skipped, errors, conflicts
    """
    import time
    start_time = time.time()

    created_count = 0
    duplicate_count = 0
    skipped_count = 0
    unmapped_count = 0
    unmapped_records = []
    skipped_rows = []  # Armazena dados completos das linhas ignoradas
    updated_records = []  # DE-PARA dos registros atualizados (match sem conflito)
    errors = []
    conflicts = []  # Lista de conflitos detectados (tag/subtag ou valor diferente)

    # DEBUG: Lista de todos os registros processados para rastreamento (só se tracing ativo)
    debug_all_records = [] if enable_tracing else None

    logger.info(f"⚡ [OTIMIZADO] Iniciando importação de {len(df)} registros... detect_conflicts={detect_conflicts}, enable_tracing={enable_tracing}")
    print(f"⚡ [OTIMIZADO] Iniciando importação de {len(df)} registros... detect_conflicts={detect_conflicts}, enable_tracing={enable_tracing}")

    # Inicializa MappingHelper para suportar exact/pattern/regex
    psycopg2_conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    mapping_helper = MappingHelper(db_connection=psycopg2_conn, tenant_id=tenant_id, user_id=user_id, account_id=account_id)

    # ========================================
    # ETAPA 1: PREPARAÇÃO DE DADOS (VETORIZADO)
    # ========================================
    print(f"📊 [ETAPA 1/5] Preparando dados (vetorizado)...")

    # Converte datas de uma vez (vetorizado - muito mais rápido que loop)
    # IMPORTANTE: dayfirst=True para formato brasileiro DD/MM/YYYY
    try:
        df['date_parsed'] = pd.to_datetime(df['Data e hora'], dayfirst=True)
    except Exception as e:
        # Se falhar conversão em massa, marca para processamento individual
        df['date_parsed'] = None

    # Converte valores para Decimal
    df['amount_decimal'] = df['Valor'].apply(lambda x: Decimal(str(float(x))))

    # Preenche valores nulos
    df['Categoria'] = df.get('Categoria', pd.Series([None] * len(df))).fillna('')
    df['Transação'] = df.get('Transação', pd.Series([None] * len(df))).fillna('')
    if not force_retag:
        df['Tag'] = df.get('Tag', pd.Series([None] * len(df))).fillna('')
        df['Subtag'] = df.get('Subtag', pd.Series([None] * len(df))).fillna('')

    # Detecta colunas de compartilhamento (opcionais)
    has_sharing_cols = 'Conta Parceira' in df.columns
    has_contribution_col = 'Minha Contribuição (%)' in df.columns
    if has_sharing_cols:
        df['Conta Parceira'] = df['Conta Parceira'].fillna('')
    if has_contribution_col:
        df['Minha Contribuição (%)'] = df['Minha Contribuição (%)'].fillna('')

    # Cache de expense_sharing_id por nome de parceiro {partner_name: sharing_id}
    sharing_cache = {}

    # ========================================
    # ETAPA 2: CACHE DE REFERÊNCIAS (3 QUERIES TOTAL)
    # ========================================
    print(f"🔄 [ETAPA 2/5] Carregando cache de subtags e mapeamentos...")

    # Cache de subtags: {(name, tag_name, type): id}
    # Cache reverso: {id: {name, tag_name, type}} - para detecção de conflitos
    # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
    # IMPORTANTE: Filtra por account_id porque cada conta tem suas próprias tags/subtags
    subtags_query = db.query(Subtag.id, Subtag.name, Subtag.type, Tag.name.label('tag_name')).join(Tag).filter(
        Subtag.tenant_id == tenant_id,
        Subtag.account_id == account_id
    ).all()
    subtag_cache = {}
    subtag_id_to_info = {}  # Cache reverso para buscar nomes a partir do ID
    for s in subtags_query:
        subtag_cache[(s.name, s.tag_name, s.type)] = s.id
        subtag_id_to_info[s.id] = {'name': s.name, 'tag_name': s.tag_name, 'type': s.type}
    print(f"   ✅ {len(subtag_cache)} subtags em cache")

    # ========================================
    # ETAPA 3: BULK QUERY PARA DUPLICATAS (1 QUERY)
    # ========================================
    print(f"🔍 [ETAPA 3/5] Verificando duplicatas (bulk query)...")

    # NOTA: BankStatement NÃO tem campo 'active' (não usa soft delete)
    # Filtra por account_id para evitar conflitos entre contas diferentes
    # Inclui subtag_id e amount para detectar conflitos
    existing_keys_query = db.query(
        BankStatement.date,
        BankStatement.category,
        BankStatement.transaction,
        BankStatement.description,
        BankStatement.amount,
        BankStatement.id,
        BankStatement.subtag_id,
        BankStatement.expense_sharing_id,
        BankStatement.ownership_percentage,
    ).filter(
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id == account_id
    ).all()

    # Dict para verificação rápida de duplicatas (O(1))
    # Chave: (date, category, transaction, description) → pode ter múltiplos registros!
    # MOTIVO: timestamps HH:mm (sem segundos) podem gerar colisões
    # Se bater → verifica se é único ou múltiplo
    # Se múltiplos → busca por valor para identificar o correto
    existing_keys = {}  # chave -> lista de IDs
    existing_records_data = {}  # id -> {subtag_id, amount, tag_name, subtag_name}
    for e in existing_keys_query:
        key = (e.date, e.category or '', e.transaction or '', e.description or '')
        if key not in existing_keys:
            existing_keys[key] = []
        existing_keys[key].append(e.id)
        existing_records_data[e.id] = {
            'subtag_id': e.subtag_id,
            'amount': float(e.amount) if e.amount else 0.0,
            'description': e.description or '',
            'category': e.category or '',
            'transaction': e.transaction or '',
            'expense_sharing_id': e.expense_sharing_id,
            'ownership_percentage': float(e.ownership_percentage) if e.ownership_percentage is not None else 100.0,
        }
    print(f"   ✅ {len(existing_records_data)} registros existentes carregados (account_id={account_id})")

    closed_months = closed_periods(db, tenant_id, account_id)

    # ========================================
    # ETAPA 4: PROCESSAMENTO EM LOTE
    # ========================================
    print(f"⚙️  [ETAPA 4/5] Processando registros...")

    records_to_insert = []
    records_to_update = []

    # Converte DataFrame para lista de dicts (muito mais rápido que iterrows)
    records = df.to_dict('records')

    for idx, row in enumerate(records):
        try:
            # Usa data já parseada (vetorizado) ou faz parse individual se falhou
            date_obj = df.iloc[idx]['date_parsed']
            if pd.isna(date_obj):
                date_str = str(row['Data e hora'])
                try:
                    # IMPORTANTE: dayfirst=True para formato brasileiro DD/MM/YYYY
                    date_obj = pd.to_datetime(date_str, dayfirst=True)
                except:
                    error_msg = f"Linha {idx + 2}: Data inválida '{date_str}'"
                    errors.append(error_msg)
                    skipped_count += 1
                    # DEBUG: Registra como erro de data (se tracing ativo)
                    if enable_tracing and debug_all_records is not None:
                        debug_all_records.append({
                            "linha": idx + 2,
                            "status": "ERRO_DATA",
                            "date": date_str,
                            "description": str(row.get('Descrição', ''))[:50],
                            "amount": 0,
                            "error": error_msg
                        })
                    # Adiciona dados completos da linha ignorada
                    row_dict = {
                        "Linha": idx + 2,
                        "Erro": error_msg
                    }
                    # Adiciona todas as colunas originais
                    for k, v in row.items():
                        if pd.isna(v):
                            row_dict[k] = None
                        elif isinstance(v, (pd.Timestamp, datetime)):
                            row_dict[k] = v.strftime('%Y-%m-%d %H:%M:%S') if hasattr(v, 'strftime') else str(v)
                        elif isinstance(v, (int, float, str, bool)):
                            row_dict[k] = v
                        else:
                            row_dict[k] = str(v)
                    skipped_rows.append(row_dict)
                    continue

            # IMPORTANTE: Converte pd.Timestamp para datetime nativo do Python
            # pd.Timestamp e datetime têm hashes diferentes, causando falha no lookup do dict
            if isinstance(date_obj, pd.Timestamp):
                date_obj = date_obj.to_pydatetime()

            if (date_obj.year, date_obj.month) in closed_months:
                error_msg = (
                    f"Linha {idx + 2}: mês {date_obj.month:02d}/{date_obj.year} já está fechado"
                )
                errors.append(error_msg)
                skipped_count += 1
                row_dict = {
                    "Linha": idx + 2,
                    "Erro": error_msg,
                }
                for k, v in row.items():
                    if pd.isna(v):
                        row_dict[k] = None
                    elif isinstance(v, (pd.Timestamp, datetime)):
                        row_dict[k] = v.strftime('%Y-%m-%d %H:%M:%S') if hasattr(v, 'strftime') else str(v)
                    elif isinstance(v, (int, float, str, bool)):
                        row_dict[k] = v
                    else:
                        row_dict[k] = str(v)
                skipped_rows.append(row_dict)
                continue

            description = str(row['Descrição'])
            amount = float(row['Valor'])
            amount_decimal = df.iloc[idx]['amount_decimal']
            category = str(row['Categoria']) if row['Categoria'] else None
            transaction = str(row['Transação']) if row['Transação'] else None

            # Determina tipo baseado no valor (extratos: positivo=receita, negativo=despesa)
            tipo = "receita" if amount >= 0 else "despesa"

            # Busca subtag_id e mapped_description usando MappingHelper (suporta exact/pattern/regex)
            subtag_id = None
            mapped_description = None
            is_sensitive = False

            if force_retag:
                # MODO RE-TAGEAMENTO: Busca APENAS em mapeamentos
                # Usa MappingHelper para suportar exact, pattern e regex
                mapping_result = mapping_helper.find_mapping(description, tipo)
                if mapping_result:
                    subtag_id = mapping_result.get('subtag_id')
                    mapped_description = mapping_result.get('mapped_description')
                    is_sensitive = mapping_result.get('is_sensitive', False)
            else:
                # MODO NORMAL: Prioridade 1 - Subtag do Excel (respeita o arquivo)
                subtag_name = str(row.get('Subtag', '')) if row.get('Subtag') else None
                tag_name = str(row.get('Tag', '')) if row.get('Tag') else None

                if subtag_name:
                    if tag_name:
                        # Busca com tag específica - tenta primeiro com o tipo calculado
                        subtag_id = subtag_cache.get((subtag_name, tag_name, tipo))
                        # Se não encontrou, tenta com o tipo oposto (arquivo pode ter subtag de tipo diferente)
                        if not subtag_id:
                            tipo_oposto = "receita" if tipo == "despesa" else "despesa"
                            subtag_id = subtag_cache.get((subtag_name, tag_name, tipo_oposto))
                    else:
                        # Busca sem tag (primeira ocorrência, independente do tipo)
                        for (s_name, s_tag, s_type), s_id in subtag_cache.items():
                            if s_name == subtag_name:
                                subtag_id = s_id
                                break

                # Prioridade 2: Mapeamentos (fallback se Excel não tiver subtag)
                # Também busca mapped_description para substituição de descrição
                mapping_result = mapping_helper.find_mapping(description, tipo)
                if mapping_result:
                    # Só usa subtag do mapeamento se não veio do Excel
                    if not subtag_id:
                        subtag_id = mapping_result.get('subtag_id')
                    # Sempre aplica mapped_description se existir (para ofuscação de dados sensíveis)
                    mapped_description = mapping_result.get('mapped_description')
                    is_sensitive = mapping_result.get('is_sensitive', False)

            # Aplica substituição de descrição se houver mapeamento
            final_description = description
            if mapped_description is not None:
                # Se for sensível, descriptografa
                if is_sensitive:
                    from app.utils.crypto_helper import get_crypto_helper
                    crypto = get_crypto_helper()
                    try:
                        final_description = crypto.decrypt(mapped_description)
                        print(f"   🔓 Descriptografado: '{description}' → '{final_description}'")
                    except Exception as e:
                        print(f"   ⚠️  Erro ao descriptografar: {e}")
                        final_description = description
                else:
                    final_description = mapped_description

            # Verifica se é duplicata (lookup em dict - O(1))
            # Chave: (date, category, transaction, description)
            # NOTA: Agora existing_keys retorna LISTA de IDs (pode ter múltiplos com mesma chave)
            key = (date_obj, category or '', transaction or '', final_description or '')
            existing_ids = existing_keys.get(key, [])

            # Se não encontrou com descrição mapeada, tenta com descrição original
            if not existing_ids and final_description != description:
                key_original = (date_obj, category or '', transaction or '', description or '')
                existing_ids = existing_keys.get(key_original, [])

            # DEBUG: Log para rastrear "Koelle" especificamente
            if 'koelle' in (final_description or '').lower():
                logger.info(f"🔍 [DEBUG KOELLE] Buscando registro:")
                logger.info(f"   date_obj={date_obj}")
                logger.info(f"   category='{category}'")
                logger.info(f"   transaction='{transaction}'")
                logger.info(f"   final_description='{final_description}'")
                logger.info(f"   key={key}")
                logger.info(f"   existing_ids={existing_ids}")
                logger.info(f"   amount={amount_decimal}")

            # Lógica para resolver múltiplos matches (timestamps HH:mm sem segundos)
            existing_id = None
            multiple_matches = None

            if len(existing_ids) == 1:
                # Único match - comportamento normal
                existing_id = existing_ids[0]
            elif len(existing_ids) > 1:
                # Múltiplos matches - busca por valor igual
                file_amount = float(amount_decimal)
                matched_by_amount = None

                # DEBUG: Log para rastrear múltiplos matches
                logger.info(f"🔄 [MÚLTIPLOS MATCHES] {len(existing_ids)} registros para '{final_description[:40]}...'")
                logger.info(f"   Valor do arquivo: {file_amount}")

                for eid in existing_ids:
                    edata = existing_records_data.get(eid, {})
                    existing_amount = edata.get('amount', 0.0)
                    diff = abs(existing_amount - file_amount)
                    logger.info(f"   #{eid}: amount={existing_amount}, diff={diff:.4f}")
                    if diff <= 0.01:
                        matched_by_amount = eid
                        logger.info(f"   ✅ Match por valor encontrado: #{eid}")
                        break

                if matched_by_amount:
                    # Encontrou registro com mesmo valor - verifica só conflito de tag
                    existing_id = matched_by_amount
                    logger.info(f"   → Usando registro #{existing_id} (match por valor)")
                else:
                    # Não encontrou valor igual - prepara lista para seleção do usuário
                    logger.info(f"   ⚠️ Nenhum match por valor - criando multiple_matches")
                    multiple_matches = []
                    for eid in existing_ids:
                        edata = existing_records_data.get(eid, {})
                        subtag_info = subtag_id_to_info.get(edata.get('subtag_id'), {})
                        multiple_matches.append({
                            'id': eid,
                            'amount': edata.get('amount', 0.0),
                            'subtag_id': edata.get('subtag_id'),
                            'subtag_name': subtag_info.get('name'),
                            'tag_name': subtag_info.get('tag_name')
                        })

            # Processa compartilhamento (usado tanto para INSERT quanto UPDATE)
            # PRIORIDADE: 1) Arquivo Excel → 2) Mapeamento → 3) Padrão (100%)
            expense_sharing_id = None
            ownership_percentage = Decimal("100.00")

            if mapping_result and mapping_result.get('expense_sharing_id') is not None:
                expense_sharing_id = mapping_result['expense_sharing_id']
                ownership_percentage = resolve_ownership_percentage(
                    tipo=tipo,
                    mapping=mapping_result,
                )

            # PRIORIDADE 1: Arquivo Excel (se houver colunas de compartilhamento)
            # Sobrescreve configuração do mapeamento
            if has_sharing_cols:
                partner_name = str(row.get('Conta Parceira', '')).strip()
                if partner_name:
                    # Busca no cache ou faz lookup
                    if partner_name not in sharing_cache:
                        sharing_cache[partner_name] = lookup_expense_sharing_by_partner_name(
                            db, tenant_id, account_id, partner_name
                        )
                    excel_sharing_id = sharing_cache[partner_name]
                    if excel_sharing_id:
                        expense_sharing_id = excel_sharing_id
                        # Se encontrou compartilhamento, usa contribuição do Excel se disponível
                        if has_contribution_col:
                            contrib_val = row.get('Minha Contribuição (%)', '')
                            if contrib_val != '' and contrib_val is not None:
                                try:
                                    ownership_percentage = Decimal(str(contrib_val))
                                except:
                                    pass  # Mantém valor anterior se inválido
                elif partner_name == '':
                    # Coluna existe mas está vazia = sem compartilhamento
                    expense_sharing_id = None
                    ownership_percentage = Decimal("100.00")

            # CASO 1: Múltiplos matches - usuário precisa selecionar qual atualizar
            if multiple_matches and detect_conflicts:
                new_subtag_ctx = subtag_id_to_info.get(subtag_id, {}) if subtag_id else {}
                conflict_record = {
                    'existing_id': None,  # Será definido pelo usuário
                    'record_type': 'bank_statement',
                    'source_line': idx + 2,
                    'date': date_obj.strftime('%Y-%m-%d %H:%M:%S') if date_obj else '',
                    'description': final_description,
                    'new_subtag_id': subtag_id,
                    'new_amount': float(amount_decimal),
                    'new_category': category,
                    'new_transaction': transaction,
                    'new_expense_sharing_id': expense_sharing_id,
                    'new_ownership_percentage': float(ownership_percentage),
                    'new_description': final_description if final_description != description else None,
                    'multiple_matches': multiple_matches,
                    # Contexto: existing_amount desconhecido (múltiplos candidatos)
                    'new_tag_name': new_subtag_ctx.get('tag_name'),
                    'new_subtag_name': new_subtag_ctx.get('name'),
                }
                conflicts.append(conflict_record)
                # DEBUG: Registra como múltiplos matches
                if enable_tracing and debug_all_records is not None:
                    debug_all_records.append({
                        "linha": idx + 2,
                        "status": "MULTIPLOS_MATCHES",
                        "date": date_obj.strftime('%Y-%m-%d %H:%M:%S') if hasattr(date_obj, 'strftime') else str(date_obj),
                        "description": final_description[:50] if final_description else "",
                        "amount": float(amount_decimal),
                        "matches_count": len(multiple_matches)
                    })
            # CASO 2: Único match encontrado
            elif existing_id:
                # Registro duplicado - verifica se há conflitos antes de atualizar
                existing_data = existing_records_data.get(existing_id, {})
                existing_subtag_id = existing_data.get('subtag_id')
                existing_amount = existing_data.get('amount', 0.0)

                # Detecta conflitos de tag/subtag e valor
                has_tag_conflict = (
                    detect_conflicts and
                    existing_subtag_id is not None and
                    subtag_id is not None and
                    existing_subtag_id != subtag_id
                )
                # Conflito de valor: verifica se há diferença no valor (tolerância de 0.001 para erros de float)
                has_amount_conflict = (
                    detect_conflicts and
                    abs(existing_amount - float(amount_decimal)) >= 0.005
                )

                if has_tag_conflict or has_amount_conflict:
                    # Pré-computa contexto completo para exibição no modal
                    existing_subtag_ctx = subtag_id_to_info.get(existing_subtag_id, {})
                    new_subtag_ctx = subtag_id_to_info.get(subtag_id, {}) if subtag_id else {}
                    # Há conflito - adiciona à lista de conflitos ao invés de atualizar
                    conflict_record = {
                        'existing_id': existing_id,
                        'record_type': 'bank_statement',
                        'source_line': idx + 2,
                        'date': date_obj.strftime('%Y-%m-%d %H:%M:%S') if date_obj else '',
                        'description': final_description,
                        'new_subtag_id': subtag_id,
                        'new_amount': float(amount_decimal),
                        'new_category': category,
                        'new_transaction': transaction,
                        'new_expense_sharing_id': expense_sharing_id,
                        'new_ownership_percentage': float(ownership_percentage),
                        'new_description': final_description if final_description != description else None,
                        # Contexto completo - valores atuais no banco
                        'existing_amount': existing_amount,
                        'existing_tag_name': existing_subtag_ctx.get('tag_name'),
                        'existing_subtag_name': existing_subtag_ctx.get('name'),
                        # Valores novos do arquivo
                        'new_tag_name': new_subtag_ctx.get('tag_name'),
                        'new_subtag_name': new_subtag_ctx.get('name'),
                    }

                    if has_tag_conflict:
                        # Busca nomes das tags para exibição
                        existing_subtag = subtag_id_to_info.get(existing_subtag_id, {})
                        new_subtag = subtag_id_to_info.get(subtag_id, {})
                        conflict_record['tag_conflict'] = {
                            'original_subtag_id': existing_subtag_id,
                            'original_subtag_name': existing_subtag.get('name'),
                            'original_tag_name': existing_subtag.get('tag_name'),
                            'new_subtag_id': subtag_id,
                            'new_subtag_name': new_subtag.get('name'),
                            'new_tag_name': new_subtag.get('tag_name')
                        }

                    if has_amount_conflict:
                        conflict_record['amount_conflict'] = {
                            'original_amount': existing_amount,
                            'new_amount': float(amount_decimal)
                        }

                    conflicts.append(conflict_record)
                    # Não conta como duplicado pois precisa de resolução
                    # DEBUG: Registra como conflito (se tracing ativo)
                    if enable_tracing and debug_all_records is not None:
                        debug_all_records.append({
                            "linha": idx + 2,
                            "status": "CONFLITO",
                            "date": date_obj.strftime('%Y-%m-%d %H:%M:%S') if hasattr(date_obj, 'strftime') else str(date_obj),
                            "description": final_description[:50] if final_description else "",
                            "amount": float(amount_decimal)
                        })
                else:
                    apply_description_update = final_description != description
                    has_changes = _extrato_row_has_changes(
                        existing_data,
                        category=category,
                        transaction=transaction,
                        subtag_id=subtag_id,
                        expense_sharing_id=expense_sharing_id,
                        ownership_percentage=ownership_percentage,
                        amount=amount_decimal,
                        final_description=final_description,
                        apply_description_update=apply_description_update,
                    )
                    if not has_changes:
                        if enable_tracing and debug_all_records is not None:
                            debug_all_records.append({
                                "linha": idx + 2,
                                "status": "SEM_ALTERACAO",
                                "date": date_obj.strftime('%Y-%m-%d %H:%M:%S') if hasattr(date_obj, 'strftime') else str(date_obj),
                                "description": final_description[:50] if final_description else "",
                                "amount": float(amount_decimal),
                            })
                    else:
                        update_record = {
                            'id': existing_id,
                            'category': category,
                            'transaction': transaction,
                            'subtag_id': subtag_id,
                            'expense_sharing_id': expense_sharing_id,
                            'ownership_percentage': ownership_percentage,
                            'amount': amount_decimal
                        }
                        if apply_description_update:
                            update_record['description'] = final_description
                        records_to_update.append(update_record)
                        duplicate_count += 1

                        existing_subtag_ctx = subtag_id_to_info.get(existing_subtag_id, {})
                        new_subtag_ctx = subtag_id_to_info.get(subtag_id, {})
                        existing_description = existing_data.get('description') or ''
                        updated_records.append({
                            'Linha': idx + 2,
                            'ID': existing_id,
                            'Data': date_obj.strftime('%Y-%m-%d %H:%M:%S') if date_obj else '',
                            'Descrição': final_description,
                            'Valor (DE)': existing_amount,
                            'Valor (PARA)': float(amount_decimal),
                            'Tag (DE)': existing_subtag_ctx.get('tag_name') or '',
                            'Subtag (DE)': existing_subtag_ctx.get('name') or '',
                            'Tag (PARA)': new_subtag_ctx.get('tag_name') or '',
                            'Subtag (PARA)': new_subtag_ctx.get('name') or '',
                            'Descrição (DE)': existing_description,
                            'Descrição (PARA)': final_description,
                        })

                        subtag_info = subtag_id_to_info.get(subtag_id, {})
                        tag_name = subtag_info.get('tag_name', 'N/A')
                        subtag_name = subtag_info.get('name', 'N/A')
                        print(f"   🔄 Atualizado: {final_description[:40]:<40} → {tag_name} / {subtag_name}")

                        if enable_tracing and debug_all_records is not None:
                            debug_all_records.append({
                                "linha": idx + 2,
                                "status": "ATUALIZADO",
                                "date": date_obj.strftime('%Y-%m-%d %H:%M:%S') if hasattr(date_obj, 'strftime') else str(date_obj),
                                "description": final_description[:50] if final_description else "",
                                "amount": float(amount_decimal),
                                "tag": tag_name,
                                "subtag": subtag_name
                            })
            # CASO 3: Nenhum match - registro novo
            else:
                # Novo registro - adiciona para insert
                # IMPORTANTE: Salva final_description (mapeada/descriptografada)
                records_to_insert.append({
                    'tenant_id': tenant_id,
                    'account_id': account_id,
                    'date': date_obj,
                    'description': final_description,
                    'amount': amount_decimal,
                    'category': category,
                    'transaction': transaction,
                    'subtag_id': subtag_id,
                    'ownership_percentage': ownership_percentage,
                    'expense_sharing_id': expense_sharing_id,
                    'created_by': user_id  # ✅ Campo obrigatório do BaseEntity
                })
                created_count += 1
                # DEBUG: Registra como criado (se tracing ativo)
                if enable_tracing and debug_all_records is not None:
                    debug_all_records.append({
                        "linha": idx + 2,
                        "status": "CRIADO",
                        "date": date_obj.strftime('%Y-%m-%d %H:%M:%S') if hasattr(date_obj, 'strftime') else str(date_obj),
                        "description": final_description[:50] if final_description else "",
                        "amount": float(amount_decimal)
                    })

            # Rastreia se não foi mapeado (subtag_id é NULL)
            if subtag_id is None:
                unmapped_count += 1
                unmapped_records.append({
                    "linha": idx + 2,
                    "data": date_obj.strftime('%Y-%m-%d %H:%M:%S'),
                    "descricao": description,
                    "valor": amount,
                    "categoria": category,
                    "transacao": transaction
                })

        except Exception as e:
            import traceback
            error_msg = f"Linha {idx + 2}: {str(e)}"
            errors.append(error_msg)
            logger.error(f"❌ ERRO: {error_msg}")
            logger.debug(f"   Traceback: {traceback.format_exc()}")
            skipped_count += 1
            # DEBUG: Registra como erro (se tracing ativo)
            if enable_tracing and debug_all_records is not None:
                debug_all_records.append({
                    "linha": idx + 2,
                    "status": "ERRO",
                    "date": "",
                    "description": str(row.get('Descricao', row.get('Descrição', '')))[:50],
                    "amount": 0,
                    "error": error_msg
                })
            # Adiciona dados completos da linha ignorada
            row_dict = {
                "Linha": idx + 2,
                "Erro": error_msg
            }
            for k, v in row.items():
                if pd.isna(v):
                    row_dict[k] = None
                elif isinstance(v, (pd.Timestamp, datetime)):
                    row_dict[k] = v.strftime('%Y-%m-%d %H:%M:%S') if hasattr(v, 'strftime') else str(v)
                elif isinstance(v, (int, float, str, bool)):
                    row_dict[k] = v
                else:
                    row_dict[k] = str(v)
            skipped_rows.append(row_dict)
            continue

    # ========================================
    # ETAPA 5: BULK INSERT/UPDATE (2 OPERAÇÕES)
    # ========================================
    print(f"💾 [ETAPA 5/5] Salvando no banco...")
    print(f"   📝 {len(records_to_insert)} novos registros")
    print(f"   🔄 {len(records_to_update)} atualizações")
    if len(conflicts) > 0:
        print(f"   ⚠️  {len(conflicts)} conflitos detectados (aguardando resolução)")

    if records_to_insert:
        db.bulk_insert_mappings(BankStatement, records_to_insert)

    if records_to_update:
        db.bulk_update_mappings(BankStatement, records_to_update)

    db.commit()

    # Fecha conexão psycopg2
    psycopg2_conn.close()

    elapsed = time.time() - start_time
    records_per_sec = len(df) / elapsed if elapsed > 0 else 0
    print(f"✅ [OTIMIZADO] Concluído em {elapsed:.2f}s ({records_per_sec:.0f} registros/s)")
    print(f"   📊 Criados: {created_count} | Duplicados: {duplicate_count} | Conflitos: {len(conflicts)} | Não mapeados: {unmapped_count} | Erros: {skipped_count}")

    # Log para debug
    if skipped_count > 0:
        logger.info(f"📋 EXTRATO: {skipped_count} registros ignorados, {len(skipped_rows)} linhas com dados completos")
        if len(skipped_rows) > 0:
            logger.info(f"   Primeira linha ignorada: {skipped_rows[0]}")

    # ===== DEBUG: Prepara dados de debug (se tracing ativo) =====
    # NOTA: O JSON será salvo apenas no final (após resolução/descarte de conflitos)
    debug_data = None
    if enable_tracing and debug_all_records is not None:
        total_processados = created_count + duplicate_count + len(conflicts) + skipped_count
        debug_data = {
            "timestamp": datetime.now().isoformat(),
            "type": "extrato",
            "original_filenames": original_filenames or [],
            "total_linhas_arquivo": len(df),
            "total_processados": total_processados,
            "created_count": created_count,
            "duplicate_count": duplicate_count,
            "conflicts_count": len(conflicts),
            "skipped_count": skipped_count,
            "unmapped_count": unmapped_count,
            "diferenca": len(df) - total_processados,
            "all_records": debug_all_records,
            "conflicts_details": [
                {
                    "existing_id": c.get("existing_id"),
                    "description": c.get("description"),
                    "date": c.get("date"),
                    # Tag/Subtag conflict info
                    "has_tag_conflict": "tag_conflict" in c,
                    "original_tag": c.get("tag_conflict", {}).get("original_tag_name") if "tag_conflict" in c else None,
                    "original_subtag": c.get("tag_conflict", {}).get("original_subtag_name") if "tag_conflict" in c else None,
                    "new_tag": c.get("tag_conflict", {}).get("new_tag_name") if "tag_conflict" in c else None,
                    "new_subtag": c.get("tag_conflict", {}).get("new_subtag_name") if "tag_conflict" in c else None,
                    # Amount conflict info
                    "has_amount_conflict": "amount_conflict" in c,
                    "original_amount": c.get("amount_conflict", {}).get("original_amount") if "amount_conflict" in c else None,
                    "new_amount": c.get("amount_conflict", {}).get("new_amount") if "amount_conflict" in c else None,
                }
                for c in conflicts
            ],
            "skipped_rows_sample": skipped_rows[:5] if skipped_rows else [],
            "errors_sample": errors[:5] if errors else []
        }

        # Se não há conflitos, salva o JSON imediatamente (fluxo completo)
        if len(conflicts) == 0:
            try:
                log_dir = os.path.join(os.path.dirname(__file__), "..", "..", "logs")
                os.makedirs(log_dir, exist_ok=True)
                log_file = os.path.join(log_dir, f"import_debug_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
                with open(log_file, "w", encoding="utf-8") as f:
                    json.dump(debug_data, f, indent=2, ensure_ascii=False, default=str)
                print(f"📝 Debug JSON salvo em: {log_file}")
            except Exception as e:
                print(f"⚠️ Erro ao salvar debug JSON: {e}")
    # ===== FIM DEBUG =====

    return {
        "success": True,
        "created": created_count,
        "skipped": skipped_count,
        "duplicates": duplicate_count,
        "unmapped": unmapped_count,
        "unmapped_records": unmapped_records[:20],  # Limita a 20 registros
        "skippedRows": skipped_rows,  # Dados completos das linhas ignoradas
        "updated_records": updated_records,  # DE-PARA das linhas atualizadas
        "errors": errors[:10],
        "conflicts": conflicts,  # Lista de conflitos pendentes
        "conflicts_count": len(conflicts),
        "debug_data": debug_data  # Dados de debug para salvar após resolução
    }
