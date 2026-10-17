"""
Migration 0026: separa a origem 'card_item' da projeção mensal em
'card_item_manual' (item digitado) e 'card_item_installment' (parcela do saldo parcelado).

Linhas antigas 'card_item' fixas cuja descrição termina em "(n/total)" viram parcela;
as demais viram manual. A coluna source passa a VARCHAR(30).
"""

import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))

NEW_SOURCES = "('manual', 'clone', 'card_invoice', 'card_item_manual', 'card_item_installment', 'payroll')"
OLD_SOURCES = "('manual', 'clone', 'card_invoice', 'card_item', 'payroll')"


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
        print("🔄 Aplicando Migration 0026: card_item_manual / card_item_installment...")
        cursor.execute("ALTER TABLE monthly_projections ALTER COLUMN source TYPE VARCHAR(30);")
        cursor.execute("ALTER TABLE monthly_projections DROP CONSTRAINT IF EXISTS chk_monthly_projections_source;")
        cursor.execute(
            "UPDATE monthly_projections SET source = 'card_item_installment' "
            "WHERE source = 'card_item' AND kind = 'fixed' AND description ~ '\\([0-9]+/[0-9]+\\)$';"
        )
        cursor.execute("UPDATE monthly_projections SET source = 'card_item_manual' WHERE source = 'card_item';")
        _replace_constraint(cursor, NEW_SOURCES)
        connection.commit()
        print("✅ Migration 0026 aplicada com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0026: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0026...")
        cursor.execute("ALTER TABLE monthly_projections DROP CONSTRAINT IF EXISTS chk_monthly_projections_source;")
        cursor.execute(
            "UPDATE monthly_projections SET source = 'card_item' "
            "WHERE source IN ('card_item_manual', 'card_item_installment');"
        )
        _replace_constraint(cursor, OLD_SOURCES)
        connection.commit()
        print("✅ Migration 0026 revertida com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration 0026: {e}")
        raise
    finally:
        cursor.close()


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0026: origens card_item_manual/installment')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    try:
        rollback(conn) if args.rollback else apply(conn)
    finally:
        conn.close()
