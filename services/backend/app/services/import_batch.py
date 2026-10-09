# -*- coding: utf-8 -*-
"""Cadastros da mesma leva de importação, usados quando ainda não estão no banco."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ImportBatchSubtag(BaseModel):
    tag_name: str = ""
    name: str = ""
    type: str = ""


class ImportBatchCard(BaseModel):
    name: str = ""
    number: str = ""
    type: str = ""


class ImportBatchPayload(BaseModel):
    subtags: list[ImportBatchSubtag] = Field(default_factory=list)
    accounts: list[str] = Field(default_factory=list)
    sharings: list[str] = Field(default_factory=list)
    cards: list[ImportBatchCard] = Field(default_factory=list)


def _norm(value: str) -> str:
    return (value or "").strip().lower()


def _last4(value: str) -> str:
    digits = "".join(ch for ch in (value or "") if ch.isdigit())
    return digits[-4:] if len(digits) >= 4 else digits


def _tipo(value: str) -> str:
    text = _norm(value)
    if text.startswith("rec"):
        return "receita"
    if text:
        return "despesa"
    return ""


class ImportBatch:
    def __init__(self, payload: ImportBatchPayload | None):
        self.subtags: set[tuple[str, str, str]] = set()
        self.accounts: set[str] = set()
        self.sharings: set[str] = set()
        self.cards: set[tuple[str, str]] = set()
        self.benefit_cards: set[tuple[str, str]] = set()
        if not payload:
            return
        for row in payload.subtags:
            name = _norm(row.name)
            if not name:
                continue
            self.subtags.add((_norm(row.tag_name), name, _tipo(row.type)))
        self.accounts = {_norm(name) for name in payload.accounts if _norm(name)}
        self.sharings = {_norm(name) for name in payload.sharings if _norm(name)}
        for row in payload.cards:
            name = _norm(row.name)
            number = _last4(row.number)
            if not (name or number):
                continue
            if _norm(row.type).startswith("benef"):
                self.benefit_cards.add((name, number))
            else:
                self.cards.add((name, number))

    def has_subtag(self, tag_name: str, subtag_name: str, tipo: str = "") -> bool:
        tag = _norm(tag_name)
        name = _norm(subtag_name)
        if not name:
            return False
        typed = _tipo(tipo)
        if (tag, name, typed) in self.subtags:
            return True
        return any(item_tag == tag and item_name == name for item_tag, item_name, _item_type in self.subtags)

    def has_account(self, name: str) -> bool:
        return _norm(name) in self.accounts

    def has_sharing(self, name: str) -> bool:
        return _norm(name) in self.sharings

    def has_card(self, name: str, number: str = "") -> bool:
        card_name = _norm(name)
        last4 = _last4(number)
        for item_name, item_last4 in self.cards:
            if last4 and item_last4 == last4:
                return True
            if card_name and item_name == card_name and (not last4 or not item_last4 or item_last4 == last4):
                return True
        return False

    def has_benefit_card(self, number: str = "") -> bool:
        """Sem final informado, qualquer cartão de benefício da leva serve (vira o padrão)."""
        last4 = _last4(number)
        if not last4:
            return bool(self.benefit_cards)
        return any(item_last4 == last4 for _name, item_last4 in self.benefit_cards)
