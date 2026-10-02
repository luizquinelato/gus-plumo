# -*- coding: utf-8 -*-
"""Mensagens de diagnóstico quando a importação de fatura PDF não gera lançamentos."""
from __future__ import annotations

import os
import re
from typing import Optional

from app.converters import CartaoConverter, detect_invoice_issuer
from app.utils.pdf_password import (
    PdfPasswordInvalid,
    PdfPasswordRequired,
    extract_pdf_text,
    pdf_requires_password,
)


def explain_empty_cartao_import(
    pdf_path: str,
    display_name: str,
    password: Optional[str],
    year: str,
    month: str,
    mapping_helper,
    output_dir: str,
) -> str:
    """Texto multilinha para exibir ao usuário (FastAPI detail)."""
    lines = [f"Arquivo: {display_name}"]

    try:
        if pdf_requires_password(pdf_path) and not password:
            lines.append(
                "Motivo: PDF protegido por senha e nenhuma senha foi informada."
            )
            return "\n".join(lines)
        raw = extract_pdf_text(pdf_path, password)
    except PdfPasswordRequired:
        lines.append("Motivo: este PDF exige senha. Informe a senha na importação.")
        return "\n".join(lines)
    except PdfPasswordInvalid:
        lines.append("Motivo: senha do PDF incorreta.")
        return "\n".join(lines)
    except Exception as exc:
        lines.append(f"Motivo: não foi possível abrir ou ler o PDF ({exc}).")
        return "\n".join(lines)

    if len(raw.strip()) < 150:
        lines.append(
            "Motivo: quase nenhum texto foi extraído do PDF (senha errada, "
            "arquivo só imagem ou PDF corrompido)."
        )
        return "\n".join(lines)

    processed = CartaoConverter.preprocessar_linha(raw)
    issuer = detect_invoice_issuer(raw)
    lines.append(f"Emissor detectado: {issuer if issuer != 'unknown' else 'não identificado'}")

    card_headers = re.findall(
        r"Lançamentos(?:\s+do\s+cartão|\s+com\b)[^\n]*?\bFinal\s+(\d{3,4})",
        processed,
        re.IGNORECASE,
    )
    if not card_headers:
        if "Lançamentos" not in processed and "Lançamentos com" not in processed:
            lines.append(
                "Motivo: não há blocos «Lançamentos do cartão … Final XXXX» — "
                "fatura só resumo, layout antigo ou PDF de outro banco."
            )
        else:
            lines.append(
                "Motivo: há lançamentos no texto, mas o número do cartão (Final XXXX) "
                "não foi reconhecido."
            )
        return "\n".join(lines)

    cards_unique = list(dict.fromkeys(c.zfill(4) for c in card_headers))
    lines.append(f"Cartões encontrados no PDF: {', '.join(cards_unique)}")

    try:
        df = CartaoConverter(mapping_helper).process_pdf_files(
            [pdf_path],
            output_dir,
            save_individually=False,
            save_temp_files=False,
            years=[year],
            months=[month],
            passwords=[password],
        )
        row_count = 0 if df is None else len(df)
    except Exception as exc:
        lines.append(f"Motivo: erro ao interpretar lançamentos ({exc}).")
        return "\n".join(lines)

    if row_count > 0:
        cards_in_df = sorted(
            {str(c).zfill(4) for c in df["Cartão"].dropna().unique() if str(c).strip()}
        )
        lines.append(
            f"Diagnóstico: o parser gerou {row_count} linha(s) "
            f"(cartões {', '.join(cards_in_df)}), mas a importação retornou vazio — "
            "tente reiniciar o backend ou contate o suporte."
        )
    else:
        lines.append(
            "Motivo: nenhum lançamento foi extraído pelo parser BTG "
            f"(ano/mês informados: {year}-{month}). "
            "Layouts BTG+ antigos (ex.: 2021) podem exigir ajuste; confira se ano e mês "
            "correspondem à fatura."
        )
        if "BTG+" in raw or "btg+" in raw.lower():
            lines.append(
                "Dica: fatura BTG+ detectada no texto — se o problema continuar, "
                "ative «Salvar TXT de conversão» e envie o arquivo para análise."
            )

    return "\n".join(lines)


def explain_empty_cartao_import_batch(
    file_paths: list[str],
    display_names: list[str],
    passwords: list[Optional[str]],
    years: list[str],
    months: list[str],
    mapping_helper,
    output_dir: str,
) -> str:
    chunks = []
    for i, path in enumerate(file_paths):
        name = display_names[i] if i < len(display_names) else os.path.basename(path)
        pwd = passwords[i] if i < len(passwords) else None
        year = years[i] if i < len(years) else ""
        month = months[i] if i < len(months) else ""
        chunks.append(
            explain_empty_cartao_import(
                path, name, pwd, year, month, mapping_helper, output_dir
            )
        )
    return "\n\n".join(chunks)
