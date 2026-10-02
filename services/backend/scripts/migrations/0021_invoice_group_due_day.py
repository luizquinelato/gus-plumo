"""
Migration 0021: due_day em credit_card_invoice_groups (vencimento unificado do grupo).
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


def apply(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Aplicando Migration 0021: due_day em credit_card_invoice_groups...")
        cursor.execute("""
            ALTER TABLE credit_card_invoice_groups
            ADD COLUMN IF NOT EXISTS due_day INTEGER NOT NULL DEFAULT 14;
        """)
        cursor.execute("""
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_groups_due_day'
              ) THEN
                ALTER TABLE credit_card_invoice_groups
                ADD CONSTRAINT chk_invoice_groups_due_day
                CHECK (due_day >= 1 AND due_day <= 30);
              END IF;
            END $$;
        """)
        cursor.execute("""
            UPDATE credit_card_invoice_groups g
            SET due_day = COALESCE(
                (
                    SELECT c.due_day
                    FROM credit_cards c
                    WHERE c.invoice_group_id = g.id AND c.type = 'credito'
                    ORDER BY c.id
                    LIMIT 1
                ),
                14
            )
            WHERE g.due_day IS NULL OR g.due_day = 14;
        """)
        cursor.execute("""
            UPDATE credit_cards c
            SET due_day = g.due_day
            FROM credit_card_invoice_groups g
            WHERE c.invoice_group_id = g.id AND c.type = 'credito';
        """)
        cursor.execute("""
            COMMENT ON COLUMN credit_card_invoice_groups.due_day IS
            'Dia de vencimento da fatura conjunta; todos os cartões do grupo usam este valor.';
        """)
        connection.commit()
        print("✅ Migration 0021 aplicada com sucesso.")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0021: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0021...")
        cursor.execute("""
            ALTER TABLE credit_card_invoice_groups
            DROP CONSTRAINT IF EXISTS chk_invoice_groups_due_day;
        """)
        cursor.execute("""
            ALTER TABLE credit_card_invoice_groups
            DROP COLUMN IF EXISTS due_day;
        """)
        connection.commit()
        print("✅ Rollback 0021 concluído.")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro no rollback 0021: {e}")
        raise
    finally:
        cursor.close()


if __name__ == "__main__":
    conn = get_database_connection()
    try:
        apply(conn)
    finally:
        conn.close()
