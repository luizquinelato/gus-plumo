"""
Migration 0023: remove payment_day de credit_cards e credit_card_invoice_groups.

Calendário de cartão: apenas closing_day (fechamento) e due_day (vencimento/pagamento).
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
        print("🔄 Aplicando Migration 0023: drop payment_day...")
        for table, prefix in (
            ("credit_cards", "credit_cards"),
            ("credit_card_invoice_groups", "invoice_groups"),
        ):
            cursor.execute(f"""
                ALTER TABLE {table}
                DROP CONSTRAINT IF EXISTS chk_{prefix}_payment_day;
            """)
            cursor.execute(f"""
                ALTER TABLE {table} DROP COLUMN IF EXISTS payment_day;
            """)
        connection.commit()
        print("✅ Migration 0023 aplicada com sucesso.")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0023: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0023 (recria payment_day = due_day)...")
        for table, prefix in (
            ("credit_cards", "credit_cards"),
            ("credit_card_invoice_groups", "invoice_groups"),
        ):
            cursor.execute(f"""
                ALTER TABLE {table}
                ADD COLUMN IF NOT EXISTS payment_day INTEGER NOT NULL DEFAULT 14;
            """)
            cursor.execute(f"""
                UPDATE {table} SET payment_day = due_day;
            """)
            cursor.execute(f"""
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'chk_{prefix}_payment_day'
                  ) THEN
                    ALTER TABLE {table}
                    ADD CONSTRAINT chk_{prefix}_payment_day
                    CHECK (payment_day >= 1 AND payment_day <= 30);
                  END IF;
                END $$;
            """)
        connection.commit()
        print("✅ Rollback 0023 concluído.")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro no rollback 0023: {e}")
        raise
    finally:
        cursor.close()


if __name__ == "__main__":
    conn = get_database_connection()
    apply(conn)
    conn.close()
