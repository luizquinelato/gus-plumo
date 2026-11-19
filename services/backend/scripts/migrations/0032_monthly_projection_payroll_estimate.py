"""
Migration 0032: origem payroll_estimate e coluna payroll_kind (advance|final).

Converte estimativas de folha (manual + automático + rótulo de holerite) para payroll_estimate.
"""

import os
import re
import sys

import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))

NEW_SOURCES = (
    "('manual', 'clone', 'card_invoice', 'card_item_manual', "
    "'card_item_installment', 'payroll', 'payroll_estimate', 'bank_statement')"
)
OLD_SOURCES = (
    "('manual', 'clone', 'card_invoice', 'card_item_manual', "
    "'card_item_installment', 'payroll', 'bank_statement')"
)

FINAL_LABEL = "Salário (fim do mês)"
ADVANCE_LABEL = "Adiantamento salarial"


def get_database_connection():
    try:
        from dotenv import load_dotenv
        from pathlib import Path

        project_root = Path(__file__).resolve().parents[4]
        for env_name in (".env.dev", ".env", ".env.prod"):
            env_file = project_root / env_name
            if env_file.exists():
                load_dotenv(env_file, override=False)
        load_dotenv()

        database_url = os.getenv("DATABASE_URL", "postgresql://plumo:plumo@localhost:5432/plumo")
        match = re.match(r"postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)", database_url)
        if not match:
            raise ValueError("Invalid DATABASE_URL format")
        user, password, host, port, database = match.groups()
        return psycopg2.connect(
            host=host,
            port=int(port),
            database=database,
            user=user,
            password=password,
            cursor_factory=RealDictCursor,
        )
    except Exception as e:
        print(f"❌ Erro ao conectar ao banco: {e}")
        raise


def _replace_source_constraint(cursor, sources: str) -> None:
    cursor.execute("ALTER TABLE monthly_projections DROP CONSTRAINT IF EXISTS chk_monthly_projections_source;")
    cursor.execute(
        "ALTER TABLE monthly_projections ADD CONSTRAINT chk_monthly_projections_source "
        f"CHECK (source IN {sources});"
    )


def _infer_kind(description: str, expected_day: int | None) -> str:
    desc = (description or "").strip()
    if desc.endswith(" (estimativa)"):
        desc = desc[: -len(" (estimativa)")].strip()
    if desc == ADVANCE_LABEL or desc.startswith(f"{ADVANCE_LABEL} "):
        return "advance"
    if expected_day == 15:
        return "advance"
    return "final"


def apply(connection) -> None:
    cursor = connection.cursor()
    try:
        print("🔄 Aplicando Migration 0032: payroll_estimate e payroll_kind...")
        cursor.execute(
            "ALTER TABLE monthly_projections "
            "ADD COLUMN IF NOT EXISTS payroll_kind VARCHAR(10);"
        )
        cursor.execute(
            "ALTER TABLE monthly_projections DROP CONSTRAINT IF EXISTS chk_monthly_projections_payroll_kind;"
        )
        cursor.execute(
            "ALTER TABLE monthly_projections ADD CONSTRAINT chk_monthly_projections_payroll_kind "
            "CHECK (payroll_kind IS NULL OR payroll_kind IN ('advance', 'final'));"
        )
        _replace_source_constraint(cursor, NEW_SOURCES)

        cursor.execute(
            """
            SELECT id, description, expected_date
            FROM monthly_projections
            WHERE active IS TRUE
              AND source = 'manual'
              AND is_automatic IS TRUE
              AND kind = 'income'
              AND (
                description LIKE %s
                OR description LIKE %s
              )
            """,
            (f"{FINAL_LABEL}%", f"{ADVANCE_LABEL}%"),
        )
        rows = cursor.fetchall()
        for row in rows:
            desc = row["description"] or ""
            day = row["expected_date"].day if row.get("expected_date") else None
            kind = _infer_kind(desc, day)
            clean = desc
            if clean.endswith(" (estimativa)"):
                clean = clean[: -len(" (estimativa)")].strip()
            cursor.execute(
                """
                UPDATE monthly_projections
                SET source = 'payroll_estimate',
                    payroll_kind = %s,
                    description = %s
                WHERE id = %s
                """,
                (kind, clean[:255], row["id"]),
            )

        cursor.execute(
            """
            UPDATE monthly_projections
            SET payroll_kind = 'final'
            WHERE active IS TRUE
              AND source = 'payroll'
              AND kind = 'income'
              AND is_automatic IS TRUE
              AND payroll_kind IS NULL
              AND (
                description = %s
                OR description LIKE %s
                OR expected_date = date_trunc('month', expected_date)::date
              )
            """,
            (FINAL_LABEL, f"{FINAL_LABEL} %"),
        )
        cursor.execute(
            """
            UPDATE monthly_projections
            SET payroll_kind = 'advance'
            WHERE active IS TRUE
              AND source = 'payroll'
              AND kind = 'income'
              AND is_automatic IS TRUE
              AND payroll_kind IS NULL
              AND (
                description = %s
                OR description LIKE %s
              )
            """,
            (ADVANCE_LABEL, f"{ADVANCE_LABEL} %"),
        )

        connection.commit()
        print(f"✅ Migration 0032 aplicada ({len(rows)} estimativa(s) convertidas).")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection) -> None:
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0032...")
        cursor.execute(
            """
            UPDATE monthly_projections
            SET source = 'manual'
            WHERE source = 'payroll_estimate'
            """
        )
        cursor.execute("ALTER TABLE monthly_projections DROP CONSTRAINT IF EXISTS chk_monthly_projections_payroll_kind;")
        cursor.execute("ALTER TABLE monthly_projections DROP COLUMN IF EXISTS payroll_kind;")
        _replace_source_constraint(cursor, OLD_SOURCES)
        connection.commit()
        print("✅ Rollback 0032 concluído.")
    except Exception as e:
        connection.rollback()
        raise
    finally:
        cursor.close()


if __name__ == "__main__":
    conn = get_database_connection()
    apply(conn)
    conn.close()