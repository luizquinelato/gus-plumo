"""
Migration 0028: cria consortiums (pai) e consortium_installments (filha).

Importação de extratos de consórcio (Porto Seguro e Rodobens) em formato único.
Campos que só uma administradora informa ficam NULL na outra.

- remaining_installments NÃO é gravado: plan_term_months - paid_installments.
- catch_up_installments: parcelas que o cotista entrou depois no grupo e paga ao ser contemplado/ao final
  (Rodobens: "prorrogadas"; Porto: 0).
- consortium_installments guarda todos os lançamentos do conta corrente, inclusive estornos
  (valores negativos). A tela soma por parcela. A cada reimportação as linhas filhas são recriadas.
"""

import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))


def get_database_connection():
    try:
        from dotenv import load_dotenv
        from pathlib import Path
        import re

        project_root = Path(__file__).resolve().parents[4]
        for env_name in ('.env.dev', '.env', '.env.prod'):
            env_file = project_root / env_name
            if env_file.exists():
                load_dotenv(env_file, override=False)

        load_dotenv()

        database_url = os.getenv('DATABASE_URL', 'postgresql://plumo:plumo@localhost:5432/plumo')
        match = re.match(r'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)', database_url)
        if not match:
            raise ValueError("Invalid DATABASE_URL format")

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
        print("🔄 Aplicando Migration 0028: consórcios...")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS consortiums (
                company VARCHAR(20) NOT NULL CHECK (company IN ('porto_seguro', 'rodobens')),
                segment VARCHAR(20) NOT NULL CHECK (segment IN ('auto', 'imovel')),
                group_code VARCHAR(20) NOT NULL,
                quota VARCHAR(20) NOT NULL,
                contract_number VARCHAR(30),
                asset_code VARCHAR(20),
                asset_description VARCHAR(255),
                credit_amount NUMERIC(15, 2),
                plan_term_months INTEGER NOT NULL,
                paid_installments INTEGER NOT NULL DEFAULT 0,
                catch_up_installments INTEGER NOT NULL DEFAULT 0,
                catch_up_installment_amount NUMERIC(15, 2),
                reduction_factor NUMERIC(7, 4),
                monthly_amount NUMERIC(15, 2),
                outstanding_balance NUMERIC(15, 2),
                joined_date DATE,
                next_due_date DATE,
                last_due_date DATE,
                group_end_date DATE,
                next_adjustment_date DATE,
                admin_fee_pct NUMERIC(10, 4),
                reserve_fund_pct NUMERIC(10, 4),
                monthly_pct NUMERIC(10, 4),
                monthly_pct_with_fees NUMERIC(10, 4),
                insurance_pct NUMERIC(10, 6),
                paid_pct NUMERIC(10, 4),
                pending_pct NUMERIC(10, 4),
                to_collect_pct NUMERIC(10, 4),
                ideal_paid_pct NUMERIC(10, 4),
                ideal_due_pct NUMERIC(10, 4),
                diff_pct NUMERIC(10, 4),
                source_filename VARCHAR(255),
                imported_at TIMESTAMP,
                active BOOLEAN NOT NULL DEFAULT TRUE,

                -- Padrão AccountBaseEntity
                account_id INTEGER NOT NULL,
                id SERIAL PRIMARY KEY,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                last_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id),
                CONSTRAINT uq_consortiums_account_company_group_quota
                    UNIQUE (account_id, company, group_code, quota)
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_consortiums_account_id ON consortiums(account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_consortiums_tenant_id ON consortiums(tenant_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_consortiums_created_by ON consortiums(created_by);")
        print("  ✓ consortiums criada")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS consortium_installments (
                consortium_id INTEGER NOT NULL,
                installment_number INTEGER,
                entry_code VARCHAR(10),
                entry_description VARCHAR(100) NOT NULL,
                due_date DATE,
                accounting_date DATE,
                payment_date DATE,
                amount_due NUMERIC(15, 2),
                amount_paid NUMERIC(15, 2),
                fine_amount NUMERIC(15, 2),
                interest_amount NUMERIC(15, 2),
                fine_interest_pct NUMERIC(10, 4),
                fc_pct NUMERIC(10, 4),
                fr_pct NUMERIC(10, 4),
                admin_fee_pct NUMERIC(10, 4),
                insurance_pct NUMERIC(10, 6),
                paid_pct NUMERIC(10, 4),
                diff_pct NUMERIC(10, 4),
                has_insurance BOOLEAN,
                asset_code VARCHAR(20),
                credit_amount NUMERIC(15, 2),
                notice_number VARCHAR(30),

                -- Padrão AccountBaseEntity
                account_id INTEGER NOT NULL,
                id SERIAL PRIMARY KEY,
                tenant_id INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                last_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

                FOREIGN KEY (consortium_id) REFERENCES consortiums(id) ON DELETE CASCADE,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id)
            );
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_consortium_installments_consortium_id "
            "ON consortium_installments(consortium_id);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_consortium_installments_account_id "
            "ON consortium_installments(account_id);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_consortium_installments_tenant_id "
            "ON consortium_installments(tenant_id);"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_consortium_installments_created_by "
            "ON consortium_installments(created_by);"
        )
        print("  ✓ consortium_installments criada")

        connection.commit()
        print("✅ Migration 0028 aplicada com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na migration 0028: {e}")
        raise
    finally:
        cursor.close()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("🔄 Revertendo Migration 0028...")
        cursor.execute("DROP TABLE IF EXISTS consortium_installments;")
        cursor.execute("DROP TABLE IF EXISTS consortiums;")
        connection.commit()
        print("✅ Migration 0028 revertida com sucesso!")
    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao reverter migration 0028: {e}")
        raise
    finally:
        cursor.close()


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0028: consórcios')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    try:
        rollback(conn) if args.rollback else apply(conn)
    finally:
        conn.close()
