#!/usr/bin/env python3
"""
Migration 0003: Rename Datetime To Date + Loans Tables
Descrição:
1. Renomeia coluna datetime para date na tabela benefit_card_statements
2. Cria tabelas loans e loan_payments para controle de empréstimos

Esta migration:
- Padroniza o nome da coluna de data/hora da tabela benefit_card_statements
- Adiciona suporte a empréstimos com liquidações parciais e juros opcionais

Autor: Gus Expenses Platform
Data: 2026-03-16
"""


def apply(connection):
    """
    Aplica a migration.

    Args:
        connection: Conexão com o banco de dados (gerenciada pelo migration_runner)
    """
    print("🚀 Aplicando Migration 0003: Rename Datetime To Date + Loans Tables")

    cursor = connection.cursor()

    try:
        # ============================================================
        # PARTE 1: Renomear coluna datetime para date
        # ============================================================
        print("   🔄 Renomeando coluna 'datetime' para 'date' em benefit_card_statements...")

        cursor.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'benefit_card_statements'
            AND column_name = 'datetime'
        """)

        if cursor.fetchone():
            cursor.execute("""
                ALTER TABLE benefit_card_statements
                RENAME COLUMN datetime TO date
            """)
            print("   ✅ Coluna 'datetime' renomeada para 'date'")

            cursor.execute("""
                SELECT indexname FROM pg_indexes
                WHERE tablename = 'benefit_card_statements'
                AND indexname = 'idx_benefit_statements_datetime'
            """)
            if cursor.fetchone():
                cursor.execute("""
                    ALTER INDEX idx_benefit_statements_datetime
                    RENAME TO idx_benefit_statements_date
                """)
                print("   ✅ Índice renomeado para 'idx_benefit_statements_date'")
        else:
            cursor.execute("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'benefit_card_statements'
                AND column_name = 'date'
            """)
            if cursor.fetchone():
                print("   ℹ️  Coluna 'date' já existe - parte 1 já foi aplicada anteriormente")
            else:
                print("   ⚠️  Nem 'datetime' nem 'date' encontradas - verifique a estrutura da tabela")

        # ============================================================
        # PARTE 2: Criar tabela loans (empréstimos)
        # ============================================================
        print("   📋 Criando tabela 'loans'...")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS loans (
                id SERIAL PRIMARY KEY,
                -- Tipo e valores
                loan_type VARCHAR(20) NOT NULL CHECK (loan_type IN ('lent', 'borrowed')),
                principal_amount DECIMAL(15, 2) NOT NULL,
                description TEXT NOT NULL,
                loan_date TIMESTAMP NOT NULL,
                due_date TIMESTAMP,

                -- Juros (opcionais)
                interest_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                interest_type VARCHAR(20) CHECK (interest_type IN ('simple', 'compound')),
                interest_rate DECIMAL(8, 4),
                interest_period VARCHAR(20) CHECK (interest_period IN ('daily', 'monthly', 'yearly')),

                -- Contraparte (conta do sistema OU externa)
                counterpart_account_id INTEGER,
                external_name VARCHAR(255),
                external_description TEXT,

                -- Status
                status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled')),
                settled_at TIMESTAMP,
                last_reopened_at TIMESTAMP,
                reopened_count INTEGER NOT NULL DEFAULT 0,

                -- Origem (se criado a partir de despesa/receita)
                source_type VARCHAR(20) CHECK (source_type IN ('manual', 'invoice', 'benefit', 'statement')),
                source_id INTEGER,

                -- Padrão AccountBaseEntity
                account_id INTEGER NOT NULL,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                active BOOLEAN NOT NULL DEFAULT TRUE,

                -- Foreign Keys
                FOREIGN KEY (counterpart_account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),

                -- Constraints
                CONSTRAINT check_counterpart_or_external CHECK (
                    (counterpart_account_id IS NOT NULL AND external_name IS NULL) OR
                    (counterpart_account_id IS NULL AND external_name IS NOT NULL)
                ),
                CONSTRAINT check_interest_config CHECK (
                    (interest_enabled = FALSE) OR
                    (interest_enabled = TRUE AND interest_type IS NOT NULL AND interest_rate IS NOT NULL AND interest_period IS NOT NULL)
                ),
                CONSTRAINT check_principal_positive CHECK (principal_amount > 0)
            );
        """)

        # Índices para loans
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loans_account ON loans(account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loans_tenant ON loans(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loans_counterpart ON loans(counterpart_account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loans_type ON loans(loan_type);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loans_date ON loans(loan_date);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loans_active ON loans(active);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loans_source ON loans(source_type, source_id);")

        # Comentários para loans
        cursor.execute("COMMENT ON TABLE loans IS 'Empréstimos entre contas ou para entidades externas. Suporta liquidações parciais e juros opcionais.';")
        cursor.execute("COMMENT ON COLUMN loans.loan_type IS 'Tipo do empréstimo na perspectiva do criador: lent (emprestei) ou borrowed (peguei emprestado)';")
        cursor.execute("COMMENT ON COLUMN loans.principal_amount IS 'Valor original do empréstimo (imutável após criação)';")
        cursor.execute("COMMENT ON COLUMN loans.interest_type IS 'Tipo de juros: simple (simples) ou compound (compostos)';")
        cursor.execute("COMMENT ON COLUMN loans.interest_rate IS 'Taxa de juros em percentual (ex: 1.5 = 1.5%)';")
        cursor.execute("COMMENT ON COLUMN loans.interest_period IS 'Período de aplicação dos juros: daily, monthly ou yearly';")
        cursor.execute("COMMENT ON COLUMN loans.counterpart_account_id IS 'FK para accounts. Conta do sistema que é a contraparte do empréstimo (NULL se externo)';")
        cursor.execute("COMMENT ON COLUMN loans.external_name IS 'Nome da entidade externa (pessoa/empresa fora do sistema)';")
        cursor.execute("COMMENT ON COLUMN loans.status IS 'Status: open (aberto/ativo), settled (quitado)';")
        cursor.execute("COMMENT ON COLUMN loans.last_reopened_at IS 'Data/hora da última reabertura do empréstimo';")
        cursor.execute("COMMENT ON COLUMN loans.reopened_count IS 'Quantidade de vezes que o empréstimo foi reaberto';")
        cursor.execute("COMMENT ON COLUMN loans.source_type IS 'Origem do empréstimo: manual ou clonado de invoice/benefit/statement';")
        cursor.execute("COMMENT ON COLUMN loans.source_id IS 'ID do registro de origem se source_type != manual';")

        print("   ✅ Tabela 'loans' criada")

        # ============================================================
        # PARTE 3: Criar tabela loan_payments (liquidações)
        # ============================================================
        print("   📋 Criando tabela 'loan_payments'...")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS loan_payments (
                id SERIAL PRIMARY KEY,
                loan_id INTEGER NOT NULL,
                amount DECIMAL(15, 2) NOT NULL,
                payment_date TIMESTAMP NOT NULL,
                payment_type VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (payment_type IN ('manual', 'linked')),

                -- Origem (se linked a uma receita)
                source_type VARCHAR(20) CHECK (source_type IN ('invoice', 'benefit', 'statement')),
                source_id INTEGER,

                notes TEXT,

                -- Padrão AccountBaseEntity
                account_id INTEGER NOT NULL,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                active BOOLEAN NOT NULL DEFAULT TRUE,

                -- Foreign Keys
                FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),

                -- Constraints
                CONSTRAINT check_payment_positive CHECK (amount > 0),
                CONSTRAINT check_linked_source CHECK (
                    (payment_type = 'manual') OR
                    (payment_type = 'linked' AND source_type IS NOT NULL AND source_id IS NOT NULL)
                )
            );
        """)

        # Índices para loan_payments
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loan_payments_loan ON loan_payments(loan_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loan_payments_account ON loan_payments(account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loan_payments_tenant ON loan_payments(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loan_payments_date ON loan_payments(payment_date);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loan_payments_type ON loan_payments(payment_type);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loan_payments_source ON loan_payments(source_type, source_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_loan_payments_active ON loan_payments(active);")

        # Comentários para loan_payments
        cursor.execute("COMMENT ON TABLE loan_payments IS 'Liquidações/pagamentos parciais de empréstimos. Saldo = principal - SUM(payments)';")
        cursor.execute("COMMENT ON COLUMN loan_payments.loan_id IS 'FK para loans. Empréstimo sendo liquidado';")
        cursor.execute("COMMENT ON COLUMN loan_payments.amount IS 'Valor do pagamento (sempre positivo)';")
        cursor.execute("COMMENT ON COLUMN loan_payments.payment_type IS 'Tipo: manual (digitado) ou linked (vinculado a receita importada)';")
        cursor.execute("COMMENT ON COLUMN loan_payments.source_type IS 'Tipo da receita de origem se linked: invoice, benefit ou statement';")
        cursor.execute("COMMENT ON COLUMN loan_payments.source_id IS 'ID da receita de origem se linked';")

        print("   ✅ Tabela 'loan_payments' criada")

        print("✅ Migration 0003 aplicada com sucesso!")

    except Exception as e:
        print(f"❌ Erro na Migration 0003: {e}")
        raise


def rollback(connection):
    """
    Reverte a migration.

    Args:
        connection: Conexão com o banco de dados (gerenciada pelo migration_runner)
    """
    print("🔄 Revertendo Migration 0003: Rename Datetime To Date + Loans Tables")

    cursor = connection.cursor()

    try:
        # ============================================================
        # PARTE 1: Remover tabelas de empréstimos (ordem inversa)
        # ============================================================
        print("   🗑️  Removendo tabela 'loan_payments'...")
        cursor.execute("DROP TABLE IF EXISTS loan_payments CASCADE;")
        print("   ✅ Tabela 'loan_payments' removida")

        print("   🗑️  Removendo tabela 'loans'...")
        cursor.execute("DROP TABLE IF EXISTS loans CASCADE;")
        print("   ✅ Tabela 'loans' removida")

        # ============================================================
        # PARTE 2: Reverter rename da coluna
        # ============================================================
        print("   🔄 Renomeando coluna 'date' de volta para 'datetime' em benefit_card_statements...")

        cursor.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'benefit_card_statements'
            AND column_name = 'date'
        """)

        if cursor.fetchone():
            cursor.execute("""
                ALTER TABLE benefit_card_statements
                RENAME COLUMN date TO datetime
            """)
            print("   ✅ Coluna 'date' renomeada de volta para 'datetime'")

            cursor.execute("""
                SELECT indexname FROM pg_indexes
                WHERE tablename = 'benefit_card_statements'
                AND indexname = 'idx_benefit_statements_date'
            """)
            if cursor.fetchone():
                cursor.execute("""
                    ALTER INDEX idx_benefit_statements_date
                    RENAME TO idx_benefit_statements_datetime
                """)
                print("   ✅ Índice renomeado de volta para 'idx_benefit_statements_datetime'")
        else:
            cursor.execute("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'benefit_card_statements'
                AND column_name = 'datetime'
            """)
            if cursor.fetchone():
                print("   ℹ️  Coluna 'datetime' já existe - parte 2 já foi revertida anteriormente")
            else:
                print("   ⚠️  Nem 'date' nem 'datetime' encontradas - verifique a estrutura da tabela")

        print("✅ Rollback Migration 0003 concluído com sucesso!")

    except Exception as e:
        print(f"❌ Erro no rollback Migration 0003: {e}")
        raise
