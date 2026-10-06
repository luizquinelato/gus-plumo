# -*- coding: utf-8 -*-
"""Criptografia de critérios de match em mapeamentos sensíveis."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

MASK = "********"


def _crypto():
    from app.utils.crypto_helper import get_crypto_helper

    return get_crypto_helper()


def decrypt_field(value: str | None, is_sensitive: bool) -> str | None:
    if not value or not is_sensitive:
        return value
    try:
        return _crypto().decrypt(value)
    except Exception as e:
        logger.warning("Falha ao descriptografar campo de mapeamento: %s", e)
        return value


def encrypt_field(value: str | None) -> str | None:
    if not value:
        return value
    return _crypto().encrypt(value)


def original_for_storage(plain: str | None, is_sensitive: bool) -> str | None:
    if not plain:
        return None
    normalized = plain.lower()
    return encrypt_field(normalized) if is_sensitive else normalized


def pattern_for_storage(plain: str | None, is_sensitive: bool) -> str | None:
    if not plain:
        return None
    normalized = plain.lower()
    return encrypt_field(normalized) if is_sensitive else normalized


def regex_for_storage(plain: str | None, is_sensitive: bool) -> str | None:
    if not plain:
        return None
    return encrypt_field(plain) if is_sensitive else plain


def resolve_pattern_update(
    *,
    fields_set: set[str],
    mapping_data_pattern: str | None,
    stored_pattern: str | None,
    old_is_sensitive: bool,
    new_is_sensitive: bool,
) -> str | None:
    if "pattern" not in fields_set:
        if not old_is_sensitive and new_is_sensitive and stored_pattern:
            return pattern_for_storage(stored_pattern, True)
        if old_is_sensitive and not new_is_sensitive and stored_pattern:
            plain = decrypt_field(stored_pattern, True)
            return plain.lower() if plain else None
        return stored_pattern

    plain = mapping_data_pattern.lower() if mapping_data_pattern else None
    if not old_is_sensitive and new_is_sensitive and plain:
        return pattern_for_storage(plain, True)
    if old_is_sensitive and not new_is_sensitive:
        if stored_pattern:
            plain = decrypt_field(stored_pattern, True)
            return plain.lower() if plain else None
        return None
    if old_is_sensitive and new_is_sensitive and plain:
        return pattern_for_storage(plain, True)
    return plain


def resolve_regex_update(
    *,
    fields_set: set[str],
    mapping_data_regex: str | None,
    stored_regex: str | None,
    old_is_sensitive: bool,
    new_is_sensitive: bool,
) -> str | None:
    if "regex_pattern" not in fields_set:
        if not old_is_sensitive and new_is_sensitive and stored_regex:
            return regex_for_storage(stored_regex, True)
        if old_is_sensitive and not new_is_sensitive and stored_regex:
            return decrypt_field(stored_regex, True)
        return stored_regex

    plain = mapping_data_regex
    if not old_is_sensitive and new_is_sensitive and plain:
        return regex_for_storage(plain, True)
    if old_is_sensitive and not new_is_sensitive:
        if stored_regex:
            return decrypt_field(stored_regex, True)
        return None
    if old_is_sensitive and new_is_sensitive and plain:
        return regex_for_storage(plain, True)
    return plain


def decrypt_pattern_for_match(pattern: str | None, is_sensitive: bool) -> str | None:
    return decrypt_field(pattern, is_sensitive)


def decrypt_regex_for_match(regex_pattern: str | None, is_sensitive: bool) -> str | None:
    return decrypt_field(regex_pattern, is_sensitive)
