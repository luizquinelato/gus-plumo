# -*- coding: utf-8 -*-
"""Detecção de emissor e parsing de faturas de cartão em PDF."""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Literal, NamedTuple, Optional

from PyPDF2 import PdfReader

from ..utils.mapping_helper import MappingHelper

logger = logging.getLogger(__name__)

InvoiceIssuer = Literal["btg", "mercadopago", "unknown"]

ISSUER_LABELS = {
    "btg": "BTG",
    "mercadopago": "Mercado Pago",
    "unknown": "Fatura",
}

VALID_INVOICE_ISSUERS = ("btg", "mercadopago")


def normalize_invoice_issuer(value: Optional[str]) -> str:
    """Normaliza o emissor da fatura para o valor persistido no banco."""
    raw = (value or "").strip().lower()
    collapsed = re.sub(r"[\s_\-]+", "", raw)
    if collapsed in ("mercadopago", "mp"):
        return "mercadopago"
    if collapsed in ("btg", "btgpactual"):
        return "btg"
    return "btg"

MONTH_ABBR = {
    1: "Jan",
    2: "Fev",
    3: "Mar",
    4: "Abr",
    5: "Mai",
    6: "Jun",
    7: "Jul",
    8: "Ago",
    9: "Set",
    10: "Out",
    11: "Nov",
    12: "Dez",
}

MONTH_NAME_TO_NUM = {
    "janeiro": 1,
    "fevereiro": 2,
    "marco": 3,
    "março": 3,
    "abril": 4,
    "maio": 5,
    "junho": 6,
    "julho": 7,
    "agosto": 8,
    "setembro": 9,
    "outubro": 10,
    "novembro": 11,
    "dezembro": 12,
}

MONTH_ABBR_TO_NUM = {
    "jan": 1,
    "fev": 2,
    "mar": 3,
    "abr": 4,
    "mai": 5,
    "jun": 6,
    "jul": 7,
    "ago": 8,
    "set": 9,
    "out": 10,
    "nov": 11,
    "dez": 12,
}

MONTH_NAMES_PATTERN = "|".join(MONTH_NAME_TO_NUM.keys())
MONTH_ABBR_PATTERN = "|".join(MONTH_ABBR_TO_NUM.keys())

_MP_TX_RE = re.compile(
    r"^(\d{1,2})/(\d{1,2})\s+(.+?)\s+R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*$",
    re.IGNORECASE,
)
_MP_CARD_RE = re.compile(
    r"Cart[aã]o\s+[A-Za-zÀ-ÿ]+\s+\[?\*+(\d{4})\]?",
    re.IGNORECASE,
)
_MP_FX_RE = re.compile(r"^BRL\b|USD\s*1\s*=|EUR\s+", re.IGNORECASE)
_MP_INVOICE_PAYMENT_REF_RE = re.compile(
    rf"^pagamento da fatura(?:\s+de\s+({MONTH_NAMES_PATTERN})(?:/(\d{{4}}))?)?",
    re.IGNORECASE,
)
_MP_CREDIT_RE = re.compile(
    r"(estorno|cancelamento|cr[eé]dito|rr[eé]dito)\b|\bconcedido\b",
    re.IGNORECASE,
)
_MP_INSTALLMENT_RE = re.compile(r"\s*Parcela\s*(\d+)\s*de\s*(\d+)\s*$", re.IGNORECASE)
_MP_SECTION_START_RE = re.compile(
    r"Detalhes de consumo|Movimenta[cç][oõ]es na fatura",
    re.IGNORECASE,
)
_MP_SECTION_END_RE = re.compile(
    r"Seu cart[aã]o de cr[eé]dito|Parcele a fatura|Compras internacionais|"
    r"Op[cç][oõ]es de pagamento",
    re.IGNORECASE,
)
_MP_EMPTY_INVOICE_RE = re.compile(
    r"n[aã]o tem gastos pendentes|Total a pagar\s*R\$\s*0,00",
    re.IGNORECASE,
)
_MP_GARBLED_CURRENCY_RE = re.compile(r"Valor em \$(?!R)", re.IGNORECASE)


def extract_pdf_text(file_path: str) -> str:
    reader = PdfReader(file_path)
    parts: List[str] = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    return "\n".join(parts)


def _normalize_pdf_text(text: str) -> str:
    normalized = (text or "").replace("\xa0", " ").replace("\u00a0", " ")
    return re.sub(r"[ \t]+", " ", normalized)


