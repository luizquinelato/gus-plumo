# -*- coding: utf-8 -*-
"""Importação da planilha de faturas exportada pelo relatório do Plumo."""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.unified_models import Cartao, CreditCardInvoice
from app.services.closed_period_edit_service import (
    after_credit_card_updated,
    after_new_transaction_in_closed_period,
    closure_impact_none,
    ensure_credit_card_update_allowed,
    ensure_new_transaction_in_closed_period_allowed,
    merge_closure_impacts,
)
from app.services.import_batch import ImportBatch
from app.services.visual_extrato_import_service import (
    ISSUE_IGNORED,
    ISSUE_NO_CLASSIFICATION,
    ISSUE_NO_SHARING,
    LookupCache,
    _tx_issue_detail,
    _append_change,
    _description_matches,
    _file_classification_label,
    _normalize_text,
    _ownership_or_full,
    _parse_amount,
    _parse_br_datetime,
)

_INSTALLMENT = re.compile(r"\((\d+)\s*/\s*(\d+)\)\s*$")


def _last4(value: Any) -> str:
    digits = "".join(ch for ch in _normalize_text(value) if ch.isdigit())
    return digits[-4:] if len(digits) >= 4 else digits


def _issuer(value: Any) -> Optional[str]:
    text = _normalize_text(value).lower()
    if not text:
        return None
    if "mercado" in text or text in {"mp", "mercadopago"}:
        return "mercadopago"
    if "btg" in text:
        return "btg"
    return None


def _year_month(raw: dict[str, Any], dt: datetime) -> str:
    text = _normalize_text(raw.get("year_month"))
    if re.fullmatch(r"\d{4}-\d{2}", text):
        month = int(text[5:7])
        if 1 <= month <= 12:
            return text
    return f"{dt.year:04d}-{dt.month:02d}"


def _installments(raw: dict[str, Any]) -> tuple[Optional[int], Optional[int]]:
    current = raw.get("current_installment")
    total = raw.get("total_installments")
    try:
        cur = int(current) if current not in (None, "") else None
        tot = int(total) if total not in (None, "") else None
    except (TypeError, ValueError):
        return None, None
    if cur is None and tot is None:
        return None, None
    if cur is None or tot is None or cur < 1 or tot < 1 or cur > tot:
        return None, None
    if tot == 1:
        return None, None
    return cur, tot


def _resolve_issuer(db: Session, tenant_id: int, credit_card_id: int, requested: Optional[str]) -> str:
    if requested in ("btg", "mercadopago"):
        return requested
    row = (
        db.query(CreditCardInvoice.issuer)
        .filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.credit_card_id == credit_card_id,
            CreditCardInvoice.issuer.in_(("btg", "mercadopago")),
        )
        .first()
    )
    if row and row[0] in ("btg", "mercadopago"):
        return row[0]
    return "btg"


def _credit_cards(db: Session, tenant_id: int, account_id: int) -> list[Cartao]:
    return (
        db.query(Cartao)
        .filter(
            Cartao.tenant_id == tenant_id,
            Cartao.account_id == account_id,
            Cartao.type == "credito",
            Cartao.active == True,
        )
        .all()
    )


def _resolve_card(
    cards: list[Cartao],
    *,
    last4: str,
    name: str,
) -> tuple[Optional[Cartao], Optional[str]]:
    name_l = name.lower()
    hits = [card for card in cards if last4 and _last4(card.number) == last4]
    if name_l:
        named = [card for card in hits if _normalize_text(card.name).lower() == name_l]
        if len(named) == 1:
            return named[0], None
        if not hits:
            named = [card for card in cards if _normalize_text(card.name).lower() == name_l]
            if len(named) == 1:
                return named[0], None
    if len(hits) == 1:
        return hits[0], None
    if len(hits) > 1:
        return None, f"Mais de um cartão com final {last4}"
    label = name or (f"final {last4}" if last4 else "")
    return None, f"Cartão não encontrado: {label}" if label else "Cartão não informado"


_CENT = Decimal("0.01")

InvoiceKey = tuple[int, str, date, Decimal, Optional[int], Optional[int]]


def _money(value: Any) -> Decimal:
    return Decimal(str(value)).quantize(_CENT)


def _invoice_key(
    card_id: int,
    year_month: str,
    dt: datetime,
    amount: Any,
    current: Optional[int],
    total: Optional[int],
) -> InvoiceKey:
    return (card_id, year_month, dt.date(), _money(amount), current, total)


