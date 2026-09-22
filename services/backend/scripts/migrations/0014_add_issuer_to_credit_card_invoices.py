"""
Migration 0014: Adiciona issuer em credit_card_invoices

Identifica o banco/emissor da fatura importada (btg ou mercadopago)
para filtrar no relatório de faturas.
Registros existentes são tratados como BTG (único parser até agora).
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
    cursor = connection.cursor()
    try:
        print("🔄 Aplicando Migration 0014: Adiciona issuer em credit_card_invoices...")

        cursor.execute("""
            ALTER TABLE credit_card_invoices
            ADD COLUMN IF NOT EXISTS issuer VARCHAR(20) NOT NULL DEFAULT 'btg';
        """)
        print("  ✓ Coluna issuer adicionada")

        cursor.execute("""
            UPDATE credit_card_invoices
            SET issuer = 'btg'
            WHERE issuer IS NULL OR btrim(issuer) = '';
        """)
        print("  ✓ Registros existentes preenchidos como btg")

        cursor.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'chk_invoices_issuer'
                ) THEN
                    ALTER TABLE credit_card_invoices
                    ADD CONSTRAINT chk_invoices_issuer
                    CHECK (issuer IN ('btg', 'mercadopago'));
                END IF;
            END $$;
        """)
        print("  ✓ Constraint chk_invoices_issuer adicionada")

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_invoices_issuer
            ON credit_card_invoices(issuer);
        """)
        print("  ✓ Índice idx_invoices_issuer criado")

        cursor.execute("""
            COMMENT ON COLUMN credit_card_invoices.issuer IS
            'Emissor da fatura PDF: btg ou mercadopago.';
        """)
        print("  ✓ Comentário adicionado")

        connection.commit()
        print("✅ Migration 0014 aplicada com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao aplicar migration: {e}")
        raise


def rollback(connection):
    """Reverte a migration."""
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0014...")

        cursor.execute("""
            ALTER TABLE credit_card_invoices
            DROP CONSTRAINT IF EXISTS chk_invoices_issuer;
        """)
        cursor.execute("DROP INDEX IF EXISTS idx_invoices_issuer;")
        cursor.execute("ALTER TABLE credit_card_invoices DROP COLUMN IF EXISTS issuer;")
        print("  ✓ Coluna issuer removida")

        connection.commit()
        print("✅ Migration 0014 revertida com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration: {e}")
        raise


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0014: Adiciona issuer em credit_card_invoices')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    if args.rollback:
        rollback(conn)
    else:
        apply(conn)
    conn.close()