def detect_invoice_issuer(text: str) -> InvoiceIssuer:
    """Identifica se o PDF é fatura BTG ou Mercado Pago."""
    normalized = _normalize_pdf_text(text).lower()

    mp_hits = 0
    if "mercado pago" in normalized:
        mp_hits += 2
    if "cartão de crédito mercado pago" in normalized or "cartao de credito mercado pago" in normalized:
        mp_hits += 2
    if "pague sua fatura pelo app mercado pago" in normalized:
        mp_hits += 2
    if "movimentações na fatura" in normalized or "movimentacoes na fatura" in normalized:
        mp_hits += 1

    btg_hits = 0
    if "btg pactual" in normalized:
        btg_hits += 2
    if "cartão eqi" in normalized or "cartao eqi" in normalized:
        btg_hits += 2
    if "lançamentos do cartão" in normalized or "lancamentos do cartao" in normalized:
        btg_hits += 2
    if "total de compras e despesas" in normalized:
        btg_hits += 1
    if "fatura do seu cartão" in normalized or "fatura do seu cartao" in normalized:
        btg_hits += 1

    if mp_hits >= 2 and mp_hits > btg_hits:
        return "mercadopago"
    if btg_hits >= 2 and btg_hits >= mp_hits:
        return "btg"
    if mp_hits > 0 and btg_hits == 0:
        return "mercadopago"
    if btg_hits > 0 and mp_hits == 0:
        return "btg"
    return "unknown"


def _year_month_from_date(match: Optional[re.Match]) -> Optional[tuple[str, str]]:
    if not match:
        return None
    return match.group(3), match.group(2).zfill(2)


def _month_num_from_name(name: Optional[str]) -> Optional[int]:
    raw = (name or "").strip().lower()
    if not raw:
        return None
    if raw in MONTH_NAME_TO_NUM:
        return MONTH_NAME_TO_NUM[raw]
    folded = raw.replace("ç", "c").replace("ã", "a")
    if folded in MONTH_NAME_TO_NUM:
        return MONTH_NAME_TO_NUM[folded]
    return MONTH_ABBR_TO_NUM.get(folded[:3])


def _format_month(month_num: Optional[int]) -> Optional[str]:
    if not month_num or month_num < 1 or month_num > 12:
        return None
    return f"{month_num:02d}"


