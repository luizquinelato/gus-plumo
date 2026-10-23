# -*- coding: utf-8 -*-
"""Detecção e parsing do extrato de conta Itaú em PDF."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from ..utils.pdf_password import extract_pdf_text

ITAU_ISSUER = "itau"
ITAU_ISSUER_LABEL = "Itaú"

_LINE_RE = re.compile(r"^(\d{2}/\d{2}/\d{4})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})$")
_PERIOD_RE = re.compile(r"per[ií]odo de visualiza[cç][aã]o:\s*(\d{2})/(\d{2})/(\d{4})\s+at[eé]\s+(\d{2})/(\d{2})/(\d{4})", re.IGNORECASE)


def is_itau_extrato_text(text: str) -> bool:
    normalized = (text or "").lower()
    return "extrato conta / lançamentos" in normalized or (
        "extrato conta / lan" in normalized and "itau" in normalized.replace("ú", "u")
    )


def _parse_brl(value: str) -> float:
    return float(value.replace(".", "").replace(",", "."))


def parse_itau_extrato_text(text: str) -> List[Dict[str, Any]]:
    """Converte o texto do PDF em registros brutos (mesmo formato do ExtratoExtractor)."""
    records: List[Dict[str, Any]] = []
    for raw_line in (text or "").replace("\xa0", " ").splitlines():
        match = _LINE_RE.match(raw_line.strip())
        if not match:
            continue
        date_str, descricao, valor = match.groups()
        if descricao.strip().upper().startswith("SALDO DO DIA"):
            continue
        records.append(
            {
                "data_hora": datetime.strptime(date_str, "%d/%m/%Y"),
                "categoria": "Itaú",
                "transacao": "",
                "descricao": re.sub(r"\s+", " ", descricao).strip(),
                "valor": _parse_brl(valor),
            }
        )
    return records


def extract_itau_extrato_records(file_path: str, password: Optional[str] = None) -> List[Dict[str, Any]]:
    return parse_itau_extrato_text(extract_pdf_text(file_path, password))


def extract_itau_extrato_period(text: str) -> tuple[Optional[str], Optional[str]]:
    """Ano e mês finais do período do extrato (informativo)."""
    match = _PERIOD_RE.search(text or "")
    if not match:
        return None, None
    return match.group(6), match.group(5)
