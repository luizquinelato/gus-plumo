"""
Router para gerenciamento de extratos de cartões de benefícios.
Fornece endpoints para importação de CSV e CRUD de extratos.
"""

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from decimal import Decimal
import csv
import io
import logging
from app.database import get_db, DATABASE_URL
from app.models.unified_models import BenefitCardStatement, Cartao, TransactionMapping, Subtag, ExpenseSharingSetting, Account
from app.dependencies.auth import require_account
from app.utils.mapping_helper import MappingHelper
import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/benefit-card-statements", tags=["benefit-card-statements"])


# ==================== HELPER FUNCTIONS ====================

def lookup_expense_sharing_by_partner_name(
    db: Session,
    tenant_id: int,
    account_id: int,
    partner_name: str
) -> Optional[int]:
    """
    Busca expense_sharing_id a partir do nome/descrição da conta parceira.

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

    logger.info(f"✅ Encontrado sharing_id={sharing.id} para parceiro '{partner_name}'")
    return sharing.id


def find_subtag_by_mapping(db: Session, tenant_id: int, description: str, valor: float) -> int | None:
    """
    Busca subtag_id através de transaction_mappings baseado na descrição.
    Filtra por tipo (receita/despesa) baseado no valor.

    Para benefícios: negativo = despesa, positivo = receita (estorno/crédito)

    Args:
        db: Sessão do banco de dados
        tenant_id: ID do tenant
        description: Descrição da transação
        valor: Valor da transação (para determinar tipo)

    Returns:
        int | None: ID da subtag encontrada ou None
    """
    # Valida descrição obrigatória
    if not description:
        print("⚠️  find_subtag_by_mapping: descrição vazia, retornando None")
        return None

    # Determina tipo baseado no valor
    # Para benefícios: negativo = despesa, positivo = receita
    tipo = "receita" if valor >= 0 else "despesa"

    # Busca mapeamento pela descrição
    # NOTA: TransactionMapping NÃO tem campo 'active' (não usa soft delete)
    try:
        mapping = db.query(TransactionMapping).filter(
            TransactionMapping.tenant_id == tenant_id,
            func.lower(TransactionMapping.original_description) == description.lower()
        ).first()

        if mapping and mapping.subtag_id:
            # Verifica se a subtag é do tipo correto
            # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
            mapped_subtag = db.query(Subtag).filter(
                Subtag.id == mapping.subtag_id,
                Subtag.type == tipo
            ).first()

            if mapped_subtag:
                print(f"✅ Mapeamento encontrado: '{description[:50]}' → {mapped_subtag.name} (ID {mapping.subtag_id})")
                return mapping.subtag_id
            else:
                print(f"⚠️  Mapeamento encontrado mas tipo incompatível: esperado '{tipo}', mapeamento aponta para subtag ID {mapping.subtag_id}")
    except Exception as e:
        print(f"❌ Erro ao buscar mapeamento: {e}")

    # Se não encontrou, retorna NULL
    print(f"⚠️  Nenhum mapeamento para '{description[:50]}', retornando NULL")
    return None


# ==================== SCHEMAS ====================
class BenefitCardStatementCreate(BaseModel):
    credit_card_id: int
    date: datetime
    description: str
    amount: Decimal
    payment_method: str | None = None
    subtag_id: int | None = None
    ownership_percentage: Decimal = Decimal('100.00')
    expense_sharing_id: int | None = None
    adjustment_notes: str | None = None


class BenefitCardStatementUpdate(BaseModel):
    subtag_id: int | None = None
    ownership_percentage: Decimal | None = None
    expense_sharing_id: int | None = None
    adjustment_notes: str | None = None


class BenefitCardStatementResponse(BaseModel):
    id: int
    credit_card_id: int
    date: datetime
    description: str
    amount: Decimal
    payment_method: str | None
    subtag_id: int | None
    adjustment_type: str  # Derivado automaticamente
    ownership_percentage: Decimal
    expense_sharing_id: int | None
    adjustment_notes: str | None
    # NOTA: BenefitCardStatement NÃO tem campo 'active' (não usa soft delete)

    class Config:
        from_attributes = True


@router.get("/", response_model=List[BenefitCardStatementResponse])
async def listar_extratos(
    credit_card_id: int | None = None,
    incluir_inativos: bool = False,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """
    Lista extratos de cartões de benefícios.

    Args:
        credit_card_id: Filtrar por cartão específico
        incluir_inativos: Parâmetro ignorado (BenefitCardStatement não tem soft delete)
    """
    tenant_id = current_user.get("tenant_id", 1)
    account_id = current_user.get("account_id")

    if not account_id:
        raise HTTPException(status_code=400, detail="account_id não encontrado no token")

    # NOTA: BenefitCardStatement NÃO tem campo 'active' (não usa soft delete)
    # Filtra por account_id através do join com Cartao
    query = db.query(BenefitCardStatement).join(
        Cartao, BenefitCardStatement.credit_card_id == Cartao.id
    ).filter(
        BenefitCardStatement.tenant_id == tenant_id,
        Cartao.account_id == account_id  # ✅ FILTRO POR ACCOUNT_ID
    )

    if credit_card_id:
        query = query.filter(BenefitCardStatement.credit_card_id == credit_card_id)

    extratos = query.order_by(BenefitCardStatement.date.desc()).all()
    return extratos


@router.post("/importar-csv")
async def importar_csv(
    credit_card_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """
    Importa extratos de cartão de benefícios a partir de arquivo CSV.

    Formato esperado: Data,Hora,Movimentação,Valor,Meio de Pagamento,Saldo
    Exemplo: 18/01/2026,12:15,SAVEGNAGO LOJA 45 RIO CLARO BRA,"-R$ 216,38",Cartão,"R$ 130,77"
    """
    tenant_id = current_user.get("tenant_id", 1)
    user_id = current_user.get("user_id") or current_user.get("id")

    # Verifica se o cartão existe e é do tipo benefícios
    # Usa joinedload para carregar o relacionamento expense_sharing em uma única query
    from sqlalchemy.orm import joinedload
    cartao = db.query(Cartao).options(
        joinedload(Cartao.expense_sharing)
    ).filter(
        Cartao.id == credit_card_id,
        Cartao.tenant_id == tenant_id,
        Cartao.active == True
    ).first()

    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado")

    if cartao.type != 'beneficios':
        raise HTTPException(status_code=400, detail="Cartão deve ser do tipo 'beneficios'")

    # Busca configurações de compartilhamento do cartão para propagar aos itens
    card_expense_sharing_id = cartao.expense_sharing_id
    card_account_id = cartao.account_id

    # Se o cartão tem compartilhamento, busca o ownership_percentage padrão
    card_ownership_percentage = Decimal('100.00')
    if card_expense_sharing_id and cartao.expense_sharing:
        card_ownership_percentage = cartao.expense_sharing.my_contribution_percentage

    try:
        import time
        import pandas as pd
        start_time = time.time()

        # Lê o conteúdo do arquivo
        contents = await file.read()
        decoded = contents.decode('utf-8')

        # ========================================
        # ETAPA 1: VALIDAÇÃO DE CABEÇALHO
        # ========================================
        csv_reader = csv.DictReader(io.StringIO(decoded))
        required_headers = ['Data', 'Hora', 'Movimentação', 'Valor', 'Meio de Pagamento', 'Saldo']
        optional_headers = ['Conta Parceira', 'Minha Contribuição (%)']
        actual_headers = [h.strip() for h in (csv_reader.fieldnames or [])]

        print(f"🔍 DEBUG - Headers obrigatórios: {required_headers}")
        print(f"🔍 DEBUG - Headers opcionais: {optional_headers}")
        print(f"🔍 DEBUG - Headers recebidos: {actual_headers}")

        # Verifica se todos os headers obrigatórios estão presentes (na ordem)
        required_present = actual_headers[:len(required_headers)] == required_headers
        if not required_present:
            raise HTTPException(
                status_code=400,
                detail=f"Cabeçalho CSV inválido. Esperado começar com: {required_headers}, Recebido: {actual_headers}"
            )

        # Detecta colunas opcionais de compartilhamento
        has_sharing_cols = 'Conta Parceira' in actual_headers
        has_contribution_col = 'Minha Contribuição (%)' in actual_headers
        if has_sharing_cols:
            print(f"   📊 Detectada coluna 'Conta Parceira'")
        if has_contribution_col:
            print(f"   📊 Detectada coluna 'Minha Contribuição (%)'")

        # ========================================
        # ETAPA 2: CONVERSÃO PARA DATAFRAME (VETORIZADO)
        # ========================================
        print(f"⚡ [OTIMIZADO] Carregando CSV em DataFrame...")
        df = pd.read_csv(io.StringIO(decoded))
        print(f"   📊 {len(df)} registros carregados")

        # ========================================
        # ETAPA 3: PREPARAÇÃO DE DADOS (VETORIZADO)
        # ========================================
        print(f"📊 [ETAPA 1/4] Preparando dados (vetorizado)...")

        # Combina Data + Hora em date (vetorizado)
        df['date'] = pd.to_datetime(df['Data'] + ' ' + df['Hora'], format='%d/%m/%Y %H:%M')

        # Parse de valores (vetorizado)
        # Remove aspas, R$, espaços, pontos de milhar, troca vírgula por ponto
        df['amount_str'] = df['Valor'].str.replace('"', '', regex=False)
        df['is_negative'] = df['amount_str'].str.contains('-')
        df['amount_clean'] = (
            df['amount_str']
            .str.replace('-', '', regex=False)
            .str.replace('R$', '', regex=False)
            .str.replace('\xa0', '', regex=False)
            .str.replace(' ', '', regex=False)
            .str.replace('\t', '', regex=False)
            .str.replace('.', '', regex=False)  # Remove pontos de milhar
            .str.replace(',', '.', regex=False)  # Troca vírgula por ponto
        )
        # Aplica sinal negativo
        df['amount_decimal'] = df.apply(
            lambda row: Decimal('-' + row['amount_clean']) if row['is_negative'] else Decimal(row['amount_clean']),
            axis=1
        )

        # ========================================
        # ETAPA 4: INICIALIZA MAPPING HELPER (suporta exact/pattern/regex)
        # ========================================
        print(f"🔄 [ETAPA 2/4] Inicializando MappingHelper...")

        # Usa MappingHelper para suporte a exact/pattern/regex com prioridade correta
        # Prioridade: 0=Alta (exact), 1=Média (pattern), 2=Baixa (regex)
        psycopg2_conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        mapping_helper = MappingHelper(db_connection=psycopg2_conn, tenant_id=tenant_id, user_id=user_id)
        print(f"   ✅ MappingHelper inicializado")

        # ========================================
        # ETAPA 5: BULK QUERY PARA DUPLICATAS (1 QUERY)
        # ========================================
        print(f"🔍 [ETAPA 3/4] Verificando duplicatas (bulk query)...")

        # NOTA: BenefitCardStatement NÃO tem campo 'active' (não usa soft delete)
        # Busca id, subtag_id e amount para detecção de conflitos
        existing_keys_query = db.query(
            BenefitCardStatement.date,
            BenefitCardStatement.description,
            BenefitCardStatement.id,
            BenefitCardStatement.subtag_id,
            BenefitCardStatement.amount
        ).filter(
            BenefitCardStatement.credit_card_id == credit_card_id,
            BenefitCardStatement.tenant_id == tenant_id
        ).all()

        # Dict para verificação rápida de duplicatas (O(1))
        # Chave: (date, description) → pode ter múltiplos registros!
        # MOTIVO: timestamps HH:mm (sem segundos) podem gerar colisões
        existing_keys = {}  # chave -> lista de IDs
        existing_records_data = {}  # id -> {subtag_id, amount}
        for e in existing_keys_query:
            key = (e.date, e.description)
            if key not in existing_keys:
                existing_keys[key] = []
            existing_keys[key].append(e.id)
            existing_records_data[e.id] = {
                'subtag_id': e.subtag_id,
                'amount': float(e.amount) if e.amount else 0.0
            }
        print(f"   ✅ {len(existing_records_data)} registros existentes carregados")

        # Cache de subtags para exibir nomes nos conflitos
        # IMPORTANTE: Busca pelo account_id do cartão, não do usuário logado
        from app.models.unified_models import Subtag, Tag
        subtags_query = db.query(Subtag.id, Subtag.name, Subtag.type, Tag.name.label('tag_name')).join(Tag).filter(
            Subtag.tenant_id == tenant_id,
            Subtag.account_id == card_account_id
        ).all()
        subtag_id_to_info = {s.id: {'name': s.name, 'tag_name': s.tag_name, 'type': s.type} for s in subtags_query}
        print(f"   ✅ {len(subtag_id_to_info)} subtags em cache para conflitos")

        # ========================================
        # ETAPA 6: PROCESSAMENTO EM LOTE
        # ========================================
        print(f"⚙️  [ETAPA 4/4] Processando registros...")

        registros_importados = 0
        registros_atualizados = 0
        unmapped_count = 0
        unmapped_records = []
        records_to_insert = []
        records_to_update = []
        conflicts = []  # Lista de conflitos detectados

        # Cache de expense_sharing_id por nome de parceiro {partner_name: sharing_id}
        sharing_cache = {}

        # Converte DataFrame para lista de dicts (muito mais rápido que iterrows)
        records = df.to_dict('records')

        for idx, row in enumerate(records):
            linha_numero = idx + 2  # +2 porque linha 1 é header
            try:
                # Usa dados já parseados (vetorizado)
                date_obj = df.iloc[idx]['date']
                amount_decimal = df.iloc[idx]['amount_decimal']
                description = row['Movimentação']
                payment_method = row['Meio de Pagamento']

                # Valida descrição obrigatória
                if not description or not str(description).strip():
                    continue

                description = str(description).strip()

                # Busca subtag_id e mapped_description usando MappingHelper (suporta exact/pattern/regex)
                # Para benefícios: negativo = despesa (gasto), positivo = receita (crédito/estorno)
                tipo = "despesa" if float(amount_decimal) < 0 else "receita"

                subtag_id = None
                mapped_description = None
                is_sensitive = False
                final_description = description

                # Usa MappingHelper para busca com prioridade correta (exact → pattern → regex)
                mapping_result = mapping_helper.find_mapping(description, tipo)
                if mapping_result:
                    subtag_id = mapping_result.get('subtag_id')
                    mapped_description = mapping_result.get('mapped_description')
                    is_sensitive = mapping_result.get('is_sensitive', False)

                    # Aplica substituição de descrição se houver mapeamento
                    if mapped_description is not None:
                        if is_sensitive:
                            from app.utils.crypto_helper import get_crypto_helper
                            crypto = get_crypto_helper()
                            try:
                                final_description = crypto.decrypt(mapped_description)
                            except Exception as e:
                                print(f"   ⚠️  Erro ao descriptografar: {e}")
                                final_description = description
                        else:
                            final_description = mapped_description

                # Verifica se é duplicata (lookup em dict - O(1))
                # Chave: (date, description) → pode ter múltiplos registros!
                key_mapped = (date_obj, final_description)
                key_original = (date_obj, description)

                existing_ids = existing_keys.get(key_mapped, [])
                if not existing_ids and final_description != description:
                    # Tenta com descrição original (caso o registro foi salvo antes do mapeamento)
                    existing_ids = existing_keys.get(key_original, [])

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

                    for eid in existing_ids:
                        edata = existing_records_data.get(eid, {})
                        if abs(edata.get('amount', 0.0) - file_amount) <= 0.01:
                            matched_by_amount = eid
                            break

                    if matched_by_amount:
                        # Encontrou registro com mesmo valor - verifica só conflito de tag
                        existing_id = matched_by_amount
                    else:
                        # Não encontrou valor igual - prepara lista para seleção do usuário
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

                # Prepara dados de compartilhamento
                # PRIORIDADE: 1) Arquivo Excel → 2) Mapeamento → 3) Cartão
                expense_sharing_id = card_expense_sharing_id
                ownership_percentage = card_ownership_percentage

                # PRIORIDADE 2: Mapeamento (se tiver expense_sharing_id definido)
                # Sobrescreve configuração do cartão
                if mapping_result and mapping_result.get('expense_sharing_id') is not None:
                    expense_sharing_id = mapping_result['expense_sharing_id']
                    if mapping_result.get('my_contribution_percentage') is not None:
                        ownership_percentage = Decimal(str(mapping_result['my_contribution_percentage']))

                # PRIORIDADE 1: Arquivo Excel (se houver colunas de compartilhamento)
                # Sobrescreve configuração do mapeamento/cartão
                if has_sharing_cols:
                    partner_name = str(row.get('Conta Parceira', '')).strip()
                    if partner_name:
                        # Busca no cache ou faz lookup
                        if partner_name not in sharing_cache:
                            sharing_cache[partner_name] = lookup_expense_sharing_by_partner_name(
                                db, tenant_id, card_account_id, partner_name
                            )
                        excel_sharing_id = sharing_cache[partner_name]
                        if excel_sharing_id:
                            expense_sharing_id = excel_sharing_id
                            # Se encontrou compartilhamento, usa contribuição do arquivo se disponível
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
                if multiple_matches:
                    conflict_record = {
                        'existing_id': None,  # Será definido pelo usuário
                        'record_type': 'benefit_card_statement',
                        'date': date_obj.strftime('%Y-%m-%d %H:%M:%S') if hasattr(date_obj, 'strftime') else str(date_obj),
                        'description': final_description,
                        'new_amount': float(amount_decimal),
                        'new_subtag_id': subtag_id,
                        'new_description': final_description if final_description != description else None,
                        'multiple_matches': multiple_matches
                    }
                    conflicts.append(conflict_record)
                # CASO 2: Único match encontrado
                elif existing_id:
                    # Registro duplicado - verifica se há conflitos de tag/subtag ou valor
                    existing_data = existing_records_data.get(existing_id, {})
                    existing_subtag_id = existing_data.get('subtag_id')
                    existing_amount = existing_data.get('amount', 0.0)

                    # Detecta conflitos de tag/subtag e valor
                    has_tag_conflict = (
                        existing_subtag_id is not None and
                        subtag_id is not None and
                        existing_subtag_id != subtag_id
                    )
                    has_amount_conflict = (
                        existing_amount != 0.0 and
                        abs(float(amount_decimal) - existing_amount) > 0.01  # Tolerância de 1 centavo
                    )

                    if has_tag_conflict or has_amount_conflict:
                        # Conflito detectado - adiciona à lista de conflitos
                        conflict_record = {
                            'existing_id': existing_id,
                            'record_type': 'benefit_card_statement',
                            'date': date_obj.strftime('%Y-%m-%d %H:%M:%S') if hasattr(date_obj, 'strftime') else str(date_obj),
                            'description': final_description,
                            'new_amount': float(amount_decimal),
                            'new_subtag_id': subtag_id,
                            'new_description': final_description if final_description != description else None
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
                        # Não conta como atualizado pois precisa de resolução
                    else:
                        # Sem conflito - atualiza normalmente
                        update_record = {
                            'id': existing_id,
                            'subtag_id': subtag_id,
                            'expense_sharing_id': expense_sharing_id,
                            'ownership_percentage': ownership_percentage,
                            'amount': amount_decimal  # Atualiza o valor também
                        }
                        # Se a descrição foi mapeada, atualiza também
                        if final_description != description:
                            update_record['description'] = final_description
                        records_to_update.append(update_record)
                        registros_atualizados += 1
                # CASO 3: Nenhum match - registro novo
                else:
                    # Novo registro - adiciona para INSERT
                    # IMPORTANTE: Salva final_description (mapeada/descriptografada)
                    records_to_insert.append({
                        'tenant_id': tenant_id,
                        'credit_card_id': credit_card_id,
                        'date': date_obj,
                        'description': final_description,
                        'amount': amount_decimal,
                        'payment_method': payment_method,
                        'subtag_id': subtag_id,
                        'expense_sharing_id': expense_sharing_id,
                        'account_id': card_account_id,
                        'ownership_percentage': ownership_percentage,
                        'created_by': user_id  # Campo obrigatório do BaseEntity
                    })
                    registros_importados += 1

                    # Rastreia se não foi mapeado (subtag_id é NULL)
                    if subtag_id is None:
                        unmapped_count += 1
                        unmapped_records.append({
                            "linha": linha_numero,
                            "data": date_obj.strftime('%Y-%m-%d %H:%M:%S'),
                            "descricao": final_description,
                            "valor": float(amount_decimal),
                            "meio_pagamento": payment_method
                        })

            except Exception as e:
                print(f"❌ ERRO na linha {linha_numero}: {e}")
                print(f"   Dados da linha: {row}")
                import traceback
                traceback.print_exc()
                raise HTTPException(
                    status_code=400,
                    detail=f"Erro ao processar linha {linha_numero}: {str(e)}"
                )

        # ========================================
        # ETAPA 7: BULK INSERT/UPDATE (2 OPERAÇÕES)
        # ========================================
        print(f"💾 [ETAPA 5/5] Salvando no banco...")
        print(f"   📝 {len(records_to_insert)} novos registros")
        print(f"   🔄 {len(records_to_update)} atualizações")

        if records_to_insert:
            db.bulk_insert_mappings(BenefitCardStatement, records_to_insert)

        if records_to_update:
            db.bulk_update_mappings(BenefitCardStatement, records_to_update)

        db.commit()

        # Fecha conexão psycopg2 do MappingHelper
        psycopg2_conn.close()

        elapsed = time.time() - start_time
        records_per_sec = len(df) / elapsed if elapsed > 0 else 0
        print(f"✅ [OTIMIZADO] Concluído em {elapsed:.2f}s ({records_per_sec:.0f} registros/s)")
        print(f"   📊 Importados: {registros_importados} | Atualizados: {registros_atualizados} | Conflitos: {len(conflicts)} | Não mapeados: {unmapped_count}")

        return {
            "message": "Importação concluída com sucesso" if len(conflicts) == 0 else "Importação com conflitos pendentes",
            "registros_importados": registros_importados,
            "registros_atualizados": registros_atualizados,
            "unmapped": unmapped_count,
            "unmapped_records": unmapped_records[:20],  # Limita a 20 registros
            "conflicts": conflicts,
            "conflicts_count": len(conflicts)
        }

    except Exception as e:
        db.rollback()
        # Tenta fechar conexão psycopg2 em caso de erro
        try:
            psycopg2_conn.close()
        except:
            pass
        raise HTTPException(status_code=400, detail=f"Erro ao importar CSV: {str(e)}")


@router.post("/importar-xlsx")
async def importar_xlsx(
    file: UploadFile = File(...),
    force_retag: bool = Form(True),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """
    Importa extratos de cartão de benefícios a partir de arquivo Excel processado (.xlsx).

    Este endpoint é usado para reimportar arquivos exportados pelo sistema.
    O cartão é identificado automaticamente pela coluna "Cartão" (4 últimos dígitos).

    Args:
        file: Arquivo Excel (.xlsx) com os dados de benefícios
        force_retag: Se True, ignora tags do arquivo e aplica mapeamentos. Se False, usa tags do arquivo.

    Formato esperado (novo): Data (timestamp), Cartão (4 dígitos), Movimentação, Valor, Meio de Pagamento, Saldo, Tag, Subtag
    Formato legado: Data, Hora, Movimentação, Valor, Meio de Pagamento, Saldo
    Colunas opcionais: Conta Parceira, Minha Contribuição (%)
    """
    import time
    import pandas as pd
    from sqlalchemy.orm import joinedload

    tenant_id = current_user.get("tenant_id", 1)
    user_id = current_user.get("user_id") or current_user.get("id")
    account_id = current_user.get("account_id")

    try:
        start_time = time.time()

        # Lê o conteúdo do arquivo Excel
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))

        print(f"📁 Arquivo Excel: {file.filename}")
        print(f"   📊 {len(df)} registros carregados")

        # ========================================
        # ETAPA 1: DETECÇÃO DE FORMATO E VALIDAÇÃO
        # ========================================
        actual_headers = [str(col).strip() for col in df.columns.tolist()]
        print(f"🔍 DEBUG - Headers recebidos: {actual_headers}")

        # Detecta formato: novo (com coluna Cartão) ou legado (com coluna Hora)
        has_card_column = 'Cartão' in actual_headers
        has_hora_column = 'Hora' in actual_headers

        if has_card_column:
            # Formato novo: Data (timestamp), Cartão, Movimentação, Valor, Meio de Pagamento, Saldo
            required_headers = ['Data', 'Cartão', 'Movimentação', 'Valor', 'Meio de Pagamento', 'Saldo']
            is_new_format = True
            print(f"   📋 Formato detectado: NOVO (Data timestamp + Cartão)")
        elif has_hora_column:
            # Formato legado: Data, Hora, Movimentação, Valor, Meio de Pagamento, Saldo
            required_headers = ['Data', 'Hora', 'Movimentação', 'Valor', 'Meio de Pagamento', 'Saldo']
            is_new_format = False
            print(f"   📋 Formato detectado: LEGADO (Data + Hora separados)")
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Formato não reconhecido. Esperado coluna 'Cartão' (novo) ou 'Hora' (legado). Recebido: {actual_headers}"
            )

        # Verifica se todos os headers obrigatórios estão presentes
        required_present = all(h in actual_headers for h in required_headers)
        if not required_present:
            raise HTTPException(
                status_code=400,
                detail=f"Cabeçalho Excel inválido. Esperado: {required_headers}, Recebido: {actual_headers}"
            )

        # Detecta colunas opcionais de compartilhamento
        has_sharing_cols = 'Conta Parceira' in actual_headers
        has_contribution_col = 'Minha Contribuição (%)' in actual_headers
        if has_sharing_cols:
            print(f"   📊 Detectada coluna 'Conta Parceira'")
        if has_contribution_col:
            print(f"   📊 Detectada coluna 'Minha Contribuição (%)'")

        # Detecta colunas opcionais de Tag/Subtag
        has_tag_col = 'Tag' in actual_headers
        has_subtag_col = 'Subtag' in actual_headers
        if has_tag_col:
            print(f"   📊 Detectada coluna 'Tag'")
        if has_subtag_col:
            print(f"   📊 Detectada coluna 'Subtag'")

        # Log do modo de re-tageamento
        print(f"   🏷️  force_retag={force_retag} - {'Usar mapeamentos' if force_retag else 'Usar tags do arquivo'}")

        # ========================================
        # ETAPA 2: CARREGAR CARTÕES DE BENEFÍCIOS
        # ========================================
        print(f"💳 Carregando cartões de benefícios...")

        # Busca todos os cartões de benefícios do tenant
        cartoes = db.query(Cartao).options(
            joinedload(Cartao.expense_sharing)
        ).filter(
            Cartao.tenant_id == tenant_id,
            Cartao.type == 'beneficios',
            Cartao.active == True
        ).all()

        if not cartoes:
            raise HTTPException(status_code=404, detail="Nenhum cartão de benefícios encontrado")

        # Cria cache de cartões por últimos 4 dígitos
        card_cache = {}
        for c in cartoes:
            if c.number:
                card_cache[c.number] = c
                print(f"   💳 Cartão: {c.name} ({c.number})")

        print(f"   ✅ {len(card_cache)} cartões indexados por 4 últimos dígitos")

        # ========================================
        # ETAPA 3: PREPARAÇÃO DE DADOS
        # ========================================
        print(f"📊 [ETAPA 1/5] Preparando dados...")

        # Parse de date baseado no formato
        if is_new_format:
            # Formato novo: Data já é timestamp (DD/MM/YYYY HH:MM:SS)
            def parse_date_new(data_val):
                if hasattr(data_val, 'strftime'):
                    # Já é datetime
                    return data_val
                else:
                    # String: tenta vários formatos
                    data_str = str(data_val).strip()
                    for fmt in ['%d/%m/%Y %H:%M:%S', '%d/%m/%Y %H:%M', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M']:
                        try:
                            return pd.to_datetime(data_str, format=fmt)
                        except:
                            continue
                    # Fallback: deixa pandas inferir
                    return pd.to_datetime(data_str, dayfirst=True)

            df['date'] = df['Data'].apply(parse_date_new)
        else:
            # Formato legado: combina Data + Hora
            def parse_date_legacy(row):
                data = row['Data']
                hora = row['Hora']

                # Converte Data para string DD/MM/YYYY
                if hasattr(data, 'strftime'):
                    data_str = data.strftime('%d/%m/%Y')
                else:
                    data_str = str(data)

                # Converte Hora para string HH:MM:SS
                if hasattr(hora, 'strftime'):
                    hora_str = hora.strftime('%H:%M:%S')
                else:
                    hora_str = str(hora)

                # Parse com formato flexível (aceita HH:MM ou HH:MM:SS)
                date_str = f"{data_str} {hora_str}"
                try:
                    return pd.to_datetime(date_str, format='%d/%m/%Y %H:%M:%S')
                except:
                    return pd.to_datetime(date_str, format='%d/%m/%Y %H:%M')

            df['date'] = df.apply(parse_date_legacy, axis=1)

        # Parse de valores - Excel já tem valores numéricos
        df['amount_decimal'] = df['Valor'].apply(lambda x: Decimal(str(x)))

        # ========================================
        # ETAPA 4: INICIALIZA MAPPING HELPER (suporta exact/pattern/regex)
        # ========================================
        print(f"🔄 [ETAPA 2/5] Inicializando MappingHelper...")

        # Usa MappingHelper para suporte a exact/pattern/regex com prioridade correta
        # Prioridade: 0=Alta (exact), 1=Média (pattern), 2=Baixa (regex)
        psycopg2_conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        mapping_helper = MappingHelper(db_connection=psycopg2_conn, tenant_id=tenant_id, user_id=user_id)
        print(f"   ✅ MappingHelper inicializado")

        # Cache de subtags por nome (para usar tags do arquivo quando force_retag=False)
        subtag_cache = {}
        if not force_retag and has_subtag_col:
            from app.models.unified_models import Tag
            # NOTA: Subtag NÃO tem campo 'active' (usa hard delete)
            subtags_query = db.query(
                Subtag.id,
                Subtag.name,
                Subtag.type,
                Tag.name.label('tag_name')
            ).join(Tag).filter(
                Subtag.tenant_id == tenant_id
            ).all()
            for s in subtags_query:
                # Cache por (subtag_name, type) para match exato
                subtag_cache[(s.name.lower(), s.type)] = s.id
                # Cache alternativo por (tag_name, subtag_name, type) para match mais específico
                subtag_cache[(s.tag_name.lower(), s.name.lower(), s.type)] = s.id
            print(f"   ✅ {len(subtag_cache)} subtags em cache para uso de tags do arquivo")

        # ========================================
        # ETAPA 5: VERIFICAÇÃO DE DUPLICATAS (por cartão)
        # ========================================
        print(f"🔍 [ETAPA 3/5] Verificando duplicatas...")

        # Busca duplicatas para todos os cartões de benefícios do tenant
        # Inclui subtag_id e amount para detecção de conflitos
        all_card_ids = [c.id for c in cartoes]
        existing_keys_query = db.query(
            BenefitCardStatement.credit_card_id,
            BenefitCardStatement.date,
            BenefitCardStatement.description,
            BenefitCardStatement.id,
            BenefitCardStatement.subtag_id,
            BenefitCardStatement.amount
        ).filter(
            BenefitCardStatement.credit_card_id.in_(all_card_ids),
            BenefitCardStatement.tenant_id == tenant_id
        ).all()

        # Cache de duplicatas: (credit_card_id, date, description) -> lista de IDs
        # Chave: pode ter múltiplos registros (timestamps HH:mm sem segundos)
        existing_keys = {}  # chave -> lista de IDs
        existing_records_data = {}  # id -> {subtag_id, amount}
        for e in existing_keys_query:
            key = (e.credit_card_id, e.date, e.description)
            if key not in existing_keys:
                existing_keys[key] = []
            existing_keys[key].append(e.id)
        print(f"   ✅ {len(existing_records_data)} registros existentes carregados")

        # Cache reverso de subtags para exibir nomes nos conflitos
        # IMPORTANTE: Usa subtags da conta que será resolvida no loop
        subtag_id_to_info = {}
        subtag_info_query = db.query(Subtag.id, Subtag.name, Subtag.type, Tag.name.label('tag_name')).join(Tag).filter(
            Subtag.tenant_id == tenant_id
        ).all()
        for s in subtag_info_query:
            subtag_id_to_info[s.id] = {'name': s.name, 'tag_name': s.tag_name, 'type': s.type}
        print(f"   ✅ {len(subtag_id_to_info)} subtags em cache para conflitos")

        # ========================================
        # ETAPA 6: PROCESSAMENTO EM LOTE
        # ========================================
        print(f"⚙️  [ETAPA 4/5] Processando registros...")

        registros_importados = 0
        registros_atualizados = 0
        registros_sem_cartao = 0
        unmapped_count = 0
        unmapped_records = []
        records_to_insert = []
        records_to_update = []
        conflicts = []  # Lista de conflitos detectados

        # Cache de expense_sharing_id por nome de parceiro
        sharing_cache = {}

        records = df.to_dict('records')

        for idx, row in enumerate(records):
            linha_numero = idx + 2
            try:
                date_obj = df.iloc[idx]['date']
                amount_decimal = df.iloc[idx]['amount_decimal']
                description = row['Movimentação']
                payment_method = row['Meio de Pagamento']

                if not description or not str(description).strip():
                    continue

                description = str(description).strip()

                # ========================================
                # IDENTIFICAÇÃO DO CARTÃO
                # ========================================
                if is_new_format:
                    # Formato novo: identifica cartão pela coluna "Cartão" (4 últimos dígitos)
                    card_last4 = str(row.get('Cartão', '')).strip()
                    if not card_last4:
                        print(f"⚠️ Linha {linha_numero}: Coluna 'Cartão' vazia, pulando")
                        registros_sem_cartao += 1
                        continue

                    # Garante 4 dígitos (com zeros à esquerda se necessário)
                    card_last4 = card_last4.zfill(4)[-4:]

                    cartao = card_cache.get(card_last4)
                    if not cartao:
                        print(f"⚠️ Linha {linha_numero}: Cartão '{card_last4}' não encontrado, pulando")
                        registros_sem_cartao += 1
                        continue
                else:
                    # Formato legado: usa o primeiro cartão disponível
                    # (comportamento antigo - mantido para compatibilidade)
                    if len(cartoes) == 1:
                        cartao = cartoes[0]
                    else:
                        raise HTTPException(
                            status_code=400,
                            detail="Arquivo legado (sem coluna 'Cartão') requer seleção manual do cartão. Use o formato novo com coluna 'Cartão' ou importe via endpoint com credit_card_id."
                        )

                # Dados do cartão identificado
                credit_card_id = cartao.id
                card_account_id = cartao.account_id
                card_expense_sharing_id = cartao.expense_sharing_id
                card_ownership_percentage = Decimal('100.00')
                if card_expense_sharing_id and cartao.expense_sharing:
                    card_ownership_percentage = cartao.expense_sharing.my_contribution_percentage

                # Busca subtag_id
                tipo = "despesa" if float(amount_decimal) < 0 else "receita"
                subtag_id = None
                mapped_description = None
                is_sensitive = False
                final_description = description
                mapping_result = None  # Inicializa para evitar erro de variável não definida

                if force_retag:
                    # Modo force_retag: usa MappingHelper (suporta exact/pattern/regex)
                    mapping_result = mapping_helper.find_mapping(description, tipo)
                    if mapping_result:
                        subtag_id = mapping_result.get('subtag_id')
                        mapped_description = mapping_result.get('mapped_description')
                        is_sensitive = mapping_result.get('is_sensitive', False)

                        # Aplica substituição de descrição se houver mapeamento
                        if mapped_description is not None:
                            if is_sensitive:
                                from app.utils.crypto_helper import get_crypto_helper
                                crypto = get_crypto_helper()
                                try:
                                    final_description = crypto.decrypt(mapped_description)
                                except:
                                    final_description = description
                            else:
                                final_description = mapped_description
                else:
                    # Modo preservar tags: usa Tag/Subtag do arquivo
                    if has_subtag_col:
                        subtag_name = str(row.get('Subtag', '')).strip()
                        tag_name = str(row.get('Tag', '')).strip() if has_tag_col else ''

                        if subtag_name:
                            # Tenta match por (tag_name, subtag_name, tipo)
                            if tag_name:
                                subtag_id = subtag_cache.get((tag_name.lower(), subtag_name.lower(), tipo))
                            # Fallback: match por (subtag_name, tipo)
                            if not subtag_id:
                                subtag_id = subtag_cache.get((subtag_name.lower(), tipo))

                    # Se não encontrou subtag do arquivo, tenta MappingHelper como fallback
                    if subtag_id is None:
                        mapping_result = mapping_helper.find_mapping(description, tipo)
                        if mapping_result:
                            subtag_id = mapping_result.get('subtag_id')
                            mapped_description = mapping_result.get('mapped_description')
                            is_sensitive = mapping_result.get('is_sensitive', False)

                            # Aplica substituição de descrição se houver mapeamento
                            if mapped_description is not None:
                                if is_sensitive:
                                    from app.utils.crypto_helper import get_crypto_helper
                                    crypto = get_crypto_helper()
                                    try:
                                        final_description = crypto.decrypt(mapped_description)
                                    except:
                                        final_description = description
                                else:
                                    final_description = mapped_description

                # Verifica duplicata (inclui credit_card_id na chave)
                # Chave: pode ter múltiplos registros (timestamps HH:mm sem segundos)
                key_mapped = (credit_card_id, date_obj, final_description)
                key_original = (credit_card_id, date_obj, description)

                existing_ids = existing_keys.get(key_mapped, [])
                if not existing_ids and final_description != description:
                    # Tenta com descrição original (caso o registro foi salvo antes do mapeamento)
                    existing_ids = existing_keys.get(key_original, [])

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

                    for eid in existing_ids:
                        edata = existing_records_data.get(eid, {})
                        if abs(edata.get('amount', 0.0) - file_amount) <= 0.01:
                            matched_by_amount = eid
                            break

                    if matched_by_amount:
                        # Encontrou registro com mesmo valor - verifica só conflito de tag
                        existing_id = matched_by_amount
                    else:
                        # Não encontrou valor igual - prepara lista para seleção do usuário
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

                # Configurações de compartilhamento
                # PRIORIDADE: 1) Arquivo Excel → 2) Mapeamento → 3) Cartão
                expense_sharing_id = card_expense_sharing_id
                ownership_percentage = card_ownership_percentage

                # PRIORIDADE 2: Mapeamento (se tiver expense_sharing_id definido)
                # Sobrescreve configuração do cartão
                if mapping_result and mapping_result.get('expense_sharing_id') is not None:
                    expense_sharing_id = mapping_result['expense_sharing_id']
                    if mapping_result.get('my_contribution_percentage') is not None:
                        ownership_percentage = Decimal(str(mapping_result['my_contribution_percentage']))

                # PRIORIDADE 1: Arquivo Excel (se houver colunas de compartilhamento)
                # Sobrescreve configuração do mapeamento/cartão
                if has_sharing_cols:
                    partner_name = str(row.get('Conta Parceira', '')).strip()
                    if partner_name:
                        cache_key = (card_account_id, partner_name)
                        if cache_key not in sharing_cache:
                            sharing_cache[cache_key] = lookup_expense_sharing_by_partner_name(
                                db, tenant_id, card_account_id, partner_name
                            )
                        excel_sharing_id = sharing_cache[cache_key]
                        if excel_sharing_id:
                            expense_sharing_id = excel_sharing_id
                            if has_contribution_col:
                                contrib_val = row.get('Minha Contribuição (%)', '')
                                if contrib_val != '' and contrib_val is not None:
                                    try:
                                        ownership_percentage = Decimal(str(contrib_val))
                                    except:
                                        pass
                    elif partner_name == '':
                        expense_sharing_id = None
                        ownership_percentage = Decimal("100.00")

                # CASO 1: Múltiplos matches - usuário precisa selecionar qual atualizar
                if multiple_matches:
                    conflict_record = {
                        'existing_id': None,  # Será definido pelo usuário
                        'record_type': 'benefit_card_statement',
                        'date': date_obj.strftime('%Y-%m-%d %H:%M:%S') if date_obj else '',
                        'description': final_description,
                        'new_amount': float(amount_decimal),
                        'new_subtag_id': subtag_id,
                        'payment_method': payment_method,
                        'credit_card_id': credit_card_id,
                        'multiple_matches': multiple_matches
                    }
                    conflicts.append(conflict_record)
                # CASO 2: Único match encontrado
                elif existing_id:
                    # Registro duplicado - verifica se há conflitos antes de atualizar
                    existing_data = existing_records_data.get(existing_id, {})
                    existing_subtag_id = existing_data.get('subtag_id')
                    existing_amount = existing_data.get('amount', 0.0)

                    # Detecta conflitos de tag/subtag e valor
                    has_tag_conflict = (
                        existing_subtag_id is not None and
                        subtag_id is not None and
                        existing_subtag_id != subtag_id
                    )
                    has_amount_conflict = (
                        existing_amount != 0.0 and
                        abs(float(amount_decimal) - existing_amount) > 0.01  # Tolerância de 1 centavo
                    )

                    if has_tag_conflict or has_amount_conflict:
                        # Conflito detectado - adiciona à lista de conflitos
                        conflict_record = {
                            'existing_id': existing_id,
                            'record_type': 'benefit_card_statement',
                            'date': date_obj.strftime('%Y-%m-%d %H:%M:%S') if date_obj else '',
                            'description': final_description,
                            'new_amount': float(amount_decimal),
                            'new_subtag_id': subtag_id,
                            'payment_method': payment_method,
                            'credit_card_id': credit_card_id
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
                        # Não conta como atualizado pois precisa de resolução
                    else:
                        # Sem conflito - atualiza normalmente
                        update_record = {
                            'id': existing_id,
                            'subtag_id': subtag_id,
                            'expense_sharing_id': expense_sharing_id,
                            'ownership_percentage': ownership_percentage
                        }
                        # Se a descrição foi mapeada, atualiza também
                        if final_description != description:
                            update_record['description'] = final_description
                        records_to_update.append(update_record)
                        registros_atualizados += 1
                # CASO 3: Nenhum match - registro novo
                else:
                    # Novo registro - adiciona para INSERT
                    records_to_insert.append({
                        'tenant_id': tenant_id,
                        'credit_card_id': credit_card_id,
                        'date': date_obj,
                        'description': final_description,
                        'amount': amount_decimal,
                        'payment_method': payment_method,
                        'subtag_id': subtag_id,
                        'expense_sharing_id': expense_sharing_id,
                        'account_id': card_account_id,
                        'ownership_percentage': ownership_percentage,
                        'created_by': user_id
                    })
                    registros_importados += 1

                    if subtag_id is None:
                        unmapped_count += 1
                        unmapped_records.append({
                            "linha": linha_numero,
                            "data": date_obj.strftime('%Y-%m-%d %H:%M:%S'),
                            "descricao": final_description,
                            "valor": float(amount_decimal),
                            "meio_pagamento": payment_method
                        })

            except Exception as e:
                print(f"❌ ERRO na linha {linha_numero}: {e}")
                import traceback
                traceback.print_exc()
                raise HTTPException(
                    status_code=400,
                    detail=f"Erro ao processar linha {linha_numero}: {str(e)}"
                )

        # ========================================
        # ETAPA 7: BULK INSERT/UPDATE (2 OPERAÇÕES)
        # ========================================
        print(f"💾 [ETAPA 5/5] Salvando no banco...")
        print(f"   📝 {len(records_to_insert)} novos registros")
        print(f"   🔄 {len(records_to_update)} atualizações")

        if records_to_insert:
            db.bulk_insert_mappings(BenefitCardStatement, records_to_insert)

        if records_to_update:
            db.bulk_update_mappings(BenefitCardStatement, records_to_update)

        db.commit()

        # Fecha conexão psycopg2 do MappingHelper
        psycopg2_conn.close()

        elapsed = time.time() - start_time
        records_per_sec = len(df) / elapsed if elapsed > 0 else 0
        print(f"✅ [OTIMIZADO] Concluído em {elapsed:.2f}s ({records_per_sec:.0f} registros/s)")
        print(f"   📊 Importados: {registros_importados} | Atualizados: {registros_atualizados} | Conflitos: {len(conflicts)} | Sem cartão: {registros_sem_cartao} | Não mapeados: {unmapped_count}")

        return {
            "message": "Importação concluída com sucesso" if len(conflicts) == 0 else "Importação com conflitos pendentes",
            "registros_importados": registros_importados,
            "registros_atualizados": registros_atualizados,
            "registros_sem_cartao": registros_sem_cartao,
            "unmapped": unmapped_count,
            "unmapped_records": unmapped_records[:20],
            "conflicts": conflicts,
            "conflicts_count": len(conflicts)
        }

    except Exception as e:
        db.rollback()
        # Tenta fechar conexão psycopg2 em caso de erro
        try:
            psycopg2_conn.close()
        except:
            pass
        raise HTTPException(status_code=400, detail=f"Erro ao importar Excel: {str(e)}")


@router.put("/{extrato_id}", response_model=BenefitCardStatementResponse)
async def atualizar_extrato(
    extrato_id: int,
    extrato_data: BenefitCardStatementUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Atualiza um extrato existente (apenas campos de curadoria)."""
    tenant_id = current_user.get("tenant_id", 1)

    # NOTA: BenefitCardStatement NÃO tem campo 'active' (não usa soft delete)
    extrato = db.query(BenefitCardStatement).filter(
        BenefitCardStatement.id == extrato_id,
        BenefitCardStatement.tenant_id == tenant_id
    ).first()

    if not extrato:
        raise HTTPException(status_code=404, detail="Extrato não encontrado")

    # Atualiza apenas os campos fornecidos
    update_data = extrato_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(extrato, field, value)

    db.commit()
    db.refresh(extrato)
    return extrato


@router.delete("/{extrato_id}", status_code=204)
async def deletar_extrato(
    extrato_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account)
):
    """Deleta (hard delete) um extrato."""
    tenant_id = current_user.get("tenant_id", 1)

    # NOTA: BenefitCardStatement NÃO tem campo 'active' (não usa soft delete)
    extrato = db.query(BenefitCardStatement).filter(
        BenefitCardStatement.id == extrato_id,
        BenefitCardStatement.tenant_id == tenant_id
    ).first()

    if not extrato:
        raise HTTPException(status_code=404, detail="Extrato não encontrado")

    # Hard delete (não tem soft delete)
    db.delete(extrato)
    db.commit()
    return None

