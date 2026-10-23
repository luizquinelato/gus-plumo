"""
Migration 0027: adiciona is_manual em bank_statements, credit_card_invoices e
benefit_card_statements.

is_manual = TRUE indica lançamento manual ou ajuste de fechamento (não importado).

Backfill:
- bank_statements: category IS NULL e migrated_from_account_id IS NULL (regra anterior do badge "M").
- benefit_card_statements: payment_method = 'Manual' (valor gravado no lançamento manual).
- credit_card_invoices: sem coluna category nem marcador; permanece FALSE.
"""

import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))

TABLES = ('bank_statements', 'credit_card_invoices', 'benefit_card_statements')


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
        print("🔄 Aplicando Migration 0027: is_manual nos extratos...")
        for table in TABLES:
            cursor.execute(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT FALSE;"
            )
            print(f"  ✓ {table}.is_manual adicionada")

        cursor.execute(
            "UPDATE bank_statements SET is_manual = TRUE "
            "WHERE category IS NULL AND migrated_from_account_id IS NULL;"
        )
        print(f"  ✓ bank_statements: {cursor.rowcount} registros marcados")

        cursor.execute(
            "UPDATE benefit_card_statements SET is_manual = TRUE WHERE payment_method = 'Manual';"
        )
        print(f"  ✓ benefit_card_statements: {cursor.rowcount} registros marcados")

        connection.commit()
        print("✅ Migration 0027 aplicada com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0027: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0027...")
        for table in TABLES:
            cursor.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS is_manual;")
        connection.commit()
        print("✅ Migration 0027 revertida com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration 0027: {e}")
        raise
    finally:
        cursor.close()


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0027: is_manual nos extratos')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    try:
        rollback(conn) if args.rollback else apply(conn)
    finally:
        conn.close()
