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
from app.services.account_period_closure_service import AccountPeriodClosedError
from app.services.closed_period_edit_service import (
    _account_id_for_benefit,
    after_benefit_curadoria_updated,
    ensure_benefit_curadoria_update_allowed,
)
from app.utils.import_progress import activate_import_job, deactivate_import_job, report_row_progress
from app.utils.import_rows import import_tag_subtag_conflict, mapping_hint, subtag_override
from app.utils.mapping_helper import MappingHelper
from app.utils.sharing_percentage import resolve_ownership_percentage
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
    confirm_closed_closure_impact: bool = False


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
    closure_impact: dict | None = None
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
def importar_csv(
    credit_card_id: int,
    file: UploadFile = File(...),
    progress_job_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Importa CSV de benefícios. Síncrono para a barra de progresso ser consultada em paralelo."""
    scope = activate_import_job(progress_job_id, current_user)
    try:
        return _importar_csv_work(
            credit_card_id=credit_card_id,
            file=file,
            db=db,
            current_user=current_user,
        )
    finally:
        deactivate_import_job(scope)


class BenefitCsvPersistRequest(BaseModel):
    credit_card_id: int
    rows: List[dict]
    progress_job_id: Optional[str] = None


@router.post("/csv/process")
def processar_csv(
    credit_card_id: int = Form(...),
    file: UploadFile = File(...),
    progress_job_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Lê o CSV de benefícios sem salvar: devolve as linhas do arquivo e o preview."""
    from app.services.raw_import_preview import build_raw_preview
    from app.utils.import_rows import df_to_rows

    scope = activate_import_job(progress_job_id, current_user)
    try:
        tenant_id = current_user.get("tenant_id", 1)
        account_id = current_user.get("account_id")
        cartao = _load_benefit_card(db, tenant_id, credit_card_id, account_id)
        try:
            df = _parse_benefit_csv(file.file.read())
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Erro ao ler CSV: {str(e)}")
        rows = df_to_rows(df)
        result: dict = {}
        if rows:
            try:
                result = save_benefit_dataframe(
                    db, current_user, cartao, df.copy(), commit=False, collect_details=True,
                )
            finally:
                db.rollback()
        return {
            "rows": rows,
            "preview": build_raw_preview(
                db, tenant_id, cartao.account_id, result,
                unchanged=result.get("registros_sem_alteracao", 0),
            ),
        }
    finally:
        deactivate_import_job(scope)


@router.post("/csv/persist")
def persistir_csv(
    body: BenefitCsvPersistRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_account),
):
    """Grava as linhas do CSV de benefícios já processadas (mapeamentos são reaplicados no save)."""
    from app.utils.import_rows import rows_to_df

    scope = activate_import_job(body.progress_job_id, current_user)
    try:
        tenant_id = current_user.get("tenant_id", 1)
        cartao = _load_benefit_card(db, tenant_id, body.credit_card_id, current_user.get("account_id"))
        if not body.rows:
            return {
                "message": "Importação concluída com sucesso",
                "registros_importados": 0,
                "registros_atualizados": 0,
                "unmapped": 0,
                "unmapped_records": [],
                "conflicts": [],
                "conflicts_count": 0,
            }
        df = rows_to_df(body.rows)
        missing = [c for c in BENEFIT_CSV_REQUIRED_HEADERS if c not in df.columns]
        if missing:
            raise HTTPException(status_code=400, detail=f"Linhas do CSV sem as colunas: {', '.join(missing)}")
        return save_benefit_dataframe(db, current_user, cartao, df)
    finally:
        deactivate_import_job(scope)


BENEFIT_CSV_REQUIRED_HEADERS = ['Data', 'Hora', 'Movimentação', 'Valor', 'Meio de Pagamento', 'Saldo']


