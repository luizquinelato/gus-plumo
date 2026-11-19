"""
Migration 0031: vínculo polimórfico source_table + source_id na projeção mensal.
"""

import os
import sys

import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))


def get_database_connection():
    try:
        from dotenv import load_dotenv
        from pathlib import Path
        import re

        project_root = Path(__file__).resolve().parents[4]
        for env_name in (".env.dev", ".env", ".env.prod"):
            env_file = project_root / env_name
            if env_file.exists():
                load_dotenv(env_file, override=False)
        load_dotenv()
        database_url = os.getenv("DATABASE_URL", "postgresql://plumo:plumo@localhost:5432/plumo")
        match = re.match(r"postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)", database_url)
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
        print("🔄 Aplicando Migration 0031: source_table + source_id em monthly_projections...")
        cursor.execute(
            "ALTER TABLE monthly_projections "
            "ADD COLUMN IF NOT EXISTS source_table VARCHAR(50) NULL;"
        )
        cursor.execute(
            "ALTER TABLE monthly_projections "
            "ADD COLUMN IF NOT EXISTS source_id INTEGER NULL;"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_monthly_projections_source_link "
            "ON monthly_projections (tenant_id, account_id, source_table, source_id) "
            "WHERE source_table IS NOT NULL AND source_id IS NOT NULL;"
        )
        cursor.execute(
            """
            UPDATE monthly_projections mp
            SET source_table = 'bank_statements',
                source_id = sub.bs_id
            FROM (
                SELECT DISTINCT ON (mp2.id) mp2.id AS mp_id, bs.id AS bs_id
                FROM monthly_projections mp2
                JOIN bank_statements bs
                  ON bs.tenant_id = mp2.tenant_id
                 AND bs.account_id = mp2.account_id
                 AND DATE(bs.date) = mp2.expected_date
                 AND ABS(bs.amount) = mp2.amount
                WHERE mp2.source = 'bank_statement'
                  AND mp2.description <> 'Saldo mês anterior'
                  AND mp2.source_table IS NULL
                ORDER BY mp2.id, bs.id
            ) sub
            WHERE mp.id = sub.mp_id;
            """
        )
        connection.commit()
        print("✅ Migration 0031 aplicada com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0031: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0031...")
        cursor.execute("DROP INDEX IF EXISTS idx_monthly_projections_source_link;")
        cursor.execute("ALTER TABLE monthly_projections DROP COLUMN IF EXISTS source_id;")
        cursor.execute("ALTER TABLE monthly_projections DROP COLUMN IF EXISTS source_table;")
        connection.commit()
        print("✅ Migration 0031 revertida.")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration 0031: {e}")
        raise
    finally:
        cursor.close()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Migration 0031: vínculo source na projeção")
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    conn = get_database_connection()
    try:
        rollback(conn) if args.rollback else apply(conn)
    finally:
        conn.close()