"""
Migration 0004: Simplificar colunas de origem em loans e loan_payments

Alterações:
1. Remove coluna payment_type de loan_payments (auto-entendido: NULL = manual, preenchido = linked)
2. Renomeia source_type para source_table em loans
3. Renomeia source_type para source_table em loan_payments
4. Atualiza valores existentes para usar nomes reais de tabelas
5. Adiciona FK balance_closure_id em loan_payments para vincular pagamentos a fechamentos
"""

from datetime import datetime


def get_migration_info():
    return {
        "version": "0004",
        "name": "simplify_loan_source_columns",
        "description": "Remove payment_type, renomeia source_type para source_table com nomes reais de tabelas",
        "created_at": "2026-03-19"
    }


def apply(conn):
    """Aplica as alterações"""
    cursor = conn.cursor()

    print("🔄 Migration 0004: Simplificando colunas de origem em loans/loan_payments...")

    # 1. Remover TODAS as constraints relacionadas a source_type e payment_type
    print("  → Removendo constraints antigas...")
    cursor.execute("ALTER TABLE loan_payments DROP CONSTRAINT IF EXISTS chk_loan_payments_type")
    cursor.execute("ALTER TABLE loan_payments DROP CONSTRAINT IF EXISTS chk_loan_payments_linked_source")
    cursor.execute("ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_source_type_check")
    cursor.execute("ALTER TABLE loans DROP CONSTRAINT IF EXISTS chk_loans_source_type")
    cursor.execute("ALTER TABLE loan_payments DROP CONSTRAINT IF EXISTS loan_payments_source_type_check")
    cursor.execute("ALTER TABLE loan_payments DROP CONSTRAINT IF EXISTS chk_loan_payments_source_type")

    # 2. Remover coluna payment_type
    print("  → Removendo coluna payment_type de loan_payments...")
    cursor.execute("ALTER TABLE loan_payments DROP COLUMN IF EXISTS payment_type")

    # 3. Renomear source_type para source_table em loans
    print("  → Renomeando source_type para source_table em loans...")
    cursor.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'loans' AND column_name = 'source_type') THEN
                ALTER TABLE loans RENAME COLUMN source_type TO source_table;
            END IF;
        END $$;
    """)

    # 4. Renomear source_type para source_table em loan_payments
    print("  → Renomeando source_type para source_table em loan_payments...")
    cursor.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'loan_payments' AND column_name = 'source_type') THEN
                ALTER TABLE loan_payments RENAME COLUMN source_type TO source_table;
            END IF;
        END $$;
    """)

    # 5. Aumentar o tamanho da coluna para comportar nomes de tabelas maiores
    print("  → Aumentando tamanho da coluna source_table...")
    cursor.execute("ALTER TABLE loans ALTER COLUMN source_table TYPE VARCHAR(50)")
    cursor.execute("ALTER TABLE loan_payments ALTER COLUMN source_table TYPE VARCHAR(50)")

    # 6. Atualizar valores existentes para nomes reais de tabelas
    print("  → Atualizando valores para nomes reais de tabelas...")

    # Em loans
    cursor.execute("UPDATE loans SET source_table = 'bank_statements' WHERE source_table = 'statement'")
    cursor.execute("UPDATE loans SET source_table = 'credit_card_invoices' WHERE source_table = 'invoice'")
    cursor.execute("UPDATE loans SET source_table = 'benefit_card_statements' WHERE source_table = 'benefit'")
    cursor.execute("UPDATE loans SET source_table = NULL WHERE source_table = 'manual'")
    
    # Em loan_payments
    cursor.execute("""
        UPDATE loan_payments SET source_table = 'bank_statements' WHERE source_table = 'statement';
        UPDATE loan_payments SET source_table = 'credit_card_invoices' WHERE source_table = 'invoice';
        UPDATE loan_payments SET source_table = 'benefit_card_statements' WHERE source_table = 'benefit';
    """)

    # 7. Adicionar FK balance_closure_id em loan_payments
    print("  → Adicionando coluna balance_closure_id em loan_payments...")
    cursor.execute("""
        ALTER TABLE loan_payments
        ADD COLUMN IF NOT EXISTS balance_closure_id INTEGER REFERENCES balance_closures(id) ON DELETE SET NULL;
    """)

    # Criar índice para performance
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_loan_payments_balance_closure_id
        ON loan_payments(balance_closure_id) WHERE balance_closure_id IS NOT NULL;
    """)

    conn.commit()
    print("✅ Migration 0004 aplicada com sucesso!")


def rollback(conn):
    """Reverte as alterações"""
    cursor = conn.cursor()

    print("🔄 Revertendo Migration 0004...")

    # 0. Remover coluna balance_closure_id
    cursor.execute("DROP INDEX IF EXISTS idx_loan_payments_balance_closure_id")
    cursor.execute("ALTER TABLE loan_payments DROP COLUMN IF EXISTS balance_closure_id")

    # 1. Renomear source_table de volta para source_type
    cursor.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'loans' AND column_name = 'source_table') THEN
                ALTER TABLE loans RENAME COLUMN source_table TO source_type;
            END IF;
        END $$;
    """)
    
    cursor.execute("""
        DO $$ 
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'loan_payments' AND column_name = 'source_table') THEN
                ALTER TABLE loan_payments RENAME COLUMN source_table TO source_type;
            END IF;
        END $$;
    """)
    
    # 2. Reverter valores para pseudo-nomes
    cursor.execute("""
        UPDATE loans SET source_type = 'statement' WHERE source_type = 'bank_statements';
        UPDATE loans SET source_type = 'invoice' WHERE source_type = 'credit_card_invoices';
        UPDATE loans SET source_type = 'benefit' WHERE source_type = 'benefit_card_statements';
    """)
    
    cursor.execute("""
        UPDATE loan_payments SET source_type = 'statement' WHERE source_type = 'bank_statements';
        UPDATE loan_payments SET source_type = 'invoice' WHERE source_type = 'credit_card_invoices';
        UPDATE loan_payments SET source_type = 'benefit' WHERE source_type = 'benefit_card_statements';
    """)
    
    # 3. Recriar coluna payment_type
    cursor.execute("""
        ALTER TABLE loan_payments ADD COLUMN IF NOT EXISTS payment_type VARCHAR(20) DEFAULT 'manual';
        UPDATE loan_payments SET payment_type = 'linked' WHERE source_type IS NOT NULL;
        UPDATE loan_payments SET payment_type = 'manual' WHERE source_type IS NULL;
    """)
    
    # 4. Recriar constraints
    cursor.execute("""
        ALTER TABLE loan_payments ADD CONSTRAINT chk_loan_payments_type 
            CHECK (payment_type IN ('manual', 'linked'));
        ALTER TABLE loan_payments ADD CONSTRAINT chk_loan_payments_linked_source
            CHECK ((payment_type = 'manual') OR 
                   (payment_type = 'linked' AND source_type IS NOT NULL AND source_id IS NOT NULL));
    """)
    
    conn.commit()
    print("✅ Migration 0004 revertida com sucesso!")