def _load_benefit_card(db: Session, tenant_id: int, credit_card_id: int, account_id: Optional[int] = None) -> Cartao:
    """Carrega o cartão de benefícios (com expense_sharing). Com account_id, exige que seja da conta."""
    from sqlalchemy.orm import joinedload
    query = db.query(Cartao).options(
        joinedload(Cartao.expense_sharing)
    ).filter(
        Cartao.id == credit_card_id,
        Cartao.tenant_id == tenant_id,
    )
    if account_id is not None:
        query = query.filter(Cartao.account_id == account_id)
    cartao = query.first()

    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado")

    if cartao.type != 'beneficios':
        raise HTTPException(status_code=400, detail="Cartão deve ser do tipo 'beneficios'")
    return cartao


def _parse_benefit_csv(contents: bytes):
    """Valida o cabeçalho e carrega o CSV de benefícios em DataFrame (colunas originais)."""
    import pandas as pd

    decoded = contents.decode('utf-8')
    csv_reader = csv.DictReader(io.StringIO(decoded))
    actual_headers = [h.strip() for h in (csv_reader.fieldnames or [])]
    required = BENEFIT_CSV_REQUIRED_HEADERS
    if actual_headers[:len(required)] != required:
        raise HTTPException(
            status_code=400,
            detail=f"Cabeçalho CSV inválido. Esperado começar com: {required}, Recebido: {actual_headers}"
        )
    df = pd.read_csv(io.StringIO(decoded))
    print(f"   📊 {len(df)} registros carregados do CSV de benefícios")
    return df


def _importar_csv_work(
    credit_card_id: int,
    file: UploadFile,
    db: Session,
    current_user: dict,
):
    """
    Importa extratos de cartão de benefícios a partir de arquivo CSV.

    Formato esperado: Data,Hora,Movimentação,Valor,Meio de Pagamento,Saldo
    Exemplo: 18/01/2026,12:15,SAVEGNAGO LOJA 45 RIO CLARO BRA,"-R$ 216,38",Cartão,"R$ 130,77"
    """
    tenant_id = current_user.get("tenant_id", 1)
    cartao = _load_benefit_card(db, tenant_id, credit_card_id)
    try:
        df = _parse_benefit_csv(file.file.read())
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro ao importar CSV: {str(e)}")
    return save_benefit_dataframe(db, current_user, cartao, df)


