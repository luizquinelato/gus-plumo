"""
Migration 0022: closing_day em credit_cards e credit_card_invoice_groups.

- closing_day: dia de fechamento da fatura (ciclo / balanço compartilhado)
- due_day: dia de vencimento (já existia)
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


def _add_closing_day_column(cursor, table: str, prefix: str) -> None:
    cursor.execute(f"""
        ALTER TABLE {table}
        ADD COLUMN IF NOT EXISTS closing_day INTEGER NOT NULL DEFAULT 14;
    """)
    cursor.execute(f"""
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'chk_{prefix}_closing_day'
          ) THEN
            ALTER TABLE {table}
            ADD CONSTRAINT chk_{prefix}_closing_day
            CHECK (closing_day >= 1 AND closing_day <= 30);
          END IF;
        END $$;
    """)


def apply(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Aplicando Migration 0022: closing_day...")
        _add_closing_day_column(cursor, "credit_cards", "credit_cards")
        _add_closing_day_column(cursor, "credit_card_invoice_groups", "invoice_groups")

        cursor.execute("""
            UPDATE credit_cards
            SET closing_day = due_day
            WHERE closing_day IS NULL OR closing_day = 14;
        """)
        cursor.execute("""
            UPDATE credit_card_invoice_groups
            SET closing_day = due_day
            WHERE closing_day IS NULL OR closing_day = 14;
        """)
        cursor.execute("""
            UPDATE credit_cards c
            SET closing_day = g.closing_day,
                due_day = g.due_day
            FROM credit_card_invoice_groups g
            WHERE c.invoice_group_id = g.id AND c.type = 'credito';
        """)
        cursor.execute("""
            COMMENT ON COLUMN credit_cards.closing_day IS
            'Dia de fechamento da fatura (1-30). Define ciclo e inclusão no balanço compartilhado.';
        """)
        cursor.execute("""
            COMMENT ON COLUMN credit_cards.due_day IS
            'Dia de vencimento da fatura (1-30).';
        """)
        cursor.execute("""
            COMMENT ON COLUMN credit_card_invoice_groups.closing_day IS
            'Dia de fechamento conjunto; cartões do grupo herdam.';
        """)
        cursor.execute("""
            COMMENT ON COLUMN credit_card_invoice_groups.due_day IS
            'Dia de vencimento conjunto; cartões do grupo herdam.';
        """)
        connection.commit()
        print("✅ Migration 0022 aplicada com sucesso.")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0022: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0022...")
        for table, prefix in (
            ("credit_cards", "credit_cards"),
            ("credit_card_invoice_groups", "invoice_groups"),
        ):
            cursor.execute(f"""
                ALTER TABLE {table}
                DROP CONSTRAINT IF EXISTS chk_{prefix}_closing_day;
            """)
            cursor.execute(f"""
                ALTER TABLE {table} DROP COLUMN IF EXISTS closing_day;
            """)
        connection.commit()
        print("✅ Rollback 0022 concluído.")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro no rollback 0022: {e}")
        raise
    finally:
        cursor.close()


if __name__ == "__main__":
    conn = get_database_connection()
    apply(conn)
    conn.close()
