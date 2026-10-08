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


def _has_column(cursor, table: str, column: str) -> bool:
    cursor.execute(
        """
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
        """,
        (table, column),
    )
    return cursor.fetchone() is not None


def _ensure_due_day_constraint_and_comment(cursor) -> None:
    cursor.execute("""
        ALTER TABLE credit_cards
        DROP CONSTRAINT IF EXISTS chk_credit_cards_closing_day;
    """)
    cursor.execute("""
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'chk_credit_cards_due_day'
          ) THEN
            ALTER TABLE credit_cards
            ADD CONSTRAINT chk_credit_cards_due_day
            CHECK (due_day >= 1 AND due_day <= 30);
          END IF;
        END $$;
    """)
    cursor.execute("""
        COMMENT ON COLUMN credit_cards.due_day IS
        'Dia de vencimento da fatura (1-30). Mesma regra de ciclo: (due_day+1) do mês anterior até due_day do mês atual.';
    """)


def apply(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Aplicando Migration 0020: closing_day → due_day em credit_cards...")
        has_closing = _has_column(cursor, "credit_cards", "closing_day")
        has_due = _has_column(cursor, "credit_cards", "due_day")

        if has_due and has_closing:
            print("  ✓ Schema atual já tem closing_day e due_day (0001+); renomear não é necessário.")
            _ensure_due_day_constraint_and_comment(cursor)
        elif has_closing and not has_due:
            cursor.execute("""
                ALTER TABLE credit_cards
                RENAME COLUMN closing_day TO due_day;
            """)
            _ensure_due_day_constraint_and_comment(cursor)
        elif has_due:
            print("  ✓ Coluna due_day já existe; nada a fazer.")
            _ensure_due_day_constraint_and_comment(cursor)
        else:
            print("  ⚠ credit_cards sem closing_day/due_day; pulando (schema inesperado).")
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
        has_closing = _has_column(cursor, "credit_cards", "closing_day")
        has_due = _has_column(cursor, "credit_cards", "due_day")

        if has_due and has_closing:
            print("  ✓ Ambas colunas presentes; rollback de rename não aplicável (schema 0001+).")
            cursor.execute("""
                ALTER TABLE credit_cards
                DROP CONSTRAINT IF EXISTS chk_credit_cards_due_day;
            """)
        elif has_due and not has_closing:
            cursor.execute("""
                ALTER TABLE credit_cards
                DROP CONSTRAINT IF EXISTS chk_credit_cards_due_day;
            """)
            cursor.execute("""
                ALTER TABLE credit_cards
                RENAME COLUMN due_day TO closing_day;
            """)
            cursor.execute("""
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'chk_credit_cards_closing_day'
                  ) THEN
                    ALTER TABLE credit_cards
                    ADD CONSTRAINT chk_credit_cards_closing_day
                    CHECK (closing_day >= 1 AND closing_day <= 30);
                  END IF;
                END $$;
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
