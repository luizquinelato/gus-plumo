"""
Migration 0024: Projeção mensal (receitas e despesas fixas/variáveis).

Tabela monthly_projections — itens projetados por conta, agrupados por year_month.
Ordem de colunas: negócio -> account_id -> BaseEntity -> active.
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


CREATE_SQL = """
CREATE TABLE IF NOT EXISTS monthly_projections (
    id SERIAL PRIMARY KEY,
    year_month VARCHAR(7) NOT NULL,
    expected_date DATE NOT NULL,
    description VARCHAR(255) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    my_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    kind VARCHAR(10) NOT NULL DEFAULT 'fixed',
    source VARCHAR(20) NOT NULL DEFAULT 'manual',
    credit_card_id INTEGER,
    invoice_group_id INTEGER,
    breakdown JSONB,
    account_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (credit_card_id) REFERENCES credit_cards(id) ON DELETE SET NULL,
    FOREIGN KEY (invoice_group_id) REFERENCES credit_card_invoice_groups(id) ON DELETE SET NULL,
    CONSTRAINT chk_monthly_projections_kind CHECK (kind IN ('fixed', 'variable', 'income')),
    CONSTRAINT chk_monthly_projections_source
        CHECK (source IN ('manual', 'clone', 'card_invoice', 'card_item', 'payroll'))
);
"""

INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_monthly_projections_period "
    "ON monthly_projections(tenant_id, account_id, year_month);",
]


def apply(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Aplicando Migration 0024: Projeção mensal...")
        cursor.execute(CREATE_SQL)
        for sql in INDEXES:
            cursor.execute(sql)
        print("  ✓ Tabela monthly_projections")
        connection.commit()
        print("✅ Migration 0024 aplicada com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0024: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0024...")
        cursor.execute("DROP TABLE IF EXISTS monthly_projections CASCADE;")
        connection.commit()
        print("✅ Migration 0024 revertida com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration 0024: {e}")
        raise
    finally:
        cursor.close()


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0024: Projeção mensal')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    try:
        rollback(conn) if args.rollback else apply(conn)
    finally:
        conn.close()
