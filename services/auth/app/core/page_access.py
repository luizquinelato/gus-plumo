# -*- coding: utf-8 -*-
"""Carga de grants de página para respostas do auth service."""

from typing import Any, Dict, List

from psycopg2.extras import RealDictCursor

# Espelho de services/backend/app/core/page_catalog.py (page_key estável)
_ADMIN_PAGE_KEYS: List[str] = [
    "home",
    "importar",
    "configuracoes.cartoes",
    "configuracoes.contas",
    "configuracoes.compartilhamentos",
    "configuracoes.tags",
    "cadastro.mappings",
    "cadastro.templates",
    "relatorios.extrato",
    "relatorios.faturas",
    "relatorios.grupo",
    "relatorios.projecao",
    "relatorios.saldo_parcelado",
    "relatorios.saude",
    "fechamentos.conta",
    "fechamentos.compartilhado",
    "fechamentos.faturas",
    "curadoria",
    "emprestimos",
    "informes",
    "consorcios",
    "configuracoes.copy",
    "configuracoes.cores",
    "configuracoes.acessos",
    "configuracoes.usuarios",
]


def obter_mapa_paginas_usuario(
    conn, tenant_id: int, is_admin: bool, role: str
) -> Dict[str, Dict[str, bool]]:
    if is_admin:
        return {key: {"can_read": True, "can_write": True} for key in _ADMIN_PAGE_KEYS}

    effective_role = role or "user"
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute(
            """
            SELECT page_key, can_read, can_write
            FROM role_page_grants
            WHERE tenant_id = %s
              AND role = %s
              AND active = TRUE
              AND can_read = TRUE;
            """,
            (tenant_id, effective_role),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()

    return {
        row["page_key"]: {
            "can_read": bool(row["can_read"]),
            "can_write": bool(row["can_write"]),
        }
        for row in rows
    }


def anexar_paginas_ao_usuario(conn, user_data: Dict[str, Any]) -> Dict[str, Any]:
    tenant_id = user_data.get("tenant_id")
    if tenant_id is None:
        return user_data
    is_admin = bool(user_data.get("is_admin"))
    role = str(user_data.get("role") or "user")
    pages = obter_mapa_paginas_usuario(conn, int(tenant_id), is_admin, role)
    return {**user_data, "pages": pages}