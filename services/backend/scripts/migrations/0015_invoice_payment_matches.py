"""
Migration 0015: Grupos de fatura conjunta, reconciliação com extrato e fechamentos da Saúde.

- credit_card_invoice_groups
- credit_cards.invoice_group_id
- credit_card_invoices.bank_statement_id
- invoice_payment_matches
- financial_health_month_closings
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


FH_CLOSINGS_CREATE_SQL = """
CREATE TABLE financial_health_month_closings (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    share_tab VARCHAR(20) NOT NULL,
    opening_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    entries DECIMAL(15, 2) NOT NULL DEFAULT 0,
    entries_benefit DECIMAL(15, 2) NOT NULL DEFAULT 0,
    exits DECIMAL(15, 2) NOT NULL DEFAULT 0,
    exits_card DECIMAL(15, 2) NOT NULL DEFAULT 0,
    exits_bank DECIMAL(15, 2) NOT NULL DEFAULT 0,
    exits_benefit DECIMAL(15, 2) NOT NULL DEFAULT 0,
    closing_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    account_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    CONSTRAINT chk_fh_closings_share_tab CHECK (share_tab IN ('geral', 'proprio', 'compartilhado')),
    CONSTRAINT chk_fh_closings_month CHECK (month >= 1 AND month <= 12),
    CONSTRAINT uq_financial_health_month_closings_period
        UNIQUE (tenant_id, account_id, year, month, share_tab)
);
"""


def _financial_health_closings_columns(cursor):
    cursor.execute("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'financial_health_month_closings'
        ORDER BY ordinal_position
    """)
    return [row['column_name'] for row in cursor.fetchall()]


def _ensure_financial_health_closings_table(cursor):
    """Negócio primeiro; account_id + BaseEntity por último (padrão das demais tabelas)."""
    columns = _financial_health_closings_columns(cursor)
    expected_prefix = ['id', 'year', 'month', 'share_tab']
    if columns[:4] == expected_prefix:
        cursor.execute(
            "ALTER TABLE financial_health_month_closings "
            "ADD COLUMN IF NOT EXISTS entries_benefit DECIMAL(15, 2) NOT NULL DEFAULT 0;"
        )
        return

    if columns:
        print("  ↻ Recriando financial_health_month_closings (colunas BaseEntity no final)")
        cursor.execute("DROP TABLE IF EXISTS financial_health_month_closings CASCADE;")

    cursor.execute(FH_CLOSINGS_CREATE_SQL)
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_fh_closings_account_period "
        "ON financial_health_month_closings(account_id, year, month);"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_fh_closings_tenant "
        "ON financial_health_month_closings(tenant_id);"
    )


