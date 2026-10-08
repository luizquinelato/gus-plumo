#!/usr/bin/env python3
"""
Copia cadastros entre PROD e DEV (upsert). Opcionalmente copia lançamentos de extrato
(`bank_statements`), fatura (`credit_card_invoices`) e benefícios
(`benefit_card_statements`) com FKs remapeadas.

Conexão: .env.prod e .env.dev na raiz do monorepo
(DATABASE_URL ou DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD).

Uso:
    python scripts/sync_cadastro_prod_dev.py
    python scripts/sync_cadastro_prod_dev.py -db prod --all
    python scripts/sync_cadastro_prod_dev.py -db dev --all
    python scripts/sync_cadastro_prod_dev.py -db prod --cartoes --mapeamentos
    python scripts/sync_cadastro_prod_dev.py -db prod --all -x templates mapeamentos
    python scripts/sync_cadastro_prod_dev.py -db prod --extratos
    python scripts/sync_cadastro_prod_dev.py -db prod --faturas
    python scripts/sync_cadastro_prod_dev.py -db prod --cartoes --faturas
    python scripts/sync_cadastro_prod_dev.py -db prod --beneficios

-db prod|dev — banco de origem; destino é o outro automaticamente.
Extratos, faturas e benefícios rodam por último. Extrato antes da fatura, para
preencher `credit_card_invoices.bank_statement_id` quando os dois entram juntos.
Sem domínio `mapeamentos` na execução (ou com `-x mapeamentos`), extratos, faturas
e benefícios gravam `subtag_id` NULL — importação limpa, com compartilhamento/ownership
preservados.
Cartões: normaliza participação na cópia (% ou legado `is_account_card` na origem → 100/0);
SELECT adapta-se a colunas presentes na origem (ex.: coluna legada ou % ausentes).
Se --all aparecer junto com outras flags de domínio, sincroniza tudo (menos -x) e ignora as demais.
--all -x exclui domínios da sincronização completa (ex.: --all -x templates).
--tags inclui subtags. --subtags é alias de --tags.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set

import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).resolve().parents[1]

ALL_DOMAINS = (
    "contas",
    "compartilhamentos",
    "tags",
    "cartoes",
    "mapeamentos",
    "templates",
    "extratos",
    "faturas",
    "beneficios",
)

DOMAIN_ALIASES = {
    "contas": "contas",
    "compartilhamentos": "compartilhamentos",
    "tags": "tags",
    "subtags": "tags",
    "cartoes": "cartoes",
    "mapeamentos": "mapeamentos",
    "templates": "templates",
    "extratos": "extratos",
    "extrato": "extratos",
    "statements": "extratos",
    "faturas": "faturas",
    "invoices": "faturas",
    "beneficios": "beneficios",
    "benefits": "beneficios",
    "all": "all",
}

DOMAIN_DEPS: Dict[str, Set[str]] = {
    "contas": set(),
    "compartilhamentos": {"contas"},
    "tags": {"contas"},
    "cartoes": {"contas", "compartilhamentos"},
    "mapeamentos": {"contas", "compartilhamentos", "tags"},
    "templates": {"contas", "compartilhamentos", "tags"},
    "extratos": {"contas", "compartilhamentos", "tags"},
    "faturas": {"contas", "compartilhamentos", "tags", "cartoes"},
    "beneficios": {"contas", "compartilhamentos", "tags", "cartoes"},
}


@dataclass
class SyncContext:
    tenant_id: int
    user_map: Dict[int, int] = field(default_factory=dict)
    bank_map: Dict[int, int] = field(default_factory=dict)
    account_map: Dict[int, int] = field(default_factory=dict)
    sharing_map: Dict[int, int] = field(default_factory=dict)
    tag_map: Dict[int, int] = field(default_factory=dict)
    subtag_map: Dict[int, int] = field(default_factory=dict)
    invoice_group_map: Dict[int, int] = field(default_factory=dict)
    credit_card_map: Dict[int, int] = field(default_factory=dict)
    template_map: Dict[int, int] = field(default_factory=dict)
    invoice_map: Dict[int, int] = field(default_factory=dict)
    statement_map: Dict[int, int] = field(default_factory=dict)
    benefit_statement_map: Dict[int, int] = field(default_factory=dict)
    # True só se `mapeamentos` estiver entre os domínios desta execução
    apply_transaction_subtags: bool = False


def parse_db_config(env_file: Path) -> dict:
    load_dotenv(env_file, override=True)
    import os

    url = os.getenv("DATABASE_URL")
    if url:
        match = re.match(
            r"postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+?)(?:\?.*)?$",
            url,
        )
        if not match:
            raise ValueError(f"DATABASE_URL inválida em {env_file}")
        user, password, host, port, database = match.groups()
        return {
            "host": host,
            "port": int(port),
            "database": database,
            "user": user,
            "password": password,
        }

    required = ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD")
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        raise ValueError(f"{env_file}: faltam {', '.join(missing)} ou DATABASE_URL")
    return {
        "host": os.getenv("DB_HOST"),
        "port": int(os.getenv("DB_PORT", "5432")),
        "database": os.getenv("DB_NAME"),
        "user": os.getenv("DB_USER"),
        "password": os.getenv("DB_PASSWORD"),
    }


def connect(cfg: dict, label: str):
    try:
        conn = psycopg2.connect(
            **cfg,
            cursor_factory=RealDictCursor,
        )
        conn.autocommit = False
        print(f"✅ Conectado: {label} ({cfg['database']}@{cfg['host']}:{cfg['port']})")
        return conn
    except Exception as exc:
        print(f"❌ Falha ao conectar {label}: {exc}")
        sys.exit(1)


def map_user_id(ctx: SyncContext, prod_user_id: Optional[int]) -> Optional[int]:
    if prod_user_id is None:
        return None
    return ctx.user_map.get(prod_user_id, prod_user_id)


def map_transaction_subtag(
    ctx: SyncContext, prod_subtag_id: Optional[int]
) -> tuple[Optional[int], bool]:
    """
    Subtag em extratos, faturas e benefícios só quando `mapeamentos` entra na sync.
    Retorna (dev_subtag_id, skip_row) — skip_row se prod tinha subtag sem mapa no destino.
    """
    if not ctx.apply_transaction_subtags:
        return None, False
    if not prod_subtag_id:
        return None, False
    dev = ctx.subtag_map.get(prod_subtag_id)
    if dev is None:
        return None, True
    return dev, False


def build_user_map(prod_conn, dev_conn, tenant_id: int) -> Dict[int, int]:
    prod_by_email: Dict[str, int] = {}
    with prod_conn.cursor() as cur:
        cur.execute(
            "SELECT id, LOWER(TRIM(email)) AS email FROM users WHERE tenant_id = %s",
            (tenant_id,),
        )
        for row in cur.fetchall():
            prod_by_email[row["email"]] = row["id"]

    with dev_conn.cursor() as cur:
        cur.execute(
            "SELECT id, LOWER(TRIM(email)) AS email FROM users WHERE tenant_id = %s",
            (tenant_id,),
        )
        dev_users = {row["email"]: row["id"] for row in cur.fetchall()}
    mapping: Dict[int, int] = {}
    for email, prod_id in prod_by_email.items():
        if email in dev_users:
            mapping[prod_id] = dev_users[email]
    if not mapping and dev_users:
        fallback = next(iter(dev_users.values()))
        for prod_id in prod_by_email.values():
            mapping.setdefault(prod_id, fallback)
    return mapping


def _normalize_domain_flag(flag: str) -> str:
    key = flag.lstrip("-").replace("-", "_")
    if key not in DOMAIN_ALIASES or key == "all":
        raise ValueError(f"Domínio desconhecido: {flag!r} (use: {', '.join(ALL_DOMAINS)})")
    return DOMAIN_ALIASES[key]


def resolve_domains(
    raw_flags: List[str],
    excludes: Optional[List[str]] = None,
) -> List[str]:
    if not raw_flags:
        selected: Set[str] = set(ALL_DOMAINS)
    else:
        normalized: List[str] = []
        for flag in raw_flags:
            key = flag.lstrip("-").replace("-", "_")
            if key not in DOMAIN_ALIASES:
                raise ValueError(f"Flag desconhecida: --{key}")
            normalized.append(DOMAIN_ALIASES[key])

        if "all" in normalized:
            selected = set(ALL_DOMAINS)
        else:
            selected = set()
            for domain in normalized:
                selected.add(domain)
                selected |= DOMAIN_DEPS.get(domain, set())

    if excludes:
        for flag in excludes:
            selected.discard(_normalize_domain_flag(flag))

    if not selected:
        raise ValueError("Nenhum domínio restante após exclusões (-x).")

    return [d for d in ALL_DOMAINS if d in selected]


def sync_banks(prod_conn, dev_conn, ctx: SyncContext) -> None:
    with prod_conn.cursor() as prod_cur, dev_conn.cursor() as dev_cur:
        prod_cur.execute(
            """
            SELECT id, code, name, full_name, ispb, tenant_id, active
            FROM banks WHERE tenant_id = %s ORDER BY id
            """,
            (ctx.tenant_id,),
        )
        rows = prod_cur.fetchall()
        for row in rows:
            dev_cur.execute("SELECT id FROM banks WHERE code = %s", (row["code"],))
            existing = dev_cur.fetchone()
            if existing:
                dev_id = existing["id"]
                dev_cur.execute(
                    """
                    UPDATE banks SET name = %s, full_name = %s, ispb = %s,
                        tenant_id = %s, active = %s, last_updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        row["name"],
                        row["full_name"],
                        row["ispb"],
                        ctx.tenant_id,
                        row["active"],
                        dev_id,
                    ),
                )
            else:
                dev_cur.execute(
                    """
                    INSERT INTO banks (code, name, full_name, ispb, tenant_id, active, created_at, last_updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
                    RETURNING id
                    """,
                    (
                        row["code"],
                        row["name"],
                        row["full_name"],
                        row["ispb"],
                        ctx.tenant_id,
                        row["active"],
                    ),
                )
                dev_id = dev_cur.fetchone()["id"]
            ctx.bank_map[row["id"]] = dev_id
    print(f"  banks: {len(ctx.bank_map)} sincronizados")


