"""
Migration 0013: Adiciona is_account_card em credit_cards

Distingue cartões reais da conta (true) de cartões de terceiros gerenciados (false/NULL).
NULL é tratado como false pela Saúde Financeira.
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

        print("🔄 Aplicando Migration 0013: Adiciona is_account_card em credit_cards...")

        cursor.execute("""
            ALTER TABLE credit_cards
            ADD COLUMN IF NOT EXISTS is_account_card BOOLEAN NULL;
        """)
        print("  ✓ Coluna is_account_card adicionada")

        cursor.execute("""
            COMMENT ON COLUMN credit_cards.is_account_card IS
            'true = cartão real da conta (Saúde Financeira); false/NULL = cartão de terceiro gerenciado.';
        """)
        print("  ✓ Comentário adicionado")

        connection.commit()
        print("✅ Migration 0013 aplicada com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao aplicar migration: {e}")
        raise


def rollback(connection):
    """Reverte a migration."""
    try:
        cursor = connection.cursor()

        print("🔄 Revertendo Migration 0013...")

        cursor.execute("ALTER TABLE credit_cards DROP COLUMN IF EXISTS is_account_card;")
        print("  ✓ Coluna is_account_card removida")

        connection.commit()
        print("✅ Migration 0013 revertida com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration: {e}")
        raise


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0013: Adiciona is_account_card em credit_cards')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    if args.rollback:
        rollback(conn)
    else:
        apply(conn)
    conn.close()