def apply(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Aplicando Migration 0015: Reconciliação de pagamento de fatura...")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS credit_card_invoice_groups (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                account_id INTEGER NOT NULL,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                active BOOLEAN NOT NULL DEFAULT TRUE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                CONSTRAINT unique_invoice_group_per_account UNIQUE (tenant_id, account_id, name)
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoice_groups_tenant ON credit_card_invoice_groups(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoice_groups_account ON credit_card_invoice_groups(account_id);")
        print("  ✓ Tabela credit_card_invoice_groups")

        cursor.execute("""
            ALTER TABLE credit_cards
            ADD COLUMN IF NOT EXISTS invoice_group_id INTEGER;
        """)
        cursor.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'fk_credit_cards_invoice_group'
                ) THEN
                    ALTER TABLE credit_cards
                    ADD CONSTRAINT fk_credit_cards_invoice_group
                    FOREIGN KEY (invoice_group_id) REFERENCES credit_card_invoice_groups(id) ON DELETE SET NULL;
                END IF;
            END $$;
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_credit_cards_invoice_group ON credit_cards(invoice_group_id);")
        print("  ✓ Coluna credit_cards.invoice_group_id")

        cursor.execute("""
            ALTER TABLE credit_card_invoices
            ADD COLUMN IF NOT EXISTS bank_statement_id INTEGER;
        """)
        cursor.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_bank_statement'
                ) THEN
                    ALTER TABLE credit_card_invoices
                    ADD CONSTRAINT fk_invoices_bank_statement
                    FOREIGN KEY (bank_statement_id) REFERENCES bank_statements(id) ON DELETE SET NULL;
                END IF;
            END $$;
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_bank_statement ON credit_card_invoices(bank_statement_id);")
        print("  ✓ Coluna credit_card_invoices.bank_statement_id")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS invoice_payment_matches (
                id SERIAL PRIMARY KEY,
                year_month VARCHAR(7) NOT NULL,
                invoice_group_id INTEGER,
                credit_card_id INTEGER,
                bank_statement_id INTEGER,
                matched_amount DECIMAL(10, 2) NOT NULL,
                match_method VARCHAR(20) NOT NULL DEFAULT 'auto',
                account_id INTEGER NOT NULL,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (invoice_group_id) REFERENCES credit_card_invoice_groups(id) ON DELETE CASCADE,
                FOREIGN KEY (credit_card_id) REFERENCES credit_cards(id) ON DELETE CASCADE,
                FOREIGN KEY (bank_statement_id) REFERENCES bank_statements(id) ON DELETE CASCADE,
                CONSTRAINT chk_invoice_payment_match_method CHECK (match_method IN ('auto', 'manual', 'unlinked')),
                CONSTRAINT chk_invoice_payment_match_target CHECK (
                    (invoice_group_id IS NOT NULL AND credit_card_id IS NULL)
                    OR (invoice_group_id IS NULL AND credit_card_id IS NOT NULL)
                ),
                CONSTRAINT chk_invoice_payment_match_statement CHECK (
                    (match_method = 'unlinked' AND bank_statement_id IS NULL)
                    OR (match_method IN ('auto', 'manual') AND bank_statement_id IS NOT NULL)
                )
            );
        """)
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_payment_matches_bank ON invoice_payment_matches(bank_statement_id);")
        cursor.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_payment_matches_group
            ON invoice_payment_matches(tenant_id, account_id, year_month, invoice_group_id)
            WHERE invoice_group_id IS NOT NULL;
        """)
        cursor.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_payment_matches_card
            ON invoice_payment_matches(tenant_id, account_id, year_month, credit_card_id)
            WHERE invoice_group_id IS NULL AND credit_card_id IS NOT NULL;
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoice_payment_matches_year_month ON invoice_payment_matches(year_month);")
        cursor.execute("ALTER TABLE invoice_payment_matches ALTER COLUMN bank_statement_id DROP NOT NULL;")
        cursor.execute("""
            DO $$
            BEGIN
                ALTER TABLE invoice_payment_matches
                    DROP CONSTRAINT IF EXISTS invoice_payment_matches_match_method_check;
                ALTER TABLE invoice_payment_matches
                    DROP CONSTRAINT IF EXISTS chk_invoice_payment_match_method;
                ALTER TABLE invoice_payment_matches
                    DROP CONSTRAINT IF EXISTS chk_invoice_payment_match_statement;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_payment_match_method'
                ) THEN
                    ALTER TABLE invoice_payment_matches
                    ADD CONSTRAINT chk_invoice_payment_match_method
                    CHECK (match_method IN ('auto', 'manual', 'unlinked'));
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_payment_match_statement'
                ) THEN
                    ALTER TABLE invoice_payment_matches
                    ADD CONSTRAINT chk_invoice_payment_match_statement
                    CHECK (
                        (match_method = 'unlinked' AND bank_statement_id IS NULL)
                        OR (match_method IN ('auto', 'manual') AND bank_statement_id IS NOT NULL)
                    );
                END IF;
            END $$;
        """)
        print("  ✓ Tabela invoice_payment_matches")

        _ensure_financial_health_closings_table(cursor)
        print("  ✓ Tabela financial_health_month_closings")

        connection.commit()
        print("✅ Migration 0015 aplicada com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao aplicar migration: {e}")
        raise


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0015...")
        cursor.execute("DROP TABLE IF EXISTS financial_health_month_closings CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS invoice_payment_matches CASCADE;")
        cursor.execute("ALTER TABLE credit_card_invoices DROP CONSTRAINT IF EXISTS fk_invoices_bank_statement;")
        cursor.execute("DROP INDEX IF EXISTS idx_invoices_bank_statement;")
        cursor.execute("ALTER TABLE credit_card_invoices DROP COLUMN IF EXISTS bank_statement_id;")
        cursor.execute("ALTER TABLE credit_cards DROP CONSTRAINT IF EXISTS fk_credit_cards_invoice_group;")
        cursor.execute("DROP INDEX IF EXISTS idx_credit_cards_invoice_group;")
        cursor.execute("ALTER TABLE credit_cards DROP COLUMN IF EXISTS invoice_group_id;")
        cursor.execute("DROP TABLE IF EXISTS credit_card_invoice_groups CASCADE;")
        connection.commit()
        print("✅ Migration 0015 revertida com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration: {e}")
        raise


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0015: Reconciliação de pagamento de fatura')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    if args.rollback:
        rollback(conn)
    else:
        apply(conn)
    conn.close()