def sync_contas(prod_conn, dev_conn, ctx: SyncContext) -> None:
    sync_banks(prod_conn, dev_conn, ctx)
    upserted = 0
    with prod_conn.cursor() as prod_cur, dev_conn.cursor() as dev_cur:
        prod_cur.execute(
            """
            SELECT id, user_id, name, description, account_type, bank_id,
                   agency, account_number, tenant_id, created_by, active,
                   import_file_password_encrypted
            FROM accounts WHERE tenant_id = %s
            ORDER BY id
            """,
            (ctx.tenant_id,),
        )
        for row in prod_cur.fetchall():
            dev_cur.execute(
                """
                SELECT id FROM accounts
                WHERE tenant_id = %s AND TRIM(name) = TRIM(%s)
                LIMIT 1
                """,
                (ctx.tenant_id, row["name"]),
            )
            existing = dev_cur.fetchone()
            dev_bank_id = ctx.bank_map.get(row["bank_id"]) if row["bank_id"] else None
            dev_user_id = map_user_id(ctx, row["user_id"])
            dev_created_by = map_user_id(ctx, row["created_by"])

            if existing:
                dev_id = existing["id"]
                dev_cur.execute(
                    """
                    UPDATE accounts SET
                        user_id = %s, name = %s, description = %s, account_type = %s,
                        bank_id = %s, agency = %s, account_number = %s,
                        created_by = %s, active = %s,
                        import_file_password_encrypted = %s,
                        last_updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        dev_user_id,
                        row["name"],
                        row["description"],
                        row["account_type"],
                        dev_bank_id,
                        row["agency"],
                        row["account_number"],
                        dev_created_by,
                        row["active"],
                        row["import_file_password_encrypted"],
                        dev_id,
                    ),
                )
            else:
                dev_cur.execute(
                    """
                    INSERT INTO accounts (
                        user_id, name, description, account_type, bank_id, agency, account_number,
                        tenant_id, created_by, active, import_file_password_encrypted,
                        created_at, last_updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                    RETURNING id
                    """,
                    (
                        dev_user_id,
                        row["name"],
                        row["description"],
                        row["account_type"],
                        dev_bank_id,
                        row["agency"],
                        row["account_number"],
                        ctx.tenant_id,
                        dev_created_by,
                        row["active"],
                        row["import_file_password_encrypted"],
                    ),
                )
                dev_id = dev_cur.fetchone()["id"]
            ctx.account_map[row["id"]] = dev_id
            upserted += 1
    print(f"  contas: {upserted} upsert(s)")


def sync_compartilhamentos(prod_conn, dev_conn, ctx: SyncContext) -> None:
    count = 0
    with prod_conn.cursor() as prod_cur, dev_conn.cursor() as dev_cur:
        prod_cur.execute(
            """
            SELECT id, account_id, shared_account_id, my_contribution_percentage,
                   revenue_contribution_percentage, description, tenant_id, created_by, active
            FROM expense_sharing_settings
            WHERE tenant_id = %s
            ORDER BY id
            """,
            (ctx.tenant_id,),
        )
        for row in prod_cur.fetchall():
            dev_account = ctx.account_map.get(row["account_id"])
            dev_shared = ctx.account_map.get(row["shared_account_id"])
            if dev_account is None or dev_shared is None:
                print(
                    f"  ⚠️  compartilhamento prod#{row['id']} ignorado (conta não mapeada)"
                )
                continue

            dev_cur.execute(
                """
                SELECT id FROM expense_sharing_settings
                WHERE tenant_id = %s AND account_id = %s AND shared_account_id = %s
                LIMIT 1
                """,
                (ctx.tenant_id, dev_account, dev_shared),
            )
            existing = dev_cur.fetchone()
            created_by = map_user_id(ctx, row["created_by"])

            if existing:
                dev_id = existing["id"]
                dev_cur.execute(
                    """
                    UPDATE expense_sharing_settings SET
                        my_contribution_percentage = %s,
                        revenue_contribution_percentage = %s,
                        description = %s, created_by = %s, active = %s,
                        last_updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        row["my_contribution_percentage"],
                        row["revenue_contribution_percentage"],
                        row["description"],
                        created_by,
                        row["active"],
                        dev_id,
                    ),
                )
            else:
                dev_cur.execute(
                    """
                    INSERT INTO expense_sharing_settings (
                        account_id, shared_account_id, my_contribution_percentage,
                        revenue_contribution_percentage, description,
                        tenant_id, created_by, active, created_at, last_updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                    RETURNING id
                    """,
                    (
                        dev_account,
                        dev_shared,
                        row["my_contribution_percentage"],
                        row["revenue_contribution_percentage"],
                        row["description"],
                        ctx.tenant_id,
                        created_by,
                        row["active"],
                    ),
                )
                dev_id = dev_cur.fetchone()["id"]
            ctx.sharing_map[row["id"]] = dev_id
            count += 1
    print(f"  compartilhamentos: {count} upsert(s)")


