#!/usr/bin/env python3
"""
Migration 0007: Balance Closure Payments
Descrição:
Cria a tabela balance_closure_payments para suporte a pagamentos parciais
de fechamentos de balanço compartilhado.

Esta migration:
- Cria tabela balance_closure_payments (pagamentos diretos ao fechamento)
- Adiciona índices necessários

Autor: Gus Expenses Platform
Data: 2026-04-23
"""


def apply(connection):
    """
    Aplica a migration.

    Args:
        connection: Conexão com o banco de dados (gerenciada pelo migration_runner)
    """
    print("🚀 Aplicando Migration 0007: Balance Closure Payments")

    cursor = connection.cursor()

    try:
        # ============================================================
        # PARTE 1: Criar tabela balance_closure_payments
        # ============================================================
        print("   📋 Criando tabela balance_closure_payments...")

        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'balance_closure_payments'
            ) AS exists
        """)
        table_exists = cursor.fetchone()["exists"]

        if not table_exists:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS balance_closure_payments (
                    id SERIAL PRIMARY KEY,
                    balance_closure_id INTEGER NOT NULL,
                    amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
                    payment_date TIMESTAMP NOT NULL,
                    notes TEXT,
                    account_id INTEGER NOT NULL,
                    tenant_id INTEGER NOT NULL,
                    created_by INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    last_updated_at TIMESTAMP DEFAULT NOW(),
                    active BOOLEAN NOT NULL DEFAULT TRUE,
                    FOREIGN KEY (balance_closure_id) REFERENCES balance_closures(id) ON DELETE CASCADE,
                    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                    FOREIGN KEY (created_by) REFERENCES users(id)
                );
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_bcp_closure ON balance_closure_payments(balance_closure_id);")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_bcp_tenant ON balance_closure_payments(tenant_id);")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_bcp_active ON balance_closure_payments(active);")

            print("   ✅ Tabela balance_closure_payments criada com sucesso")
        else:
            print("   ⏭️  Tabela balance_closure_payments já existe, pulando criação")

        connection.commit()
        print("✅ Migration 0007 aplicada com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na Migration 0007: {e}")
        raise


def rollback(connection):
    """
    Reverte a migration.
    """
    print("⏪ Revertendo Migration 0007: Balance Closure Payments")

    cursor = connection.cursor()

    try:
        cursor.execute("DROP TABLE IF EXISTS balance_closure_payments CASCADE;")
        connection.commit()
        print("✅ Migration 0007 revertida com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter Migration 0007: {e}")
        raise
