"""
Migration 0017: % distintos de despesa e receita no compartilhamento.

- expense_sharing_settings.revenue_contribution_percentage (backfill = my_contribution_percentage)
- credit_cards.expense_ownership_percentage / revenue_ownership_percentage
- transaction_mappings.revenue_contribution_percentage
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


def apply(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Aplicando Migration 0017: % receita/despesa no compartilhamento...")

        cursor.execute("""
            ALTER TABLE expense_sharing_settings
            ADD COLUMN IF NOT EXISTS revenue_contribution_percentage DECIMAL(5,2);
        """)
        cursor.execute("""
            UPDATE expense_sharing_settings
            SET revenue_contribution_percentage = my_contribution_percentage
            WHERE revenue_contribution_percentage IS NULL;
        """)
        cursor.execute("""
            ALTER TABLE expense_sharing_settings
            ALTER COLUMN revenue_contribution_percentage SET DEFAULT 50.00;
        """)
        cursor.execute("""
            ALTER TABLE expense_sharing_settings
            ALTER COLUMN revenue_contribution_percentage SET NOT NULL;
        """)
        cursor.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'chk_expense_sharing_revenue_pct'
                ) THEN
                    ALTER TABLE expense_sharing_settings
                    ADD CONSTRAINT chk_expense_sharing_revenue_pct
                    CHECK (revenue_contribution_percentage >= 0 AND revenue_contribution_percentage <= 100);
                END IF;
            END $$;
        """)
        cursor.execute("""
            COMMENT ON COLUMN expense_sharing_settings.revenue_contribution_percentage IS
            'Percentual desta conta em RECEITAS (0-100%).';
        """)

        cursor.execute("""
            ALTER TABLE credit_cards
            ADD COLUMN IF NOT EXISTS expense_ownership_percentage DECIMAL(5,2);
        """)
        cursor.execute("""
            ALTER TABLE credit_cards
            ADD COLUMN IF NOT EXISTS revenue_ownership_percentage DECIMAL(5,2);
        """)
        cursor.execute("""
            COMMENT ON COLUMN credit_cards.expense_ownership_percentage IS
            'Override do % de despesa neste cartão. NULL = usa o default da config.';
        """)
        cursor.execute("""
            COMMENT ON COLUMN credit_cards.revenue_ownership_percentage IS
            'Override do % de receita neste cartão. NULL = usa o default da config.';
        """)

        cursor.execute("""
            ALTER TABLE transaction_mappings
            ADD COLUMN IF NOT EXISTS revenue_contribution_percentage DECIMAL(5,2);
        """)
        cursor.execute("""
            COMMENT ON COLUMN transaction_mappings.revenue_contribution_percentage IS
            'Override do % de RECEITA neste mapeamento (0-100). Se NULL, usa cartão/config.';
        """)

        connection.commit()
        print("✅ Migration 0017 aplicada com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0017: {e}")
        raise


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0017...")
        cursor.execute("ALTER TABLE transaction_mappings DROP COLUMN IF EXISTS revenue_contribution_percentage;")
        cursor.execute("ALTER TABLE credit_cards DROP COLUMN IF EXISTS expense_ownership_percentage;")
        cursor.execute("ALTER TABLE credit_cards DROP COLUMN IF EXISTS revenue_ownership_percentage;")
        cursor.execute("ALTER TABLE expense_sharing_settings DROP CONSTRAINT IF EXISTS chk_expense_sharing_revenue_pct;")
        cursor.execute("ALTER TABLE expense_sharing_settings DROP COLUMN IF EXISTS revenue_contribution_percentage;")
        connection.commit()
        print("✅ Migration 0017 revertida com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration 0017: {e}")
        raise


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0017: % receita/despesa no compartilhamento')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    if args.rollback:
        rollback(conn)
    else:
        apply(conn)
    conn.close()
