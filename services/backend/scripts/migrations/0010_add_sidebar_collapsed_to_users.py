"""
Migration 0010: Adiciona preferência de sidebar colapsado por usuário

Adiciona à tabela users:
- sidebar_collapsed: BOOLEAN DEFAULT FALSE
"""

import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))


def get_database_connection():
    """Obtém conexão com o banco de dados usando configuração do backend."""
    try:
        from dotenv import load_dotenv
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
    """Aplica a migration."""
    try:
        cursor = connection.cursor()

        print("🔄 Aplicando Migration 0010: Adiciona sidebar_collapsed em users...")

        cursor.execute("""
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS sidebar_collapsed BOOLEAN NOT NULL DEFAULT FALSE;
        """)
        print("  ✓ Coluna sidebar_collapsed adicionada")

        cursor.execute("""
            COMMENT ON COLUMN users.sidebar_collapsed IS
            'Preferência do usuário para sidebar recolhido (true) ou expandido (false).';
        """)
        print("  ✓ Comentário adicionado")

        connection.commit()
        print("✅ Migration 0010 aplicada com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao aplicar migration: {e}")
        raise


def rollback(connection):
    """Reverte a migration."""
    try:
        cursor = connection.cursor()

        print("🔄 Revertendo Migration 0010...")

        cursor.execute("ALTER TABLE users DROP COLUMN IF EXISTS sidebar_collapsed;")
        print("  ✓ Coluna sidebar_collapsed removida")

        connection.commit()
        print("✅ Migration 0010 revertida com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration: {e}")
        raise


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0010: Adiciona sidebar_collapsed em users')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    if args.rollback:
        rollback(conn)
    else:
        apply(conn)
    conn.close()
