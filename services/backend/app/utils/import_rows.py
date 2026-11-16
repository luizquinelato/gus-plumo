"""
Conversão DataFrame ⇄ linhas JSON para o fluxo de importação em dois momentos
(processar sem salvar → persistir as linhas já processadas).

Datas viram texto no formato brasileiro (DD/MM/YYYY HH:MM:SS), que é o formato
aceito pelos loaders (pd.to_datetime com dayfirst=True).
"""

from __future__ import annotations

import math
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable

import numpy as np
import pandas as pd


def _jsonable(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if value is pd.NaT:
        return None
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.strftime("%d/%m/%Y %H:%M:%S")
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        number = float(value)
        return None if math.isnan(number) else number
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def df_to_rows(df: pd.DataFrame | None) -> list[dict[str, Any]]:
    """Serializa o DataFrame em linhas com valores JSON (NaN → None)."""
    if df is None or df.empty:
        return []
    return [
        {str(key): _jsonable(value) for key, value in record.items()}
        for record in df.to_dict("records")
    ]


def rows_to_df(rows: Iterable[dict[str, Any]]) -> pd.DataFrame:
    """Reconstrói o DataFrame a partir das linhas recebidas do cliente."""
    return pd.DataFrame(list(rows))


SUBTAG_OVERRIDE_COLUMN = "subtag_override"


def import_tag_subtag_conflict(
    existing_subtag_id: int | None,
    new_subtag_id: int | None,
) -> bool:
    """
    Conflito de tag/subtag só quando o arquivo propõe outra classificação definida.
    Sem mapeamento, sem tag no arquivo ou “sem classificação” (new=None) mantém o que está no banco.
    """
    if new_subtag_id is None:
        return False
    if existing_subtag_id is None:
        return False
    return existing_subtag_id != new_subtag_id


def subtag_override(row: Any, valid_ids: Iterable[int]) -> tuple[bool, int | None]:
    """Classificação escolhida no wizard: (tem_override, subtag_id). 0 = sem classificação."""
    raw = row.get(SUBTAG_OVERRIDE_COLUMN) if hasattr(row, "get") else None
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return False, None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return False, None
    if value == 0:
        return True, None
    return (True, value) if value in valid_ids else (False, None)


def mapping_hint(mapping_helper: Any, descriptions: Iterable[str], tipo: str) -> dict[str, Any] | None:
    """Mapeamento que casa a descrição só no tipo oposto (receita × despesa): precisa de ajuste manual."""
    other = "receita" if tipo == "despesa" else "despesa"
    for description in descriptions:
        if not description:
            continue
        found = mapping_helper.find_mapping(description, other)
        if found and found.get("subtag_id"):
            return {
                "subtag_id": found.get("subtag_id"),
                "tag": found.get("tag"),
                "subtag": found.get("subtag"),
                "type": other,
            }
    return None


def json_safe(value: Any) -> Any:
    """Converte recursivamente estruturas de resultado (dict/list) para JSON."""
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return _jsonable(value)
