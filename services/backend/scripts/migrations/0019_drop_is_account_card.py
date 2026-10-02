"""
Migration 0019: remove credit_cards.is_account_card (participação só via % e sharing).

Antes de dropar, converte legado explícito:
- is_account_card = false → 0% despesa/receita (sem compartilhamento)
- is_account_card = true  → 100% onde % ainda NULL (sem compartilhamento)
"""

import os
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))


def get_database_connection():
    try:
        from dotenv import load_dotenv

        project_root = Path(__file__).resolve().parents[4]
        for env_name in (".env.dev", ".env", ".env.prod"):
            env_file = project_root / env_name
            if env_file.exists():
                load_dotenv(env_file, override=False)

        load_dotenv()

        database_url = os.getenv("DATABASE_URL", "postgresql://plumo:plumo@localhost:5432/plumo")

        import re

        match = re.match(
            r"postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)", database_url
        )
        if not match:
            raise ValueError(f"Invalid DATABASE_URL format: {database_url}")

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


def _column_exists(cursor, table: str, column: str) -> bool:
    cursor.execute(
        """
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
        LIMIT 1
        """,
        (table, column),
    )
    return cursor.fetchone() is not None


def apply(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Aplicando Migration 0019: remove is_account_card de credit_cards...")
        if not _column_exists(cursor, "credit_cards", "is_account_card"):
            print("  ⏭ Coluna is_account_card já ausente; nada a fazer.")
            connection.commit()
            return

        cursor.execute("""
            UPDATE credit_cards
            SET expense_ownership_percentage = 0,
                revenue_ownership_percentage = COALESCE(revenue_ownership_percentage, 0)
            WHERE expense_sharing_id IS NULL
              AND is_account_card IS FALSE
              AND expense_ownership_percentage IS NULL
        """)
        print(f"  ✓ Gerenciado (0%): {cursor.rowcount} cartão(ões)")

        cursor.execute("""
            UPDATE credit_cards
            SET expense_ownership_percentage = 100,
                revenue_ownership_percentage = COALESCE(revenue_ownership_percentage, 100)
            WHERE expense_sharing_id IS NULL
              AND is_account_card IS TRUE
              AND expense_ownership_percentage IS NULL
        """)
        print(f"  ✓ Próprio (100%): {cursor.rowcount} cartão(ões)")

        cursor.execute("""
            ALTER TABLE credit_cards
            DROP COLUMN IF EXISTS is_account_card
        """)
        print("  ✓ Coluna is_account_card removida")

        connection.commit()
        print("✅ Migration 0019 aplicada com sucesso.")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0019: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0019...")
        cursor.execute("""
            ALTER TABLE credit_cards
            ADD COLUMN IF NOT EXISTS is_account_card BOOLEAN NULL
        """)
        cursor.execute("""
            COMMENT ON COLUMN credit_cards.is_account_card IS
            'Legado: true = cartão da conta; false/NULL = gerenciado. Preferir expense_ownership_percentage.'
        """)
        cursor.execute("""
            UPDATE credit_cards
            SET is_account_card = CASE
                WHEN expense_sharing_id IS NOT NULL THEN NULL
                WHEN expense_ownership_percentage = 0 THEN FALSE
                ELSE TRUE
            END
            WHERE is_account_card IS NULL
        """)
        connection.commit()
        print("✅ Rollback 0019 concluído (coluna recriada; valores aproximados).")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro no rollback 0019: {e}")
        raise
    finally:
        cursor.close()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Migration 0019: remove is_account_card de credit_cards"
    )
    parser.add_argument("action", choices=["apply", "rollback"])
    args = parser.parse_args()
    conn = get_database_connection()
    try:
        if args.action == "apply":
            apply(conn)
        else:
            rollback(conn)
    finally:
        conn.close()
