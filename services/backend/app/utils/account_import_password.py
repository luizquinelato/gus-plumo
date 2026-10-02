# -*- coding: utf-8 -*-
"""Senha padrão de abertura de PDFs por conta (armazenada criptografada)."""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.models.unified_models import Account
from app.utils.crypto_helper import CryptoHelper


def _crypto() -> CryptoHelper:
    return CryptoHelper()


def encrypt_import_file_password(plain: str) -> str:
    return _crypto().encrypt(plain.strip())


def decrypt_import_file_password(encrypted: Optional[str]) -> Optional[str]:
    if not encrypted:
        return None
    try:
        return _crypto().decrypt(encrypted)
    except Exception:
        return None


def account_has_import_file_password(account: Optional[Account]) -> bool:
    return bool(account and account.import_file_password_encrypted)


def account_default_import_file_password(account: Optional[Account]) -> Optional[str]:
    if not account:
        return None
    return decrypt_import_file_password(account.import_file_password_encrypted)


def set_account_import_file_password(account: Account, plain: Optional[str]) -> None:
    if plain is None or plain.strip() == "":
        account.import_file_password_encrypted = None
        return
    account.import_file_password_encrypted = encrypt_import_file_password(plain)


def load_account_for_user(
    db: Session, tenant_id: int, account_id: Optional[int]
) -> Optional[Account]:
    if not account_id:
        return None
    return (
        db.query(Account)
        .filter(Account.id == account_id, Account.tenant_id == tenant_id)
        .first()
    )