def sync_tags(prod_conn, dev_conn, ctx: SyncContext) -> None:
    tag_count = 0
    subtag_count = 0
    with prod_conn.cursor() as prod_cur, dev_conn.cursor() as dev_cur:
        prod_cur.execute(
            """
            SELECT id, account_id, tenant_id, name, description, icon, created_by
            FROM tags WHERE tenant_id = %s ORDER BY id
            """,
            (ctx.tenant_id,),
        )
        for row in prod_cur.fetchall():
            dev_account = ctx.account_map.get(row["account_id"])
            if dev_account is None:
                continue
            dev_cur.execute(
                """
                SELECT id FROM tags
                WHERE tenant_id = %s AND account_id = %s AND TRIM(name) = TRIM(%s)
                LIMIT 1
                """,
                (ctx.tenant_id, dev_account, row["name"]),
            )
            existing = dev_cur.fetchone()
            created_by = map_user_id(ctx, row["created_by"])
            if existing:
                dev_id = existing["id"]
                dev_cur.execute(
                    """
                    UPDATE tags SET description = %s, icon = %s, created_by = %s, last_updated_at = NOW()
                    WHERE id = %s
                    """,
                    (row["description"], row["icon"], created_by, dev_id),
                )
            else:
                dev_cur.execute(
                    """
                    INSERT INTO tags (account_id, tenant_id, name, description, icon, created_by, created_at, last_updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
                    RETURNING id
                    """,
                    (
                        dev_account,
                        ctx.tenant_id,
                        row["name"],
                        row["description"],
                        row["icon"],
                        created_by,
                    ),
                )
                dev_id = dev_cur.fetchone()["id"]
            ctx.tag_map[row["id"]] = dev_id
            tag_count += 1

        prod_cur.execute(
            """
            SELECT id, account_id, tenant_id, tag_id, name, description, type, icon, created_by
            FROM subtags WHERE tenant_id = %s ORDER BY id
            """,
            (ctx.tenant_id,),
        )
        for row in prod_cur.fetchall():
            dev_account = ctx.account_map.get(row["account_id"])
            dev_tag = ctx.tag_map.get(row["tag_id"])
            if dev_account is None or dev_tag is None:
                continue
            dev_cur.execute(
                """
                SELECT id FROM subtags
                WHERE tenant_id = %s AND account_id = %s AND tag_id = %s
                  AND TRIM(name) = TRIM(%s) AND type = %s
                LIMIT 1
                """,
                (ctx.tenant_id, dev_account, dev_tag, row["name"], row["type"]),
            )
            existing = dev_cur.fetchone()
            created_by = map_user_id(ctx, row["created_by"])
            if existing:
                dev_id = existing["id"]
                dev_cur.execute(
                    """
                    UPDATE subtags SET description = %s, icon = %s, created_by = %s, last_updated_at = NOW()
                    WHERE id = %s
                    """,
                    (row["description"], row["icon"], created_by, dev_id),
                )
            else:
                dev_cur.execute(
                    """
                    INSERT INTO subtags (
                        account_id, tenant_id, tag_id, name, description, type, icon,
                        created_by, created_at, last_updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                    RETURNING id
                    """,
                    (
                        dev_account,
                        ctx.tenant_id,
                        dev_tag,
                        row["name"],
                        row["description"],
                        row["type"],
                        row["icon"],
                        created_by,
                    ),
                )
                dev_id = dev_cur.fetchone()["id"]
            ctx.subtag_map[row["id"]] = dev_id
            subtag_count += 1
    print(f"  tags: {tag_count} upsert(s), subtags: {subtag_count} upsert(s)")


