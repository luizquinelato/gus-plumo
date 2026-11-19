"""
Migration 0030: origem bank_statement na projeção mensal e flag is_automatic.

is_automatic distingue lançamento digitado de lançamento gerado (fatura, parcela,
folha, extrato). Linhas já existentes dessas origens são marcadas como automáticas.
"""

import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))

NEW_SOURCES = (
    "('manual', 'clone', 'card_invoice', 'card_item_manual', "
    "'card_item_installment', 'payroll', 'bank_statement')"
)
OLD_SOURCES = (
    "('manual', 'clone', 'card_invoice', 'card_item_manual', "
    "'card_item_installment', 'payroll')"
)
AUTOMATIC_SOURCES = "('card_invoice', 'card_item_installment', 'payroll')"


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


def _replace_constraint(cursor, sources: str):
    cursor.execute("ALTER TABLE monthly_projections DROP CONSTRAINT IF EXISTS chk_monthly_projections_source;")
    cursor.execute(
        "ALTER TABLE monthly_projections ADD CONSTRAINT chk_monthly_projections_source "
        f"CHECK (source IN {sources});"
    )


def apply(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Aplicando Migration 0030: bank_statement e is_automatic...")
        cursor.execute(
            "ALTER TABLE monthly_projections "
            "ADD COLUMN IF NOT EXISTS is_automatic BOOLEAN NOT NULL DEFAULT FALSE;"
        )
        cursor.execute(
            "UPDATE monthly_projections SET is_automatic = TRUE "
            f"WHERE source IN {AUTOMATIC_SOURCES};"
        )
        _replace_constraint(cursor, NEW_SOURCES)
        connection.commit()
        print("✅ Migration 0030 aplicada com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0030: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0030...")
        cursor.execute("DELETE FROM monthly_projections WHERE source = 'bank_statement';")
        _replace_constraint(cursor, OLD_SOURCES)
        cursor.execute("ALTER TABLE monthly_projections DROP COLUMN IF EXISTS is_automatic;")
        connection.commit()
        print("✅ Migration 0030 revertida com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration 0030: {e}")
        raise
    finally:
        cursor.close()


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0030: extrato na projeção mensal')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    try:
        rollback(conn) if args.rollback else apply(conn)
    finally:
        conn.close()
