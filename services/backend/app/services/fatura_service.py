"""
Serviço para gerenciar faturas de cartão de crédito.
Responsável por salvar e processar faturas no banco de dados.
"""

import re
import logging
from datetime import datetime
from typing import Optional, Tuple, Dict, Any
from decimal import Decimal
import pandas as pd
import psycopg2
from psycopg2.extras import RealDictCursor
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models import CreditCardInvoice, Cartao, Subtag, Tag, TransactionMapping
from app.utils.card_helper import CardHelper
from app.utils.mapping_helper import MappingHelper
from app.database import DATABASE_URL

logger = logging.getLogger(__name__)


class FaturaService:
    """Serviço para gerenciar faturas de cartão de crédito."""

    @staticmethod
    def get_card_adjustment_config(db: Session, card_id: int) -> Dict[str, Any]:
        """
        Busca as configurações de ajuste padrão de um cartão.

        Args:
            db: Sessão do banco de dados
            card_id: ID do cartão

        Returns:
            Dicionário com:
            - adjustment_type: 'proprio' ou 'compartilhado'
            - ownership_percentage: 0-100 (percentual do usuário)
            - expense_sharing_id: ID da configuração de compartilhamento (se compartilhado)
        """
        card = db.query(Cartao).filter(Cartao.id == card_id).first()

        if not card:
            # Padrão se cartão não encontrado
            return {
                "adjustment_type": "proprio",
                "ownership_percentage": Decimal("100.00"),
                "expense_sharing_id": None
            }

        # Mapeia ownership_type para adjustment_type
        if card.ownership_type == "proprio":
            return {
                "adjustment_type": "proprio",
                "ownership_percentage": Decimal("100.00"),
                "expense_sharing_id": None
            }
        elif card.ownership_type == "compartilhado":
            # Busca percentual do compartilhamento (default 50%)
            ownership_pct = Decimal("50.00")  # Default 50/50
            if card.expense_sharing and hasattr(card.expense_sharing, 'my_contribution_percentage'):
                # Usa my_contribution_percentage da configuração de compartilhamento
                ownership_pct = card.expense_sharing.my_contribution_percentage

            return {
                "adjustment_type": "compartilhado",
                "ownership_percentage": ownership_pct,
                "expense_sharing_id": card.expense_sharing_id
            }
        else:
            # Fallback para 'proprio'
            return {
                "adjustment_type": "proprio",
                "ownership_percentage": Decimal("100.00"),
                "expense_sharing_id": None
            }

    @staticmethod
    def buscar_subtag_por_mapeamento(db: Session, descricao: str, tenant_id: int = 1) -> Optional[int]:
        """
        Busca subtag_id na tabela transaction_mappings pela descrição.

        Args:
            db: Sessão do banco de dados
            descricao: Descrição da transação
            tenant_id: ID do tenant

        Returns:
            subtag_id se encontrar mapeamento, None caso contrário
        """
        if not descricao:
            return None

        # Busca mapeamento exato (case-insensitive)
        # NOTA: TransactionMapping NÃO tem campo 'active' (não usa soft delete)
        mapping = db.query(TransactionMapping).filter(
            TransactionMapping.tenant_id == tenant_id,
            func.lower(TransactionMapping.original_description) == descricao.lower().strip()
        ).first()

        if mapping and mapping.subtag_id:
            logger.info(f"✅ [FATURA_SERVICE] Mapeamento encontrado: '{descricao}' → subtag_id={mapping.subtag_id}")
            return mapping.subtag_id

        return None

    @staticmethod
    def extrair_parcelas(descricao: str) -> Tuple[bool, Optional[int], Optional[int]]:
        """
        Extrai informações de parcelamento da descrição.

        Args:
            descricao: Descrição original da transação

        Returns:
            Tupla (parcelado, parcela_paga, total_parcelas)

        Exemplos:
            "Compra Mercado (2/12)" -> (True, 2, 12)
            "Restaurante (1/3)" -> (True, 1, 3)
            "Supermercado" -> (False, None, None)
        """
        # Padrão: (X/Y) no final da descrição
        pattern = r'\((\d+)/(\d+)\)\s*$'
        match = re.search(pattern, descricao)

        if match:
            parcela_paga = int(match.group(1))
            total_parcelas = int(match.group(2))
            return True, parcela_paga, total_parcelas

        return False, None, None

    @staticmethod
    def buscar_cartao_id(db: Session, numero: str, tenant_id: int = 1) -> Optional[int]:
        """
        Busca o ID do cartão pelo número (incluindo cartões inativos).

        Compara números normalizados (sem zeros à esquerda) para garantir
        que "323" encontre "0323" no banco.

        Args:
            db: Sessão do banco de dados
            numero: Número do cartão (últimos 4 dígitos)
            tenant_id: ID do tenant

        Returns:
            ID do cartão ou None se não encontrado

        Note:
            Permite importar faturas de cartões inativos para manter histórico completo.
        """
        # Usa CardHelper para buscar com normalização de número
        return CardHelper.get_card_id_by_number(db, numero, tenant_id)

    @staticmethod
    def get_default_subtag_id(db: Session, tenant_id: int, account_id: int, valor: float = None) -> int:
        """
        Retorna o ID da subtag padrão "Pendente" da tag "Não Categorizado".
        Cria se não existir, filtrando por tipo baseado no valor.

        GARANTE que sempre retorna um ID válido (nunca None).

        NOTA: Para faturas de cartão, valores positivos são DESPESAS (débitos na fatura).
        Valores negativos são RECEITAS (créditos/estornos na fatura).

        Args:
            db: Sessão do banco de dados
            tenant_id: ID do tenant
            account_id: ID da conta logada
            valor: Valor da transação (positivo = despesa, negativo = receita para faturas)

        Returns:
            int: ID da subtag "Pendente" (nunca None)

        Raises:
            ValueError: Se não conseguir criar/encontrar a subtag padrão
        """
        # Determina o tipo baseado no valor
        # Para faturas: positivo = despesa, negativo = receita (estorno/crédito)
        tipo = None
        if valor is not None:
            tipo = "despesa" if valor >= 0 else "receita"

        # Busca tag "Não Categorizado"
        tag = db.query(Tag).filter(
            Tag.tenant_id == tenant_id,
            Tag.name == "Não Categorizado",
            Tag.active == True
        ).first()

        if not tag:
            # Cria tag se não existir
            logger.info(f"📝 [FATURA_SERVICE] Criando tag 'Não Categorizado' para tenant {tenant_id}")
            tag = Tag(
                tenant_id=tenant_id,
                name="Não Categorizado",
                description="Registros não categorizados automaticamente",
                active=True
            )
            db.add(tag)
            db.flush()

        # Busca subtag "Pendente" com o tipo correto
        # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
        # IMPORTANTE: Filtra por account_id porque cada conta tem suas próprias tags/subtags
        query = db.query(Subtag).filter(
            Subtag.tenant_id == tenant_id,
            Subtag.account_id == account_id,
            Subtag.tag_id == tag.id,
            Subtag.name == "Pendente"
        )

        if tipo:
            query = query.filter(Subtag.type == tipo)

        subtag = query.first()

        if not subtag:
            # Cria subtag se não existir
            logger.info(f"📝 [FATURA_SERVICE] Criando subtag 'Pendente' (tipo: {tipo or 'despesa'}) para tag '{tag.name}' (ID: {tag.id}), account_id {account_id}")
            subtag = Subtag(
                tenant_id=tenant_id,
                account_id=account_id,
                tag_id=tag.id,
                name="Pendente",
                type=tipo or "despesa",  # Default para despesa
                description="Registros pendentes de categorização manual",
                active=True
            )
            db.add(subtag)
            db.flush()

        # Garante que temos um ID válido
        if not subtag or not subtag.id:
            raise ValueError(f"Falha ao obter/criar subtag padrão 'Pendente' para tenant {tenant_id}")

        return subtag.id

    @staticmethod
    def buscar_subtag_id(db: Session, subtag_nome: str, tag_nome: str, valor: float = None, tenant_id: int = 1, account_id: int = None) -> Optional[int]:
        """
        Busca o ID da subtag pelo nome, filtrando por tipo baseado no valor.
        Retorna None se não encontrar (o chamador deve usar get_default_subtag_id).

        NOTA: Para faturas de cartão, valores positivos são DESPESAS (débitos na fatura).
        Valores negativos são RECEITAS (créditos/estornos na fatura).

        Args:
            db: Sessão do banco de dados
            subtag_nome: Nome da subtag
            tag_nome: Nome da tag pai
            valor: Valor da transação (positivo = despesa, negativo = receita para faturas)
            tenant_id: ID do tenant
            account_id: ID da conta (obrigatório para filtrar subtags da conta correta)

        Returns:
            int | None: ID da subtag encontrada ou None se não encontrar
        """
        if not subtag_nome:
            return None

        # Determina o tipo baseado no valor
        # Para faturas: positivo = despesa, negativo = receita (estorno/crédito)
        tipo = None
        if valor is not None:
            tipo = "despesa" if valor >= 0 else "receita"

        # Busca subtag existente, filtrando pela tag e tipo
        # Faz JOIN com Tag para filtrar por tag_nome
        # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
        # IMPORTANTE: Filtra por tenant_id e account_id porque cada conta tem suas próprias tags/subtags
        query = db.query(Subtag).join(Tag).filter(
            Subtag.tenant_id == tenant_id,
            Subtag.account_id == account_id,
            Subtag.name == subtag_nome,
            Tag.name == tag_nome
        )
        # Filtra por tipo (sempre em Subtag, nunca em Tag)
        if tipo:
            query = query.filter(Subtag.type == tipo)

        subtag = query.first()

        if subtag and subtag.id:
            return subtag.id

        # Se não encontrou, loga e retorna None (chamador deve usar get_default_subtag_id)
        logger.warning(f"⚠️  Subtag '{subtag_nome}' não encontrada (tag='{tag_nome}', tipo='{tipo}', account_id={account_id}), usando 'Pendente'")
        return None

    @staticmethod
    def buscar_ou_criar_tag(db: Session, tag_nome: str, valor: float = None, tenant_id: int = 1) -> int:
        """
        Busca ou cria uma tag pelo nome.

        NOTA: Tags agora são genéricas (não têm tipo). O tipo está nas Subtags.

        Args:
            db: Sessão do banco de dados
            tag_nome: Nome da tag
            valor: Valor da transação (não usado, mantido para compatibilidade)
            tenant_id: ID do tenant (padrão: 1)

        Returns:
            ID da tag
        """
        if not tag_nome:
            tag_nome = "Outros"

        # Busca tag existente
        tag = db.query(Tag).filter(
            Tag.tenant_id == tenant_id,
            Tag.name == tag_nome
        ).first()

        if tag:
            return tag.id

        # Cria nova tag (sem tipo, pois Tags agora são genéricas)
        logger.info(f"📝 [FATURA_SERVICE] Criando tag '{tag_nome}' para tenant {tenant_id}...")
        nova_tag = Tag(
            tenant_id=tenant_id,
            name=tag_nome,
            description=f"Tag criada automaticamente: {tag_nome}"
        )
        db.add(nova_tag)
        db.flush()  # Garante que o ID seja gerado
        return nova_tag.id

    @staticmethod
    def buscar_ou_criar_subtag(db: Session, subtag_nome: str, tag_nome: str, valor: float = None, tenant_id: int = 1, account_id: int = None) -> Optional[int]:
        """
        Busca ou cria uma subtag pelo nome, filtrando por tipo da tag baseado no valor.

        NOTA: Para faturas de cartão, valores positivos são DESPESAS (débitos na fatura).
        Valores negativos são RECEITAS (créditos/estornos na fatura).

        Args:
            db: Sessão do banco de dados
            subtag_nome: Nome da subtag
            tag_nome: Nome da tag pai
            valor: Valor da transação (positivo = despesa, negativo = receita para faturas)
            tenant_id: ID do tenant (padrão: 1)
            account_id: ID da conta logada

        Returns:
            ID da subtag ou None se não fornecido
        """
        if not subtag_nome:
            return None

        # Determina o tipo baseado no valor
        # Para faturas: positivo = despesa, negativo = receita (estorno/crédito)
        tipo = None
        if valor is not None:
            tipo = "despesa" if valor >= 0 else "receita"

        # Busca subtag existente, filtrando pela tag e tipo
        # Faz JOIN com Tag para filtrar por tag_nome
        # IMPORTANTE: Filtra por account_id porque cada conta tem suas próprias tags/subtags
        query = db.query(Subtag).join(Tag).filter(
            Subtag.tenant_id == tenant_id,
            Subtag.account_id == account_id,
            Subtag.name == subtag_nome,
            Tag.name == tag_nome
        )
        # Filtra por tipo (sempre em Subtag, nunca em Tag)
        if tipo:
            query = query.filter(Subtag.type == tipo)

        subtag = query.first()

        if subtag:
            return subtag.id

        # Cria nova subtag
        logger.info(f"📝 [FATURA_SERVICE] Criando subtag '{subtag_nome}' para tag '{tag_nome}' (tipo: {tipo}) para tenant {tenant_id}, account_id {account_id}...")

        # Garante que a tag existe
        tag_id = FaturaService.buscar_ou_criar_tag(db, tag_nome, valor, tenant_id)

        nova_subtag = Subtag(
            tenant_id=tenant_id,
            account_id=account_id,
            tag_id=tag_id,
            name=subtag_nome,
            type=tipo or "despesa",  # Tipo agora é obrigatório em Subtag
            description=f"Subtag criada automaticamente: {subtag_nome}"
        )
        db.add(nova_subtag)
        db.flush()  # Garante que o ID seja gerado
        return nova_subtag.id
    
    @staticmethod
    def converter_data(data_str: str, ano_fatura: str, mes_fatura: str, descricao: str = "") -> datetime:
        """
        Converte string de data para datetime, considerando:
        1. Compras de dezembro em faturas de janeiro são do ano anterior
        2. Parcelas: calcula ano real baseado na parcela atual

        Args:
            data_str: Data no formato "DD Mês" (ex: "15 Dez")
            ano_fatura: Ano da fatura (ex: "2026")
            mes_fatura: Mês da fatura (ex: "01" ou "1")
            descricao: Descrição da compra (para extrair parcelas)

        Returns:
            Objeto datetime com o ano correto

        Exemplos:
            - Fatura Jan/2026, compra "15 Dez" sem parcelas -> 15/Dez/2025
            - Fatura Jan/2026, compra "15 Dez" (13/18) -> 15/Dez/2024 (13 meses atrás)
        """
        # Mapeamento de meses em português
        meses = {
            'jan': 1, 'fev': 2, 'mar': 3, 'abr': 4, 'mai': 5, 'jun': 6,
            'jul': 7, 'ago': 8, 'set': 9, 'out': 10, 'nov': 11, 'dez': 12
        }

        # Extrai dia e mês da compra
        partes = data_str.lower().split()

        # Valida se o primeiro elemento é um número (dia)
        try:
            dia_compra = int(partes[0])
        except (ValueError, IndexError):
            raise ValueError(f"Data inválida: '{data_str}'. Esperado formato 'DD Mês' (ex: '15 Dez')")

        # Valida se o segundo elemento é um mês válido
        if len(partes) < 2:
            raise ValueError(f"Data inválida: '{data_str}'. Falta o mês. Esperado formato 'DD Mês' (ex: '15 Dez')")

        mes_compra = meses.get(partes[1][:3], None)
        if mes_compra is None:
            raise ValueError(f"Mês inválido: '{partes[1]}'. Esperado: Jan, Fev, Mar, Abr, Mai, Jun, Jul, Ago, Set, Out, Nov, Dez")

        # Converte mês da fatura para int
        mes_fatura_int = int(mes_fatura)
        ano_fatura_int = int(ano_fatura)

        # Extrai informação de parcelas
        parcelado, parcela_atual, total_parcelas = FaturaService.extrair_parcelas(descricao)

        # Calcula ano real
        ano_real = ano_fatura_int

        if parcelado and parcela_atual and total_parcelas:
            # Caso 1: Compra parcelada
            # Se estou pagando a parcela 13 de 18, a compra foi há 12 meses
            # (parcela 1 foi há 12 meses, parcela 13 é agora)
            meses_atras = parcela_atual - 1

            # Calcula quantos anos completos se passaram
            anos_atras = meses_atras // 12
            meses_restantes = meses_atras % 12

            # Ajusta o ano
            ano_real -= anos_atras

            # Ajusta se o mês da compra + meses restantes ultrapassar o mês da fatura
            mes_calculado = mes_compra + meses_restantes
            if mes_calculado > mes_fatura_int:
                ano_real -= 1
        else:
            # Caso 2: Compra à vista
            # Se a fatura é de Janeiro (1) e a compra é de Dezembro (12), é do ano anterior
            if mes_fatura_int == 1 and mes_compra == 12:
                ano_real -= 1
            # Se a fatura é de Fevereiro (2) e a compra é de Janeiro (1), pode ser do ano anterior
            elif mes_fatura_int == 2 and mes_compra == 1:
                # Verifica se já passou o fechamento (geralmente dia 15-20)
                # Por segurança, assume que compras de janeiro em fatura de fevereiro são do mesmo ano
                pass
            # Se o mês da compra é maior que o mês da fatura, é do ano anterior
            elif mes_compra > mes_fatura_int:
                ano_real -= 1

        # Retorna datetime com timestamp 00:00:00
        return datetime(ano_real, mes_compra, dia_compra, 0, 0, 0)
    
    @staticmethod
    def salvar_faturas_do_dataframe(db: Session, df: pd.DataFrame, tenant_id: int = 1, user_id: int = None, account_id: int = None) -> Dict[str, int]:
        """
        Salva faturas do DataFrame no banco de dados.

        ⚡ OTIMIZADA para performance com:
        - Operações vetorizadas do pandas (10-100x mais rápido que iterrows)
        - Cache em memória de cartões, mapeamentos e configurações (99% redução em queries)
        - Bulk query para duplicatas (5800 queries → 1 query)
        - Bulk insert/update (80-95% mais rápido)

        Args:
            db: Sessão do banco de dados
            df: DataFrame com as faturas processadas
            tenant_id: ID do tenant (padrão: 1)
            user_id: ID do usuário (obrigatório para created_by)
            account_id: ID da conta logada (obrigatório para filtrar subtags)

        Returns:
            Dicionário com estatísticas: {
                'linhas_salvas': int,
                'linhas_atualizadas': int,
                'cartoes_distintos': int,
                'linhas_nao_mapeadas': int,
                'registros_nao_mapeados': list
            }
        """
        import time
        start_time = time.time()

        linhas_salvas = 0
        linhas_atualizadas = 0
        cartoes_processados = set()
        unmapped_count = 0
        unmapped_records = []

        logger.info(f"⚡ [OTIMIZADO] Iniciando importação de {len(df)} faturas...")

        # ========================================
        # ETAPA 1: PREPARAÇÃO DE DADOS (VETORIZADO)
        # ========================================
        logger.info(f"📊 [ETAPA 1/5] Preparando dados (vetorizado)...")

        # Preenche valores nulos
        df['Descrição'] = df.get('Descrição', pd.Series([None] * len(df))).fillna('')
        df['Valor'] = df.get('Valor', pd.Series([0.0] * len(df))).fillna(0.0)

        # ========================================
        # ETAPA 2: CACHE DE REFERÊNCIAS (3 QUERIES TOTAL)
        # ========================================
        logger.info(f"🔄 [ETAPA 2/5] Carregando cache de cartões, mapeamentos e configurações...")

        # Cache de cartões: {number: id}
        cartoes_query = db.query(Cartao.id, Cartao.number).filter(
            Cartao.tenant_id == tenant_id,
            Cartao.active == True
        ).all()
        cartao_cache = {c.number: c.id for c in cartoes_query}
        logger.info(f"   ✅ {len(cartao_cache)} cartões em cache")

        # MappingHelper para buscar mapeamentos (suporta exact, pattern e regex)
        # O helper carrega todos os mapeamentos em cache e faz matching correto:
        # - exact: comparação direta (O(1) com índice interno)
        # - pattern: busca se pattern está contido na descrição (O(n))
        # - regex: busca com expressão regular (O(n))
        psycopg2_conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        mapping_helper = MappingHelper(db_connection=psycopg2_conn, tenant_id=tenant_id, user_id=user_id, account_id=account_id)
        logger.info(f"   ✅ MappingHelper inicializado")

        # Cache de configurações de cartões: {card_id: {ownership_percentage, expense_sharing_id, ...}}
        adjustment_cache = {}
        for c in db.query(Cartao).filter(Cartao.tenant_id == 1).all():
            # Calcula ownership_percentage baseado no ownership_type (property calculada)
            if c.ownership_type == 'terceiro':
                ownership_pct = Decimal("0.00")
            elif c.ownership_type == 'compartilhado':
                # Busca percentual do compartilhamento (default 50%)
                ownership_pct = Decimal("50.00")
                if c.expense_sharing and hasattr(c.expense_sharing, 'my_contribution_percentage'):
                    ownership_pct = Decimal(str(c.expense_sharing.my_contribution_percentage))
            else:  # proprio
                ownership_pct = Decimal("100.00")

            adjustment_cache[c.id] = {
                'ownership_percentage': ownership_pct,
                'expense_sharing_id': c.expense_sharing_id,
                'account_id': c.account_id
            }
        logger.info(f"   ✅ {len(adjustment_cache)} configurações de cartões em cache")

        # Cache de subtags: {(name, tag_name, type): id}
        # NOTA: Subtag NÃO tem campo 'active' (não usa soft delete)
        # IMPORTANTE: Filtra por account_id porque cada conta tem suas próprias tags/subtags
        subtags_query = db.query(Subtag.id, Subtag.name, Subtag.type, Tag.name.label('tag_name')).join(Tag).filter(
            Subtag.tenant_id == tenant_id,
            Subtag.account_id == account_id
        ).all()
        subtag_cache = {(s.name, s.tag_name, s.type): s.id for s in subtags_query}
        logger.info(f"   ✅ {len(subtag_cache)} subtags em cache")

        # ========================================
        # ETAPA 3: BULK QUERY PARA DUPLICATAS (1 QUERY)
        # ========================================
        logger.info(f"🔍 [ETAPA 3/5] Verificando duplicatas (bulk query)...")

        # NOTA: CreditCardInvoice NÃO tem campo 'active' (não usa soft delete)
        # Busca id, subtag_id e amount para detecção de conflitos
        existing_keys_query = db.query(
            CreditCardInvoice.year_month,
            CreditCardInvoice.credit_card_id,
            CreditCardInvoice.description,
            CreditCardInvoice.date,
            CreditCardInvoice.id,
            CreditCardInvoice.subtag_id,
            CreditCardInvoice.amount
        ).filter(
            CreditCardInvoice.tenant_id == tenant_id
        ).all()

        # Dict para verificação rápida de duplicatas (O(1))
        # Chave inclui VALOR para diferenciar compras similares com valores diferentes
        # Estrutura: { (year_month, credit_card_id, description, amount, date?) : [lista de IDs] }
        existing_keys = {}
        # Dict com dados completos para detecção de conflitos
        existing_records_data = {}
        for e in existing_keys_query:
            amount_rounded = round(float(e.amount), 2) if e.amount else 0.0

            # Chave SEM data (para compras à vista) - inclui valor
            key_no_date = (e.year_month, e.credit_card_id, e.description, amount_rounded)
            # Chave COM data (para parceladas) - inclui valor
            key_with_date = (e.year_month, e.credit_card_id, e.description, amount_rounded, e.date)

            # Usa lista para permitir múltiplos registros com mesma chave
            if key_no_date not in existing_keys:
                existing_keys[key_no_date] = []
            existing_keys[key_no_date].append(e.id)

            if key_with_date not in existing_keys:
                existing_keys[key_with_date] = []
            existing_keys[key_with_date].append(e.id)

            # Dados para conflitos
            existing_records_data[e.id] = {
                'subtag_id': e.subtag_id,
                'amount': amount_rounded
            }
        logger.info(f"   ✅ {len(existing_keys_query)} registros existentes carregados")

        # Cache reverso de subtags para exibir nomes nos conflitos
        subtag_id_to_info = {s.id: {'name': s.name, 'tag_name': s.tag_name, 'type': s.type} for s in subtags_query}
        logger.info(f"   ✅ {len(subtag_id_to_info)} subtags em cache para conflitos")

        # ========================================
        # ETAPA 4: PROCESSAMENTO EM LOTE
        # ========================================
        logger.info(f"⚙️  [ETAPA 4/5] Processando registros...")

        records_to_insert = []
        records_to_update = []
        conflicts = []  # Lista de conflitos detectados

        # Converte DataFrame para lista de dicts (muito mais rápido que iterrows)
        records = df.to_dict('records')

        for idx, row in enumerate(records):
            try:
                # Busca cartão_id usando CACHE (sem query!)
                cartao_number = row['Cartão'][-4:] if len(row['Cartão']) >= 4 else row['Cartão']
                cartao_id = cartao_cache.get(cartao_number)
                if not cartao_id:
                    continue

                # Adiciona cartão ao conjunto de cartões processados
                cartoes_processados.add(row['Cartão'])

                # Busca subtag_id usando CACHE (sem queries!)
                valor = float(row['Valor']) if row.get('Valor') else 0.0
                descricao = str(row.get('Descrição', ''))

                # Para faturas: positivo = despesa, negativo = receita (estorno/crédito)
                tipo = "despesa" if valor >= 0 else "receita"

                subtag_id = None
                mapping_data = None  # Dados do mapeamento (subtag_id, expense_sharing_id, etc)

                # PRIORIDADE 1: Busca mapeamento criado pelo usuário (MappingHelper)
                # Suporta exact, pattern e regex com priorização correta
                if descricao:
                    mapping_data = mapping_helper.find_mapping(descricao, tipo)
                    if mapping_data:
                        subtag_id = mapping_data.get('subtag_id')

                # PRIORIDADE 2: Tenta buscar subtag se houver colunas Tag e Subtag (do parser)
                if not subtag_id and row.get('Subtag') and row.get('Tag'):
                    tag_nome = str(row['Tag'])
                    subtag_nome = str(row['Subtag'])
                    subtag_id = subtag_cache.get((subtag_nome, tag_nome, tipo))

                # PRIORIDADE 3: Se não encontrou, deixa NULL
                # subtag_id permanece None

                # Rastreia se não foi mapeado (subtag_id é NULL)
                is_unmapped = (subtag_id is None)

                # Extrai informações de parcelas da descrição original
                descricao_original = row.get('Descrição', '')
                parcelado, parcela_atual, total_parcelas = FaturaService.extrair_parcelas(descricao_original)

                # Converte data (considerando parcelas e mês da fatura)
                try:
                    data_compra = FaturaService.converter_data(
                        data_str=row['Data'],
                        ano_fatura=row['Ano'],
                        mes_fatura=row['Mês'],
                        descricao=descricao_original
                    )
                except ValueError as e:
                    logger.warning(f"⚠️  [FATURA_SERVICE] Linha ignorada - {str(e)}")
                    continue

                # Formata year_month no formato YYYY-MM
                ano = str(row['Ano'])
                mes = str(row['Mês']).zfill(2)  # Garante 2 dígitos (01, 02, etc)
                year_month = f"{ano}-{mes}"

                # Verifica se é duplicata (lookup em dict - O(1))
                descricao_limpa = row.get('Descrição Limpa', descricao)

                # Inverte o sinal do valor (positivo → negativo, negativo → positivo)
                # Faturas são despesas, então valores positivos viram negativos
                valor_invertido = round(-float(row['Valor']), 2)

                # Chave INCLUI valor para identificação precisa
                # Tenta com data (para parceladas)
                if parcela_atual is not None:
                    key = (year_month, cartao_id, descricao_limpa, valor_invertido, data_compra)
                else:
                    key = (year_month, cartao_id, descricao_limpa, valor_invertido)

                existing_ids = existing_keys.get(key, [])

                # Pega o primeiro ID disponível (se houver múltiplos)
                # Usa set para rastrear IDs já consumidos nesta importação
                existing_id = None
                if existing_ids:
                    # Usa o primeiro ID que ainda não foi consumido
                    existing_id = existing_ids[0]

                if existing_id:
                    # Registro duplicado - verifica se há conflitos de tag/subtag
                    # NOTA: Conflito de VALOR não existe mais pois o valor faz parte da chave!
                    existing_data = existing_records_data.get(existing_id, {})
                    existing_subtag_id = existing_data.get('subtag_id')

                    # Detecta conflitos de tag/subtag apenas
                    # NOTA: Para PDF, não detectamos conflito de tag se o novo subtag_id é None
                    # (significa que não há mapeamento, então o registro foi categorizado manualmente)
                    has_tag_conflict = (
                        existing_subtag_id is not None and
                        subtag_id is not None and
                        existing_subtag_id != subtag_id
                    )

                    # DEBUG: Log para investigar conflitos
                    if has_tag_conflict:
                        logger.info(f"   ⚠️ CONFLITO TAG: {descricao_limpa[:40]}")
                        logger.info(f"      Tag: existing={existing_subtag_id}, new={subtag_id}")

                    if has_tag_conflict:
                        # Conflito de TAG detectado - adiciona à lista de conflitos
                        # Extrai os últimos 4 dígitos do cartão para exibição
                        cartao_raw = row.get('Cartão', '')
                        card_number = cartao_raw[-4:] if len(cartao_raw) >= 4 else cartao_raw

                        # Busca nomes das tags para exibição
                        existing_subtag = subtag_id_to_info.get(existing_subtag_id, {})
                        new_subtag = subtag_id_to_info.get(subtag_id, {})

                        conflict_record = {
                            'existing_id': existing_id,
                            'record_type': 'credit_card_invoice',
                            'date': data_compra.strftime('%Y-%m-%d') if hasattr(data_compra, 'strftime') else str(data_compra),
                            'description': descricao_limpa,
                            'amount': valor_invertido,
                            'new_subtag_id': subtag_id,
                            'year_month': year_month,
                            'card_number': card_number,  # Últimos 4 dígitos para agrupamento no frontend
                            'tag_conflict': {
                                'original_subtag_id': existing_subtag_id,
                                'original_subtag_name': existing_subtag.get('name'),
                                'original_tag_name': existing_subtag.get('tag_name'),
                                'new_subtag_id': subtag_id,
                                'new_subtag_name': new_subtag.get('name'),
                                'new_tag_name': new_subtag.get('tag_name')
                            }
                        }

                        conflicts.append(conflict_record)
                        # Não conta como atualizado pois precisa de resolução
                    else:
                        # Sem conflito - atualiza normalmente
                        records_to_update.append({
                            'id': existing_id,
                            'subtag_id': subtag_id,
                            'current_installment': parcela_atual,
                            'total_installments': total_parcelas
                        })
                        linhas_atualizadas += 1
                else:
                    # Busca configurações de ajuste do cartão (cache)
                    # Propaga configurações de compartilhamento do cartão
                    adjustment_config = adjustment_cache.get(cartao_id, {
                        'ownership_percentage': Decimal("100.00"),
                        'expense_sharing_id': None,
                        'account_id': None
                    })

                    # Determina compartilhamento final:
                    # PRIORIDADE 1: Mapeamento (se tiver expense_sharing_id definido)
                    # PRIORIDADE 2: Cartão (configuração padrão)
                    final_expense_sharing_id = adjustment_config['expense_sharing_id']
                    final_ownership_percentage = adjustment_config['ownership_percentage']

                    if mapping_data and mapping_data.get('expense_sharing_id') is not None:
                        # Mapeamento tem compartilhamento específico - sobrescreve cartão
                        final_expense_sharing_id = mapping_data['expense_sharing_id']
                        if mapping_data.get('my_contribution_percentage') is not None:
                            final_ownership_percentage = Decimal(str(mapping_data['my_contribution_percentage']))

                    # Novo registro - adiciona para insert
                    records_to_insert.append({
                        'tenant_id': tenant_id,
                        'credit_card_id': cartao_id,
                        'date': data_compra,
                        'year_month': year_month,
                        'description': descricao_limpa,
                        'amount': valor_invertido,
                        'current_installment': parcela_atual,
                        'total_installments': total_parcelas,
                        'subtag_id': subtag_id,
                        'expense_sharing_id': final_expense_sharing_id,
                        'account_id': adjustment_config['account_id'],
                        'ownership_percentage': final_ownership_percentage,
                        'created_by': user_id  # ✅ Campo obrigatório do BaseEntity
                    })
                    linhas_salvas += 1

                    # Adiciona aos registros não mapeados se necessário
                    if is_unmapped:
                        unmapped_count += 1
                        unmapped_records.append({
                            "linha": len(unmapped_records) + 1,
                            "data": data_compra.strftime("%d/%m/%Y"),
                            "descricao": descricao_limpa,
                            "valor": valor_invertido,
                            "cartao": row['Cartão']
                        })

            except Exception as e:
                logger.error(f"❌ Erro ao processar fatura: {e}", exc_info=True)
                continue

        # ========================================
        # ETAPA 5: BULK INSERT/UPDATE (2 OPERAÇÕES)
        # ========================================
        logger.info(f"💾 [ETAPA 5/5] Salvando no banco...")
        logger.info(f"   📝 {len(records_to_insert)} novos registros")
        logger.info(f"   🔄 {len(records_to_update)} atualizações")

        if records_to_insert:
            db.bulk_insert_mappings(CreditCardInvoice, records_to_insert)

        if records_to_update:
            db.bulk_update_mappings(CreditCardInvoice, records_to_update)

        db.commit()

        # Fecha conexão psycopg2 do MappingHelper
        psycopg2_conn.close()

        elapsed = time.time() - start_time
        records_per_sec = len(df) / elapsed if elapsed > 0 else 0
        logger.info(f"✅ [OTIMIZADO] Concluído em {elapsed:.2f}s ({records_per_sec:.0f} registros/s)")
        logger.info(f"   📊 Criados: {linhas_salvas} | Atualizados: {linhas_atualizadas} | Conflitos: {len(conflicts)} | Não mapeados: {unmapped_count}")

        return {
            'linhas_salvas': linhas_salvas,
            'linhas_atualizadas': linhas_atualizadas,
            'cartoes_distintos': len(cartoes_processados),
            'linhas_nao_mapeadas': unmapped_count,
            'registros_nao_mapeados': unmapped_records[:20],  # Limita a 20 registros
            'conflicts': conflicts,
            'conflicts_count': len(conflicts)
        }

