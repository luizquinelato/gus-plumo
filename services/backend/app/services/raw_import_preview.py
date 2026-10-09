"""
Preview do import bruto (extrato, fatura PDF, benefício CSV).

Monta o resumo a partir do resultado do save executado com commit=False e
collect_details=True (o chamador faz rollback logo em seguida).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.unified_models import Account, BankStatement
from app.services.visual_extrato_import_service import LookupCache
from app.utils.import_rows import json_safe

OTHER_ACCOUNT_MIN_MATCHES = 10
OTHER_ACCOUNT_MIN_SHARE = 0.5


def _fmt_date(value: Any) -> str:
    if isinstance(value, datetime):
        if value.hour or value.minute or value.second:
            return value.strftime("%d/%m/%Y %H:%M")
        return value.strftime("%d/%m/%Y")
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    return str(value or "")


def _pct(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return ""
    text = f"{number:.2f}".rstrip("0").rstrip(".")
    return f"{text}%"


def _ownership_number(value: Any) -> Optional[float]:
    """Parte da conta logada (0% é válido); ausente = 100%."""
    if value is None or value == "":
        return 100.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _sharing_text(lookup: LookupCache, sharing_id: Optional[int], ownership: Any) -> str:
    if not sharing_id:
        return ""
    label = lookup.sharing_label(sharing_id) or f"#{sharing_id}"
    pct = _pct(ownership)
    return f"{label} ({pct})" if pct else label


def _amount_changed(before: Any, after: Any) -> bool:
    try:
        return abs(float(before or 0) - float(after or 0)) >= 0.005
    except (TypeError, ValueError):
        return False


def _update_changes(lookup: LookupCache, before: dict, after: dict) -> list[dict[str, str]]:
    changes: list[dict[str, str]] = []
    if before.get("subtag_id") != after.get("subtag_id"):
        changes.append({
            "field": "Classificação",
            "before": lookup.subtag_label(before.get("subtag_id")) or "",
            "after": lookup.subtag_label(after.get("subtag_id")) or "",
        })
    if "amount" in after and _amount_changed(before.get("amount"), after.get("amount")):
        changes.append({
            "field": "Valor",
            "before": f"{float(before.get('amount') or 0):.2f}",
            "after": f"{float(after.get('amount') or 0):.2f}",
        })
    for key, label in (("description", "Descrição"), ("category", "Categoria"), ("transaction", "Transação"), ("installments", "Parcelas")):
        if key in after and (before.get(key) or "") != (after.get(key) or ""):
            changes.append({"field": label, "before": before.get(key) or "", "after": after.get(key) or ""})
    if "expense_sharing_id" in after:
        sharing_changed = before.get("expense_sharing_id") != after.get("expense_sharing_id")
        pct_changed = _amount_changed(before.get("ownership_percentage"), after.get("ownership_percentage"))
        if sharing_changed or (after.get("expense_sharing_id") and pct_changed):
            changes.append({
                "field": "Compartilhamento",
                "before": _sharing_text(lookup, before.get("expense_sharing_id"), before.get("ownership_percentage")),
                "after": _sharing_text(lookup, after.get("expense_sharing_id"), after.get("ownership_percentage")),
            })
    return changes


def _amount_key(value: Any) -> Optional[int]:
    try:
        return round(float(value) * 100)
    except (TypeError, ValueError):
        return None


def extrato_other_account_warnings(
    db: Session,
    tenant_id: int,
    user_id: int,
    account_id: int,
    result: dict[str, Any],
) -> list[str]:
    """Avisa quando os lançamentos "novos" já existem em outra conta do mesmo usuário (conta errada selecionada)."""
    creates = [
        (item.get("date"), _amount_key(item.get("amount")))
        for item in result.get("preview_creates") or []
        if isinstance(item.get("date"), datetime) and _amount_key(item.get("amount")) is not None
    ]
    if len(creates) < OTHER_ACCOUNT_MIN_MATCHES:
        return []

    accounts = {
        row.id: row.name
        for row in db.query(Account.id, Account.name).filter(
            Account.tenant_id == tenant_id,
            Account.user_id == user_id,
            Account.id != account_id,
        )
    }
    if not accounts:
        return []

    dates = [created_at for created_at, _ in creates]
    keys_by_account: dict[int, set[tuple[datetime, int]]] = {}
    for row in db.query(BankStatement.account_id, BankStatement.date, BankStatement.amount).filter(
        BankStatement.tenant_id == tenant_id,
        BankStatement.account_id.in_(list(accounts)),
        BankStatement.date >= min(dates),
        BankStatement.date <= max(dates),
    ):
        keys_by_account.setdefault(row.account_id, set()).add((row.date, _amount_key(row.amount)))

    best_account, best_matches = None, 0
    for other_id, keys in keys_by_account.items():
        matches = sum(1 for key in creates if key in keys)
        if matches > best_matches:
            best_account, best_matches = other_id, matches
    if best_account is None or best_matches < max(OTHER_ACCOUNT_MIN_MATCHES, len(creates) * OTHER_ACCOUNT_MIN_SHARE):
        return []

    current = db.query(Account.name).filter(Account.tenant_id == tenant_id, Account.id == account_id).scalar()
    return [
        f"{best_matches} dos {len(creates)} lançamentos novos já existem na conta “{accounts[best_account]}”. "
        f"Confira se a conta selecionada (“{current or account_id}”) é a correta antes de importar."
    ]


def build_raw_preview(
    db: Session,
    tenant_id: int,
    account_id: int,
    result: dict[str, Any],
    *,
    unchanged: int = 0,
    ignored_rows: Optional[list[dict[str, Any]]] = None,
    warnings: Optional[list[str]] = None,
) -> dict[str, Any]:
    lookup = LookupCache(db, tenant_id, account_id)

    creates = []
    for item in result.get("preview_creates") or []:
        hint = item.get("mapping_hint")
        creates.append({
            "row": item.get("line"),
            "row_index": item.get("row_index"),
            "mapping_hint": (
                {
                    "subtag_id": hint.get("subtag_id"),
                    "label": lookup.subtag_label(hint.get("subtag_id"))
                    or " / ".join(part for part in (hint.get("tag"), hint.get("subtag")) if part),
                    "type": hint.get("type"),
                }
                if hint
                else None
            ),
            "date": _fmt_date(item.get("date")),
            "description": item.get("description") or "",
            "amount": item.get("amount"),
            "classification": lookup.subtag_label(item.get("subtag_id")) or "",
            "sharing": (
                lookup.sharing_label(item.get("expense_sharing_id")) or f"#{item.get('expense_sharing_id')}"
                if item.get("expense_sharing_id")
                else ""
            ),
            "ownership": (
                _ownership_number(item.get("ownership_percentage")) if item.get("expense_sharing_id") else None
            ),
            "card": item.get("card") or "",
            "year_month": item.get("year_month") or "",
            "installments": item.get("installments") or "",
            "category": item.get("category") or "",
            "transaction": item.get("transaction") or "",
            "payment_method": item.get("payment_method") or "",
        })

    updates = []
    for item in result.get("preview_updates") or []:
        changes = _update_changes(lookup, item.get("before") or {}, item.get("after") or {})
        if not changes:
            unchanged += 1
            continue
        updates.append({
            "row": item.get("line"),
            "record_id": item.get("id"),
            "date": _fmt_date(item.get("date")),
            "description": item.get("description") or "",
            "amount": item.get("amount"),
            "card": item.get("card") or "",
            "changes": changes,
        })

    issues = []
    for row in result.get("skippedRows") or []:
        issues.append({
            "row": row.get("Linha"),
            "description": row.get("Descrição") or "",
            "reason": row.get("Erro") or "",
        })
    for row in result.get("preview_skipped") or []:
        issues.append({
            "row": row.get("line"),
            "description": row.get("description") or "",
            "reason": row.get("reason") or "",
        })

    ignored = [
        {
            "row": index + 1,
            "date": row.get("data") or "",
            "description": row.get("descricao") or "",
            "transaction": row.get("transacao") or "",
            "amount": row.get("valor"),
            "reason": row.get("motivo") or "",
        }
        for index, row in enumerate(ignored_rows or [])
    ]

    conflicts = result.get("conflicts") or []
    summary = {
        "creates": len(creates),
        "updates": len(updates),
        "unchanged": unchanged,
        "conflicts": len(conflicts),
        "unmapped": sum(1 for item in creates if not item["classification"]),
        "needs_mapping": sum(1 for item in creates if item["mapping_hint"]),
        "issues": len(issues),
        "ignored": len(ignored),
    }
    return json_safe({
        "summary": summary,
        "creates": creates,
        "updates": updates,
        "conflicts": conflicts,
        "issues": issues,
        "ignored": ignored,
        "warnings": list(warnings or []),
    })