def save_benefit_dataframe(
    db: Session,
    current_user: dict,
    cartao: Cartao,
    df,
    commit: bool = True,
    collect_details: bool = False,
) -> dict:
    """
    Insert/update de extratos de benefícios a partir do DataFrame com as colunas do CSV.

    commit=False apenas executa os comandos na transação (o chamador faz rollback);
    collect_details=True retorna preview_creates / preview_updates linha a linha.
    """
    tenant_id = current_user.get("tenant_id", 1)
    user_id = current_user.get("user_id") or current_user.get("id")
    credit_card_id = cartao.id

    # Busca configurações de compartilhamento do cartão para propagar aos itens
    card_expense_sharing_id = cartao.expense_sharing_id
    card_account_id = cartao.account_id

    # Se o cartão tem compartilhamento, busca o ownership_percentage padrão
    card_ownership_percentage = Decimal('100.00')
    if card_expense_sharing_id:
        card_ownership_percentage = resolve_ownership_percentage(
            kind='expense', sharing=cartao.expense_sharing, card=cartao
        )

    has_sharing_cols = 'Conta Parceira' in df.columns
    has_contribution_col = 'Minha Contribuição (%)' in df.columns
    unchanged_count = 0
    preview_creates = []
    preview_updates = []

    try:
        import time
        import pandas as pd
        start_time = time.time()

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
        total_rows = len(records)
        report_row_progress(0, total_rows)

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

                has_override, override_subtag_id = subtag_override(row, subtag_id_to_info)
                if has_override:
                    subtag_id = override_subtag_id

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
                # Só sobrescreve (compartilhamento e %) se o mapeamento for compartilhado;
                # mapeamento "próprio" (sem expense_sharing_id) não impõe seus 100%.
                if mapping_result and mapping_result.get('expense_sharing_id') is not None:
                    expense_sharing_id = mapping_result['expense_sharing_id']
                    ownership_percentage = resolve_ownership_percentage(
                        tipo=tipo,
                        mapping=mapping_result,
                        card=cartao,
                        sharing=cartao.expense_sharing,
                    )

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
                    has_tag_conflict = import_tag_subtag_conflict(existing_subtag_id, subtag_id)
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
                            'expense_sharing_id': expense_sharing_id,
                            'ownership_percentage': ownership_percentage,
                            'amount': amount_decimal  # Atualiza o valor também
                        }
                        if subtag_id is not None:
                            update_record['subtag_id'] = subtag_id
                        # Se a descrição foi mapeada, atualiza também
                        if final_description != description:
                            update_record['description'] = final_description
                        records_to_update.append(update_record)
                        registros_atualizados += 1
                        changed = (
                            (subtag_id is not None and existing_subtag_id != subtag_id)
                            or abs(float(amount_decimal) - existing_amount) > 0.005
                            or final_description != description
                        )
                        if not changed:
                            unchanged_count += 1
                        elif collect_details:
                            preview_updates.append({
                                'line': linha_numero,
                                'id': existing_id,
                                'date': date_obj,
                                'description': final_description,
                                'amount': float(amount_decimal),
                                'before': {
                                    'subtag_id': existing_subtag_id,
                                    'amount': existing_amount,
                                    'description': description,
                                },
                                'after': {
                                    'subtag_id': subtag_id,
                                    'amount': float(amount_decimal),
                                    'description': final_description,
                                },
                            })
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
                    if collect_details:
                        preview_creates.append({
                            'line': linha_numero,
                            'row_index': idx,
                            'date': date_obj,
                            'description': final_description,
                            'amount': float(amount_decimal),
                            'payment_method': payment_method,
                            'subtag_id': subtag_id,
                            'expense_sharing_id': expense_sharing_id,
                            'ownership_percentage': float(ownership_percentage),
                            'mapping_hint': (
                                mapping_hint(mapping_helper, (description,), tipo)
                                if subtag_id is None and not has_override
                                else None
                            ),
                        })

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
            finally:
                report_row_progress(idx + 1, total_rows)

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

        if commit:
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
            "conflicts_count": len(conflicts),
            "registros_sem_alteracao": unchanged_count,
            **({"preview_creates": preview_creates, "preview_updates": preview_updates} if collect_details else {}),
        }

    except Exception as e:
        db.rollback()
        # Tenta fechar conexão psycopg2 em caso de erro
        try:
            psycopg2_conn.close()
        except:
            pass
        raise HTTPException(status_code=400, detail=f"Erro ao importar CSV: {str(e)}")



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

    account_id = current_user.get("account_id")
    user_id = int(current_user.get("user_id") or current_user.get("id") or 0)

    # Atualiza apenas os campos fornecidos
    update_data = extrato_data.model_dump(exclude_unset=True)
    confirm_closed = bool(update_data.pop("confirm_closed_closure_impact", False))
    subtag_changed = "subtag_id" in update_data and update_data["subtag_id"] != extrato.subtag_id
    sharing_changed = (
        "expense_sharing_id" in update_data and update_data["expense_sharing_id"] != extrato.expense_sharing_id
    ) or (
        "ownership_percentage" in update_data
        and update_data["ownership_percentage"] != extrato.ownership_percentage
    )

    card_account_id = _account_id_for_benefit(db, extrato) if account_id is not None else None
    try:
        ensure_benefit_curadoria_update_allowed(
            db,
            tenant_id,
            card_account_id,
            user_id,
            extrato,
            update_data,
            confirm_closed,
        )
    except AccountPeriodClosedError as exc:
        detail: dict | str = exc.message
        if exc.payload:
            detail = {"message": exc.message, **exc.payload}
        raise HTTPException(status_code=409, detail=detail) from exc

    for field, value in update_data.items():
        setattr(extrato, field, value)

    closure_impact = after_benefit_curadoria_updated(
        db,
        tenant_id,
        _account_id_for_benefit(db, extrato) if account_id is not None else None,
        extrato,
        subtag_changed=subtag_changed,
        sharing_changed=sharing_changed,
    )

    db.commit()
    db.refresh(extrato)
    return BenefitCardStatementResponse(
        **BenefitCardStatementResponse.model_validate(extrato).model_dump(),
        closure_impact=closure_impact if closure_impact.get("impact_type") != "none" else None,
    )


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

