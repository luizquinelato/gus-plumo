"""
Migration 0005: Adiciona colunas de rastreamento de migração

Adiciona à tabela bank_statements:
- migrated_from_account_id: FK para accounts (conta de origem)
- migrated_from_table: VARCHAR(50) indicando tabela de origem ('credit_card_invoices' ou 'benefit_card_statements')

Essas colunas são usadas para rastrear itens que foram migrados de cartão/benefício
para extrato bancário durante a inversão de compartilhamento.
"""

import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor

# Adiciona o backend service ao path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))

def get_database_connection():
    """Obtém conexão com o banco de dados usando configuração do backend."""
    try:
        from dotenv import load_dotenv
        load_dotenv()

        database_url = os.getenv('DATABASE_URL', 'postgresql://plumo:plumo@localhost:5432/plumo')

        # Parse DATABASE_URL
        import re
        match = re.match(r'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)', database_url)
        if not match:
            raise ValueError(f"Invalid DATABASE_URL format: {database_url}")

        user, password, host, port, database = match.groups()

        connection = psycopg2.connect(
            host=host,
            port=int(port),
            database=database,
            user=user,
            password=password,
            cursor_factory=RealDictCursor
        )
        return connection
    except Exception as e:
        print(f"❌ Erro ao conectar ao banco: {e}")
        raise

def apply(connection):
    """Aplica a migration."""
    try:
        cursor = connection.cursor()

        print("🔄 Aplicando Migration 0005: Adiciona colunas de rastreamento de migração...")

        # Adiciona coluna migrated_from_account_id
        cursor.execute("""
            ALTER TABLE bank_statements 
            ADD COLUMN IF NOT EXISTS migrated_from_account_id INTEGER;
        """)
        print("  ✓ Coluna migrated_from_account_id adicionada")

        # Adiciona coluna migrated_from_table
        cursor.execute("""
            ALTER TABLE bank_statements 
            ADD COLUMN IF NOT EXISTS migrated_from_table VARCHAR(50);
        """)
        print("  ✓ Coluna migrated_from_table adicionada")

        # Adiciona FK para accounts
        cursor.execute("""
            ALTER TABLE bank_statements
            ADD CONSTRAINT fk_bank_statements_migrated_from_account
            FOREIGN KEY (migrated_from_account_id) REFERENCES accounts(id) ON DELETE SET NULL;
        """)
        print("  ✓ FK migrated_from_account_id -> accounts adicionada")

        # Adiciona índice
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_statements_migrated_from 
            ON bank_statements(migrated_from_account_id);
        """)
        print("  ✓ Índice idx_statements_migrated_from criado")

        # Adiciona comentários
        cursor.execute("COMMENT ON COLUMN bank_statements.migrated_from_account_id IS 'Conta de origem quando item foi migrado por inversão de compartilhamento.';")
        cursor.execute("COMMENT ON COLUMN bank_statements.migrated_from_table IS 'Tabela de origem: credit_card_invoices ou benefit_card_statements. NULL se não foi migrado.';")
        print("  ✓ Comentários adicionados")

        connection.commit()
        print("✅ Migration 0005 aplicada com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao aplicar migration: {e}")
        raise

def rollback(connection):
    """Reverte a migration."""
    try:
        cursor = connection.cursor()

        print("🔄 Revertendo Migration 0005...")

        # Remove índice
        cursor.execute("DROP INDEX IF EXISTS idx_statements_migrated_from;")
        print("  ✓ Índice removido")

        # Remove FK
        cursor.execute("""
            ALTER TABLE bank_statements
            DROP CONSTRAINT IF EXISTS fk_bank_statements_migrated_from_account;
        """)
        print("  ✓ FK removida")

        # Remove colunas
        cursor.execute("ALTER TABLE bank_statements DROP COLUMN IF EXISTS migrated_from_account_id;")
        cursor.execute("ALTER TABLE bank_statements DROP COLUMN IF EXISTS migrated_from_table;")
        print("  ✓ Colunas removidas")

        connection.commit()
        print("✅ Migration 0005 revertida com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration: {e}")
        raise

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0005: Adiciona colunas de rastreamento de migração')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    if args.rollback:
        rollback(conn)
    else:
        apply(conn)
    conn.close()