def _load_invoice_index(
    db: Session,
    tenant_id: int,
    card_ids: set[int],
    year_months: set[str],
) -> tuple[dict[InvoiceKey, list[CreditCardInvoice]], dict[int, CreditCardInvoice]]:
    """card_ids devem vir de `_credit_cards` (já filtrados pela conta)."""
    by_key: dict[InvoiceKey, list[CreditCardInvoice]] = {}
    by_id: dict[int, CreditCardInvoice] = {}
    if not card_ids or not year_months:
        return by_key, by_id
    rows = (
        db.query(CreditCardInvoice)
        .filter(
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.credit_card_id.in_(card_ids),
            CreditCardInvoice.year_month.in_(year_months),
        )
        .order_by(CreditCardInvoice.id.asc())
        .all()
    )
    for row in rows:
        if row.date is None or row.amount is None:
            continue
        key = _invoice_key(
            int(row.credit_card_id),
            row.year_month,
            row.date,
            row.amount,
            row.current_installment,
            row.total_installments,
        )
        by_key.setdefault(key, []).append(row)
        by_id[int(row.id)] = row
    return by_key, by_id


def _find_invoice(
    index: dict[InvoiceKey, list[CreditCardInvoice]],
    card_id: int,
    *,
    year_month: str,
    dt: datetime,
    description: str,
    amount: Decimal,
    current: Optional[int],
    total: Optional[int],
    exclude_ids: set[int],
) -> Optional[CreditCardInvoice]:
    wanted = description.lower()
    for row in index.get(_invoice_key(card_id, year_month, dt, amount, current, total), ()):
        if int(row.id) in exclude_ids:
            continue
        if _description_matches(row.description or "", wanted):
            return row
    return None


def _plan_visual_fatura_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    *,
    rows: list[dict[str, Any]],
    batch: ImportBatch | None = None,
) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    resolved: list[dict[str, Any]] = []
    skipped = 0
    used_ids: set[int] = set()
    cards = _credit_cards(db, tenant_id, account_id)
    lookup = LookupCache(db, tenant_id, account_id)
    card_cache: dict[tuple[str, str], tuple[Optional[Cartao], Optional[str]]] = {}

    for idx, raw in enumerate(rows):
        line = int(raw.get("row_index") or idx + 2)
        dt = _parse_br_datetime(raw.get("date"))
        description = _normalize_text(raw.get("description"))
        amount = _parse_amount(raw.get("amount"))
        if not dt or not description or amount is None:
            issues.append({
                "source": "invoice",
                "row": line,
                "reason": "Data, descrição ou valor inválidos",
                "detail": _tx_issue_detail(raw),
                "action": ISSUE_IGNORED,
            })
            skipped += 1
            continue
        year_month = _year_month(raw, dt)
        current, total = _installments(raw)
        last4 = _last4(raw.get("card_last4"))
        card_name = _normalize_text(raw.get("card_name"))
        card_key = (last4, card_name)
        if card_key not in card_cache:
            card_cache[card_key] = _resolve_card(cards, last4=last4, name=card_name)
        card, card_err = card_cache[card_key]
        pending_card = False
        if card_err and batch and batch.has_card(card_name, last4):
            card_err = None
            pending_card = True
        elif card_err:
            issues.append({
                "source": "invoice",
                "row": line,
                "reason": card_err,
                "detail": _tx_issue_detail(raw),
                "action": ISSUE_IGNORED,
            })
            skipped += 1
            continue

        tag_file = str(raw.get("tag") or "")
        subtag_file = str(raw.get("subtag") or "")
        tipo = "receita" if amount >= 0 else "despesa"
        subtag_id, sub_err = lookup.subtag(tag_file, subtag_file, amount)
        if sub_err and not (batch and batch.has_subtag(tag_file, subtag_file, tipo)):
            issues.append({
                "source": "invoice",
                "row": line,
                "reason": sub_err,
                "detail": _tx_issue_detail(raw),
                "action": ISSUE_NO_CLASSIFICATION,
            })
        elif sub_err:
            sub_err = None
            subtag_id = None
        partner_file = str(raw.get("partner_name") or "")
        sharing_id, ownership, share_err = lookup.sharing(partner_file, raw.get("ownership_percentage"))
        if share_err and not (batch and batch.has_sharing(partner_file)):
            issues.append({
                "source": "invoice",
                "row": line,
                "reason": share_err,
                "detail": _tx_issue_detail(raw),
                "action": ISSUE_NO_SHARING,
            })
            sharing_id = None
            ownership = Decimal("100.00")
        elif share_err:
            share_err = None
            sharing_id = None
            ownership = Decimal("100.00")

        issuer = _issuer(raw.get("issuer"))
        meta = {
            "line": line,
            "dt": dt,
            "year_month": year_month,
            "description": description,
            "amount": amount,
            "current": current,
            "total": total,
            "subtag_id": subtag_id,
            "sharing_id": sharing_id,
            "ownership": _ownership_or_full(ownership),
            "issuer": issuer,
            "tag_file": tag_file,
            "subtag_file": subtag_file,
            "partner_file": partner_file,
            "sub_err": sub_err,
            "share_err": share_err,
            "card_err": "Cartão entra com o cadastro desta leva" if pending_card else None,
            "card_name": card_name,
            "card_last4": last4,
            "credit_card_id": int(card.id) if card else None,
            "keep_existing": bool(raw.get("keep_existing")),
        }
        resolved.append(meta)

    index, invoices_by_id = _load_invoice_index(
        db,
        tenant_id,
        {meta["credit_card_id"] for meta in resolved if meta["credit_card_id"] is not None},
        {meta["year_month"] for meta in resolved if meta["credit_card_id"] is not None},
    )
    planned: list[dict[str, Any]] = []
    kept = 0
    for meta in resolved:
        card_id = meta["credit_card_id"]
        existing = None
        if card_id is not None and not meta["card_err"]:
            existing = _find_invoice(
                index,
                card_id,
                year_month=meta["year_month"],
                dt=meta["dt"],
                description=meta["description"],
                amount=meta["amount"],
                current=meta["current"],
                total=meta["total"],
                exclude_ids=used_ids,
            )
        if existing and meta["keep_existing"]:
            used_ids.add(int(existing.id))
            kept += 1
        elif existing:
            used_ids.add(int(existing.id))
            planned.append({"action": "update_invoice", "id": int(existing.id), **meta})
        else:
            planned.append({"action": "create_invoice", "kind": "cash", **meta})

    return {
        "planned": planned,
        "issues": issues,
        "skipped": skipped,
        "kept": kept,
        "invoices_by_id": invoices_by_id,
        "lookup": lookup,
    }


