# -*- coding: utf-8 -*-
"""Abertura de PDFs com suporte a criptografia (senha de usuário)."""
from __future__ import annotations

from typing import Optional

from PyPDF2 import PdfReader


class PdfPasswordRequired(Exception):
    """PDF exige senha e nenhuma foi informada."""


class PdfPasswordInvalid(Exception):
    """Senha informada não abre o PDF."""


def pdf_requires_password(file_path: str) -> bool:
    """
    True se o PDF está criptografado e não abre sem senha do usuário.
    PDFs que aceitam senha vazia não exigem prompt.
    """
    reader = PdfReader(file_path)
    if not reader.is_encrypted:
        return False
    if reader.decrypt("") > 0:
        return False
    return True


def open_pdf_reader(file_path: str, password: Optional[str] = None) -> PdfReader:
    reader = PdfReader(file_path)
    if not reader.is_encrypted:
        return reader

    if password is not None:
        if reader.decrypt(password) > 0:
            return reader
        # PDF que abre com senha vazia não deve falhar por causa da senha padrão da conta.
        if reader.decrypt("") > 0:
            return reader
        raise PdfPasswordInvalid()

    if reader.decrypt("") > 0:
        return reader

    raise PdfPasswordRequired()


def extract_pdf_text(file_path: str, password: Optional[str] = None) -> str:
    reader = open_pdf_reader(file_path, password)
    parts: list[str] = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    return "\n".join(parts)


def password_at_index(passwords: Optional[list[str]], index: int) -> Optional[str]:
    if not passwords or index >= len(passwords):
        return None
    value = passwords[index]
    if value is None or value == "":
        return None
    return value


def resolve_pdf_password_at_index(
    passwords: Optional[list[str]],
    index: int,
    account_default_password: Optional[str] = None,
) -> Optional[str]:
    explicit = password_at_index(passwords, index)
    if explicit:
        return explicit
    return account_default_password


def pdf_still_needs_user_password(
    file_path: str, try_password: Optional[str] = None
) -> bool:
    """
    True se o PDF exige senha e a senha informada (ex.: padrão da conta) não abre.
    """
    if not pdf_requires_password(file_path):
        return False
    if try_password:
        try:
            open_pdf_reader(file_path, try_password)
            return False
        except PdfPasswordInvalid:
            return True
        except PdfPasswordRequired:
            return True
    return True
