# -*- coding: utf-8 -*-
"""Resolve o ownership_percentage de um lançamento (despesa vs receita)."""

from decimal import Decimal
from typing import Any, Literal

OwnershipKind = Literal["expense", "revenue"]


def _as_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def _get(obj: Any, key: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def ownership_kind_from_amount(amount: Any) -> OwnershipKind:
    """Valores gravados: positivo = receita, negativo/zero-negativo = despesa."""
    value = _as_decimal(amount) or Decimal("0")
    return "revenue" if value >= 0 else "expense"


def ownership_kind_from_type(tipo: str | None) -> OwnershipKind:
    return "revenue" if (tipo or "").lower() == "receita" else "expense"


def resolve_ownership_percentage(
    *,
    kind: OwnershipKind | None = None,
    amount: Any = None,
    tipo: str | None = None,
    sharing: Any = None,
    card: Any = None,
    mapping: Any = None,
) -> Decimal:
    """
    Ordem: override do mapeamento → override do cartão → default da config → 100%.
    `kind` prevalece; senão usa `tipo`; senão o sinal de `amount`.
    """
    resolved_kind: OwnershipKind
    if kind is not None:
        resolved_kind = kind
    elif tipo:
        resolved_kind = ownership_kind_from_type(tipo)
    else:
        resolved_kind = ownership_kind_from_amount(amount)

    if mapping is not None:
        mapping_key = (
            "revenue_contribution_percentage"
            if resolved_kind == "revenue"
            else "my_contribution_percentage"
        )
        mapping_pct = _as_decimal(_get(mapping, mapping_key))
        if mapping_pct is not None:
            return mapping_pct

    if card is not None:
        card_key = (
            "revenue_ownership_percentage"
            if resolved_kind == "revenue"
            else "expense_ownership_percentage"
        )
        card_pct = _as_decimal(_get(card, card_key))
        if card_pct is not None:
            return card_pct

    if sharing is not None:
        sharing_key = (
            "revenue_contribution_percentage"
            if resolved_kind == "revenue"
            else "my_contribution_percentage"
        )
        sharing_pct = _as_decimal(_get(sharing, sharing_key))
        if sharing_pct is None and resolved_kind == "revenue":
            sharing_pct = _as_decimal(_get(sharing, "my_contribution_percentage"))
        if sharing_pct is not None:
            return sharing_pct

    return Decimal("100.00")


def card_adjustment_config(card: Any) -> dict[str, Any]:
    """
    Defaults de participação do cartão para importação de faturas.
    100% = próprio; 0% = gerenciado; compartilhado = expense_sharing_id + %.
    """
    if card is None:
        return {
            "adjustment_type": "proprio",
            "ownership_percentage": Decimal("100.00"),
            "expense_ownership_percentage": Decimal("100.00"),
            "revenue_ownership_percentage": Decimal("100.00"),
            "expense_sharing_id": None,
        }

    expense_pct = resolve_ownership_percentage(
        kind="expense", sharing=card.expense_sharing, card=card
    )
    revenue_pct = resolve_ownership_percentage(
        kind="revenue", sharing=card.expense_sharing, card=card
    )

    if card.expense_sharing_id is not None:
        return {
            "adjustment_type": "compartilhado",
            "ownership_percentage": expense_pct,
            "expense_ownership_percentage": expense_pct,
            "revenue_ownership_percentage": revenue_pct,
            "expense_sharing_id": card.expense_sharing_id,
            "card": card,
            "sharing": card.expense_sharing,
        }

    return {
        "adjustment_type": "proprio",
        "ownership_percentage": expense_pct,
        "expense_ownership_percentage": expense_pct,
        "revenue_ownership_percentage": revenue_pct,
        "expense_sharing_id": None,
    }
