# -*- coding: utf-8 -*-
"""
ExtratoETL - Orquestrador do pipeline ETL
Coordena Extract → Transform para extratos bancários.
LOAD é feito pela função save_extrato_records() em excel_import_router.py
"""
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
import os
import pandas as pd

from .extrato_extractor import ExtratoExtractor
from .extrato_transformer import ExtratoTransformer
from ..utils.mapping_helper import MappingHelper


class ExtratoETL:
    """
    Orquestrador do pipeline ETL para extratos bancários.

    Fluxo:
    1. EXTRACT: Lê arquivos Excel brutos do banco e extrai dados
    2. TRANSFORM: Aplica transformações (mapeamentos, conversões, limpeza)
    3. Retorna DataFrame pronto para save_extrato_records()

    Benefícios:
    - Separação clara de responsabilidades
    - Reutilizável
    - Testável independentemente
    """

    def __init__(self, db_session: Optional[Session] = None, mapping_helper: Optional[MappingHelper] = None, tenant_id: int = 1):
        """
        Inicializa o orquestrador ETL.

        Args:
            db_session: Sessão do banco de dados (não usado, mantido para compatibilidade)
            mapping_helper: Helper de mapeamento para transformações
            tenant_id: ID do tenant (padrão: 1)
        """
        self.mapping_helper = mapping_helper
        self.tenant_id = tenant_id

        # Inicializa componentes ETL (apenas Extract e Transform)
        self.extractor = ExtratoExtractor()
        self.transformer = ExtratoTransformer(mapping_helper=mapping_helper)
    
    def process(self, file_paths: List[str], return_dataframe: bool = True) -> Dict[str, Any]:
        """
        Executa Extract + Transform (sem Load).

        Args:
            file_paths: Lista de caminhos dos arquivos brutos a processar
            return_dataframe: Se True, retorna DataFrame transformado

        Returns:
            Dicionário com resultados:
            {
                "success": bool,
                "arquivos_processados": int,
                "registros_extraidos": int,
                "registros_transformados": int,
                "dataframe": pd.DataFrame (se return_dataframe=True)
            }
        """
        print("=" * 80)
        print("🚀 INICIANDO ETL - EXTRATOS BANCÁRIOS (Extract + Transform)")
        print("=" * 80)

        try:
            # ========================================
            # ETAPA 1: EXTRACT
            # ========================================
            print("\n📥 ETAPA 1/2: EXTRACT (Extração de Dados Brutos)")
            print("-" * 80)
            raw_records = self.extractor.extract_from_files(file_paths)

            if not raw_records:
                return {
                    "success": False,
                    "error": "Nenhum registro extraído dos arquivos",
                    "arquivos_processados": len(file_paths),
                    "registros_extraidos": 0
                }

            # ========================================
            # ETAPA 2: TRANSFORM
            # ========================================
            print("\n🔄 ETAPA 2/2: TRANSFORM (Limpeza e Transformação)")
            print("-" * 80)
            transformed_records, ignored_records = self.transformer.transform(raw_records)

            if not transformed_records and not ignored_records:
                hint = ""
                joined = " ".join(os.path.basename(p) for p in file_paths).upper()
                if "DE-PARA" in joined or "ATUALIZADOS" in joined:
                    hint = (
                        " O arquivo parece ser o relatório DE-PARA do Plumo, não o extrato "
                        "original do banco."
                    )
                elif len(raw_records) == 0:
                    hint = (
                        " Verifique se é o Excel bruto do banco (com cabeçalho "
                        "Data e hora, Categoria, Transação, Descrição, Valor)."
                    )
                return {
                    "success": False,
                    "error": f"Nenhum registro transformado.{hint}",
                    "arquivos_processados": len(file_paths),
                    "registros_extraidos": len(raw_records),
                    "registros_transformados": 0,
                    "ignored_rows": [],
                }

            if not transformed_records and ignored_records:
                print(
                    f"ℹ️ [ETL] Todos os {len(ignored_records)} registros foram ignorados "
                    f"(política de importação)."
                )

            # Converte para DataFrame
            df = None
            if return_dataframe and transformed_records:
                df = self.transformer.to_dataframe(transformed_records)
            elif return_dataframe:
                df = pd.DataFrame()

            # ========================================
            # RESULTADO FINAL
            # ========================================
            print("\n" + "=" * 80)
            print("✅ ETL CONCLUÍDO - DataFrame pronto para save_extrato_records()")
            print("=" * 80)
            print(f"📊 Resumo:")
            print(f"   - Arquivos processados: {len(file_paths)}")
            print(f"   - Registros extraídos: {len(raw_records)}")
            print(f"   - Registros transformados: {len(transformed_records)}")
            print("=" * 80 + "\n")

            result = {
                "success": True,
                "arquivos_processados": len(file_paths),
                "registros_extraidos": len(raw_records),
                "registros_transformados": len(transformed_records),
                "ignored_rows": ignored_records,
                "ignored_count": len(ignored_records),
            }

            if return_dataframe and df is not None:
                result["dataframe"] = df

            return result

        except Exception as e:
            print(f"\n❌ ERRO NO ETL: {e}")
            import traceback
            traceback.print_exc()

            return {
                "success": False,
                "error": str(e),
                "arquivos_processados": len(file_paths)
            }

