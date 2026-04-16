"""
Pacote ETL (Extract-Transform) para processamento de extratos bancários.

Arquitetura:
- ExtratoExtractor: Extrai dados brutos de arquivos Excel do banco
- ExtratoTransformer: Transforma dados brutos (mapeamentos, conversões, limpeza)
- ExtratoETL: Orquestra Extract + Transform (Load é feito por save_extrato_records)

Benefícios:
- Separação clara de responsabilidades
- Testável independentemente
- Reutilizável
"""

from .extrato_extractor import ExtratoExtractor
from .extrato_transformer import ExtratoTransformer
from .extrato_etl import ExtratoETL

__all__ = [
    'ExtratoExtractor',
    'ExtratoTransformer',
    'ExtratoETL',
]

