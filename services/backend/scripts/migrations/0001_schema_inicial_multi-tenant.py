#!/usr/bin/env python3
"""
Migration 0001: Schema Inicial Multi-Tenant
Descrição: Cria o schema completo do banco de dados com suporte multi-tenant
Autor: Gus Expenses Platform
Data: 2025-12-29

Esta migration cria:
- Tabelas de gerenciamento de tenants (tenants, tenants_colors)
- Tabelas de autenticação e usuários (users, users_sessions, users_permissions)
- Tabelas de configuração (system_settings)
- Tabelas de negócio (tags, subtags, credit_cards, credit_card_invoices, bank_statements, expense_templates, expense_template_items)
- Todas as chaves primárias, estrangeiras, constraints e índices
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
        # Format: postgresql://user:password@host:port/database
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
        connection.autocommit = False
        return connection
    except Exception as e:
        print(f"❌ Falha ao conectar ao banco de dados: {e}")
        sys.exit(1)

def apply(connection):
    """Aplica a migration inicial do schema."""
    print("🚀 Aplicando Migration 0001: Schema Inicial Multi-Tenant")

    cursor = connection.cursor()

    try:
        print("📋 Criando tabelas core...")

        # 1. Tabela tenants (fundação do sistema multi-tenant)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tenants (
                id SERIAL PRIMARY KEY,
                name VARCHAR NOT NULL UNIQUE,
                website VARCHAR,
                assets_folder VARCHAR(100),
                logo_filename VARCHAR(255) DEFAULT 'default-logo.png',
                color_schema_mode VARCHAR(10) DEFAULT 'default' CHECK (color_schema_mode IN ('default', 'custom')),
                tier VARCHAR(20) NOT NULL DEFAULT 'premium',
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                active BOOLEAN NOT NULL DEFAULT TRUE
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(active);")
        cursor.execute("COMMENT ON TABLE tenants IS 'Tabela de isolamento multi-tenant';")

        # 2. Tabela users (usuários do sistema)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                role VARCHAR(50) NOT NULL DEFAULT 'user',
                is_admin BOOLEAN DEFAULT FALSE,
                auth_provider VARCHAR(50) NOT NULL DEFAULT 'local',
                password_hash VARCHAR(255),
                theme_mode VARCHAR(10) DEFAULT 'light',
                high_contrast_mode BOOLEAN DEFAULT FALSE,
                reduce_motion BOOLEAN DEFAULT FALSE,
                colorblind_safe_palette BOOLEAN DEFAULT FALSE,
                accessibility_level VARCHAR(10) DEFAULT 'regular',
                profile_image_filename VARCHAR(255),
                last_login_at TIMESTAMP,
                tenant_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                active BOOLEAN NOT NULL DEFAULT TRUE,
                UNIQUE(email, tenant_id),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);")

        # 3. Tabela users_sessions (sessões de usuários)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users_sessions (
                id SERIAL PRIMARY KEY,
                token_hash VARCHAR(255) NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                ip_address VARCHAR(45),
                user_agent TEXT,
                user_id INTEGER NOT NULL,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                active BOOLEAN NOT NULL DEFAULT TRUE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON users_sessions(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON users_sessions(user_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token ON users_sessions(token_hash);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_active ON users_sessions(active);")

        # 4. Tabela users_permissions (permissões de usuários)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users_permissions (
                id SERIAL PRIMARY KEY,
                resource VARCHAR(100) NOT NULL,
                action VARCHAR(50) NOT NULL,
                granted BOOLEAN NOT NULL DEFAULT TRUE,
                user_id INTEGER NOT NULL,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                active BOOLEAN NOT NULL DEFAULT TRUE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_permissions_tenant ON users_permissions(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_permissions_user ON users_permissions(user_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_permissions_resource ON users_permissions(resource);")

        # 5. Tabela system_settings (configurações do sistema)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                id SERIAL PRIMARY KEY,
                setting_key VARCHAR NOT NULL,
                setting_value VARCHAR NOT NULL,
                setting_type VARCHAR NOT NULL DEFAULT 'string',
                description VARCHAR,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                active BOOLEAN NOT NULL DEFAULT TRUE,
                UNIQUE(setting_key, tenant_id),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_settings_tenant ON system_settings(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_settings_key ON system_settings(setting_key);")

        # 6. Tabela tenants_colors (esquemas de cores dos tenants)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tenants_colors (
                id SERIAL PRIMARY KEY,
                color_schema_mode VARCHAR(10) NOT NULL,
                accessibility_level VARCHAR(10) NOT NULL,
                theme_mode VARCHAR(5) NOT NULL,
                color1 VARCHAR(7),
                color2 VARCHAR(7),
                color3 VARCHAR(7),
                color4 VARCHAR(7),
                color5 VARCHAR(7),
                on_color1 VARCHAR(7),
                on_color2 VARCHAR(7),
                on_color3 VARCHAR(7),
                on_color4 VARCHAR(7),
                on_color5 VARCHAR(7),
                on_gradient_1_2 VARCHAR(7),
                on_gradient_2_3 VARCHAR(7),
                on_gradient_3_4 VARCHAR(7),
                on_gradient_4_5 VARCHAR(7),
                on_gradient_5_1 VARCHAR(7),
                tenant_id INTEGER NOT NULL,
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                active BOOLEAN NOT NULL DEFAULT TRUE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_colors_tenant ON tenants_colors(tenant_id);")

        print("✅ Tabelas core criadas")
        print("📋 Criando tabelas de negócio...")

        # 7. Tabela banks (bancos brasileiros)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS banks (
                id SERIAL PRIMARY KEY,
                code VARCHAR(10) NOT NULL UNIQUE,
                name VARCHAR(100) NOT NULL,
                full_name VARCHAR(255),
                ispb VARCHAR(10),
                tenant_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                active BOOLEAN NOT NULL DEFAULT TRUE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_banks_code ON banks(code);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_banks_name ON banks(name);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_banks_tenant ON banks(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_banks_active ON banks(active);")
        cursor.execute("COMMENT ON TABLE banks IS 'Bancos brasileiros com código COMPE';")
        cursor.execute("COMMENT ON COLUMN banks.code IS 'Código COMPE do banco (ex: 341, 260, 001)';")
        cursor.execute("COMMENT ON COLUMN banks.name IS 'Nome curto do banco (ex: Itaú, Nubank, Banco do Brasil)';")
        cursor.execute("COMMENT ON COLUMN banks.full_name IS 'Nome completo oficial do banco';")
        cursor.execute("COMMENT ON COLUMN banks.ispb IS 'Identificador do Sistema de Pagamentos Brasileiro';")

        # 8. Tabela accounts (contas bancárias dos usuários)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS accounts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                name VARCHAR(100),
                description TEXT,
                account_type VARCHAR(50),
                bank_id INTEGER,
                agency VARCHAR(6),           -- 5 dígitos + 1 verificador (formato: xxxxx-x)
                account_number VARCHAR(10),  -- 9 dígitos + 1 verificador (formato: xxxxxxxxx-x)
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                active BOOLEAN NOT NULL DEFAULT TRUE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE RESTRICT
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_accounts_tenant ON accounts(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_accounts_created_by ON accounts(created_by);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(active);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_accounts_bank ON accounts(bank_id);")
        cursor.execute("COMMENT ON TABLE accounts IS 'Contas bancárias dos usuários';")
        cursor.execute("COMMENT ON COLUMN accounts.bank_id IS 'FK para banks. Banco da conta';")
        cursor.execute("COMMENT ON COLUMN accounts.agency IS 'Agência bancária (VARCHAR(6) - formato: xxxxx-x, 5 dígitos + 1 verificador)';")
        cursor.execute("COMMENT ON COLUMN accounts.account_number IS 'Número da conta (VARCHAR(10) - formato: xxxxxxxxx-x, 9 dígitos + 1 verificador)';")

        # 9. Tabela expense_sharing_settings (configurações de compartilhamento de despesas)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS expense_sharing_settings (
                id SERIAL PRIMARY KEY,
                shared_account_id INTEGER NOT NULL,
                my_contribution_percentage DECIMAL(5,2) NOT NULL DEFAULT 50.00,
                description TEXT,
                account_id INTEGER NOT NULL,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                active BOOLEAN NOT NULL DEFAULT TRUE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (shared_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                UNIQUE(account_id, shared_account_id),
                CHECK (my_contribution_percentage >= 0 AND my_contribution_percentage <= 100)
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_expense_sharing_account ON expense_sharing_settings(account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_expense_sharing_tenant ON expense_sharing_settings(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_expense_sharing_shared_account ON expense_sharing_settings(shared_account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_expense_sharing_active ON expense_sharing_settings(active);")
        cursor.execute("COMMENT ON TABLE expense_sharing_settings IS 'Configurações de compartilhamento de despesas entre contas. Cada configuração é única por par de contas (account_id + shared_account_id).';")
        cursor.execute("COMMENT ON COLUMN expense_sharing_settings.account_id IS 'Conta que está configurando o compartilhamento (conta logada)';")
        cursor.execute("COMMENT ON COLUMN expense_sharing_settings.shared_account_id IS 'Conta com quem compartilha despesas';")
        cursor.execute("COMMENT ON COLUMN expense_sharing_settings.my_contribution_percentage IS 'Percentual que esta conta (account_id) paga (0-100%). 0%=outra conta paga tudo, 50%=meio a meio, 100%=eu pago tudo';")

        # 10. Tabela notifications (notificações in-app)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                type VARCHAR(50) NOT NULL,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                related_type VARCHAR(50),
                related_id INTEGER,
                read BOOLEAN DEFAULT false,
                read_at TIMESTAMP,
                account_id INTEGER NOT NULL,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id)
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_notifications_account ON notifications(account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_notifications_created_by ON notifications(created_by);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);")
        cursor.execute("COMMENT ON TABLE notifications IS 'Notificações in-app para solicitações de parceria, aprovações e outras ações do sistema';")
        cursor.execute("COMMENT ON COLUMN notifications.type IS 'Tipo de notificação: partnership_request, partnership_accepted, partnership_rejected';")
        cursor.execute("COMMENT ON COLUMN notifications.related_type IS 'Tipo do registro relacionado: partner, expense, etc.';")
        cursor.execute("COMMENT ON COLUMN notifications.related_id IS 'ID do registro relacionado (ex: partner_id, expense_id)';")

        # 12. Tabela tags (categorias principais - SEM tipo, pois tipo está nas subtags)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tags (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                icon VARCHAR(50) DEFAULT 'Tag',
                account_id INTEGER NOT NULL,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(name, account_id, tenant_id),
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id)
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tags_account ON tags(account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tags_tenant ON tags(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tags_created_by ON tags(created_by);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);")

        # 13. Tabela subtags (subcategorias - COM tipo: receita ou despesa)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS subtags (
                id SERIAL PRIMARY KEY,
                tag_id INTEGER NOT NULL,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                type VARCHAR(20) NOT NULL CHECK (type IN ('receita', 'despesa')),
                icon VARCHAR(50) DEFAULT 'Tags',
                account_id INTEGER NOT NULL,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(name, tag_id, account_id, tenant_id, type),
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subtags_account ON subtags(account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subtags_tenant ON subtags(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subtags_created_by ON subtags(created_by);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subtags_tag ON subtags(tag_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subtags_name ON subtags(name);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subtags_type ON subtags(type);")

        # 14. Tabela credit_cards (cartões de crédito)
        # NOTA: ownership_type é DERIVADO automaticamente:
        # - proprio: expense_sharing_id IS NULL
        # - compartilhado: expense_sharing_id IS NOT NULL
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS credit_cards (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                description VARCHAR(255),
                number VARCHAR(4) NOT NULL,
                type VARCHAR(20) NOT NULL DEFAULT 'credito',
                closing_day INTEGER NOT NULL DEFAULT 14,
                expense_sharing_id INTEGER,
                account_id INTEGER,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                active BOOLEAN NOT NULL DEFAULT TRUE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                FOREIGN KEY (expense_sharing_id) REFERENCES expense_sharing_settings(id) ON DELETE RESTRICT,
                CONSTRAINT unique_card_per_tenant UNIQUE (tenant_id, name, number),
                CHECK (type IN ('credito', 'beneficios')),
                CHECK (closing_day >= 1 AND closing_day <= 30)
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_credit_cards_tenant ON credit_cards(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_credit_cards_created_by ON credit_cards(created_by);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_credit_cards_name ON credit_cards(name);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_credit_cards_active ON credit_cards(active);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_credit_cards_account ON credit_cards(account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_credit_cards_type ON credit_cards(type);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_credit_cards_expense_sharing ON credit_cards(expense_sharing_id);")
        cursor.execute("COMMENT ON COLUMN credit_cards.closing_day IS 'Dia de fechamento da fatura (1-30). Período da fatura: (closing_day+1) do mês anterior até closing_day do mês atual.';")
        cursor.execute("COMMENT ON COLUMN credit_cards.expense_sharing_id IS 'FK para expense_sharing_settings. Faturas herdam essa configuração mas podem sobrescrever. Se não nulo, cartão é compartilhado.';")

        # 15. Tabela credit_card_invoices (faturas de cartão de crédito)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS credit_card_invoices (
                id SERIAL PRIMARY KEY,
                credit_card_id INTEGER NOT NULL,
                year_month VARCHAR(7) NOT NULL,
                date TIMESTAMP NOT NULL,
                description TEXT NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                current_installment INTEGER,
                total_installments INTEGER,
                subtag_id INTEGER,
                ownership_percentage DECIMAL(5,2) NOT NULL DEFAULT 100.00,
                expense_sharing_id INTEGER,
                adjustment_notes TEXT,
                account_id INTEGER,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (credit_card_id) REFERENCES credit_cards(id) ON DELETE RESTRICT,
                FOREIGN KEY (subtag_id) REFERENCES subtags(id) ON DELETE RESTRICT,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                FOREIGN KEY (expense_sharing_id) REFERENCES expense_sharing_settings(id) ON DELETE RESTRICT,
                CHECK (ownership_percentage >= 0 AND ownership_percentage <= 100)
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON credit_card_invoices(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON credit_card_invoices(created_by);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_year_month ON credit_card_invoices(year_month);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_card_id ON credit_card_invoices(credit_card_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_date ON credit_card_invoices(date);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_subtag ON credit_card_invoices(subtag_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_account ON credit_card_invoices(account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_installment ON credit_card_invoices(current_installment, total_installments);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_invoices_expense_sharing ON credit_card_invoices(expense_sharing_id);")
        cursor.execute("COMMENT ON COLUMN credit_card_invoices.credit_card_id IS 'FK para credit_cards. Referência ao cartão de crédito.';")
        cursor.execute("COMMENT ON COLUMN credit_card_invoices.current_installment IS 'Número da parcela atual (ex: 3 em \"3/12\"). NULL para compras à vista.';")
        cursor.execute("COMMENT ON COLUMN credit_card_invoices.total_installments IS 'Total de parcelas (ex: 12 em \"3/12\"). NULL para compras à vista.';")
        cursor.execute("COMMENT ON COLUMN credit_card_invoices.ownership_percentage IS 'Percentual do valor que é SEU (0-100). 0%=outra conta paga tudo, 50%=compartilhado, 100%=próprio';")
        cursor.execute("COMMENT ON COLUMN credit_card_invoices.expense_sharing_id IS 'FK para expense_sharing_settings. Herda do cartão se NULL, mas pode sobrescrever para ajuste fino.';")

        # 16. Tabela bank_statements (extratos bancários)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS bank_statements (
                id SERIAL PRIMARY KEY,
                category VARCHAR(100),
                transaction VARCHAR(100),
                description TEXT NOT NULL,
                date TIMESTAMP NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                subtag_id INTEGER,
                ownership_percentage DECIMAL(5,2) NOT NULL DEFAULT 100.00,
                expense_sharing_id INTEGER,
                adjustment_notes TEXT,
                account_id INTEGER,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (subtag_id) REFERENCES subtags(id) ON DELETE RESTRICT,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                FOREIGN KEY (expense_sharing_id) REFERENCES expense_sharing_settings(id) ON DELETE RESTRICT,
                CHECK (ownership_percentage >= 0 AND ownership_percentage <= 100)
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_statements_tenant ON bank_statements(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_statements_created_by ON bank_statements(created_by);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_statements_date ON bank_statements(date);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_statements_subtag ON bank_statements(subtag_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_statements_account ON bank_statements(account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_statements_expense_sharing ON bank_statements(expense_sharing_id);")
        cursor.execute("COMMENT ON COLUMN bank_statements.ownership_percentage IS 'Percentual do valor que é SEU (0-100). 0%=outra conta paga tudo, 50%=compartilhado, 100%=próprio';")
        cursor.execute("COMMENT ON COLUMN bank_statements.expense_sharing_id IS 'FK para expense_sharing_settings. Define configuração de compartilhamento para esta despesa.';")

        # 17. Tabela benefit_card_statements (extratos de cartões de benefícios)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS benefit_card_statements (
                id SERIAL PRIMARY KEY,
                credit_card_id INTEGER NOT NULL,
                datetime TIMESTAMP NOT NULL,
                description TEXT NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                payment_method VARCHAR(50),
                subtag_id INTEGER,
                ownership_percentage DECIMAL(5,2) NOT NULL DEFAULT 100.00,
                expense_sharing_id INTEGER,
                adjustment_notes TEXT,
                account_id INTEGER,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (credit_card_id) REFERENCES credit_cards(id) ON DELETE RESTRICT,
                FOREIGN KEY (subtag_id) REFERENCES subtags(id) ON DELETE RESTRICT,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
                FOREIGN KEY (expense_sharing_id) REFERENCES expense_sharing_settings(id) ON DELETE RESTRICT,
                CHECK (ownership_percentage >= 0 AND ownership_percentage <= 100)
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_benefit_statements_tenant ON benefit_card_statements(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_benefit_statements_created_by ON benefit_card_statements(created_by);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_benefit_statements_card_id ON benefit_card_statements(credit_card_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_benefit_statements_datetime ON benefit_card_statements(datetime);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_benefit_statements_subtag ON benefit_card_statements(subtag_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_benefit_statements_account ON benefit_card_statements(account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_benefit_statements_expense_sharing ON benefit_card_statements(expense_sharing_id);")
        cursor.execute("COMMENT ON COLUMN benefit_card_statements.ownership_percentage IS 'Percentual do valor que é SEU (0-100). 0%=outra conta paga tudo, 50%=compartilhado, 100%=próprio';")
        cursor.execute("COMMENT ON COLUMN benefit_card_statements.expense_sharing_id IS 'FK para expense_sharing_settings. Define configuração de compartilhamento para esta despesa.';")

        # 18. Tabela transaction_mappings (mapeamento de transações)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS transaction_mappings (
                id SERIAL PRIMARY KEY,
                -- Grupo 1: Identificação e Matching
                mapping_type VARCHAR(20) NOT NULL DEFAULT 'exact',
                original_description TEXT,
                pattern TEXT,
                regex_pattern TEXT,
                mapped_description TEXT,
                priority INTEGER NOT NULL DEFAULT 1,
                CONSTRAINT check_priority CHECK (priority >= 0 AND priority <= 2),
                -- Grupo 2: Categorização
                subtag_id INTEGER NOT NULL,
                is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
                -- Grupo 3: Compartilhamento de despesas
                expense_sharing_id INTEGER,
                my_contribution_percentage DECIMAL(5,2),
                -- Grupo 4: AccountBaseEntity
                account_id INTEGER NOT NULL,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (subtag_id) REFERENCES subtags(id) ON DELETE CASCADE,
                FOREIGN KEY (expense_sharing_id) REFERENCES expense_sharing_settings(id) ON DELETE RESTRICT,
                CONSTRAINT check_mapping_type CHECK (mapping_type IN ('exact', 'pattern', 'regex')),
                CONSTRAINT check_contribution_percentage CHECK (my_contribution_percentage IS NULL OR (my_contribution_percentage >= 0 AND my_contribution_percentage <= 100))
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_mappings_account ON transaction_mappings(account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_mappings_tenant ON transaction_mappings(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_mappings_created_by ON transaction_mappings(created_by);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_mappings_original_desc ON transaction_mappings USING hash(original_description);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_mappings_subtag ON transaction_mappings(subtag_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_mappings_account_desc ON transaction_mappings(account_id, md5(original_description));")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_mappings_type ON transaction_mappings(mapping_type);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_mappings_priority ON transaction_mappings(priority ASC);")
        cursor.execute("COMMENT ON COLUMN transaction_mappings.mapping_type IS 'Tipo de mapeamento: exact (descrição completa), pattern (contém texto), regex (expressão regular)';")
        cursor.execute("COMMENT ON COLUMN transaction_mappings.original_description IS 'Descrição original da transação (sempre em lowercase). Usado apenas para mapping_type=exact.';")
        cursor.execute("COMMENT ON COLUMN transaction_mappings.pattern IS 'Texto a buscar dentro da descrição (para mapping_type=pattern). Busca case-insensitive.';")
        cursor.execute("COMMENT ON COLUMN transaction_mappings.regex_pattern IS 'Expressão regular para matching avançado (para mapping_type=regex). Busca case-insensitive.';")
        cursor.execute("COMMENT ON COLUMN transaction_mappings.mapped_description IS 'Descrição personalizada/ofuscada. Se is_sensitive=TRUE, este campo é criptografado.';")
        cursor.execute("COMMENT ON COLUMN transaction_mappings.priority IS 'Prioridade do mapeamento: 0=Alta, 1=Média, 2=Baixa. Menor valor = testado primeiro. Usado para desempate quando múltiplos mapeamentos correspondem';")
        cursor.execute("COMMENT ON COLUMN transaction_mappings.is_sensitive IS 'Se TRUE, mapped_description é criptografado no banco e ofuscado na interface (ex: apps de namoro, sites adultos)';")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_mappings_expense_sharing ON transaction_mappings(expense_sharing_id);")
        cursor.execute("COMMENT ON COLUMN transaction_mappings.expense_sharing_id IS 'FK para expense_sharing_settings. Define configuração de compartilhamento padrão para despesas com esta descrição.';")
        cursor.execute("COMMENT ON COLUMN transaction_mappings.my_contribution_percentage IS 'Percentual de contribuição específico para este mapeamento (0-100). Se NULL, usa o valor de expense_sharing_settings. Sobrescreve o valor padrão durante importação.';")
        cursor.execute("COMMENT ON TABLE transaction_mappings IS 'Mapeamentos de transações para categorização automática. Suporta exact match, pattern matching e regex. Todas as buscas são case-insensitive.';")

        # 15. Tabela expense_templates (templates de lançamentos)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS expense_templates (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                icon VARCHAR(50) DEFAULT 'FileText',
                account_id INTEGER NOT NULL,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                active BOOLEAN NOT NULL DEFAULT TRUE,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id)
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_expense_templates_account ON expense_templates(account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_expense_templates_tenant ON expense_templates(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_expense_templates_active ON expense_templates(active);")
        cursor.execute("COMMENT ON TABLE expense_templates IS 'Templates de lançamentos para facilitar criação de despesas/receitas recorrentes';")
        cursor.execute("COMMENT ON COLUMN expense_templates.icon IS 'Ícone do lucide-react para identificação visual do template';")

        # 16. Tabela expense_template_items (itens dos templates)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS expense_template_items (
                id SERIAL PRIMARY KEY,
                expense_template_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                amount DECIMAL(10, 2),
                day_of_month INTEGER,
                subtag_id INTEGER,
                ownership_percentage DECIMAL(5,2) DEFAULT 100.00,
                expense_sharing_id INTEGER,
                display_order INTEGER NOT NULL DEFAULT 0,
                account_id INTEGER NOT NULL,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                FOREIGN KEY (expense_template_id) REFERENCES expense_templates(id) ON DELETE CASCADE,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (subtag_id) REFERENCES subtags(id) ON DELETE RESTRICT,
                FOREIGN KEY (expense_sharing_id) REFERENCES expense_sharing_settings(id) ON DELETE RESTRICT,
                CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 31)),
                CHECK (ownership_percentage >= 0 AND ownership_percentage <= 100)
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_expense_template_items_template ON expense_template_items(expense_template_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_expense_template_items_account ON expense_template_items(account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_expense_template_items_tenant ON expense_template_items(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_expense_template_items_subtag ON expense_template_items(subtag_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_expense_template_items_order ON expense_template_items(expense_template_id, display_order);")
        cursor.execute("COMMENT ON TABLE expense_template_items IS 'Itens pré-configurados de cada template. Ao usar o template, itens são convertidos em bank_statements';")
        cursor.execute("COMMENT ON COLUMN expense_template_items.description IS 'Descrição pré-configurada da despesa/receita (editável ao usar o template)';")
        cursor.execute("COMMENT ON COLUMN expense_template_items.amount IS 'Valor pré-configurado (nullable - usuário pode definir na hora de usar o template)';")
        cursor.execute("COMMENT ON COLUMN expense_template_items.day_of_month IS 'Dia do mês (1-31, nullable). Ao usar template, combina com mês/ano atual. NULL = usuário define manualmente';")
        cursor.execute("COMMENT ON COLUMN expense_template_items.display_order IS 'Ordem de exibição dos itens no template (menor = primeiro)';")

        # 17. Tabela balance_closures (histórico de fechamentos de balanço - cabeçalho)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS balance_closures (
                id SERIAL PRIMARY KEY,
                expense_sharing_id INTEGER NOT NULL,
                account_id INTEGER NOT NULL,
                shared_account_id INTEGER NOT NULL,
                period_start_date TIMESTAMP NOT NULL,
                closing_date TIMESTAMP NOT NULL,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                total_to_receive DECIMAL(15,2) NOT NULL,
                total_to_pay DECIMAL(15,2) NOT NULL,
                net_balance DECIMAL(15,2) NOT NULL,
                notes TEXT,
                is_settled BOOLEAN NOT NULL DEFAULT FALSE,
                settled_at TIMESTAMP,
                settled_by INTEGER,
                settlement_notes TEXT,
                closure_data JSONB NOT NULL,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                last_updated_at TIMESTAMP DEFAULT NOW(),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (settled_by) REFERENCES users(id)
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_balance_closures_sharing ON balance_closures(expense_sharing_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_balance_closures_period ON balance_closures(year, month);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_balance_closures_date ON balance_closures(closing_date);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_balance_closures_tenant ON balance_closures(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_balance_closures_settled ON balance_closures(is_settled);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_balance_closures_data ON balance_closures USING GIN (closure_data);")
        cursor.execute("COMMENT ON TABLE balance_closures IS 'Histórico de fechamentos de balanço compartilhado. Armazena snapshot do cabeçalho com totais e informações gerais.';")
        cursor.execute("COMMENT ON COLUMN balance_closures.total_to_receive IS 'Total a receber da conta compartilhada (sempre positivo ou zero)';")
        cursor.execute("COMMENT ON COLUMN balance_closures.total_to_pay IS 'Total a pagar para a conta compartilhada (sempre positivo ou zero)';")
        cursor.execute("COMMENT ON COLUMN balance_closures.net_balance IS 'Saldo líquido. Negativo = a receber, Positivo = a pagar, Zero = equilibrado';")
        cursor.execute("COMMENT ON COLUMN balance_closures.closure_data IS 'Snapshot do cabeçalho em JSON: contas, período, totais, etc.';")
        cursor.execute("COMMENT ON COLUMN balance_closures.is_settled IS 'Se o balanço já foi quitado/pago';")

        print("✅ Tabelas de negócio criadas")

        connection.commit()
        print("✅ Migration 0001: Schema Inicial Multi-Tenant aplicada com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao aplicar migration: {e}")
        raise

def rollback(connection):
    """Reverte a migration inicial do schema."""
    print("🔄 Revertendo Migration 0001: Schema Inicial Multi-Tenant")

    cursor = connection.cursor()

    try:
        print("📋 Removendo tabelas...")

        # Remove tabelas na ordem inversa (respeitando foreign keys)
        cursor.execute("DROP TABLE IF EXISTS balance_closures CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS expense_template_items CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS expense_templates CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS transaction_mappings CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS benefit_card_statements CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS bank_statements CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS credit_card_invoices CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS credit_cards CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS subtags CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS tags CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS notifications CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS expense_sharing_settings CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS accounts CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS banks CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS tenants_colors CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS system_settings CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS users_permissions CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS users_sessions CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS users CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS tenants CASCADE;")

        print("✅ Tabelas removidas")

        connection.commit()
        print("✅ Migration 0001: Schema Inicial Multi-Tenant revertida com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration: {e}")
        raise

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0001: Schema Inicial Multi-Tenant')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    try:
        if args.rollback:
            rollback(conn)
        else:
            apply(conn)
    finally:
        conn.close()

