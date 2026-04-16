# -*- coding: utf-8 -*-
"""
MappingHelper - Utilitário para mapeamento de despesas e categorias
Adaptado do gus-converter/settings.py para usar banco de dados
"""
from datetime import datetime
from typing import Optional, Dict, List
import psycopg2
from psycopg2.extras import RealDictCursor
import os


class MappingHelper:
    """Helper para mapeamento de despesas, categorias e tags."""

    # Mapeamento de descrições sensíveis (hardcoded)
    # Usado para ofuscar informações sensíveis antes de salvar no banco
    DESCRIPTION_MAPPING = [
        {"original": "badoo", "mapped": "Tomato"},
        {"original": "onlyfans", "mapped": "Onion"},
    ]
    
    def __init__(self, db_connection=None, user_id=None, tenant_id=None, account_id=None):
        """
        Inicializa o helper de mapeamento.

        Args:
            db_connection: Conexão com o banco de dados (opcional)
            user_id: ID do usuário para filtrar mapeamentos (opcional)
            tenant_id: ID do tenant para filtrar mapeamentos (opcional)
            account_id: ID da conta para filtrar mapeamentos (opcional, mas recomendado)
        """
        self.db_connection = db_connection
        self.user_id = user_id
        self.tenant_id = tenant_id
        self.account_id = account_id
        self.expense_mapping_cache = None
        self.months_mapping = []
        
        # Gera mapeamento de meses para 2021-2025
        for year in range(2021, 2026):
            for month_number, (month_name, days_in_month) in enumerate([
                ("Janeiro", 31), ("Fevereiro", 28), ("Março", 31), ("Abril", 30),
                ("Maio", 31), ("Junho", 30), ("Julho", 31), ("Agosto", 31),
                ("Setembro", 30), ("Outubro", 31), ("Novembro", 30), ("Dezembro", 31)
            ], start=1):
                # Ajusta para anos bissextos em Fevereiro
                if month_number == 2 and (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)):
                    days_in_month = 29

                self.months_mapping.append({
                    "month_year": year,
                    "month_original_name": month_name,
                    "month_mapped_name": f"{year}-{month_number:02d}-{month_name}",
                    "month_number": month_number,
                    "month_start_date": f"{year}-{month_number:02d}-01",
                    "month_end_date": f"{year}-{month_number:02d}-{days_in_month:02d}"
                })
    
    def _load_expense_mapping_from_db(self):
        """
        Carrega mapeamento de transações do banco de dados (tabela transaction_mappings).
        Filtra por user_id e tenant_id se fornecidos.

        Retorna lista no formato:
        [{"descrição": "...", "tag": "...", "subtag": "...", "subtag_id": ..., "mapped_description": ...}, ...]
        """
        if self.expense_mapping_cache is not None:
            return self.expense_mapping_cache

        if not self.db_connection:
            self.expense_mapping_cache = []
            return self.expense_mapping_cache

        try:
            cursor = self.db_connection.cursor()

            # Monta query com filtros opcionais
            # NOTA: transaction_mappings NÃO tem campo 'active' (não usa soft delete)
            query = """
                SELECT
                    em.original_description,
                    em.mapped_description,
                    em.subtag_id,
                    em.mapping_type,
                    em.pattern,
                    em.regex_pattern,
                    em.priority,
                    em.is_sensitive,
                    em.expense_sharing_id,
                    em.my_contribution_percentage,
                    s.name as subtag_name,
                    s.type as subtag_type,
                    t.name as tag_name
                FROM transaction_mappings em
                JOIN subtags s ON em.subtag_id = s.id
                JOIN tags t ON s.tag_id = t.id
                WHERE 1=1
            """
            params = []

            if self.tenant_id is not None:
                query += " AND em.tenant_id = %s"
                params.append(self.tenant_id)

            # Filtra por account_id (OBRIGATÓRIO para evitar conflitos entre contas)
            if self.account_id is not None:
                query += " AND em.account_id = %s"
                params.append(self.account_id)

            query += " ORDER BY em.priority ASC, em.original_description;"

            cursor.execute(query, params)

            results = cursor.fetchall()

            # Converte para formato esperado
            self.expense_mapping_cache = [
                {
                    "descrição": row['original_description'],
                    "tag": row['tag_name'],
                    "subtag": row['subtag_name'],
                    "subtag_type": row['subtag_type'],
                    "mapping_type": row['mapping_type'],
                    "pattern": row['pattern'],
                    "regex_pattern": row['regex_pattern'],
                    "priority": row['priority'],
                    "subtag_id": row['subtag_id'],
                    "mapped_description": row['mapped_description'],  # Pode ser None
                    "is_sensitive": row['is_sensitive'],  # Para descriptografia
                    "expense_sharing_id": row['expense_sharing_id'],  # Compartilhamento do mapeamento
                    "my_contribution_percentage": row['my_contribution_percentage']  # Percentual de contribuição
                }
                for row in results
            ]

            return self.expense_mapping_cache

        except Exception as e:
            print(f"⚠️  Erro ao carregar mapeamentos do banco: {e}")
            self.expense_mapping_cache = []
            return self.expense_mapping_cache

    def find_mapping(self, description: str, tipo: Optional[str] = None) -> Optional[Dict]:
        """
        Busca mapeamento para uma descrição usando priorização:
        1. Exact match (mais rápido)
        2. Pattern match (ordenado por prioridade DESC, depois por tamanho do pattern DESC)
        3. Regex match (ordenado por prioridade DESC)

        Args:
            description: Descrição da transação
            tipo: Tipo da transação ('receita' ou 'despesa') para filtrar subtags

        Returns:
            Dict com informações do mapeamento ou None se não encontrado
            Formato: {"subtag_id": int, "tag": str, "subtag": str, "mapped_description": str|None}
        """
        import re

        # 🔍 LOG: Valor recebido
        # Valida descrição obrigatória
        if not description:
            return None

        # Carrega mapeamentos do banco
        mappings = self._load_expense_mapping_from_db()

        if not mappings:
            return None

        # Filtra por tipo se fornecido
        if tipo:
            mappings = [m for m in mappings if m.get("subtag_type") == tipo]

        # Separa mapeamentos por tipo
        exact_mappings = []
        pattern_mappings = []
        regex_mappings = []

        for mapping in mappings:
            mapping_type = mapping.get("mapping_type", "exact")
            if mapping_type == "exact":
                exact_mappings.append(mapping)
            elif mapping_type == "pattern":
                pattern_mappings.append(mapping)
            elif mapping_type == "regex":
                regex_mappings.append(mapping)

        # 1️⃣ EXACT MATCH (mais rápido)
        desc_lower = description.lower().strip()
        for mapping in exact_mappings:
            # Usa "or ''" porque dict.get() retorna None se a chave existe com valor None
            original_desc = (mapping.get("descrição") or "").lower().strip()
            if original_desc == desc_lower:
                return {
                    "subtag_id": mapping.get("subtag_id"),
                    "tag": mapping.get("tag"),
                    "subtag": mapping.get("subtag"),
                    "mapped_description": mapping.get("mapped_description"),
                    "is_sensitive": mapping.get("is_sensitive", False),
                    "expense_sharing_id": mapping.get("expense_sharing_id"),
                    "my_contribution_percentage": mapping.get("my_contribution_percentage")
                }

        # 2️⃣ PATTERN MATCH (ordenado por prioridade ASC, depois por tamanho DESC)
        # Ordena por prioridade (menor = mais prioritário), depois por tamanho do pattern (maior = mais específico)
        pattern_mappings_sorted = sorted(
            pattern_mappings,
            key=lambda m: (m.get("priority", 1), -len(m.get("pattern", "")))
        )

        for mapping in pattern_mappings_sorted:
            pattern = mapping.get("pattern")
            if not pattern:
                continue

            # Busca sempre case-insensitive
            # NOTA: Aplicamos .lower() em ambos os lados por segurança (defesa em profundidade)
            # mesmo que o pattern já seja salvo em lowercase no banco
            if pattern.lower() in desc_lower:
                return {
                    "subtag_id": mapping.get("subtag_id"),
                    "tag": mapping.get("tag"),
                    "subtag": mapping.get("subtag"),
                    "mapped_description": mapping.get("mapped_description"),
                    "is_sensitive": mapping.get("is_sensitive", False),
                    "expense_sharing_id": mapping.get("expense_sharing_id"),
                    "my_contribution_percentage": mapping.get("my_contribution_percentage")
                }

        # 3️⃣ REGEX MATCH (ordenado por prioridade ASC - menor = mais prioritário)
        regex_mappings_sorted = sorted(
            regex_mappings,
            key=lambda m: m.get("priority", 1)
        )

        for mapping in regex_mappings_sorted:
            regex_pattern = mapping.get("regex_pattern")
            if not regex_pattern:
                continue

            try:
                # Busca sempre case-insensitive
                if re.search(regex_pattern, description, re.IGNORECASE):
                    return {
                        "subtag_id": mapping.get("subtag_id"),
                        "tag": mapping.get("tag"),
                        "subtag": mapping.get("subtag"),
                        "mapped_description": mapping.get("mapped_description"),
                        "is_sensitive": mapping.get("is_sensitive", False),
                        "expense_sharing_id": mapping.get("expense_sharing_id"),
                        "my_contribution_percentage": mapping.get("my_contribution_percentage")
                    }
            except re.error as e:
                print(f"⚠️  Regex inválido '{regex_pattern}': {e}")
                continue

        # Não encontrou nenhum mapeamento
        return None

    def get_mapped_month_name(self, datetime_value: datetime) -> Optional[str]:
        """
        Retorna o nome do mês mapeado no formato "YYYY-MM-NomeMês".
        
        Args:
            datetime_value: Objeto datetime
            
        Returns:
            str: Nome do mês mapeado (ex: "2024-01-Janeiro")
        """
        month_year = datetime_value.year
        month_number = datetime_value.month

        for month in self.months_mapping:
            if month["month_year"] == month_year and month["month_number"] == month_number:
                return month["month_mapped_name"]
        
        return None
    
    def get_mapped_month_name_by_name(self, year: str, month_name: str) -> Optional[str]:
        """
        Retorna o nome do mês mapeado a partir do ano e nome do mês.

        Args:
            year: Ano como string
            month_name: Nome do mês

        Returns:
            str: Nome do mês mapeado
        """
        for month in self.months_mapping:
            if month["month_year"] == int(year) and month["month_original_name"] == month_name:
                return month["month_mapped_name"]

        return None

    def get_mapped_tag(self, categoria: Optional[str], transacao: Optional[str],
                       descricao: str, valor: float, origem: int = 1) -> str:
        """
        Retorna a tag (categoria) mapeada para uma despesa.

        Usa o novo sistema de matching (exact → pattern → regex).
        Se não encontrar, retorna "Geral" como fallback.

        Args:
            categoria: Categoria original do extrato
            transacao: Tipo de transação
            descricao: Descrição da despesa
            valor: Valor da transação (positivo = receita, negativo = despesa)
            origem: 1 para extrato bancário, 2 para cartão de crédito

        Returns:
            str: Tag mapeada ou "Geral" se não encontrado
        """
        # Determina o tipo baseado no valor
        # Para extratos bancários: valor positivo = receita, negativo = despesa
        tipo = "receita" if valor >= 0 else "despesa"

        # Usa o novo método find_mapping COM filtro de tipo
        mapping = self.find_mapping(descricao, tipo=tipo)
        if mapping:
            return mapping.get("tag", "Geral")

        # Fallback: retorna "Geral" (tag genérica)
        return "Geral"

    def get_mapped_subtag(self, descricao: str, tag: str, is_receita: Optional[bool] = None) -> Optional[str]:
        """
        Retorna a subtag (subcategoria) mapeada para uma despesa.

        Usa o novo sistema de matching (exact → pattern → regex).

        Args:
            descricao: Descrição da despesa
            tag: Tag (categoria) da despesa
            is_receita: True para receita, False para despesa, None para não filtrar

        Returns:
            str: Subtag mapeada ou None se não encontrado
        """
        # Determina o tipo para filtrar
        tipo = None
        if is_receita is not None:
            tipo = "receita" if is_receita else "despesa"

        # Usa o novo método find_mapping COM filtro de tipo
        mapping = self.find_mapping(descricao, tipo=tipo)
        if mapping and mapping.get("tag") == tag:
            return mapping.get("subtag")

        return None

    def get_mapped_subtag_id(self, descricao: str, tag: str, is_receita: Optional[bool] = None) -> Optional[int]:
        """
        Retorna o subtag_id mapeado para uma despesa diretamente do banco.
        Filtra pelo tipo correto (receita/despesa) se is_receita for fornecido.

        Usa o novo sistema de matching (exact → pattern → regex).

        Args:
            descricao: Descrição da despesa
            tag: Tag (categoria) da despesa
            is_receita: True para receita, False para despesa, None para não filtrar

        Returns:
            int: ID da subtag ou None se não encontrado
        """
        # Determina o tipo para filtrar
        tipo = None
        if is_receita is not None:
            tipo = "receita" if is_receita else "despesa"

        # Usa o novo método find_mapping com filtro de tipo
        mapping = self.find_mapping(descricao, tipo=tipo)
        if mapping and mapping.get("tag") == tag:
            return mapping.get("subtag_id")

        return None

    def get_mapped_description(self, descricao: str, transacao: Optional[str] = None) -> str:
        """
        Retorna a descrição mapeada (para ofuscar informações sensíveis).

        Usa o novo sistema de matching (exact → pattern → regex).
        - Se mapped_description for NULL: retorna a descrição original do arquivo
        - Se mapped_description estiver preenchido: retorna o valor mapeado (descriptografado se necessário)

        Args:
            descricao: Descrição original do arquivo
            transacao: Tipo de transação (opcional)

        Returns:
            str: Descrição mapeada ou original (string vazia se descricao for None)
        """
        # Valida descrição obrigatória
        if not descricao:
            return ""

        # Usa o novo método find_mapping
        mapping = self.find_mapping(descricao)

        if mapping:
            # Se mapped_description não for None, usa o valor mapeado
            mapped_desc = mapping.get("mapped_description")
            is_sensitive = mapping.get("is_sensitive", False)

            if mapped_desc is not None:
                # Se for sensível, descriptografa
                if is_sensitive:
                    from app.utils.crypto_helper import get_crypto_helper
                    crypto = get_crypto_helper()
                    try:
                        return crypto.decrypt(mapped_desc)
                    except Exception as e:
                        print(f"⚠️  Erro ao descriptografar mapped_description: {e}")
                        # Se falhar, retorna a descrição original
                        return descricao

                return mapped_desc

            # Se for None, retorna a descrição original do arquivo
            return descricao

        # Fallback para mapeamentos hardcoded antigos (DESCRIPTION_MAPPING)
        descricao_lower = descricao.lower()
        for description in MappingHelper.DESCRIPTION_MAPPING:
            if description["original"] == descricao_lower:
                return description["mapped"]

        if (descricao == "BTG Pactual" or descricao == "BTG PACTUAL SA") and transacao:
            return transacao

        return descricao

    @staticmethod
    def normalize_card_number(number: str) -> str:
        """
        Normaliza número de cartão removendo zeros à esquerda.

        Exemplos:
            "0323" -> "323"
            "323" -> "323"
            "0001" -> "1"
            "1234" -> "1234"

        Args:
            number: Número do cartão (últimos 4 dígitos)

        Returns:
            str: Número normalizado sem zeros à esquerda
        """
        return str(int(number)) if number.isdigit() else number

    def get_mapped_credit_card_owner(self, number: str) -> Optional[str]:
        """
        Retorna o titular do cartão de crédito a partir do banco de dados.

        Busca cartões independente de estarem ativos ou inativos, permitindo
        importar faturas históricas de cartões que foram desativados.

        Compara números normalizados (sem zeros à esquerda) para garantir
        que "323" encontre "0323" no banco.

        Args:
            number: Últimos 4 dígitos do cartão

        Returns:
            str: Nome do titular ou None se não encontrado
        """
        if not self.db_connection:
            return None

        try:
            cursor = self.db_connection.cursor()
            # Busca todos os cartões e compara números normalizados
            cursor.execute("SELECT id, name, number FROM credit_cards")
            results = cursor.fetchall()

            normalized_input = self.normalize_card_number(number)

            for row in results:
                if self.normalize_card_number(row['number']) == normalized_input:
                    return row['name']

            return None
        except Exception:
            return None

    def get_credit_card_id_by_number(self, number: str) -> Optional[int]:
        """
        Retorna o ID do cartão de crédito a partir do número.

        Busca cartões independente de estarem ativos ou inativos, permitindo
        importar faturas históricas de cartões que foram desativados.

        Compara números normalizados (sem zeros à esquerda) para garantir
        que "323" encontre "0323" no banco.

        Args:
            number: Últimos 4 dígitos do cartão

        Returns:
            int: ID do cartão ou None se não encontrado
        """
        if not self.db_connection:
            return None

        try:
            cursor = self.db_connection.cursor()
            # Busca todos os cartões e compara números normalizados
            cursor.execute("SELECT id, number FROM credit_cards")
            results = cursor.fetchall()

            normalized_input = self.normalize_card_number(number)

            for row in results:
                if self.normalize_card_number(row['number']) == normalized_input:
                    return row['id']

            return None
        except Exception:
            return None