def preview_visual_fatura_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    *,
    rows: list[dict[str, Any]],
    batch: ImportBatch | None = None,
) -> dict[str, Any]:
    plan = _plan_visual_fatura_import(db, tenant_id, account_id, rows=rows, batch=batch)
    invoices_by_id: dict[int, CreditCardInvoice] = plan["invoices_by_id"]
    lookup: LookupCache = plan["lookup"]
    creates: list[dict[str, Any]] = []
    updates: list[dict[str, Any]] = []
    unchanged = 0

    for item in plan["planned"]:
        action = "create" if item["action"] == "create_invoice" else "update"
        after_subtag = lookup.subtag_label(item.get("subtag_id"))
        after_sharing = lookup.sharing_label(item.get("sharing_id"))
        ownership = float(_ownership_or_full(item.get("ownership")))
        null_fields = []
        file_cls = _file_classification_label(item.get("tag_file", ""), item.get("subtag_file", ""))
        if item.get("card_err"):
            null_fields.append({
                "field": "card",
                "file_value": item.get("card_name") or item.get("card_last4") or None,
                "reason": item["card_err"],
            })
        if item.get("sub_err"):
            null_fields.append({"field": "subtag", "file_value": file_cls or None, "reason": item["sub_err"]})
        elif not file_cls:
            null_fields.append({
                "field": "subtag",
                "file_value": None,
                "reason": "Sem tag/subtag na planilha → ficará vazio",
            })
        if item.get("share_err"):
            null_fields.append({
                "field": "sharing",
                "file_value": item.get("partner_file") or None,
                "reason": item["share_err"],
            })
        base = {
            "source": "invoice",
            "row": item["line"],
            "action": action,
            "date": item["dt"].strftime("%d/%m/%Y"),
            "description": item["description"][:120],
            "amount": float(item["amount"]),
            "classification_after": after_subtag,
            "classification_file": file_cls or None,
            "sharing_after": after_sharing,
            "sharing_file": _normalize_text(item.get("partner_file")) or None,
            "ownership_after": ownership if after_sharing else None,
            "null_fields": null_fields,
        }
        if action == "create":
            creates.append({**base, "record_id": None})
            continue
        row = invoices_by_id.get(item["id"])
        if not row:
            continue
        changes: list[dict[str, Any]] = []
        _append_change(changes, "description", row.description, item["description"])
        _append_change(changes, "year_month", row.year_month, item["year_month"])
        _append_change(changes, "subtag", lookup.subtag_label(row.subtag_id), after_subtag)
        _append_change(changes, "sharing", lookup.sharing_label(row.expense_sharing_id), after_sharing)
        if after_sharing or row.expense_sharing_id:
            _append_change(
                changes,
                "ownership_pct",
                float(row.ownership_percentage) if row.expense_sharing_id else None,
                ownership if after_sharing else None,
            )
        next_issuer = item.get("issuer") or row.issuer
        _append_change(changes, "issuer", row.issuer, next_issuer)
        if not changes:
            unchanged += 1
            continue
        updates.append({**base, "record_id": item["id"], "changes": changes})

    return {
        "summary": {
            "creates": len(creates),
            "updates": len(updates),
            "unchanged": unchanged,
            "kept": plan["kept"],
            "skipped_invalid": plan["skipped"],
            "issues": len(plan["issues"]),
        },
        "creates": creates,
        "updates": updates,
        "issues": plan["issues"],
    }