def _table_column_names(conn, table_name: str) -> Set[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            """,
            (table_name,),
        )
        return {row["column_name"] for row in cur.fetchall()}


def _credit_cards_column_names(conn) -> Set[str]:
    return _table_column_names(conn, "credit_cards")


def _card_calendar_day(row: dict, field: str) -> int:
    """Lê closing/due do row; se ausente (prod antigo), usa due_day."""
    val = row.get(field)
    if val is not None:
        return int(val)
    return int(row.get("due_day") or 14)


def normalize_card_participation_for_sync(
    row: dict,
    *,
    has_is_account_card: bool,
) -> tuple[Any, Any]:
    """
    Alinha participação ao modelo por % (100 próprio / 0 gerenciado / compartilhado).

    - Origem já com expense_ownership_percentage: mantém (inclui 0% gerenciado).
    - Origem só com is_account_card (legado, se a coluna existir): false → 0%; true → 100%.
    - Compartilhamento: não força 100/0; % podem ficar NULL (default da config).
    """
    sharing_id = row.get("expense_sharing_id")
    expense_pct = row.get("expense_ownership_percentage")
    revenue_pct = row.get("revenue_ownership_percentage")
    is_account_card = row.get("is_account_card") if has_is_account_card else None

    if sharing_id:
        return expense_pct, revenue_pct

    if expense_pct is not None:
        expense_f = float(expense_pct)
        if expense_f == 0:
            rev = 0.0 if revenue_pct is None else float(revenue_pct)
            return 0.0, rev
        rev = 100.0 if revenue_pct is None else float(revenue_pct)
        return expense_f, rev

    if has_is_account_card and is_account_card is False:
        rev = 0.0 if revenue_pct is None else float(revenue_pct)
        return 0.0, rev
    if has_is_account_card and is_account_card is True:
        rev = 100.0 if revenue_pct is None else float(revenue_pct)
        return 100.0, rev

    return expense_pct, revenue_pct


def sync_cartoes(prod_conn, dev_conn, ctx: SyncContext) -> None:
    group_count = 0
    card_count = 0
    with prod_conn.cursor() as prod_cur, dev_conn.cursor() as dev_cur:
        prod_group_cols = _table_column_names(prod_conn, "credit_card_invoice_groups")
        dev_group_cols = _table_column_names(dev_conn, "credit_card_invoice_groups")
        group_select = [
            "id",
            "name",
            "account_id",
            "tenant_id",
            "created_by",
            "active",
            "due_day",
        ]
        if "closing_day" in prod_group_cols:
            group_select.append("closing_day")
        prod_cur.execute(
            f"""
            SELECT {", ".join(group_select)}
            FROM credit_card_invoice_groups
            WHERE tenant_id = %s ORDER BY id
            """,
            (ctx.tenant_id,),
        )
        for row in prod_cur.fetchall():
            dev_account = ctx.account_map.get(row["account_id"])
            if dev_account is None:
                continue
            dev_cur.execute(
                """
                SELECT id FROM credit_card_invoice_groups
                WHERE tenant_id = %s AND account_id = %s AND TRIM(name) = TRIM(%s)
                LIMIT 1
                """,
                (ctx.tenant_id, dev_account, row["name"]),
            )
            existing = dev_cur.fetchone()
            created_by = map_user_id(ctx, row["created_by"])
            due_day = _card_calendar_day(row, "due_day")
            closing_day = _card_calendar_day(row, "closing_day")
            if existing:
                dev_id = existing["id"]
                if "closing_day" in dev_group_cols:
                    dev_cur.execute(
                        """
                        UPDATE credit_card_invoice_groups
                        SET active = %s, closing_day = %s, due_day = %s,
                            created_by = %s, last_updated_at = NOW()
                        WHERE id = %s
                        """,
                        (row["active"], closing_day, due_day, created_by, dev_id),
                    )
                else:
                    dev_cur.execute(
                        """
                        UPDATE credit_card_invoice_groups
                        SET active = %s, due_day = %s, created_by = %s, last_updated_at = NOW()
                        WHERE id = %s
                        """,
                        (row["active"], due_day, created_by, dev_id),
                    )
            else:
                if "closing_day" in dev_group_cols:
                    dev_cur.execute(
                        """
                        INSERT INTO credit_card_invoice_groups (
                            name, account_id, tenant_id, created_by, active,
                            closing_day, due_day, created_at, last_updated_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                        RETURNING id
                        """,
                        (
                            row["name"],
                            dev_account,
                            ctx.tenant_id,
                            created_by,
                            row["active"],
                            closing_day,
                            due_day,
                        ),
                    )
                else:
                    dev_cur.execute(
                        """
                        INSERT INTO credit_card_invoice_groups (
                            name, account_id, tenant_id, created_by, active, due_day, created_at, last_updated_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
                        RETURNING id
                        """,
                        (
                            row["name"],
                            dev_account,
                            ctx.tenant_id,
                            created_by,
                            row["active"],
                            due_day,
                        ),
                    )
                dev_id = dev_cur.fetchone()["id"]
            ctx.invoice_group_map[row["id"]] = dev_id
            group_count += 1

        prod_cols = _credit_cards_column_names(prod_conn)
        dev_cols = _credit_cards_column_names(dev_conn)
        has_iac_prod = "is_account_card" in prod_cols
        select_parts = [
            "id",
            "name",
            "description",
            "number",
            "type",
            "due_day",
            "account_id",
            "expense_sharing_id",
        ]
        if "closing_day" in prod_cols:
            select_parts.append("closing_day")
        if "expense_ownership_percentage" in prod_cols:
            select_parts.append("expense_ownership_percentage")
        if "revenue_ownership_percentage" in prod_cols:
            select_parts.append("revenue_ownership_percentage")
        if has_iac_prod:
            select_parts.append("is_account_card")
        select_parts.extend(
            ["invoice_group_id", "tenant_id", "created_by", "active"]
        )
        prod_cur.execute(
            f"""
            SELECT {", ".join(select_parts)}
            FROM credit_cards WHERE tenant_id = %s ORDER BY id
            """,
            (ctx.tenant_id,),
        )
        for row in prod_cur.fetchall():
            dev_account = ctx.account_map.get(row["account_id"])
            if dev_account is None:
                continue
            dev_sharing = (
                ctx.sharing_map.get(row["expense_sharing_id"])
                if row["expense_sharing_id"]
                else None
            )
            dev_group = (
                ctx.invoice_group_map.get(row["invoice_group_id"])
                if row["invoice_group_id"]
                else None
            )
            dev_cur.execute(
                """
                SELECT id FROM credit_cards
                WHERE tenant_id = %s AND account_id = %s
                  AND TRIM(name) = TRIM(%s) AND number = %s
                LIMIT 1
                """,
                (ctx.tenant_id, dev_account, row["name"], row["number"]),
            )
            existing = dev_cur.fetchone()
            created_by = map_user_id(ctx, row["created_by"])
            expense_pct, revenue_pct = normalize_card_participation_for_sync(
                row, has_is_account_card=has_iac_prod
            )
            due_day = _card_calendar_day(row, "due_day")
            closing_day = _card_calendar_day(row, "closing_day")
            if existing:
                dev_id = existing["id"]
                if "closing_day" in dev_cols:
                    dev_cur.execute(
                        """
                        UPDATE credit_cards SET
                            description = %s, type = %s,
                            closing_day = %s, due_day = %s,
                            expense_sharing_id = %s, expense_ownership_percentage = %s,
                            revenue_ownership_percentage = %s,
                            invoice_group_id = %s, created_by = %s, active = %s,
                            last_updated_at = NOW()
                        WHERE id = %s
                        """,
                        (
                            row["description"],
                            row["type"],
                            closing_day,
                            due_day,
                            dev_sharing,
                            expense_pct,
                            revenue_pct,
                            dev_group,
                            created_by,
                            row["active"],
                            dev_id,
                        ),
                    )
                else:
                    dev_cur.execute(
                        """
                        UPDATE credit_cards SET
                            description = %s, type = %s, due_day = %s,
                            expense_sharing_id = %s, expense_ownership_percentage = %s,
                            revenue_ownership_percentage = %s,
                            invoice_group_id = %s, created_by = %s, active = %s,
                            last_updated_at = NOW()
                        WHERE id = %s
                        """,
                        (
                            row["description"],
                            row["type"],
                            due_day,
                            dev_sharing,
                            expense_pct,
                            revenue_pct,
                            dev_group,
                            created_by,
                            row["active"],
                            dev_id,
                        ),
                    )
            else:
                if "closing_day" in dev_cols:
                    dev_cur.execute(
                        """
                        INSERT INTO credit_cards (
                            name, description, number, type,
                            closing_day, due_day, account_id,
                            expense_sharing_id, expense_ownership_percentage,
                            revenue_ownership_percentage, invoice_group_id,
                            tenant_id, created_by, active, created_at, last_updated_at
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
                        )
                        RETURNING id
                        """,
                        (
                            row["name"],
                            row["description"],
                            row["number"],
                            row["type"],
                            closing_day,
                            due_day,
                            dev_account,
                            dev_sharing,
                            expense_pct,
                            revenue_pct,
                            dev_group,
                            ctx.tenant_id,
                            created_by,
                            row["active"],
                        ),
                    )
                else:
                    dev_cur.execute(
                        """
                        INSERT INTO credit_cards (
                            name, description, number, type, due_day, account_id,
                            expense_sharing_id, expense_ownership_percentage,
                            revenue_ownership_percentage, invoice_group_id,
                            tenant_id, created_by, active, created_at, last_updated_at
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
                        )
                        RETURNING id
                        """,
                        (
                            row["name"],
                            row["description"],
                            row["number"],
                            row["type"],
                            due_day,
                            dev_account,
                            dev_sharing,
                            expense_pct,
                            revenue_pct,
                            dev_group,
                            ctx.tenant_id,
                            created_by,
                            row["active"],
                        ),
                    )
                dev_id = dev_cur.fetchone()["id"]
            ctx.credit_card_map[row["id"]] = dev_id
            card_count += 1
    print(f"  grupos de fatura: {group_count}, cartões: {card_count} upsert(s)")


def mapping_identity(row: dict) -> tuple:
    return (
        row["mapping_type"],
        row.get("original_description"),
        row.get("pattern"),
        row.get("regex_pattern"),
        row.get("priority", 0),
    )


def sync_mapeamentos(prod_conn, dev_conn, ctx: SyncContext) -> None:
    count = 0
    with prod_conn.cursor() as prod_cur, dev_conn.cursor() as dev_cur:
        prod_cur.execute(
            """
            SELECT id, account_id, tenant_id, original_description, mapped_description,
                   subtag_id, expense_sharing_id, my_contribution_percentage,
                   revenue_contribution_percentage, mapping_type, pattern, regex_pattern,
                   priority, is_sensitive, created_by
            FROM transaction_mappings
            WHERE tenant_id = %s
            ORDER BY id
            """,
            (ctx.tenant_id,),
        )
        rows = prod_cur.fetchall()
        by_account: Dict[int, List[dict]] = {}
        for row in rows:
            by_account.setdefault(row["account_id"], []).append(row)

        for prod_account_id, account_rows in by_account.items():
            dev_account = ctx.account_map.get(prod_account_id)
            if dev_account is None:
                continue

            dev_cur.execute(
                """
                SELECT id, mapping_type, original_description, pattern, regex_pattern, priority
                FROM transaction_mappings
                WHERE tenant_id = %s AND account_id = %s
                """,
                (ctx.tenant_id, dev_account),
            )
            dev_existing = {
                mapping_identity(r): r["id"] for r in dev_cur.fetchall()
            }

            for row in account_rows:
                dev_subtag = ctx.subtag_map.get(row["subtag_id"])
                if dev_subtag is None:
                    print(
                        f"  ⚠️  mapeamento prod#{row['id']} ignorado (subtag não mapeada)"
                    )
                    continue
                dev_sharing = (
                    ctx.sharing_map.get(row["expense_sharing_id"])
                    if row["expense_sharing_id"]
                    else None
                )
                created_by = map_user_id(ctx, row["created_by"])
                key = mapping_identity(row)
                payload = (
                    row["original_description"],
                    row["mapped_description"],
                    dev_subtag,
                    dev_sharing,
                    row["my_contribution_percentage"],
                    row["revenue_contribution_percentage"],
                    row["mapping_type"],
                    row["pattern"],
                    row["regex_pattern"],
                    row["priority"],
                    row["is_sensitive"],
                    created_by,
                )
                if key in dev_existing:
                    dev_cur.execute(
                        """
                        UPDATE transaction_mappings SET
                            original_description = %s, mapped_description = %s,
                            subtag_id = %s, expense_sharing_id = %s,
                            my_contribution_percentage = %s, revenue_contribution_percentage = %s,
                            mapping_type = %s, pattern = %s, regex_pattern = %s,
                            priority = %s, is_sensitive = %s, created_by = %s,
                            last_updated_at = NOW()
                        WHERE id = %s
                        """,
                        (*payload, dev_existing[key]),
                    )
                else:
                    dev_cur.execute(
                        """
                        INSERT INTO transaction_mappings (
                            account_id, tenant_id, original_description, mapped_description,
                            subtag_id, expense_sharing_id, my_contribution_percentage,
                            revenue_contribution_percentage, mapping_type, pattern, regex_pattern,
                            priority, is_sensitive, created_by, created_at, last_updated_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                        """,
                        (
                            dev_account,
                            ctx.tenant_id,
                            *payload,
                        ),
                    )
                count += 1
    print(f"  mapeamentos: {count} upsert(s)")


def sync_templates(prod_conn, dev_conn, ctx: SyncContext) -> None:
    tpl_count = 0
    item_count = 0
    with prod_conn.cursor() as prod_cur, dev_conn.cursor() as dev_cur:
        prod_cur.execute(
            """
            SELECT id, account_id, tenant_id, name, description, icon, created_by, active
            FROM expense_templates WHERE tenant_id = %s ORDER BY id
            """,
            (ctx.tenant_id,),
        )
        for row in prod_cur.fetchall():
            dev_account = ctx.account_map.get(row["account_id"])
            if dev_account is None:
                continue
            dev_cur.execute(
                """
                SELECT id FROM expense_templates
                WHERE tenant_id = %s AND account_id = %s AND TRIM(name) = TRIM(%s)
                LIMIT 1
                """,
                (ctx.tenant_id, dev_account, row["name"]),
            )
            existing = dev_cur.fetchone()
            created_by = map_user_id(ctx, row["created_by"])
            if existing:
                dev_tpl_id = existing["id"]
                dev_cur.execute(
                    """
                    UPDATE expense_templates SET
                        description = %s, icon = %s, created_by = %s, active = %s,
                        last_updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        row["description"],
                        row["icon"],
                        created_by,
                        row["active"],
                        dev_tpl_id,
                    ),
                )
            else:
                dev_cur.execute(
                    """
                    INSERT INTO expense_templates (
                        account_id, tenant_id, name, description, icon,
                        created_by, active, created_at, last_updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                    RETURNING id
                    """,
                    (
                        dev_account,
                        ctx.tenant_id,
                        row["name"],
                        row["description"],
                        row["icon"],
                        created_by,
                        row["active"],
                    ),
                )
                dev_tpl_id = dev_cur.fetchone()["id"]
            ctx.template_map[row["id"]] = dev_tpl_id
            tpl_count += 1

            prod_cur.execute(
                """
                SELECT id, account_id, tenant_id, expense_template_id, description, amount,
                       day_of_month, subtag_id, ownership_percentage, expense_sharing_id,
                       display_order, created_by
                FROM expense_template_items
                WHERE expense_template_id = %s
                ORDER BY display_order, id
                """,
                (row["id"],),
            )
            items = prod_cur.fetchall()
            synced_orders: Set[int] = set()
            for item in items:
                dev_item_account = ctx.account_map.get(item["account_id"], dev_account)
                dev_subtag = (
                    ctx.subtag_map.get(item["subtag_id"]) if item["subtag_id"] else None
                )
                dev_sharing = (
                    ctx.sharing_map.get(item["expense_sharing_id"])
                    if item["expense_sharing_id"]
                    else None
                )
                created_by_item = map_user_id(ctx, item["created_by"])
                dev_cur.execute(
                    """
                    SELECT id FROM expense_template_items
                    WHERE expense_template_id = %s AND display_order = %s
                    LIMIT 1
                    """,
                    (dev_tpl_id, item["display_order"]),
                )
                existing_item = dev_cur.fetchone()
                if existing_item:
                    dev_cur.execute(
                        """
                        UPDATE expense_template_items SET
                            account_id = %s, description = %s, amount = %s, day_of_month = %s,
                            subtag_id = %s, ownership_percentage = %s, expense_sharing_id = %s,
                            created_by = %s, last_updated_at = NOW()
                        WHERE id = %s
                        """,
                        (
                            dev_item_account,
                            item["description"],
                            item["amount"],
                            item["day_of_month"],
                            dev_subtag,
                            item["ownership_percentage"],
                            dev_sharing,
                            created_by_item,
                            existing_item["id"],
                        ),
                    )
                else:
                    dev_cur.execute(
                        """
                        INSERT INTO expense_template_items (
                            account_id, tenant_id, expense_template_id, description, amount,
                            day_of_month, subtag_id, ownership_percentage, expense_sharing_id,
                            display_order, created_by, created_at, last_updated_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                        """,
                        (
                            dev_item_account,
                            ctx.tenant_id,
                            dev_tpl_id,
                            item["description"],
                            item["amount"],
                            item["day_of_month"],
                            dev_subtag,
                            item["ownership_percentage"],
                            dev_sharing,
                            item["display_order"],
                            created_by_item,
                        ),
                    )
                synced_orders.add(item["display_order"])
                item_count += 1

            if synced_orders:
                dev_cur.execute(
                    """
                    DELETE FROM expense_template_items
                    WHERE expense_template_id = %s AND NOT (display_order = ANY(%s))
                    """,
                    (dev_tpl_id, list(synced_orders)),
                )

    print(f"  templates: {tpl_count}, itens: {item_count} upsert(s)")


def sync_faturas(source_conn, dest_conn, ctx: SyncContext) -> None:
    """
    Copia credit_card_invoices com FKs remapeadas (cartão, subtag, compartilhamento, conta).
    bank_statement_id aponta para o extrato copiado nesta execução; senão fica NULL.
    """
    inserted = 0
    updated = 0
    skipped_no_card = 0
    skipped_bad_fk = 0

    with source_conn.cursor() as src_cur, dest_conn.cursor() as dest_cur:
        src_cur.execute(
            """
            SELECT id, credit_card_id, year_month, date, description, amount,
                   current_installment, total_installments, subtag_id,
                   ownership_percentage, expense_sharing_id, adjustment_notes,
                   account_id, issuer, bank_statement_id, created_by
            FROM credit_card_invoices
            WHERE tenant_id = %s
            ORDER BY id
            """,
            (ctx.tenant_id,),
        )
        rows = src_cur.fetchall()

        for row in rows:
            dev_card = ctx.credit_card_map.get(row["credit_card_id"])
            if dev_card is None:
                skipped_no_card += 1
                continue

            dev_subtag, skip_subtag = map_transaction_subtag(ctx, row["subtag_id"])
            if skip_subtag:
                skipped_bad_fk += 1
                continue

            dev_sharing = (
                ctx.sharing_map.get(row["expense_sharing_id"])
                if row["expense_sharing_id"]
                else None
            )
            if row["expense_sharing_id"] and dev_sharing is None:
                skipped_bad_fk += 1
                continue

            dev_account = (
                ctx.account_map.get(row["account_id"]) if row["account_id"] else None
            )
            if row["account_id"] and dev_account is None:
                skipped_bad_fk += 1
                continue

            created_by = map_user_id(ctx, row["created_by"])
            if created_by is None:
                skipped_bad_fk += 1
                continue

            dev_statement = (
                ctx.statement_map.get(row["bank_statement_id"])
                if row["bank_statement_id"]
                else None
            )

            dest_cur.execute(
                """
                SELECT id FROM credit_card_invoices
                WHERE tenant_id = %s AND credit_card_id = %s AND year_month = %s
                  AND date = %s AND description = %s AND amount = %s
                  AND COALESCE(current_installment, -1) = COALESCE(%s, -1)
                  AND COALESCE(total_installments, -1) = COALESCE(%s, -1)
                LIMIT 1
                """,
                (
                    ctx.tenant_id,
                    dev_card,
                    row["year_month"],
                    row["date"],
                    row["description"],
                    row["amount"],
                    row["current_installment"],
                    row["total_installments"],
                ),
            )
            existing = dest_cur.fetchone()

            if existing:
                dev_id = existing["id"]
                dest_cur.execute(
                    """
                    UPDATE credit_card_invoices SET
                        subtag_id = %s,
                        ownership_percentage = %s,
                        expense_sharing_id = %s,
                        adjustment_notes = %s,
                        account_id = %s,
                        issuer = %s,
                        bank_statement_id = %s,
                        created_by = %s,
                        last_updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        dev_subtag,
                        row["ownership_percentage"],
                        dev_sharing,
                        row["adjustment_notes"],
                        dev_account,
                        row["issuer"],
                        dev_statement,
                        created_by,
                        dev_id,
                    ),
                )
                updated += 1
            else:
                dest_cur.execute(
                    """
                    INSERT INTO credit_card_invoices (
                        credit_card_id, year_month, date, description, amount,
                        current_installment, total_installments, subtag_id,
                        ownership_percentage, expense_sharing_id, adjustment_notes,
                        account_id, issuer, bank_statement_id,
                        tenant_id, created_by, created_at, last_updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, NOW(), NOW()
                    )
                    RETURNING id
                    """,
                    (
                        dev_card,
                        row["year_month"],
                        row["date"],
                        row["description"],
                        row["amount"],
                        row["current_installment"],
                        row["total_installments"],
                        dev_subtag,
                        row["ownership_percentage"],
                        dev_sharing,
                        row["adjustment_notes"],
                        dev_account,
                        row["issuer"],
                        dev_statement,
                        ctx.tenant_id,
                        created_by,
                    ),
                )
                dev_id = dest_cur.fetchone()["id"]
                inserted += 1

            ctx.invoice_map[row["id"]] = dev_id

    print(
        f"  faturas: {inserted} inserida(s), {updated} atualizada(s), "
        f"ignoradas (cartão): {skipped_no_card}, ignoradas (FK): {skipped_bad_fk}"
    )


def sync_beneficios(source_conn, dest_conn, ctx: SyncContext) -> None:
    """
    Copia benefit_card_statements (cartões type=beneficios) com FKs remapeadas.
    """
    inserted = 0
    updated = 0
    skipped_no_card = 0
    skipped_bad_fk = 0

    with source_conn.cursor() as src_cur, dest_conn.cursor() as dest_cur:
        src_cur.execute(
            """
            SELECT b.id, b.credit_card_id, b.date, b.description, b.amount,
                   b.payment_method, b.subtag_id, b.ownership_percentage,
                   b.expense_sharing_id, b.adjustment_notes, b.account_id, b.created_by
            FROM benefit_card_statements b
            WHERE b.tenant_id = %s
            ORDER BY b.id
            """,
            (ctx.tenant_id,),
        )
        rows = src_cur.fetchall()

        for row in rows:
            dev_card = ctx.credit_card_map.get(row["credit_card_id"])
            if dev_card is None:
                skipped_no_card += 1
                continue

            dev_subtag, skip_subtag = map_transaction_subtag(ctx, row["subtag_id"])
            if skip_subtag:
                skipped_bad_fk += 1
                continue

            dev_sharing = (
                ctx.sharing_map.get(row["expense_sharing_id"])
                if row["expense_sharing_id"]
                else None
            )
            if row["expense_sharing_id"] and dev_sharing is None:
                skipped_bad_fk += 1
                continue

            dev_account = (
                ctx.account_map.get(row["account_id"]) if row["account_id"] else None
            )
            if row["account_id"] and dev_account is None:
                skipped_bad_fk += 1
                continue

            created_by = map_user_id(ctx, row["created_by"])
            if created_by is None:
                skipped_bad_fk += 1
                continue

            dest_cur.execute(
                """
                SELECT id FROM benefit_card_statements
                WHERE tenant_id = %s AND credit_card_id = %s AND date = %s
                  AND description = %s AND amount = %s
                  AND COALESCE(payment_method, '') = COALESCE(%s, '')
                LIMIT 1
                """,
                (
                    ctx.tenant_id,
                    dev_card,
                    row["date"],
                    row["description"],
                    row["amount"],
                    row["payment_method"],
                ),
            )
            existing = dest_cur.fetchone()

            if existing:
                dev_id = existing["id"]
                dest_cur.execute(
                    """
                    UPDATE benefit_card_statements SET
                        subtag_id = %s,
                        ownership_percentage = %s,
                        expense_sharing_id = %s,
                        adjustment_notes = %s,
                        account_id = %s,
                        payment_method = %s,
                        created_by = %s,
                        last_updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        dev_subtag,
                        row["ownership_percentage"],
                        dev_sharing,
                        row["adjustment_notes"],
                        dev_account,
                        row["payment_method"],
                        created_by,
                        dev_id,
                    ),
                )
                updated += 1
            else:
                dest_cur.execute(
                    """
                    INSERT INTO benefit_card_statements (
                        credit_card_id, date, description, amount, payment_method,
                        subtag_id, ownership_percentage, expense_sharing_id,
                        adjustment_notes, account_id,
                        tenant_id, created_by, created_at, last_updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
                    )
                    RETURNING id
                    """,
                    (
                        dev_card,
                        row["date"],
                        row["description"],
                        row["amount"],
                        row["payment_method"],
                        dev_subtag,
                        row["ownership_percentage"],
                        dev_sharing,
                        row["adjustment_notes"],
                        dev_account,
                        ctx.tenant_id,
                        created_by,
                    ),
                )
                dev_id = dest_cur.fetchone()["id"]
                inserted += 1

            ctx.benefit_statement_map[row["id"]] = dev_id

    print(
        f"  beneficios: {inserted} inserida(s), {updated} atualizada(s), "
        f"ignoradas (cartão): {skipped_no_card}, ignoradas (FK): {skipped_bad_fk}"
    )


def sync_extratos(source_conn, dest_conn, ctx: SyncContext) -> None:
    """
    Copia bank_statements com FKs remapeadas (conta, subtag, compartilhamento).
    Identidade no destino: conta + data + descrição + valor + categoria + transação.
    """
    inserted = 0
    updated = 0
    skipped_no_account = 0
    skipped_bad_fk = 0
    used_dest_ids: List[int] = []

    with source_conn.cursor() as src_cur, dest_conn.cursor() as dest_cur:
        src_cur.execute(
            """
            SELECT id, category, transaction, description, date, amount,
                   subtag_id, account_id, ownership_percentage, expense_sharing_id,
                   adjustment_notes, migrated_from_account_id, migrated_from_table,
                   created_by
            FROM bank_statements
            WHERE tenant_id = %s
            ORDER BY id
            """,
            (ctx.tenant_id,),
        )
        rows = src_cur.fetchall()

        for row in rows:
            dev_account = ctx.account_map.get(row["account_id"]) if row["account_id"] else None
            if row["account_id"] and dev_account is None:
                skipped_no_account += 1
                continue
            if dev_account is None:
                skipped_no_account += 1
                continue

            dev_subtag, skip_subtag = map_transaction_subtag(ctx, row["subtag_id"])
            if skip_subtag:
                skipped_bad_fk += 1
                continue

            dev_sharing = (
                ctx.sharing_map.get(row["expense_sharing_id"])
                if row["expense_sharing_id"]
                else None
            )
            if row["expense_sharing_id"] and dev_sharing is None:
                skipped_bad_fk += 1
                continue

            dev_migrated_from = (
                ctx.account_map.get(row["migrated_from_account_id"])
                if row["migrated_from_account_id"]
                else None
            )

            created_by = map_user_id(ctx, row["created_by"])
            if created_by is None:
                skipped_bad_fk += 1
                continue

            dest_cur.execute(
                """
                SELECT id FROM bank_statements
                WHERE tenant_id = %s AND account_id = %s
                  AND date = %s AND description = %s AND amount = %s
                  AND COALESCE(category, '') = COALESCE(%s, '')
                  AND COALESCE(transaction, '') = COALESCE(%s, '')
                  AND NOT (id = ANY(%s))
                ORDER BY id
                LIMIT 1
                """,
                (
                    ctx.tenant_id,
                    dev_account,
                    row["date"],
                    row["description"],
                    row["amount"],
                    row["category"],
                    row["transaction"],
                    used_dest_ids or [-1],
                ),
            )
            existing = dest_cur.fetchone()

            if existing:
                dev_id = existing["id"]
                dest_cur.execute(
                    """
                    UPDATE bank_statements SET
                        category = %s,
                        transaction = %s,
                        subtag_id = %s,
                        ownership_percentage = %s,
                        expense_sharing_id = %s,
                        adjustment_notes = %s,
                        migrated_from_account_id = %s,
                        migrated_from_table = %s,
                        created_by = %s,
                        last_updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        row["category"],
                        row["transaction"],
                        dev_subtag,
                        row["ownership_percentage"],
                        dev_sharing,
                        row["adjustment_notes"],
                        dev_migrated_from,
                        row["migrated_from_table"],
                        created_by,
                        dev_id,
                    ),
                )
                updated += 1
            else:
                dest_cur.execute(
                    """
                    INSERT INTO bank_statements (
                        category, transaction, description, date, amount,
                        subtag_id, account_id, ownership_percentage, expense_sharing_id,
                        adjustment_notes, migrated_from_account_id, migrated_from_table,
                        tenant_id, created_by, created_at, last_updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
                    )
                    RETURNING id
                    """,
                    (
                        row["category"],
                        row["transaction"],
                        row["description"],
                        row["date"],
                        row["amount"],
                        dev_subtag,
                        dev_account,
                        row["ownership_percentage"],
                        dev_sharing,
                        row["adjustment_notes"],
                        dev_migrated_from,
                        row["migrated_from_table"],
                        ctx.tenant_id,
                        created_by,
                    ),
                )
                dev_id = dest_cur.fetchone()["id"]
                inserted += 1

            used_dest_ids.append(dev_id)
            ctx.statement_map[row["id"]] = dev_id

    print(
        f"  extratos: {inserted} inserido(s), {updated} atualizado(s), "
        f"ignorados (conta): {skipped_no_account}, ignorados (FK): {skipped_bad_fk}"
    )


SYNC_HANDLERS = {
    "contas": sync_contas,
    "compartilhamentos": sync_compartilhamentos,
    "tags": sync_tags,
    "cartoes": sync_cartoes,
    "mapeamentos": sync_mapeamentos,
    "templates": sync_templates,
    "extratos": sync_extratos,
    "faturas": sync_faturas,
    "beneficios": sync_beneficios,
}


def preload_account_map(prod_conn, dev_conn, ctx: SyncContext) -> None:
    """Mapeia contas já existentes em DEV pelo nome (para sync parcial)."""
    with prod_conn.cursor() as prod_cur, dev_conn.cursor() as dev_cur:
        prod_cur.execute(
            "SELECT id, TRIM(name) AS name FROM accounts WHERE tenant_id = %s",
            (ctx.tenant_id,),
        )
        prod_rows = prod_cur.fetchall()
        for row in prod_rows:
            dev_cur.execute(
                """
                SELECT id FROM accounts
                WHERE tenant_id = %s AND TRIM(name) = %s LIMIT 1
                """,
                (ctx.tenant_id, row["name"]),
            )
            dev_row = dev_cur.fetchone()
            if dev_row:
                ctx.account_map[row["id"]] = dev_row["id"]


def preload_sharing_map(prod_conn, dev_conn, ctx: SyncContext) -> None:
    with prod_conn.cursor() as prod_cur, dev_conn.cursor() as dev_cur:
        prod_cur.execute(
            """
            SELECT id, account_id, shared_account_id
            FROM expense_sharing_settings WHERE tenant_id = %s
            """,
            (ctx.tenant_id,),
        )
        for row in prod_cur.fetchall():
            dev_acc = ctx.account_map.get(row["account_id"])
            dev_shared = ctx.account_map.get(row["shared_account_id"])
            if dev_acc is None or dev_shared is None:
                continue
            dev_cur.execute(
                """
                SELECT id FROM expense_sharing_settings
                WHERE tenant_id = %s AND account_id = %s AND shared_account_id = %s
                LIMIT 1
                """,
                (ctx.tenant_id, dev_acc, dev_shared),
            )
            dev_row = dev_cur.fetchone()
            if dev_row:
                ctx.sharing_map[row["id"]] = dev_row["id"]


def preload_tag_maps(prod_conn, dev_conn, ctx: SyncContext) -> None:
    with prod_conn.cursor() as prod_cur, dev_conn.cursor() as dev_cur:
        prod_cur.execute(
            "SELECT id, account_id, TRIM(name) AS name FROM tags WHERE tenant_id = %s",
            (ctx.tenant_id,),
        )
        for row in prod_cur.fetchall():
            dev_acc = ctx.account_map.get(row["account_id"])
            if dev_acc is None:
                continue
            dev_cur.execute(
                """
                SELECT id FROM tags
                WHERE tenant_id = %s AND account_id = %s AND TRIM(name) = %s LIMIT 1
                """,
                (ctx.tenant_id, dev_acc, row["name"]),
            )
            dev_row = dev_cur.fetchone()
            if dev_row:
                ctx.tag_map[row["id"]] = dev_row["id"]

        prod_cur.execute(
            """
            SELECT s.id, s.account_id, s.tag_id, TRIM(s.name) AS name, s.type
            FROM subtags s WHERE s.tenant_id = %s
            """,
            (ctx.tenant_id,),
        )
        for row in prod_cur.fetchall():
            dev_acc = ctx.account_map.get(row["account_id"])
            dev_tag = ctx.tag_map.get(row["tag_id"])
            if dev_acc is None or dev_tag is None:
                continue
            dev_cur.execute(
                """
                SELECT id FROM subtags
                WHERE tenant_id = %s AND account_id = %s AND tag_id = %s
                  AND TRIM(name) = %s AND type = %s LIMIT 1
                """,
                (ctx.tenant_id, dev_acc, dev_tag, row["name"], row["type"]),
            )
            dev_row = dev_cur.fetchone()
            if dev_row:
                ctx.subtag_map[row["id"]] = dev_row["id"]


def preload_credit_card_maps(source_conn, dest_conn, ctx: SyncContext) -> None:
    """Mapeia grupos de fatura e cartões já existentes no destino (sync parcial)."""
    with source_conn.cursor() as src_cur, dest_conn.cursor() as dest_cur:
        src_cur.execute(
            """
            SELECT id, account_id, TRIM(name) AS name
            FROM credit_card_invoice_groups
            WHERE tenant_id = %s
            """,
            (ctx.tenant_id,),
        )
        for row in src_cur.fetchall():
            dev_acc = ctx.account_map.get(row["account_id"])
            if dev_acc is None:
                continue
            dest_cur.execute(
                """
                SELECT id FROM credit_card_invoice_groups
                WHERE tenant_id = %s AND account_id = %s AND TRIM(name) = %s
                LIMIT 1
                """,
                (ctx.tenant_id, dev_acc, row["name"]),
            )
            dev_row = dest_cur.fetchone()
            if dev_row:
                ctx.invoice_group_map[row["id"]] = dev_row["id"]

        src_cur.execute(
            """
            SELECT id, account_id, TRIM(name) AS name, number
            FROM credit_cards WHERE tenant_id = %s
            """,
            (ctx.tenant_id,),
        )
        for row in src_cur.fetchall():
            dev_acc = ctx.account_map.get(row["account_id"])
            if dev_acc is None:
                continue
            dest_cur.execute(
                """
                SELECT id FROM credit_cards
                WHERE tenant_id = %s AND account_id = %s
                  AND TRIM(name) = %s AND number = %s
                LIMIT 1
                """,
                (ctx.tenant_id, dev_acc, row["name"], row["number"]),
            )
            dev_row = dest_cur.fetchone()
            if dev_row:
                ctx.credit_card_map[row["id"]] = dev_row["id"]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sincroniza cadastros entre PROD e DEV (upsert)."
    )
    parser.add_argument(
        "-db",
        "--db",
        choices=("prod", "dev"),
        default="prod",
        help="Banco de origem (destino: o outro ambiente). Padrão: prod → dev",
    )
    for name in DOMAIN_ALIASES:
        if name == "all":
            parser.add_argument("--all", action="store_true", help="Todos os cadastros")
        else:
            parser.add_argument(
                f"--{name.replace('_', '-')}",
                action="store_true",
                help=f"Sincronizar {name}",
            )
    parser.add_argument(
        "-x",
        "--exclude",
        nargs="+",
        metavar="DOMINIO",
        default=[],
        help="Com --all: domínios a omitir (ex.: -x templates mapeamentos)",
    )
    parser.add_argument(
        "--tenant-id",
        type=int,
        default=1,
        help="Tenant a sincronizar (padrão: 1)",
    )
    args = parser.parse_args()

    if args.exclude and not args.all:
        print("❌ -x / --exclude só pode ser usado com --all.")
        sys.exit(1)

    raw_flags: List[str] = []
    if args.all:
        raw_flags.append("all")
    for name in DOMAIN_ALIASES:
        if name == "all":
            continue
        attr = name.replace("-", "_")
        if getattr(args, attr, False):
            raw_flags.append(name)

    try:
        domains = resolve_domains(raw_flags, excludes=args.exclude or None)
    except ValueError as exc:
        print(f"❌ {exc}")
        sys.exit(1)

    if args.db == "prod":
        source_env, dest_env = ".env.prod", ".env.dev"
        source_label, dest_label = "PROD", "DEV"
    else:
        source_env, dest_env = ".env.dev", ".env.prod"
        source_label, dest_label = "DEV", "PROD"

    source_cfg = parse_db_config(PROJECT_ROOT / source_env)
    dest_cfg = parse_db_config(PROJECT_ROOT / dest_env)

    source_conn = connect(source_cfg, f"origem ({source_label})")
    dest_conn = connect(dest_cfg, f"destino ({dest_label})")

    ctx = SyncContext(tenant_id=args.tenant_id)
    ctx.user_map = build_user_map(source_conn, dest_conn, ctx.tenant_id)
    ctx.apply_transaction_subtags = "mapeamentos" in domains

    exclude_note = f", excl.: {', '.join(args.exclude)}" if args.exclude else ""
    subtag_note = (
        " | subtags em extratos/faturas/benefícios: sim"
        if ctx.apply_transaction_subtags
        else " | subtags em extratos/faturas/benefícios: omitidas (sem mapeamentos)"
    )
    print(
        f"\n🔄 {source_label} → {dest_label} | "
        f"domínios: {', '.join(domains)} (tenant_id={ctx.tenant_id}{exclude_note})"
        f"{subtag_note}\n"
    )

    try:
        if "contas" not in domains:
            preload_account_map(source_conn, dest_conn, ctx)
        if "compartilhamentos" not in domains and any(
            d in domains
            for d in (
                "cartoes",
                "mapeamentos",
                "templates",
                "extratos",
                "faturas",
                "beneficios",
            )
        ):
            preload_sharing_map(source_conn, dest_conn, ctx)
        if "tags" not in domains and any(
            d in domains for d in ("mapeamentos", "templates", "extratos", "faturas", "beneficios")
        ):
            preload_tag_maps(source_conn, dest_conn, ctx)
        if "cartoes" not in domains and any(
            d in domains for d in ("faturas", "beneficios")
        ):
            preload_credit_card_maps(source_conn, dest_conn, ctx)

        for domain in domains:
            print(f"▶ {domain}")
            SYNC_HANDLERS[domain](source_conn, dest_conn, ctx)

        dest_conn.commit()
        print(f"\n✅ Sincronização concluída (commit em {dest_label}).")
    except Exception as exc:
        dest_conn.rollback()
        print(f"\n❌ Erro — rollback em {dest_label}: {exc}")
        raise
    finally:
        source_conn.close()
        dest_conn.close()


if __name__ == "__main__":
    main()
