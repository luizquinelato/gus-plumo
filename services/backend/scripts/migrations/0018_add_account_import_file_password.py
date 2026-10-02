"""
Migration 0018: senha padrão (criptografada) por conta para abrir PDFs na importação.
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

        project_root = Path(__file__).resolve().parents[4]
        for env_name in (".env.dev", ".env", ".env.prod"):
            env_file = project_root / env_name
            if env_file.exists():
                load_dotenv(env_file, override=False)

        load_dotenv()

        database_url = os.getenv("DATABASE_URL", "postgresql://plumo:plumo@localhost:5432/plumo")

        import re

        match = re.match(
            r"postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)", database_url
        )
        if not match:
            raise ValueError(f"Invalid DATABASE_URL format: {database_url}")

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
        print("🔄 Aplicando Migration 0018: senha padrão de importação por conta...")
        cursor.execute("""
            ALTER TABLE accounts
            ADD COLUMN IF NOT EXISTS import_file_password_encrypted TEXT;
        """)
        connection.commit()
        print("✅ Migration 0018 aplicada com sucesso.")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0018: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0018...")
        cursor.execute("""
            ALTER TABLE accounts
            DROP COLUMN IF EXISTS import_file_password_encrypted;
        """)
        connection.commit()
        print("✅ Rollback 0018 concluído.")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro no rollback 0018: {e}")
        raise
    finally:
        cursor.close()


if __name__ == "__main__":
    conn = get_database_connection()
    try:
        apply(conn)
    finally:
        conn.close()
