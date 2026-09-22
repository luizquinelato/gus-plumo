import re
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional, Tuple

from PyPDF2 import PdfReader


PayrollDocType = Literal["payslip", "income_report"]
PayslipFormat = Literal["br_official", "adp"]

MONTH_MAP = {
    "janeiro": 1,
    "fevereiro": 2,
    "março": 3,
    "marco": 3,
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

MONTH_NAMES = {
    1: "Janeiro",
    2: "Fevereiro",
    3: "Março",
    4: "Abril",
    5: "Maio",
    6: "Junho",
    7: "Julho",
    8: "Agosto",
    9: "Setembro",
    10: "Outubro",
    11: "Novembro",
    12: "Dezembro",
}


def extract_pdf_text(file_path: str) -> str:
    reader = PdfReader(file_path)
    parts: List[str] = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    return "\n".join(parts)


def _normalize_pdf_text(text: str) -> str:
    normalized = (text or "").replace("\xa0", " ")
    normalized = normalized.replace("\u00a0", " ")
    return re.sub(r"[ \t]+", " ", normalized)


def _split_pdf_lines(text: str) -> List[str]:
    return [ln.strip() for ln in _normalize_pdf_text(text).splitlines() if ln.strip()]


def detect_payslip_format(text: str) -> PayslipFormat:
    """
    br_official: demonstrativo portal BR (layout com 'Processado pela ADP' / colunas com |).
    adp: export nativo do sistema ADP (ex.: 2026-02-Mensal.pdf), sem o rodapé clássico.
    """
    normalized = _normalize_pdf_text(text).lower()
    if "processado pela adp" in normalized:
        return "br_official"
    if re.search(r"\d{4}\s+.+\|.+\|", text or ""):
        return "br_official"
    return "adp"


def classify_payroll_pdf(text: str) -> PayrollDocType:
    normalized = _normalize_pdf_text(text).lower()
    if "demonstrativo de pagamento" in normalized:
        return "payslip"
    if "comprovante de rendimentos pagos" in normalized or "imposto sobre a renda retido na fonte" in normalized:
        return "income_report"
    raise ValueError("Tipo de PDF não reconhecido (holerite/informe)")


def _parse_brl_number(raw: str | None) -> Decimal | None:
    if not raw:
        return None
    clean = raw.replace(".", "").replace(",", ".").strip()
    try:
        return Decimal(clean)
    except Exception:
        return None


def _extract_cnpj(raw: str | None) -> Optional[str]:
    if not raw:
        return None
    formatted = re.search(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}", raw)
    if formatted:
        return formatted.group(0)
    digits = re.match(r"^(\d{14})", raw.strip())
    return digits.group(1) if digits else None


def _extract_cpf(raw: str | None) -> Optional[str]:
    if not raw:
        return None
    formatted = re.search(r"\d{3}\.\d{3}\.\d{3}-\d{2}", raw)
    if formatted:
        return formatted.group(0)
    digits = re.match(r"^(\d{11})", raw.strip())
    return digits.group(1) if digits else None


_BRL_AMOUNT_PATTERN = r"\d{1,3}(?:\.\d{3})*,\d{2}"
_INCOME_ITEM_START_RE = re.compile(r"^(\d+)\.(?!\d)\s*(.+)$")
_INCOME_AMOUNT_SUFFIX_RE = re.compile(rf"^(.+?)\s+({_BRL_AMOUNT_PATTERN})$")
_INCOME_GROUP_RE = re.compile(r"^(\d+)-\s+(.+)$")
_INCOME_CONTINUATION_TAIL_WORDS = {
    "a",
    "o",
    "e",
    "ou",
    "de",
    "da",
    "do",
    "das",
    "dos",
    "por",
    "programa",
    "função",
    "funcao",
}


def _split_income_amount_suffix(line: str) -> Tuple[Optional[str], Optional[Decimal]]:
    match = _INCOME_AMOUNT_SUFFIX_RE.match(line.strip())
    if not match:
        return None, None
    return match.group(1).strip(), _parse_brl_number(match.group(2))


def _is_income_description_continuation(pending_desc: str, continuation: str) -> bool:
    cont = continuation.strip()
    if not cont:
        return True
    if cont[0].islower():
        return True

    words = pending_desc.rstrip().split()
    tail = words[-1].lower().rstrip(".,;:") if words else ""
    if tail in _INCOME_CONTINUATION_TAIL_WORDS:
        return True
    if pending_desc.rstrip().endswith(("(", "-", "/")):
        return True
    return False


def _append_income_line_item(
    line_items: List[Dict[str, Any]],
    *,
    group_name: str,
    item_no: Optional[str],
    description: str,
    amount: Optional[Decimal],
) -> None:
    line_items.append(
        {
            "group_name": group_name,
            "item_no": item_no,
            "description": description.strip(),
            "amount": amount,
        }
    )


def _parse_income_report_line_items(lines: List[str]) -> List[Dict[str, Any]]:
    line_items: List[Dict[str, Any]] = []
    current_group: Optional[str] = None
    pending: Optional[Dict[str, Any]] = None

    def flush_pending(*, with_amount_only: bool = False) -> None:
        nonlocal pending
        if not pending:
            return
        if with_amount_only and pending.get("amount") is None:
            _append_income_line_item(
                line_items,
                group_name=pending["group_name"],
                item_no=pending["item_no"],
                description=pending["description"],
                amount=None,
            )
        elif pending.get("amount") is not None or not with_amount_only:
            _append_income_line_item(
                line_items,
                group_name=pending["group_name"],
                item_no=pending["item_no"],
                description=pending["description"],
                amount=pending.get("amount"),
            )
        pending = None

    for ln in lines:
        group_match = _INCOME_GROUP_RE.match(ln)
        if group_match:
            flush_pending()
            current_group = f"{group_match.group(1)} - {group_match.group(2)}"
            continue

        if not current_group:
            continue

        item_start = _INCOME_ITEM_START_RE.match(ln)
        if item_start:
            flush_pending()
            item_no = item_start.group(1)
            rest = item_start.group(2).strip()
            desc_part, amount = _split_income_amount_suffix(rest)
            if amount is not None and desc_part is not None:
                _append_income_line_item(
                    line_items,
                    group_name=current_group,
                    item_no=item_no,
                    description=desc_part,
                    amount=amount,
                )
            else:
                pending = {
                    "group_name": current_group,
                    "item_no": item_no,
                    "description": rest,
                    "amount": None,
                }
            continue

        if pending:
            desc_part, amount = _split_income_amount_suffix(ln)
            if amount is not None and desc_part is not None:
                if _is_income_description_continuation(pending["description"], desc_part):
                    pending["description"] = f"{pending['description']} {desc_part}".strip()
                    pending["amount"] = amount
                    flush_pending()
                else:
                    flush_pending(with_amount_only=True)
                    _append_income_line_item(
                        line_items,
                        group_name=current_group,
                        item_no=None,
                        description=desc_part,
                        amount=amount,
                    )
            else:
                pending["description"] = f"{pending['description']} {ln}".strip()
            continue

        desc_part, amount = _split_income_amount_suffix(ln)
        if amount is not None and desc_part is not None:
            _append_income_line_item(
                line_items,
                group_name=current_group,
                item_no=None,
                description=desc_part,
                amount=amount,
            )

    flush_pending()
    return line_items


def normalize_line_description(text: str) -> str:
    normalized = re.sub(r"\s+", " ", (text or "").strip().lower())
    return normalized


ADVANCE_LINE_CODE = "2820"
FINAL_ADVANCE_DEDUCTION_LINE_CODE = "2821"
PROFIT_SHARE_LINE_CODE = "0040"
ACCOUNT_SECTIONS = frozenset({"entries_deductions", "entries", "deductions"})


def is_account_section(section: str | None) -> bool:
    return (section or "") in ACCOUNT_SECTIONS


def _line_code_of(line: Any) -> str:
    if isinstance(line, dict):
        return str(line.get("line_code") or "").strip()
    return str(getattr(line, "line_code", None) or "").strip()


def is_advance_transfer_line(line: Any, *, has_final: bool) -> bool:
    """2821 is the advance already paid; 2820 is the advance earning (skip when the month sheet exists)."""
    code = _line_code_of(line)
    if code == FINAL_ADVANCE_DEDUCTION_LINE_CODE:
        return True
    return has_final and code == ADVANCE_LINE_CODE


def compute_account_section_totals(line_items: List[Dict[str, Any]]) -> Dict[str, Optional[Decimal]]:
    account_lines = [line for line in line_items if is_account_section(line.get("section"))]
    earnings = sum((line.get("earnings_amount") or Decimal(0)) for line in account_lines)
    deductions = sum((line.get("deduction_amount") or Decimal(0)) for line in account_lines)
    if not earnings and not deductions:
        return {"gross_earnings": None, "total_deductions": None, "net_amount": None}
    return {
        "gross_earnings": earnings,
        "total_deductions": deductions,
        "net_amount": earnings - deductions,
    }


def infer_period_from_filename(filename: str) -> Tuple[Optional[int], Optional[int], Optional[str]]:
    monthly_match = re.search(r"(\d{4})-Monthly-(\d{2})", filename, re.IGNORECASE)
    if monthly_match:
        year = int(monthly_match.group(1))
        month = int(monthly_match.group(2))
        label = f"{MONTH_NAMES.get(month, str(month))} {year}"
        return year, month, label

    profit_match = re.search(r"(\d{4})-ProfitShare-(\d{2})", filename, re.IGNORECASE)
    if profit_match:
        year = int(profit_match.group(1))
        month = int(profit_match.group(2))
        label = f"PLR {MONTH_NAMES.get(month, str(month))} {year}"
        return year, month, label

    advance_match = re.search(
        r"(\d{4})-(?:Advance(?:Payment)?)-(\d{2})",
        filename,
        re.IGNORECASE,
    )
    if advance_match:
        year = int(advance_match.group(1))
        month = int(advance_match.group(2))
        label = f"{MONTH_NAMES.get(month, str(month))} {year}"
        return year, month, label

    # Formato ADP nativo: 2026-02-Mensal.pdf / 2026-01-Adiantamento.pdf / 2026-03-Distribuicao.pdf
    adp_native = re.search(
        r"(\d{4})-(\d{2})-(Mensal|Adiantamento|Distribui[cç][aã]o|Distribuicao)",
        filename,
        re.IGNORECASE,
    )
    if adp_native:
        year = int(adp_native.group(1))
        month = int(adp_native.group(2))
        kind = adp_native.group(3).lower()
        if "distribui" in kind:
            label = f"PLR {MONTH_NAMES.get(month, str(month))} {year}"
        else:
            label = f"{MONTH_NAMES.get(month, str(month))} {year}"
        return year, month, label

    return None, None, None


def detect_payslip_kind(line_items: List[Dict[str, Any]]) -> str:
    for line in line_items:
        code = (line.get("line_code") or "").strip()
        if code == FINAL_ADVANCE_DEDUCTION_LINE_CODE and line.get("deduction_amount"):
            return "final"
    for line in line_items:
        code = (line.get("line_code") or "").strip()
        if code == ADVANCE_LINE_CODE and line.get("earnings_amount"):
            return "advance"
    for line in line_items:
        code = (line.get("line_code") or "").strip()
        if code == PROFIT_SHARE_LINE_CODE and line.get("earnings_amount"):
            return "profit_share"
    return "regular"


def payslip_kind_family(kind: str | None) -> str:
    """salary = adiantamento/folha; profit_share = participação nos lucros."""
    if (kind or "").strip() == "profit_share":
        return "profit_share"
    return "salary"


def _apply_reference(payload: Dict[str, Any], reference_label: str) -> None:
    payload["reference_label"] = reference_label.strip()
    parts = payload["reference_label"].split()
    if len(parts) >= 2 and parts[-1].isdigit():
        payload["year"] = int(parts[-1])
        payload["month"] = MONTH_MAP.get(parts[0].lower())


def _parse_reference(lines: List[str], full_text: str) -> Optional[str]:
    month_pattern = r"(Janeiro|Fevereiro|Mar[cç]o|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s+(\d{4})"

    ref_idx = next(
        (
            i
            for i, line in enumerate(lines)
            if "REFER" in line.upper() and ("SAL" in line.upper() or "SALÁRIO" in line.upper() or "SALARIO" in line.upper())
        ),
        None,
    )
    if ref_idx is not None:
        for candidate in lines[ref_idx : ref_idx + 4]:
            match = re.search(month_pattern, candidate, re.IGNORECASE)
            if match:
                return f"{match.group(1).capitalize()} {match.group(2)}"

    inline_match = re.search(
        rf"REFER[EÊ]NCIA[^\n]{{0,40}}{month_pattern}",
        full_text,
        re.IGNORECASE,
    )
    if inline_match:
        return f"{inline_match.group(1).capitalize()} {inline_match.group(2)}"

    anywhere_match = re.search(month_pattern, full_text, re.IGNORECASE)
    if anywhere_match:
        return f"{anywhere_match.group(1).capitalize()} {anywhere_match.group(2)}"

    return None


ROLE_KEYWORDS = (
    "ANALISTA",
    "ENGENHEIRO",
    "GERENTE",
    "COORDENADOR",
    "DIRETOR",
    "ASSISTENTE",
    "ESPECIALISTA",
    "CONSULTOR",
    "TECNICO",
    "TÉCNICO",
    "AUXILIAR",
    "SUPERVISOR",
    "ADMINISTRADOR",
    "SCRUM",
)


def _split_name_and_role(words: List[str]) -> tuple[Optional[str], Optional[str]]:
    role_start = next((index for index, word in enumerate(words) if word.startswith(ROLE_KEYWORDS)), None)
    if role_start is None or role_start == 0:
        return (" ".join(words).strip() or None), None
    name = " ".join(words[:role_start]).strip() or None
    role = " ".join(words[role_start:]).strip() or None
    return name, role


def _parse_employee(lines: List[str]) -> Dict[str, Optional[str]]:
    result: Dict[str, Optional[str]] = {
        "employee_registration": None,
        "employee_name": None,
        "employee_role": None,
    }

    employee_idx = next((i for i, line in enumerate(lines) if "ESTAB MATR" in line.upper() and "NOME" in line.upper()), None)
    if employee_idx is None or employee_idx + 1 >= len(lines):
        return result

    emp_line = lines[employee_idx + 1]
    adp_match = re.match(r"^\d{3}([A-Z0-9]+)\s+(.+)\s+(\d{4})$", emp_line)
    if adp_match:
        result["employee_registration"] = adp_match.group(1).strip()
        name, role = _split_name_and_role(adp_match.group(2).strip().split())
        result["employee_name"] = name
        result["employee_role"] = role
        return result

    patterns = [
        r"^\d+\s+([A-Z0-9]+)\s+(.+?)\s{2,}([A-ZÁÉÍÓÚÂÊÔ].+?)\s+\d+\s+\d+$",
        r"^\d+\s+([A-Z0-9]+)\s+(.+?)\s+([A-ZÁÉÍÓÚÂÊÔ][A-ZÁÉÍÓÚÂÊÔ\s\.]+)$",
        r"^([A-Z0-9]+)\s+(.+?)\s{2,}(.+)$",
    ]
    for pattern in patterns:
        match = re.match(pattern, emp_line)
        if match:
            result["employee_registration"] = match.group(1).strip()
            result["employee_name"] = match.group(2).strip()
            result["employee_role"] = match.group(3).strip()
            break

    return result


def _parse_totals(lines: List[str]) -> Dict[str, Optional[Decimal]]:
    totals: Dict[str, Optional[Decimal]] = {
        "gross_earnings": None,
        "total_deductions": None,
        "net_amount": None,
    }

    totals_idx = next((i for i, line in enumerate(lines) if re.match(r"^T\s+O\s+T\s+A\s+I\s+S", line.upper())), None)
    if totals_idx is None:
        totals_idx = next((i for i, line in enumerate(lines) if re.match(r"^TOTAIS\b", line.upper())), None)
    if totals_idx is None:
        return totals

    search_chunks = [lines[totals_idx]]
    if totals_idx + 1 < len(lines):
        search_chunks.append(lines[totals_idx + 1])

    values = re.findall(r"(\d{1,3}(?:\.\d{3})*,\d{2})", " ".join(search_chunks))
    if len(values) >= 3:
        totals["gross_earnings"] = _parse_brl_number(values[0])
        totals["total_deductions"] = _parse_brl_number(values[1])
        totals["net_amount"] = _parse_brl_number(values[2])

    return totals


def _is_canonical_brl_amount(raw: str) -> bool:
    if not re.fullmatch(_BRL_AMOUNT_PATTERN, raw or ""):
        return False
    integer_part = raw.split(",", 1)[0].split(".", 1)[0]
    if len(integer_part) > 1 and integer_part.startswith("0"):
        return False
    return True


def _split_adp_desc_qty_amount(rest: str) -> Tuple[Optional[str], Optional[Decimal], Optional[Decimal]]:
    """
    Separa descrição, quantidade (opcional) e valor no layout ADP nativo.
    Exemplos:
      'Salário Base 20019.182,73' → qty 200, amount 19.182,73
      'Aux.Creche menor 6 anos 1337,19' → qty 1, amount 337,19
      'Adiant Quinzenal 7.673,09' → amount only
      'Inss Empregador 20 3.836,55' → qty 20, amount 3.836,55
    """
    text = (rest or "").strip()
    if not text:
        return None, None, None

    spaced = re.match(rf"^(.+?)\s+(\d{{1,3}})\s+({_BRL_AMOUNT_PATTERN})$", text)
    if spaced and _is_canonical_brl_amount(spaced.group(3)):
        return spaced.group(1).strip(), Decimal(spaced.group(2)), _parse_brl_number(spaced.group(3))

    best: Optional[Tuple[int, Optional[str], Optional[Decimal], Optional[Decimal]]] = None
    for index in range(len(text)):
        candidate = text[index:]
        if not _is_canonical_brl_amount(candidate):
            continue

        prefix = text[:index]
        amount = _parse_brl_number(candidate)
        description: Optional[str]
        quantity: Optional[Decimal]

        if prefix == "" or prefix.endswith(" "):
            description = prefix.strip() or None
            quantity = None
        else:
            qty_match = re.match(r"^(.*?)(\d{1,3})$", prefix)
            if qty_match and qty_match.group(1).strip():
                description = qty_match.group(1).strip()
                quantity = Decimal(qty_match.group(2))
            elif re.fullmatch(r"\d{1,3}", prefix):
                description = None
                quantity = Decimal(prefix)
            else:
                description = prefix.strip()
                quantity = None

        score = len(candidate)
        if best is None or score > best[0]:
            best = (score, description, quantity, amount)

    if best is None:
        return None, None, None
    return best[1], best[2], best[3]


def _adp_line_is_earning(code: str) -> bool:
    """Heurística para coluna única do ADP: vencimento vs desconto."""
    code = (code or "").strip()
    if code == ADVANCE_LINE_CODE:
        return True
    if code == FINAL_ADVANCE_DEDUCTION_LINE_CODE:
        return False
    if code.startswith(("35", "55", "56")):
        return False
    if code.startswith(("00", "01", "02", "03", "04", "05", "06", "07", "08", "09")):
        return True
    return False


def _empty_payslip_payload() -> Dict[str, Any]:
    return {
        "employee_registration": None,
        "employee_name": None,
        "employee_role": None,
        "employer_cnpj": None,
        "employer_name": None,
        "reference_label": None,
        "year": None,
        "month": None,
        "payment_date": None,
        "gross_earnings": None,
        "total_deductions": None,
        "net_amount": None,
        "line_items": [],
        "source_provider": None,
    }


def _finalize_payslip_period(payload: Dict[str, Any], source_filename: Optional[str]) -> Dict[str, Any]:
    if (not payload.get("year") or not payload.get("month")) and payload.get("payment_date"):
        payload["year"] = payload["payment_date"].year
        payload["month"] = payload["payment_date"].month
        if not payload.get("reference_label"):
            _apply_reference(
                payload,
                f"{MONTH_NAMES.get(payload['month'], str(payload['month']))} {payload['year']}",
            )

    if (not payload.get("year") or not payload.get("month")) and source_filename:
        year, month, label = infer_period_from_filename(source_filename)
        if year and month:
            payload["year"] = year
            payload["month"] = month
            if not payload.get("reference_label"):
                payload["reference_label"] = label

    if not payload.get("gross_earnings") and payload["line_items"]:
        payload.update(compute_account_section_totals(payload["line_items"]))

    return payload


def _parse_payslip_br_official(text: str, source_filename: Optional[str] = None) -> Dict[str, Any]:
    normalized_text = _normalize_pdf_text(text)
    lines = _split_pdf_lines(text)
    payload = _empty_payslip_payload()
    payload["source_provider"] = "br_official"

    employer_idx = next((i for i, line in enumerate(lines) if "ESTABELECIMENTO C.N.P.J" in line.upper()), None)
    if employer_idx is not None and employer_idx + 1 < len(lines):
        match = re.match(r"^(.*?)\s+(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})", lines[employer_idx + 1])
        if match:
            payload["employer_name"] = match.group(1).strip()
            payload["employer_cnpj"] = match.group(2)

    payload.update(_parse_employee(lines))

    reference_label = _parse_reference(lines, normalized_text)
    if reference_label:
        _apply_reference(payload, reference_label)

    pay_line = next((line for line in lines if "DATA DE PAGAMENTO" in line.upper()), None)
    if pay_line:
        match = re.search(r"(\d{2}/\d{2}/\d{4})", pay_line)
        if match:
            payload["payment_date"] = datetime.strptime(match.group(1), "%d/%m/%Y").date()

    payload.update(_parse_totals(lines))

    in_table = False
    section = "entries_deductions"
    for ln in lines:
        upper = ln.upper()
        if "CONTA QTDE" in upper and "VENCIMENTOS" in upper and "DESCONTOS" in upper:
            in_table = True
            continue
        if in_table and "BASE/OUTROS" in upper:
            section = "base_values"
            continue
        if in_table and upper.startswith("VENCIMENTOS DESCONTOS"):
            break
        if not in_table:
            continue

        match = re.match(
            r"^(\d{4})\s+(.+?)\s+\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)$",
            ln,
        )
        if not match:
            continue
        code, desc, qty_raw, earn_raw, ded_raw = match.groups()
        earnings_amount = _parse_brl_number(earn_raw.strip() or None)
        deduction_amount = _parse_brl_number(ded_raw.strip() or None)
        base_amount = _parse_brl_number(ded_raw.strip() or None) if section == "base_values" else None

        payload["line_items"].append(
            {
                "section": section,
                "line_code": code.strip(),
                "description": desc.strip(),
                "quantity": _parse_brl_number(qty_raw.strip() or None),
                "earnings_amount": earnings_amount,
                "deduction_amount": deduction_amount,
                "base_amount": base_amount,
            }
        )

    return _finalize_payslip_period(payload, source_filename)


def _parse_payslip_adp(text: str, source_filename: Optional[str] = None) -> Dict[str, Any]:
    lines = _split_pdf_lines(text)
    payload = _empty_payslip_payload()
    payload["source_provider"] = "adp"

    month_alt = r"janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro"

    for ln in lines:
        cnpj_match = re.search(r"(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})", ln)
        if cnpj_match and not payload.get("employer_cnpj"):
            payload["employer_cnpj"] = cnpj_match.group(1)
            name_part = ln[: cnpj_match.start()].strip()
            name_part = re.sub(
                r"^(?:DATA DE PAGAMENTO\s*)?SAL[AÁ]RIO",
                "",
                name_part,
                flags=re.IGNORECASE,
            ).strip()
            if name_part:
                payload["employer_name"] = name_part

        role_match = re.match(r"^(\d{3})(\d{5})(.+?)\s+(\d+)(?:\s+(\d+))?$", ln)
        if role_match and not payload.get("employee_role"):
            role_text = role_match.group(3).strip()
            if any(role_text.upper().startswith(k) for k in ROLE_KEYWORDS) or "MASTER" in role_text.upper():
                payload["employee_role"] = role_text

        name_match = re.match(r"^([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç\s\.]+?)\s+(\d{5,})$", ln)
        if name_match and not payload.get("employee_name"):
            payload["employee_name"] = name_match.group(1).strip()
            payload["employee_registration"] = name_match.group(2).strip()

        ref_match = re.search(rf"(\d{{1,2}})/({month_alt})/(\d{{4}})", ln, re.IGNORECASE)
        if ref_match and not payload.get("reference_label"):
            month_key = ref_match.group(2).lower().replace("ç", "c")
            month_num = MONTH_MAP.get(month_key) or MONTH_MAP.get(ref_match.group(2).lower())
            year = int(ref_match.group(3))
            if month_num:
                _apply_reference(payload, f"{MONTH_NAMES[month_num]} {year}")

        pay_match = re.match(rf"^(\d{{2}}/\d{{2}}/\d{{4}})\s+({_BRL_AMOUNT_PATTERN})", ln)
        if pay_match and not payload.get("payment_date"):
            payload["payment_date"] = datetime.strptime(pay_match.group(1), "%d/%m/%Y").date()

    payload.update(_parse_totals(lines))

    in_table = False
    section = "entries_deductions"
    for ln in lines:
        upper = ln.upper()
        if "CONTA QTDE" in upper and "VENCIMENTOS" in upper:
            in_table = True
            continue
        if in_table and "BASE" in upper and "OUTROS" in upper:
            section = "base_values"
            continue
        if in_table and upper.startswith("VENCIMENTOS DESCONTOS"):
            break
        if in_table and upper.startswith("TOTAIS"):
            break
        if not in_table:
            continue

        line_match = re.match(r"^(\d{4})\s+(.+)$", ln)
        if not line_match:
            continue
        code = line_match.group(1)
        desc, quantity, amount = _split_adp_desc_qty_amount(line_match.group(2))
        if amount is None:
            continue

        earnings_amount = None
        deduction_amount = None
        base_amount = None
        if section == "base_values":
            base_amount = amount
            deduction_amount = amount
        elif _adp_line_is_earning(code):
            earnings_amount = amount
        else:
            deduction_amount = amount

        payload["line_items"].append(
            {
                "section": section,
                "line_code": code,
                "description": (desc or "").strip() or "-",
                "quantity": quantity,
                "earnings_amount": earnings_amount,
                "deduction_amount": deduction_amount,
                "base_amount": base_amount,
            }
        )

    return _finalize_payslip_period(payload, source_filename)


def parse_payslip_text(text: str, source_filename: Optional[str] = None) -> Dict[str, Any]:
    fmt = detect_payslip_format(text)
    if fmt == "adp":
        return _parse_payslip_adp(text, source_filename=source_filename)
    return _parse_payslip_br_official(text, source_filename=source_filename)


def parse_income_report_text(text: str) -> Dict[str, Any]:
    lines = _split_pdf_lines(text)
    payload: Dict[str, Any] = {
        "report_year": None,
        "calendar_year": None,
        "payer_cnpj": None,
        "payer_name": None,
        "beneficiary_cpf": None,
        "beneficiary_name": None,
        "nature_code": None,
        "nature_description": None,
        "issued_at": None,
        "line_items": [],
    }

    for ln in lines:
        if ln.lower().startswith("exercício de"):
            m = re.search(r"(\d{4})", ln)
            if m:
                payload["report_year"] = int(m.group(1))
        if "Ano-calendário de" in ln:
            m = re.search(r"(\d{4})", ln)
            if m:
                payload["calendar_year"] = int(m.group(1))

    cnpj_idx = next((i for i, l in enumerate(lines) if l == "CNPJ/CPF"), None)
    if cnpj_idx is not None and cnpj_idx + 2 < len(lines):
        payload["payer_cnpj"] = _extract_cnpj(lines[cnpj_idx + 1])
        payload["payer_name"] = lines[cnpj_idx + 2]

    cpf_idx = next((i for i, l in enumerate(lines) if l == "CPF"), None)
    if cpf_idx is not None and cpf_idx + 2 < len(lines):
        payload["beneficiary_cpf"] = _extract_cpf(lines[cpf_idx + 1])
        payload["beneficiary_name"] = lines[cpf_idx + 2]

    nature_line = next((l for l in lines if " - RENDIMENTOS DO TRABALHO ASSALARIADO" in l), None)
    if nature_line:
        m = re.match(r"^(\d+)\s*-\s*(.+)$", nature_line)
        if m:
            payload["nature_code"] = m.group(1)
            payload["nature_description"] = m.group(2)

    date_idx = next((i for i, l in enumerate(lines) if l == "Data"), None)
    if date_idx is not None and date_idx + 1 < len(lines):
        try:
            payload["issued_at"] = datetime.strptime(lines[date_idx + 1], "%d/%m/%Y")
        except Exception:
            payload["issued_at"] = None

    payload["line_items"] = _parse_income_report_line_items(lines)

    return payload
