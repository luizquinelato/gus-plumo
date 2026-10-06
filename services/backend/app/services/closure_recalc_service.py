"""Recálculo de fechamento compartilhado: diff entre snapshot e dados atuais."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from decimal import Decimal
from typing import Any

from app.routers.balance_router import BalanceCalculationResponse, TransactionItem

ITEM_BUCKETS: list[tuple[str, str]] = [
    ("expense_items", "bank_statements"),
    ("revenue_items", "bank_statements"),
    ("credit_card_expense_items", "credit_card_invoices"),
    ("credit_card_revenue_items", "credit_card_invoices"),
    ("benefit_card_expense_items", "benefit_card_statements"),
    ("benefit_card_revenue_items", "benefit_card_statements"),
]

SOURCE_LABELS = {
    "bank_statements": "Extrato",
    "credit_card_invoices": "Cartão",
    "benefit_card_statements": "Benefício",
}


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    raw = str(value).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(raw.split("+")[0])
    except ValueError:
        return None


def _item_to_dict(item: TransactionItem | dict) -> dict:
    if isinstance(item, TransactionItem):
        return item.model_dump(mode="json")
    return dict(item)


def _norm_amount(value: Any) -> float:
    return round(float(value or 0), 2)


def _norm_str(value: Any) -> str:
    return (str(value or "")).strip()


def _norm_tag(value: Any) -> str | None:
    s = _norm_str(value)
    return s if s else None


def _item_key(owner_account_id: int, source_table: str, item_id: int) -> str:
    return f"{owner_account_id}:{source_table}:{item_id}"


def _flatten_card_items(card: dict | None, owner_account_id: int) -> dict[str, dict]:
    if not card:
        return {}
    out: dict[str, dict] = {}
    for bucket, default_source in ITEM_BUCKETS:
        for raw in card.get(bucket) or []:
            item = dict(raw)
            source = item.get("source_table") or default_source
            item_id = item.get("id")
            if item_id is None:
                continue
            key = _item_key(owner_account_id, source, int(item_id))
            item["source_table"] = source
            item["_bucket"] = bucket
            item["_owner_account_id"] = owner_account_id
            out[key] = item
    return out


def _flatten_closure_items(closure_data: dict) -> dict[str, dict]:
    main = closure_data.get("main_account_card") or {}
    partner = closure_data.get("partner_account_card") or {}
    main_id = int(main.get("account_id") or 0)
    partner_id = int(partner.get("account_id") or 0)
    items: dict[str, dict] = {}
    items.update(_flatten_card_items(main, main_id))
    items.update(_flatten_card_items(partner, partner_id))
    return items


def _align_fresh_cards(
    fresh: BalanceCalculationResponse,
    stored_main_id: int,
) -> tuple[dict, dict]:
    main_f = fresh.main_account_card.model_dump(mode="json")
    partner_f = fresh.partner_account_card.model_dump(mode="json")
    if int(main_f.get("account_id") or 0) == stored_main_id:
        return main_f, partner_f
    return partner_f, main_f


def _transaction_totals_for_card(card: dict) -> tuple[float, float]:
    """Retorna (total_to_receive abs, total_to_pay abs) antes de empréstimos."""
    exp = abs(float(card.get("total_expenses") or 0))
    rev = abs(float(card.get("total_revenues") or 0))
    return exp, rev


def _build_card_snapshot(fresh_card: dict, old_card: dict | None) -> dict:
    old_card = old_card or {}
    exp, rev = _transaction_totals_for_card(fresh_card)
    loan_recv = float(old_card.get("loan_to_receive") or 0)
    loan_pay = float(old_card.get("loan_to_pay") or 0)
    net_before = exp - rev
    return {
        "account_id": fresh_card.get("account_id"),
        "account_name": fresh_card.get("account_name"),
        "account_number": fresh_card.get("account_number"),
        "bank_name": fresh_card.get("bank_name"),
        "agency": fresh_card.get("agency"),
        "status": fresh_card.get("status"),
        "total_to_receive": exp,
        "total_to_pay": -rev,
        "net_amount_before_loans": net_before,
        "loan_to_receive": loan_recv,
        "loan_to_pay": loan_pay,
        "net_amount": net_before + loan_recv + loan_pay,
        "expense_items": fresh_card.get("expense_items") or [],
        "revenue_items": fresh_card.get("revenue_items") or [],
        "credit_card_expense_items": fresh_card.get("credit_card_expense_items") or [],
        "credit_card_revenue_items": fresh_card.get("credit_card_revenue_items") or [],
        "benefit_card_expense_items": fresh_card.get("benefit_card_expense_items") or [],
        "benefit_card_revenue_items": fresh_card.get("benefit_card_revenue_items") or [],
        "loan_payments": old_card.get("loan_payments"),
    }


def build_proposed_closure_data(
    old_closure_data: dict,
    fresh: BalanceCalculationResponse,
) -> dict:
    old = deepcopy(old_closure_data or {})
    stored_main_id = int((old.get("main_account_card") or {}).get("account_id") or 0)
    fresh_main, fresh_partner = _align_fresh_cards(fresh, stored_main_id)

    proposed = deepcopy(old)
    proposed["main_account_card"] = _build_card_snapshot(
        fresh_main, old.get("main_account_card"),
    )
    proposed["partner_account_card"] = _build_card_snapshot(
        fresh_partner, old.get("partner_account_card"),
    )
    proposed["start_date"] = fresh.start_date.isoformat()
    proposed["end_date"] = fresh.end_date.isoformat()
    period = dict(proposed.get("period") or {})
    period["start_date"] = fresh.start_date.isoformat()
    period["end_date"] = fresh.end_date.isoformat()
    proposed["period"] = period
    proposed["recalculation_timestamp"] = datetime.now().isoformat()
    return proposed


def _classify_change(old_item: dict, new_item: dict) -> str:
    tag_fields = (
        _norm_tag(old_item.get("tag_name")) != _norm_tag(new_item.get("tag_name"))
        or _norm_tag(old_item.get("subtag_name")) != _norm_tag(new_item.get("subtag_name"))
    )
    material = (
        _norm_amount(old_item.get("amount")) != _norm_amount(new_item.get("amount"))
        or _norm_str(old_item.get("description")) != _norm_str(new_item.get("description"))
        or _norm_amount(old_item.get("my_contribution_percentage"))
        != _norm_amount(new_item.get("my_contribution_percentage"))
        or _norm_amount(old_item.get("partner_contribution_percentage"))
        != _norm_amount(new_item.get("partner_contribution_percentage"))
        or _norm_str(old_item.get("year_month")) != _norm_str(new_item.get("year_month"))
        or int(old_item.get("current_installment") or 0) != int(new_item.get("current_installment") or 0)
        or int(old_item.get("total_installments") or 0) != int(new_item.get("total_installments") or 0)
    )
    if material:
        return "material"
    if tag_fields:
        return "tag_only"
    return "unchanged"


def diff_closure_against_fresh(
    old_closure_data: dict,
    fresh: BalanceCalculationResponse,
) -> dict[str, Any]:
    old_items = _flatten_closure_items(old_closure_data)
    proposed = build_proposed_closure_data(old_closure_data, fresh)
    new_items = _flatten_closure_items(proposed)

    new_list: list[dict] = []
    removed_list: list[dict] = []
    altered_list: list[dict] = []
    tag_only_count = 0

    for key, new_item in new_items.items():
        if key not in old_items:
            source = new_item.get("source_table") or "bank_statements"
            new_list.append(
                {
                    "key": key,
                    "source_table": source,
                    "source_label": SOURCE_LABELS.get(source, source),
                    "item": new_item,
                }
            )
            continue
        kind = _classify_change(old_items[key], new_item)
        if kind == "tag_only":
            tag_only_count += 1
        elif kind == "material":
            old_item = old_items[key]
            source = new_item.get("source_table") or "bank_statements"
            altered_list.append(
                {
                    "key": key,
                    "source_table": source,
                    "source_label": SOURCE_LABELS.get(source, source),
                    "before": old_item,
                    "after": new_item,
                }
            )

    for key, old_item in old_items.items():
        if key not in new_items:
            source = old_item.get("source_table") or "bank_statements"
            removed_list.append(
                {
                    "key": key,
                    "source_table": source,
                    "source_label": SOURCE_LABELS.get(source, source),
                    "item": old_item,
                }
            )

    old_main = (old_closure_data.get("main_account_card") or {})
    new_main = proposed.get("main_account_card") or {}
    old_net = float(old_main.get("net_amount") or 0)
    new_net = float(new_main.get("net_amount") or 0)

    return {
        "summary": {
            "new_count": len(new_list),
            "removed_count": len(removed_list),
            "altered_count": len(altered_list),
            "tag_only_count": tag_only_count,
            "unchanged_count": max(
                0,
                len(new_items)
                - len(new_list)
                - len(altered_list)
                - tag_only_count,
            ),
            "old_net_amount": old_net,
            "new_net_amount": new_net,
            "net_delta": round(new_net - old_net, 2),
        },
        "new_items": new_list,
        "removed_items": removed_list,
        "altered_items": altered_list,
        "proposed_closure_data": proposed,
    }


def closure_net_for_entity(closure: Any) -> Decimal:
    return Decimal(str(closure.net_balance or 0))


def debt_remaining(net_balance: Decimal, total_paid: Decimal) -> Decimal:
    debt = abs(net_balance) if net_balance != 0 else Decimal("0")
    remaining = debt - total_paid
    return remaining if remaining > Decimal("0") else Decimal("0")
