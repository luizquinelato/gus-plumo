"""
Migration 0020: credit_cards.closing_day → due_day (dia de vencimento da fatura).
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
        print("🔄 Aplicando Migration 0020: closing_day → due_day em credit_cards...")
        cursor.execute("""
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'credit_cards' AND column_name = 'closing_day'
        """)
        if cursor.fetchone():
            cursor.execute("""
                ALTER TABLE credit_cards
                RENAME COLUMN closing_day TO due_day;
            """)
            cursor.execute("""
                ALTER TABLE credit_cards
                DROP CONSTRAINT IF EXISTS chk_credit_cards_closing_day;
            """)
            cursor.execute("""
                ALTER TABLE credit_cards
                ADD CONSTRAINT chk_credit_cards_due_day
                CHECK (due_day >= 1 AND due_day <= 30);
            """)
            cursor.execute("""
                COMMENT ON COLUMN credit_cards.due_day IS
                'Dia de vencimento da fatura (1-30). Mesma regra de ciclo: (due_day+1) do mês anterior até due_day do mês atual.';
            """)
        connection.commit()
        print("✅ Migration 0020 aplicada com sucesso.")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0020: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0020...")
        cursor.execute("""
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'credit_cards' AND column_name = 'due_day'
        """)
        if cursor.fetchone():
            cursor.execute("""
                ALTER TABLE credit_cards
                DROP CONSTRAINT IF EXISTS chk_credit_cards_due_day;
            """)
            cursor.execute("""
                ALTER TABLE credit_cards
                RENAME COLUMN due_day TO closing_day;
            """)
            cursor.execute("""
                ALTER TABLE credit_cards
                ADD CONSTRAINT chk_credit_cards_closing_day
                CHECK (closing_day >= 1 AND closing_day <= 30);
            """)
        connection.commit()
        print("✅ Rollback 0020 concluído.")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro no rollback 0020: {e}")
        raise
    finally:
        cursor.close()


if __name__ == "__main__":
    conn = get_database_connection()
    try:
        apply(conn)
    finally:
        conn.close()
