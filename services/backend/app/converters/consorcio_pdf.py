# -*- coding: utf-8 -*-
"""Parser de extratos de consórcio em PDF (Porto Seguro e Rodobens)."""
import re
import unicodedata
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

PORTO = "porto_seguro"
RODOBENS = "rodobens"

_DATE = r"(\d{2}/\d{2}/\d{4})"
_NUM = r"(-?[\d.]*\d,\d+)"


def _norm(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").upper()


def _dec(value: Optional[str]) -> Optional[Decimal]:
    if value is None or value == "":
        return None
    return Decimal(value.replace(".", "").replace(",", "."))


def _expense(value: Optional[str]) -> Optional[Decimal]:
    """Valor que é saída de dinheiro (dívida/despesa): gravado negativo."""
    amount = _dec(value)
    return -amount if amount is not None else None


def _date(value: Optional[str]) -> Optional[date]:
    return datetime.strptime(value, "%d/%m/%Y").date() if value else None


def _find(pattern: str, text: str, flags: int = 0, group: int = 1) -> Optional[str]:
    match = re.search(pattern, text, flags)
    return match.group(group) if match else None


def detect_consortium_company(text: str) -> Optional[str]:
    upper = _norm(text[:600])
    if "PORTO SEGURO" in upper and "EXTRATO DO CONSORCIADO" in upper:
        return PORTO
    if "RODOBENS" in upper and "EXTRATO DO CONSORCIADO" in upper:
        return RODOBENS
    return None


def _add_month(d: date) -> date:
    year, month = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return d.replace(year=year, month=month, day=min(d.day, 28))


def _parse_porto_rows(text: str) -> List[Dict[str, Any]]:
    pattern = re.compile(
        rf"^(\d{{3}})\s+(.+?)\s+{_DATE}\s+{_DATE}\s+{_NUM}\s+{_NUM}\s+{_NUM}\s+{_NUM}\s+{_NUM}\s+{_NUM}\s+{_NUM}\s+{_NUM}$",
        re.MULTILINE,
    )
    rows = []
    for m in pattern.finditer(text):
        g = m.groups()
        rows.append({
            "installment_number": int(g[0]), "entry_description": g[1].strip(),
            "accounting_date": _date(g[2]), "payment_date": _date(g[3]),
            "amount_due": _expense(g[4]), "amount_paid": _dec(g[5]),
            "fc_pct": _dec(g[6]), "fr_pct": _dec(g[7]), "admin_fee_pct": _dec(g[8]),
            "insurance_pct": _dec(g[9]), "fine_interest_pct": _dec(g[10]), "diff_pct": _dec(g[11]),
        })
    return rows


def _parse_rodobens_rows(text: str) -> List[Dict[str, Any]]:
    pattern = re.compile(
        rf"^(?:(\d{{3}})\s+)?{_DATE}\s+{_DATE}\s+(\d{{6}})\s+{_NUM}\s+{_NUM}\s+{_NUM}\s+([SN])\s+{_NUM}\s+{_NUM}\s+{_NUM}"
        rf"\s+(\d{{3}}-\d)\s+(.+?)\s+(\d{{9}})\s+{_NUM}$",
        re.MULTILINE,
    )
    rows = []
    for m in pattern.finditer(text):
        g = m.groups()
        rows.append({
            "installment_number": int(g[0]) if g[0] else None,
            "due_date": _date(g[1]), "payment_date": _date(g[2]), "asset_code": g[3],
            "credit_amount": _dec(g[4]), "amount_paid": _dec(g[5]), "fine_amount": _expense(g[6]),
            "has_insurance": g[7] == "S", "paid_pct": _dec(g[8]), "amount_due": _expense(g[9]),
            "diff_pct": _dec(g[10]), "entry_code": g[11], "entry_description": g[12].strip(),
            "notice_number": g[13], "interest_amount": _expense(g[14]),
        })
    return rows


def _paid_installments(rows: List[Dict[str, Any]]) -> int:
    net: Dict[int, Decimal] = {}
    for row in rows:
        number = row.get("installment_number")
        if number is not None:
            net[number] = net.get(number, Decimal(0)) + (row.get("amount_paid") or Decimal(0))
    return sum(1 for value in net.values() if value > 0)


def _parse_porto(text: str) -> Dict[str, Any]:
    rows = _parse_porto_rows(text)
    group, quota, contract = re.search(r"Grupo:\s*(\S+)\s+Cota:\s*(\S+)\s+Contrato:\s*(\d+)", text).groups()
    paid = _paid_installments(rows)
    header = re.search(rf"{_DATE}\s+(\d+)\s+{_DATE}", text)
    next_due = _date(header.group(3)) if header else None
    if next_due and header and paid >= int(header.group(2)):
        next_due = _add_month(next_due)
    totals = re.search(r"^TOTAL\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+100,0000", text, re.MULTILINE)
    diff = re.search(r"Diferença:\s*(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)", text)
    segment = "imovel" if "IMOVEL" in _norm(text[:3000]) else "auto"
    first = rows[0] if rows else {}
    return {
        "company": PORTO, "segment": segment, "group_code": group, "quota": quota,
        "contract_number": contract, "asset_code": None,
        "asset_description": "Imóvel" if segment == "imovel" else "Automóvel",
        "credit_amount": _dec(_find(r"(\d{1,3}(?:\.\d{3})*,\d{2})001", text)),
        "plan_term_months": int(_find(r"Prazo do grupo:\s*(\d+)", text)),
        "paid_installments": paid, "catch_up_installments": 0,
        "monthly_amount": _expense(_find(r"Valor Contrib\. Mensal:\s*([\d.]+,\d{2})", text)),
        "outstanding_balance": _expense(_find(r"TOTAL\s+[\d.]+,\d{2}\s+TOTAL\s+([\d.]+,\d{2})", text)),
        "joined_date": _date(_find(rf"Valor Crédito:[\d,]+{_DATE}", text)),
        "next_due_date": next_due,
        "last_due_date": _date(_find(rf"último vencimento da cota:\s*{_DATE}", text)),
        "group_end_date": _date(_find(rf"encerramento do grupo:\s*{_DATE}", text)),
        "next_adjustment_date": _date(_find(rf"Próximo reajuste em:\s*{_DATE}", text)),
        "admin_fee_pct": first.get("admin_fee_pct"), "reserve_fund_pct": first.get("fr_pct"),
        "monthly_pct": _dec(diff.group(1)) if diff else None,
        "monthly_pct_with_fees": _dec(_find(r"Taxas:\s*\d,\d{6}\s+(\d,\d+)", text)),
        "insurance_pct": _dec(_find(r"\b(\d,\d{6})\b", text)),
        "paid_pct": _dec(totals.group(1)) if totals else None,
        "pending_pct": _dec(totals.group(2)) if totals else None,
        "to_collect_pct": _dec(totals.group(3)) if totals else None,
        "ideal_paid_pct": _dec(diff.group(2)) if diff else None,
        "ideal_due_pct": _dec(_find(r"Ideal Devido:\s*([\d,]+)", text)),
        "diff_pct": _dec(diff.group(3)) if diff else None,
        "installments": rows,
    }


def _parse_rodobens(text: str) -> Dict[str, Any]:
    rows = _parse_rodobens_rows(text)
    group, contract = re.search(r"Grupo:\s*Contrato:\s*(\d+)\s+(\d+)", text).groups()
    quota_m = re.search(r"Cota:\s*(\d+)\s+(\d{2})", text)
    asset = re.search(r"Bem:\s*(\d{6})\s+(.+?)Plano básico:\s*(\d+)\s*meses", text)
    segment = "imovel" if "IMOVEL" in _norm(asset.group(2)) else "auto"
    last = _find(rf"Data do ultimo vencimento:\s*{_DATE}", text)
    pcts = re.search(r"Parcela\s*(\d+,\d{4})%\s*(\d+,\d{4})%\s*(\d+,\d{4})%", text)
    return {
        "company": RODOBENS, "segment": segment, "group_code": group,
        "quota": f"{quota_m.group(1)}-{quota_m.group(2)}", "contract_number": contract,
        "asset_code": asset.group(1), "asset_description": asset.group(2).strip(),
        "credit_amount": _dec(_find(r"Diferença de Parcelas\s*([\d.]+,\d{2})", text)),
        "plan_term_months": int(asset.group(3)),
        "paid_installments": _paid_installments(rows),
        "catch_up_installments": int(_find(r"Qtde Furo:\s*(\d+)", text) or 0),
        "monthly_amount": _expense(_find(r"Valor contribuição mensal:\s*([\d.]+,\d{2})", text)),
        "outstanding_balance": _expense(
            _find(r"Diferença de Parcelas\s*[\d.]+,\d{2}\s+[\d.]+,\d{2}\s+([\d.]+,\d{2})", text)
        ),
        "joined_date": None,
        "next_due_date": _date(_find(rf"Vencimento:\s*{_DATE}", text)),
        "last_due_date": _date(last),
        "group_end_date": _date(_find(rf"Data prevista para o encerramento:\s*{_DATE}", text)),
        "next_adjustment_date": _date(_find(rf"Reajuste em:\s*{_DATE}", text)),
        "admin_fee_pct": None, "reserve_fund_pct": None,
        "monthly_pct": _dec(_find(r"Mensal:\s*(\d,\d+)", text)),
        "monthly_pct_with_fees": _dec(_find(r"mensal c/ taxas:\s*(\d,\d+)", text)),
        "insurance_pct": _dec(_find(r"\b(\d,\d{6})\b", text)),
        "paid_pct": _dec(pcts.group(1)) if pcts else None,
        "to_collect_pct": _dec(pcts.group(2)) if pcts else None,
        "pending_pct": _dec(pcts.group(3)) if pcts else None,
        "ideal_paid_pct": None, "ideal_due_pct": None, "diff_pct": None,
        "installments": rows,
    }


def parse_consortium_text(text: str) -> Dict[str, Any]:
    company = detect_consortium_company(text)
    if company == PORTO:
        return _parse_porto(text)
    if company == RODOBENS:
        return _parse_rodobens(text)
    raise ValueError("Extrato de consórcio não reconhecido")
