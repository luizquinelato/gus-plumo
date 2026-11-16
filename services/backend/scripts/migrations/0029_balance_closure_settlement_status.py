"""
Migration 0029: status de quitação por empréstimo em balance_closures.

- settlement_status: pending | settled | loan_open | settled_via_loan
- settlement_loan_id: FK opcional para loans.id
"""

import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))


def get_database_connection():
    try:
        from dotenv import load_dotenv
        from pathlib import Path
        import re

        project_root = Path(__file__).resolve().parents[4]
        for env_name in ('.env.dev', '.env', '.env.prod'):
            env_file = project_root / env_name
            if env_file.exists():
                load_dotenv(env_file, override=False)

        load_dotenv()

        database_url = os.getenv('DATABASE_URL', 'postgresql://plumo:plumo@localhost:5432/plumo')
        match = re.match(r'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)', database_url)
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


def apply(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Aplicando Migration 0029: settlement_status em balance_closures...")
        cursor.execute(
            "ALTER TABLE balance_closures ADD COLUMN IF NOT EXISTS settlement_status VARCHAR(24) "
            "NOT NULL DEFAULT 'pending';"
        )
        cursor.execute(
            "ALTER TABLE balance_closures ADD COLUMN IF NOT EXISTS settlement_loan_id INTEGER;"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_balance_closures_settlement_loan_id "
            "ON balance_closures (settlement_loan_id);"
        )
        cursor.execute(
            "ALTER TABLE balance_closures DROP CONSTRAINT IF EXISTS fk_balance_closures_settlement_loan;"
        )
        cursor.execute(
            "ALTER TABLE balance_closures ADD CONSTRAINT fk_balance_closures_settlement_loan "
            "FOREIGN KEY (settlement_loan_id) REFERENCES loans(id) ON DELETE SET NULL;"
        )
        cursor.execute(
            "ALTER TABLE balance_closures DROP CONSTRAINT IF EXISTS chk_balance_closures_settlement_status;"
        )
        cursor.execute(
            "ALTER TABLE balance_closures ADD CONSTRAINT chk_balance_closures_settlement_status "
            "CHECK (settlement_status IN ('pending', 'settled', 'loan_open', 'settled_via_loan'));"
        )
        cursor.execute(
            """
            UPDATE balance_closures
            SET settlement_status = CASE
                WHEN is_settled THEN 'settled'
                ELSE 'pending'
            END
            WHERE settlement_status IS NULL OR settlement_status = 'pending'
            """
        )
        connection.commit()
        print("✅ Migration 0029 aplicada com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0029: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0029...")
        cursor.execute(
            "ALTER TABLE balance_closures DROP CONSTRAINT IF EXISTS fk_balance_closures_settlement_loan;"
        )
        cursor.execute(
            "ALTER TABLE balance_closures DROP CONSTRAINT IF EXISTS chk_balance_closures_settlement_status;"
        )
        cursor.execute("DROP INDEX IF EXISTS ix_balance_closures_settlement_loan_id;")
        cursor.execute("ALTER TABLE balance_closures DROP COLUMN IF EXISTS settlement_loan_id;")
        cursor.execute("ALTER TABLE balance_closures DROP COLUMN IF EXISTS settlement_status;")
        connection.commit()
        print("✅ Migration 0029 revertida com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration 0029: {e}")
        raise
    finally:
        cursor.close()


if __name__ == "__main__":
    conn = get_database_connection()
    apply(conn)
    conn.close()