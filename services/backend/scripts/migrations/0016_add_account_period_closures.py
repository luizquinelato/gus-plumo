"""
Migration 0016: Fechamentos mensais explícitos da conta (extrato bancário).

Tabela account_period_closures — snapshot travado por ano/mês da conta logada.
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

        project_root = Path(__file__).resolve().parents[4]
        for env_name in ('.env.dev', '.env', '.env.prod'):
            env_file = project_root / env_name
            if env_file.exists():
                load_dotenv(env_file, override=False)

        load_dotenv()

        database_url = os.getenv('DATABASE_URL', 'postgresql://plumo:plumo@localhost:5432/plumo')

        import re
        match = re.match(r'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)', database_url)
        if not match:
            raise ValueError(f"Invalid DATABASE_URL format: {database_url}")

        user, password, host, port, database = match.groups()

        return psycopg2.connect(
            host=host,
            port=int(port),
            database=database,
            user=user,
            password=password,
            cursor_factory=RealDictCursor
        )
    except Exception as e:
        print(f"❌ Erro ao conectar ao banco: {e}")
        raise


CREATE_SQL = """
CREATE TABLE IF NOT EXISTS account_period_closures (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    opening_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    entries DECIMAL(15, 2) NOT NULL DEFAULT 0,
    exits DECIMAL(15, 2) NOT NULL DEFAULT 0,
    closing_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    closure_data JSONB NOT NULL,
    notes TEXT,
    account_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    CONSTRAINT chk_account_period_closures_month CHECK (month >= 1 AND month <= 12),
    CONSTRAINT uq_account_period_closures_period UNIQUE (tenant_id, account_id, year, month)
);
"""


def apply(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Aplicando Migration 0016: Fechamentos mensais da conta...")
        cursor.execute(CREATE_SQL)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_account_period_closures_account "
            "ON account_period_closures(account_id, year, month);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_account_period_closures_tenant "
            "ON account_period_closures(tenant_id);"
        )
        print("  ✓ Tabela account_period_closures")
        connection.commit()
        print("✅ Migration 0016 aplicada com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0016: {e}")
        raise
    finally:
        cursor.close()


if __name__ == '__main__':
    conn = get_database_connection()
    try:
        apply(conn)
    finally:
        conn.close()
