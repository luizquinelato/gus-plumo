"""Envio de mensagens de texto via Evolution API (WhatsApp, cliente não oficial)."""

import os

import httpx
from fastapi import HTTPException


SHARED_BALANCE_EXTRA_TO_DEFAULT = "5519999203010"


def shared_balance_recipients() -> list[str]:
    """Destino padrão + segundo destino do resumo do balanço compartilhado."""
    default_to = os.environ.get("WHATSAPP_DEFAULT_TO", "")
    extra_to = os.environ.get("WHATSAPP_SHARED_BALANCE_EXTRA_TO", SHARED_BALANCE_EXTRA_TO_DEFAULT)
    return list(dict.fromkeys(n for n in (default_to, extra_to) if n))


def send_text(text: str, recipients: list[str] | None = None) -> None:
    url = os.environ.get("EVOLUTION_API_URL", "").rstrip("/")
    api_key = os.environ.get("EVOLUTION_API_KEY", "")
    instance = os.environ.get("EVOLUTION_INSTANCE", "")
    targets = recipients if recipients is not None else [os.environ.get("WHATSAPP_DEFAULT_TO", "")]
    targets = [t for t in targets if t]
    if not (url and api_key and instance and targets):
        raise HTTPException(
            status_code=503,
            detail="WhatsApp não configurado (EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE, WHATSAPP_DEFAULT_TO).",
        )
    for to in targets:
        try:
            response = httpx.post(
                f"{url}/message/sendText/{instance}",
                headers={"apikey": api_key},
                json={"number": to, "text": text},
                timeout=15.0,
            )
        except httpx.RequestError:
            raise HTTPException(status_code=502, detail="Não foi possível conectar à Evolution API.")
        if response.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail="Evolution API recusou o envio (instância desconectada ou número inválido).",
            )
