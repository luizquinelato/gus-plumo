"""Envio de mensagens de texto via Evolution API (WhatsApp, cliente não oficial)."""

import os

import httpx
from fastapi import HTTPException


def send_text(text: str) -> None:
    url = os.environ.get("EVOLUTION_API_URL", "").rstrip("/")
    api_key = os.environ.get("EVOLUTION_API_KEY", "")
    instance = os.environ.get("EVOLUTION_INSTANCE", "")
    to = os.environ.get("WHATSAPP_DEFAULT_TO", "")
    if not (url and api_key and instance and to):
        raise HTTPException(
            status_code=503,
            detail="WhatsApp não configurado (EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE, WHATSAPP_DEFAULT_TO).",
        )
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
