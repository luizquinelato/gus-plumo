#!/usr/bin/env python3
"""
Migration 0008: Vincular pagamentos de fechamento a lançamentos bancários
Descrição:
Adiciona coluna bank_statement_id em balance_closure_payments para rastrear
o BankStatement (lançamento no extrato) gerado automaticamente ao registrar
um pagamento parcial de fechamento de balanço.

Esta migration:
- Adiciona coluna bank_statement_id (nullable) em balance_closure_payments
- Cria FK para bank_statements(id) ON DELETE SET NULL

Autor: Gus Expenses Platform
Data: 2026-04-23
"""


def apply(connection):
    cursor = connection.cursor()

    try:
        print("🚀 Aplicando Migration 0008: Vincular pagamentos de fechamento a lançamentos")

        # Verificar se coluna já existe
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.columns
                WHERE table_name = 'balance_closure_payments'
                  AND column_name = 'bank_statement_id'
            ) AS exists
        """)
        col_exists = cursor.fetchone()["exists"]

        if not col_exists:
            print("   📋 Adicionando coluna bank_statement_id em balance_closure_payments...")
            cursor.execute("""
                ALTER TABLE balance_closure_payments
                ADD COLUMN bank_statement_id INTEGER,
                ADD CONSTRAINT fk_bcp_bank_statement
                    FOREIGN KEY (bank_statement_id)
                    REFERENCES bank_statements(id)
                    ON DELETE SET NULL;
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_bcp_bank_statement ON balance_closure_payments(bank_statement_id);")
            print("   ✅ Coluna bank_statement_id adicionada com sucesso")
        else:
            print("   ⏭️  Coluna bank_statement_id já existe, pulando")

        connection.commit()
        print("✅ Migration 0008 aplicada com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na Migration 0008: {e}")
        raise


def rollback(connection):
    print("⏪ Revertendo Migration 0008")
    cursor = connection.cursor()
    try:
        cursor.execute("""
            ALTER TABLE balance_closure_payments
            DROP CONSTRAINT IF EXISTS fk_bcp_bank_statement,
            DROP COLUMN IF EXISTS bank_statement_id;
        """)
        cursor.execute("DROP INDEX IF EXISTS idx_bcp_bank_statement;")
        connection.commit()
        print("✅ Migration 0008 revertida com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter Migration 0008: {e}")
        raise
