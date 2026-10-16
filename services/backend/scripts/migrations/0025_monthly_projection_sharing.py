"""
Migration 0025: compartilhamento usado no lançamento da projeção de cartões.

Coluna monthly_projections.sharing ('own', 'mine' ou 'all'); NULL em linhas antigas/manuais.
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
        print("🔄 Aplicando Migration 0025: sharing em monthly_projections...")
        cursor.execute("ALTER TABLE monthly_projections ADD COLUMN IF NOT EXISTS sharing VARCHAR(10);")
        cursor.execute(
            "ALTER TABLE monthly_projections DROP CONSTRAINT IF EXISTS chk_monthly_projections_sharing;"
        )
        cursor.execute(
            "ALTER TABLE monthly_projections ADD CONSTRAINT chk_monthly_projections_sharing "
            "CHECK (sharing IS NULL OR sharing IN ('own', 'mine', 'all'));"
        )
        connection.commit()
        print("✅ Migration 0025 aplicada com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0025: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0025...")
        cursor.execute(
            "ALTER TABLE monthly_projections DROP CONSTRAINT IF EXISTS chk_monthly_projections_sharing;"
        )
        cursor.execute("ALTER TABLE monthly_projections DROP COLUMN IF EXISTS sharing;")
        connection.commit()
        print("✅ Migration 0025 revertida com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration 0025: {e}")
        raise
    finally:
        cursor.close()


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0025: sharing em monthly_projections')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    try:
        rollback(conn) if args.rollback else apply(conn)
    finally:
        conn.close()