def _extract_btg_period(normalized: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Ano/mês e final do cartão a partir do cabeçalho BTG/EQI."""
    year: Optional[str] = None
    month: Optional[str] = None

    named_year = re.search(
        rf"fatura de\s+({MONTH_NAMES_PATTERN})\s+de\s+(20\d{{2}})",
        normalized,
        re.IGNORECASE,
    )
    named_only = re.search(
        rf"\b({MONTH_NAMES_PATTERN})\s+no valor a pagar",
        normalized,
        re.IGNORECASE,
    )
    eqi = re.search(
        rf"fatura do seu cart[aã]o(?:\s+EQI)?\s+de\s+({MONTH_NAMES_PATTERN})",
        normalized,
        re.IGNORECASE,
    )
    current_abbr = re.search(
        rf"\b({MONTH_ABBR_PATTERN})\s*-\s*Atual\b",
        normalized,
        re.IGNORECASE,
    )
    closing = re.search(
        r"Per[ií]odo de compras:.*?at[eé]\s+(\d{1,2})/(\d{1,2})",
        normalized,
        re.IGNORECASE | re.DOTALL,
    )
    due = re.search(
        r"Vencimento:\s*(\d{1,2})/(\d{1,2})(?:/(\d{4}))?",
        normalized,
        re.IGNORECASE,
    )
    year_match = re.search(r"\b(20\d{2})\b", normalized)

    if named_year:
        month = _format_month(_month_num_from_name(named_year.group(1)))
        year = named_year.group(2)
    elif named_only:
        month = _format_month(_month_num_from_name(named_only.group(1)))
    elif eqi:
        month = _format_month(_month_num_from_name(eqi.group(1)))
    elif current_abbr:
        month = _format_month(MONTH_ABBR_TO_NUM.get(current_abbr.group(1).lower()))
    elif closing:
        month = closing.group(2).zfill(2)
    elif due:
        month = due.group(2).zfill(2)
        if due.group(3):
            year = due.group(3)

    if year is None and year_match:
        year = year_match.group(1)

    card_last4: Optional[str] = None
    card_match = re.search(
        r"Lan[cç]amentos do cart[aã]o.*?Final\s+(\d{3,4})",
        normalized,
        re.IGNORECASE | re.DOTALL,
    )
    if not card_match:
        card_match = re.search(
            r"cart[aã]o final\s+(\d{3,4})",
            normalized,
            re.IGNORECASE,
        )
    if card_match:
        card_last4 = card_match.group(1).zfill(4)

    return year, month, card_last4


def extract_invoice_metadata(text: str, issuer: InvoiceIssuer) -> Dict[str, Optional[str]]:
    """Extrai ano, mês e final do cartão do texto da fatura."""
    normalized = _normalize_pdf_text(text)

    year: Optional[str] = None
    month: Optional[str] = None
    card_last4: Optional[str] = None

    if issuer == "mercadopago":
        named = re.search(
            rf"fatura de\s+({MONTH_NAMES_PATTERN})\b",
            normalized,
            re.IGNORECASE,
        )
        closing = re.search(
            r"Fechamento da fatura\s+(\d{1,2})/(\d{1,2})/(\d{4})",
            normalized,
            re.IGNORECASE,
        )
        due = re.search(
            r"(?:Vencimento:|Vence em)\s*(\d{1,2})/(\d{1,2})/(\d{4})",
            normalized,
            re.IGNORECASE,
        )
        issued = re.search(
            r"Emitida em:\s*(\d{1,2})/(\d{1,2})/(\d{4})",
            normalized,
            re.IGNORECASE,
        )

        if named:
            month = _format_month(_month_num_from_name(named.group(1)))

        for candidate in (closing, due, issued):
            parsed = _year_month_from_date(candidate)
            if not parsed:
                continue
            cand_year, cand_month = parsed
            if month is None:
                month = cand_month
            if year is None and cand_month == month:
                year = cand_year
            elif year is None:
                year = cand_year

        card_match = _MP_CARD_RE.search(normalized)
        if card_match:
            card_last4 = card_match.group(1)

    elif issuer == "btg":
        year, month, card_last4 = _extract_btg_period(normalized)

    return {
        "year": year,
        "month": month,
        "card_last4": card_last4,
        "issuer_label": ISSUER_LABELS.get(issuer, ISSUER_LABELS["unknown"]),
    }


def inspect_invoice_pdf(file_path: str) -> Dict[str, Optional[str]]:
    text = extract_pdf_text(file_path)
    issuer = detect_invoice_issuer(text)
    metadata = extract_invoice_metadata(text, issuer)
    if issuer == "unknown":
        btg_year, btg_month, btg_card = _extract_btg_period(_normalize_pdf_text(text))
        if btg_year and btg_month:
            issuer = "btg"
            metadata = {
                "year": btg_year,
                "month": btg_month,
                "card_last4": btg_card,
                "issuer_label": ISSUER_LABELS["btg"],
            }
    logger.info(
        "Fatura PDF identificada: issuer=%s year=%s month=%s card=%s",
        issuer,
        metadata.get("year"),
        metadata.get("month"),
        metadata.get("card_last4"),
    )
    return {"issuer": issuer, **metadata}


def _parse_brl_amount(value_str: str) -> float:
    cleaned = value_str.replace(" ", "").replace(".", "").replace(",", ".")
    return float(cleaned)


def _classify_invoice_payment(
    description: str,
    invoice_year: str,
    invoice_month: str,
) -> Optional[str]:
    """
    Classifica pagamento de fatura nas movimentações.

    Abril/2025 tem o caso raro de pagamento da própria fatura no mesmo ciclo:
      20/03 Pagamento da fatura de março/2025
      16/04 Pagamento da fatura de abril/2025
    """
    match = _MP_INVOICE_PAYMENT_REF_RE.match(description.strip())
    if not match:
        return None

    month_name = (match.group(1) or "").lower()
    year = match.group(2)
    if not month_name:
        return "previous"

    paid_month = f"{MONTH_NAME_TO_NUM[month_name]:02d}"
    paid_year = year or invoice_year
    if paid_year == str(invoice_year) and paid_month == str(invoice_month).zfill(2):
        return "same_month"
    return "previous"


def _is_credit(description: str) -> bool:
    return bool(_MP_CREDIT_RE.search(description.strip()))


def _description_is_garbled(description: str) -> bool:
    """Detecta comerciante ilegível por ToUnicode quebrado do PDF do Mercado Pago."""
    if "$" in description or "%" in description:
        return True
    stripped = description.lstrip()
    if stripped[:1] in "êõóàáíÊÕÓ":
        return True
    lowered = stripped.lower()
    if lowered.startswith("rrédito") or lowered.startswith("rredito"):
        return True
    letters = [c for c in description if c.isalpha()]
    if not letters:
        return False
    unusual = sum(1 for c in letters if c in "êõí" or ord(c) > 255)
    return unusual / len(letters) >= 0.2


def _normalize_mp_description(description: str) -> str:
    description = re.sub(
        r"Parcela\s*(\d+)\s*de\s*(\d+)",
        r"Parcela \1 de \2",
        description,
        flags=re.IGNORECASE,
    )
    match = _MP_INSTALLMENT_RE.search(description)
    if match:
        description = _MP_INSTALLMENT_RE.sub(
            f" ({match.group(1)}/{match.group(2)})",
            description,
        )
    return description.strip()


def _extract_movements_section(text: str) -> str:
    start = _MP_SECTION_START_RE.search(text)
    if not start:
        return text
    rest = text[start.start() :]
    end = _MP_SECTION_END_RE.search(rest[40:])
    if end:
        return rest[: 40 + end.start()]
    return rest


def _prepare_mp_text(text: str) -> str:
    section = _extract_movements_section(_normalize_pdf_text(text))
    section = re.sub(r"\$M\b", "R$", section)
    section = re.sub(r"\$9\b", "R$", section)
    # PDFs até mai/2026 colam a data na descrição: 22/04Pagamento
    section = re.sub(r"(?<!\d)(\d{1,2}/\d{1,2})(?=[^\d\s/])", r"\1 ", section)
    return section


def _is_empty_mp_invoice(text: str, payments_skipped: int, row_count: int) -> bool:
    if row_count:
        return False
    if payments_skipped > 0:
        return True
    return bool(_MP_EMPTY_INVOICE_RE.search(text))


def _mp_text_looks_garbled(text: str) -> bool:
    return bool(_MP_GARBLED_CURRENCY_RE.search(text) or "$M" in text or re.search(r"Valor em \$9", text))


_OCR_ENGINE = None


def _get_ocr_engine():
    global _OCR_ENGINE
    if _OCR_ENGINE is None:
        from rapidocr_onnxruntime import RapidOCR

        _OCR_ENGINE = RapidOCR()
    return _OCR_ENGINE


def _ocr_items_to_lines(result, y_tol: float = 16) -> List[str]:
    rows = []
    for item in result or []:
        box, text, _score = item[0], item[1], item[2]
        xs = [point[0] for point in box]
        ys = [point[1] for point in box]
        rows.append((sum(ys) / 4, min(xs), text))
    rows.sort()
    lines: List[str] = []
    current_y = None
    current: List[tuple] = []
    for y, x, text in rows:
        if current_y is None or abs(y - current_y) <= y_tol:
            current.append((x, text))
            if current_y is None:
                current_y = y
            continue
        current.sort()
        lines.append(" ".join(part for _, part in current))
        current = [(x, text)]
        current_y = y
    if current:
        current.sort()
        lines.append(" ".join(part for _, part in current))
    return lines


def extract_mp_ocr_text(file_path: str) -> str:
    """Reconstrói o texto da fatura Mercado Pago via OCR quando o ToUnicode está quebrado."""
    try:
        import pymupdf
    except ImportError:
        logger.warning("pymupdf não instalado; OCR da fatura Mercado Pago indisponível")
        return ""

    try:
        engine = _get_ocr_engine()
    except Exception:
        logger.exception("Falha ao iniciar o OCR da fatura Mercado Pago")
        return ""

    doc = pymupdf.open(file_path)
    parts: List[str] = []
    try:
        for page in doc:
            raw = page.get_text() or ""
            if not re.search(r"Detalhes de consumo", raw, re.IGNORECASE):
                continue
            pix = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
            result, _elapsed = engine(pix.tobytes("png"))
            parts.extend(_ocr_items_to_lines(result))
    finally:
        doc.close()

    if not parts:
        logger.warning("OCR da fatura Mercado Pago não encontrou a página de movimentações")
    return "\n".join(parts)


class MercadoPagoParseResult(NamedTuple):
    rows: List[Dict[str, Any]]
    empty_invoice: bool
    garbled: bool
    card_last4: Optional[str] = None


def _build_row(
    mapping: MappingHelper,
    year: str,
    month: str,
    card_number: str,
    data_lancamento: str,
    descricao: str,
    valor: float,
) -> Dict[str, Any]:
    descricao_simples = re.sub(r"\s*\(.*?\)", "", descricao).strip()
    tag = mapping.get_mapped_tag(None, None, descricao_simples, valor, 2)
    return {
        "Ano": year,
        "Mês": month,
        "Cartão": card_number,
        "Titular": mapping.get_mapped_credit_card_owner(card_number),
        "Data": data_lancamento,
        "Descrição": mapping.get_mapped_description(descricao),
        "Descrição Limpa": mapping.get_mapped_description(descricao_simples),
        "Valor": valor,
        "Tag": tag,
        "Subtag": mapping.get_mapped_subtag(descricao_simples, tag),
        "Emissor": "mercadopago",
    }


def parse_mercadopago_invoice(
    text: str,
    year: str,
    month: str,
    mapping: Optional[MappingHelper] = None,
    pdf_path: Optional[str] = None,
) -> MercadoPagoParseResult:
    """
    Extrai lançamentos da fatura Mercado Pago.

    Formato observado (jun/2026+):
      Cartão Visa [************8483]
      24/07 MERCADOLIVRE*MERCADOLIVRE R$ 74,98

    Formato anterior (até mai/2026): mesma linha, sem espaço após a data:
      22/04Pagamento da fatura de abril/2026 R$ 299,00

    Pagamentos de fatura (mês anterior ou do próprio mês, como em abril/2025)
    não são importados como lançamentos.

    PDFs com ToUnicode quebrado são reconstruídos por OCR da página de movimentações.
    """
    mapping = mapping or MappingHelper()
    rows: List[Dict[str, Any]] = []
    pending: List[Dict[str, Any]] = []
    card_number: Optional[str] = None
    payments_skipped = 0
    garbled_skipped = 0

    original_text = text
    looks_garbled_pdf = _mp_text_looks_garbled(text)
    if looks_garbled_pdf and pdf_path:
        ocr_text = extract_mp_ocr_text(pdf_path)
        if ocr_text.strip():
            logger.info("Fatura Mercado Pago: texto reconstruído via OCR (%s chars)", len(ocr_text))
            text = ocr_text
            looks_garbled_pdf = False

    fallback_card = None
    card_match_full = _MP_CARD_RE.search(_normalize_pdf_text(original_text))
    if not card_match_full:
        card_match_full = _MP_CARD_RE.search(_normalize_pdf_text(text))
    if card_match_full:
        fallback_card = card_match_full.group(1)

    prepared = _prepare_mp_text(text)

    for raw_line in prepared.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        card_match = _MP_CARD_RE.search(line)
        if card_match:
            card_number = card_match.group(1)
            if pending:
                for item in pending:
                    item["Cartão"] = card_number
                    item["Titular"] = mapping.get_mapped_credit_card_owner(card_number)
                    rows.append(item)
                pending = []
            continue

        if _MP_FX_RE.search(line) or re.match(r"^Total\s+R\$", line, re.IGNORECASE):
            continue

        tx_match = _MP_TX_RE.match(line)
        if not tx_match:
            continue

        day, month_num, descricao, valor_str = tx_match.groups()
        descricao = _normalize_mp_description(descricao)
        payment_kind = _classify_invoice_payment(descricao, year, month)
        if payment_kind == "same_month":
            payments_skipped += 1
            logger.info("Ignorando pagamento da própria fatura: %s", descricao)
            continue
        if payment_kind:
            payments_skipped += 1
            logger.info("Ignorando pagamento de fatura anterior: %s", descricao)
            continue

        if _description_is_garbled(descricao):
            garbled_skipped += 1
            logger.warning("Ignorando lançamento com texto ilegível: %s", descricao)
            continue

        month_int = int(month_num)
        day_int = int(day)
        if month_int < 1 or month_int > 12 or day_int < 1 or day_int > 31:
            continue

        valor = _parse_brl_amount(valor_str)
        if _is_credit(descricao):
            valor = -abs(valor)

        data_lancamento = f"{day_int} {MONTH_ABBR[month_int]}"
        assigned_card = card_number or fallback_card or ""
        row = _build_row(
            mapping=mapping,
            year=year,
            month=month.zfill(2),
            card_number=assigned_card,
            data_lancamento=data_lancamento,
            descricao=descricao,
            valor=valor,
        )

        if assigned_card:
            rows.append(row)
        else:
            pending.append(row)

    resolved_card = card_number or fallback_card
    if pending and resolved_card:
        for item in pending:
            item["Cartão"] = resolved_card
            item["Titular"] = mapping.get_mapped_credit_card_owner(resolved_card)
            rows.append(item)
        pending = []
    elif pending:
        logger.warning("Lançamentos Mercado Pago sem cartão identificado: %s", len(pending))

    empty_invoice = _is_empty_mp_invoice(text, payments_skipped, len(rows))
    garbled = looks_garbled_pdf and not rows and not empty_invoice

    logger.info(
        "Fatura Mercado Pago: %s lançamentos extraídos (pagamentos ignorados=%s, ilegíveis=%s)",
        len(rows),
        payments_skipped,
        garbled_skipped,
    )
    return MercadoPagoParseResult(
        rows=rows,
        empty_invoice=empty_invoice,
        garbled=garbled,
        card_last4=resolved_card,
    )