def apply_visual_fatura_import(
    db: Session,
    tenant_id: int,
    account_id: int,
    user_id: int,
    *,
    rows: list[dict[str, Any]],
    confirm_closed_closure_impact: bool,
) -> dict[str, Any]:
    plan = _plan_visual_fatura_import(db, tenant_id, account_id, rows=rows, batch=None)
    invoices_by_id: dict[int, CreditCardInvoice] = plan["invoices_by_id"]
    issues: list[dict[str, Any]] = list(plan["issues"])
    stats = {"updated": 0, "created": 0, "kept": plan["kept"], "skipped": plan["skipped"]}
    closure_impact: dict[str, Any] = closure_impact_none()
    issuer_cache: dict[tuple[int, Optional[str]], str] = {}

    for item in plan["planned"]:
        if item.get("credit_card_id") is None:
            issues.append({
                "source": "invoice",
                "row": item["line"],
                "reason": "Cartão ainda não cadastrado nesta conta",
            })
            stats["skipped"] += 1
            continue
        card_id = int(item["credit_card_id"])
        issuer_key = (card_id, item.get("issuer"))
        if issuer_key not in issuer_cache:
            issuer_cache[issuer_key] = _resolve_issuer(db, tenant_id, card_id, item.get("issuer"))
        issuer = issuer_cache[issuer_key]
        ownership = _ownership_or_full(item["ownership"])
        if item["action"] == "update_invoice":
            row = invoices_by_id.get(item["id"])
            if not row:
                issues.append({"source": "invoice", "row": item["line"], "reason": "Lançamento não encontrado"})
                continue
            kind = ensure_credit_card_update_allowed(
                db,
                tenant_id,
                account_id,
                user_id,
                row,
                description=item["description"],
                amount=float(item["amount"]),
                date=item["dt"],
                subtag_id=item["subtag_id"],
                shared_partner_id=item["sharing_id"],
                ownership_percentage=float(ownership),
                confirm_closed_closure_impact=confirm_closed_closure_impact,
            )
            old_date = row.date
            row.date = item["dt"]
            row.year_month = item["year_month"]
            row.description = item["description"]
            row.amount = item["amount"]
            row.current_installment = item["current"]
            row.total_installments = item["total"]
            row.subtag_id = item["subtag_id"]
            row.expense_sharing_id = item["sharing_id"]
            row.ownership_percentage = ownership
            row.issuer = issuer
            db.flush()
            stats["updated"] += 1
            if kind != "noop":
                impact = after_credit_card_updated(
                    db,
                    tenant_id,
                    account_id,
                    user_id,
                    row,
                    kind=kind,
                    old_date=old_date,
                    note="Importação visual de faturas",
                )
                closure_impact = merge_closure_impacts(closure_impact, impact) or closure_impact
            continue

        invoice = CreditCardInvoice(
            tenant_id=tenant_id,
            created_by=user_id,
            account_id=account_id,
            credit_card_id=card_id,
            year_month=item["year_month"],
            date=item["dt"],
            description=item["description"],
            amount=item["amount"],
            current_installment=item["current"],
            total_installments=item["total"],
            subtag_id=item["subtag_id"],
            expense_sharing_id=item["sharing_id"],
            ownership_percentage=ownership,
            issuer=issuer,
            adjustment_notes="Importação do relatório de faturas",
        )

        def insert(row: CreditCardInvoice = invoice) -> None:
            db.add(row)
            db.flush()

        ensure_new_transaction_in_closed_period_allowed(
            db,
            tenant_id,
            account_id,
            user_id,
            item["dt"],
            confirm_closed_closure_impact,
            insert,
        )
        if invoice.id is None:
            insert()
        stats["created"] += 1
        impact = after_new_transaction_in_closed_period(
            db,
            tenant_id,
            account_id,
            user_id,
            item["dt"],
            note="Importação visual de faturas",
        )
        closure_impact = merge_closure_impacts(closure_impact, impact) or closure_impact

    return {"stats": stats, "issues": issues, "closure_impact": closure_impact}
