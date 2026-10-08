# -*- coding: utf-8 -*-
"""
ExtratoTransformer - Camada TRANSFORM do ETL
Responsável por aplicar todas as transformações nos dados brutos.
"""
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
import pandas as pd
from ..utils.mapping_helper import MappingHelper
from ..utils.datetime_helper import DatetimeHelper
from ..utils.import_progress import report_row_progress

# Transações do extrato bruto que não devem ser importadas (comparação case-insensitive).
IGNORED_RAW_TRANSACTIONS = frozenset({"saque negado"})


def is_ignored_extrato_transaction(transacao: Any) -> bool:
    label = str(transacao or "").strip().casefold()
    return label in IGNORED_RAW_TRANSACTIONS


class ExtratoTransformer:
    """
    Transformador de dados de extratos bancários.
    
    Responsabilidades:
    - Aplicar mapeamento de descrições (badoo → Tomato)
    - Aplicar mapeamento de tags e subtags
    - Converter e normalizar datas
    - Calcular campos derivados (ano, mês)
    - Retornar dados transformados prontos para carga
    """
    
    def __init__(self, mapping_helper: Optional[MappingHelper] = None):
        """
        Inicializa o transformador.
        
        Args:
            mapping_helper: Helper de mapeamento (opcional)
        """
        self.mapping_helper = mapping_helper or MappingHelper()
    
    def transform(
        self, raw_records: List[Dict[str, Any]]
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Transforma dados brutos em dados processados.
        
        Args:
            raw_records: Lista de registros brutos do extrator
            
        Returns:
            Tupla (registros transformados, linhas ignoradas por política de importação):
            [
                {
                    "ano": int,
                    "mes": str,
                    "data_hora": datetime,
                    "categoria": str,
                    "transacao": str,
                    "descricao": str,  # JÁ MAPEADA (badoo → Tomato)
                    "valor": float,
                    "tag": str,
                    "subtag": str,
                    "subtag_id": int
                },
                ...
            ]
        """
        print(f"🔄 [TRANSFORMER] Transformando {len(raw_records)} registros...")
        
        transformed_records = []
        ignored_records: List[Dict[str, Any]] = []
        total_rows = len(raw_records)
        report_row_progress(0, total_rows, phase=3)

        for idx, raw_record in enumerate(raw_records, 1):
            try:
                if is_ignored_extrato_transaction(raw_record.get("transacao")):
                    ignored_records.append(self._build_ignored_row_summary(raw_record))
                    continue
                transformed = self._transform_single_record(raw_record)
                transformed_records.append(transformed)
                
                if idx <= 3 or idx % 100 == 0:
                    print(f"   ✅ Transformado {idx}/{len(raw_records)}: {transformed['descricao'][:50]}")
                    
            except Exception as e:
                print(f"   ❌ Erro ao transformar registro {idx}: {e}")
                print(f"      Registro: {raw_record}")
                continue
            finally:
                report_row_progress(idx, total_rows, phase=3)
        
        if ignored_records:
            print(f"⏭️ [TRANSFORMER] Ignorados (política): {len(ignored_records)} registros")
        print(f"✅ [TRANSFORMER] Total transformado: {len(transformed_records)} registros")
        return transformed_records, ignored_records

    def _build_ignored_row_summary(self, raw_record: Dict[str, Any]) -> Dict[str, Any]:
        """Resumo para exibir no relatório de importação (campos do arquivo bruto)."""
        data_hora_raw = raw_record.get("data_hora")
        data_label = ""
        try:
            if isinstance(data_hora_raw, datetime):
                data_label = data_hora_raw.strftime("%d/%m/%Y %H:%M")
            else:
                data_label = self._convert_date(data_hora_raw).strftime("%d/%m/%Y %H:%M")
        except Exception:
            data_label = str(data_hora_raw or "")

        valor_raw = raw_record.get("valor")
        try:
            valor = float(valor_raw) if valor_raw is not None and valor_raw != "" else 0.0
        except (TypeError, ValueError):
            valor = 0.0

        return {
            "data": data_label,
            "transacao": str(raw_record.get("transacao") or "").strip(),
            "descricao": str(raw_record.get("descricao") or "").strip(),
            "valor": valor,
            "motivo": "Saque negado",
        }
    
    def _transform_single_record(self, raw_record: Dict[str, Any]) -> Dict[str, Any]:
        """
        Transforma um único registro bruto.
        
        Args:
            raw_record: Registro bruto
            
        Returns:
            Registro transformado
        """
        # 1. Converte data
        data_hora = self._convert_date(raw_record["data_hora"])
        
        # 2. Mapeia descrição (badoo → Tomato)
        descricao_original = raw_record["descricao"]
        transacao = raw_record["transacao"]
        descricao_mapeada = self.mapping_helper.get_mapped_description(
            descricao_original, transacao
        )
        
        # 3. Mapeia tag
        categoria = raw_record["categoria"]
        valor = float(raw_record["valor"]) if raw_record["valor"] else 0.0
        tag = self.mapping_helper.get_mapped_tag(
            categoria, transacao, descricao_mapeada, valor
        )

        # 4. Ajustes especiais de tag
        if tag == "Trabalho-Salário":
            tag = "Trabalho"
        elif tag == "Governo-Restituição IRPF":
            tag = "Governo"

        # 5. Determina se é receita ou despesa
        # Para extratos bancários: valor positivo = receita, negativo = despesa
        is_receita = valor >= 0

        # 6. Mapeia subtag (com filtro de tipo)
        subtag = self.mapping_helper.get_mapped_subtag(descricao_mapeada, tag, is_receita)

        # 7. Busca subtag_id (com filtro de tipo)
        subtag_id = self.mapping_helper.get_mapped_subtag_id(descricao_mapeada, tag, is_receita)

        # 8. Calcula ano e mês
        ano = data_hora.year
        mes = self.mapping_helper.get_mapped_month_name(data_hora)

        # 9. Retorna registro transformado
        return {
            "ano": ano,
            "mes": mes,
            "data_hora": data_hora,
            "categoria": categoria,
            "transacao": transacao,
            "descricao": descricao_mapeada,  # ✅ JÁ MAPEADA!
            "valor": valor,
            "tag": tag,
            "subtag": subtag,
            "subtag_id": subtag_id
        }
    
    def _convert_date(self, date_value) -> datetime:
        """
        Converte valor de data para datetime.
        
        Args:
            date_value: Valor da data (pode ser string, datetime, etc)
            
        Returns:
            Objeto datetime
        """
        if isinstance(date_value, datetime):
            return date_value
        elif isinstance(date_value, str):
            return DatetimeHelper.convert_to_datetime(date_value)
        else:
            return DatetimeHelper.convert_to_datetime(date_value)
    
    def to_dataframe(self, transformed_records: List[Dict[str, Any]]) -> pd.DataFrame:
        """
        Converte registros transformados para DataFrame.
        
        Args:
            transformed_records: Lista de registros transformados
            
        Returns:
            DataFrame com colunas padronizadas
        """
        df = pd.DataFrame(transformed_records)
        
        # Renomeia colunas para padrão esperado pelo loader
        df = df.rename(columns={
            "ano": "Ano",
            "mes": "Mês",
            "data_hora": "Data e hora",
            "categoria": "Categoria",
            "transacao": "Transação",
            "descricao": "Descrição",
            "valor": "Valor",
            "tag": "Tag",
            "subtag": "Subtag"
        })

        return df

