"""
Migration 0012: Adiciona tabelas de Holerites e Informes de Rendimentos.
"""

import os
import re
import psycopg2
from psycopg2.extras import RealDictCursor


def get_database_connection():
    from dotenv import load_dotenv

    load_dotenv()
    database_url = os.getenv("DATABASE_URL", "postgresql://plumo:plumo@localhost:5432/plumo")
    match = re.match(r"postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)", database_url)
    if not match:
        raise ValueError(f"Invalid DATABASE_URL format: {database_url}")

    user, password, host, port, database = match.groups()
    return psycopg2.connect(
        host=host,
        port=int(port),
        database=database,
        user=user,
        password=password,
        cursor_factory=RealDictCursor,
    )


def apply(connection):
    cursor = connection.cursor()
    try:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS payroll_line_types (
                id SERIAL PRIMARY KEY,
                doc_type VARCHAR(30) NOT NULL,
                code VARCHAR(20),
                description_normalized TEXT NOT NULL,
                display_name TEXT NOT NULL,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                active BOOLEAN NOT NULL DEFAULT TRUE
            );
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS payslips (
                id SERIAL PRIMARY KEY,
                source_provider VARCHAR(50) NOT NULL DEFAULT 'adp',
                employee_registration VARCHAR(50),
                employee_name VARCHAR(255),
                employee_role VARCHAR(120),
                employer_cnpj VARCHAR(20),
                employer_name VARCHAR(255),
                reference_label VARCHAR(50),
                payslip_kind VARCHAR(20) NOT NULL DEFAULT 'regular',
                year INTEGER,
                month INTEGER,
                payment_date DATE,
                gross_earnings NUMERIC(14,2),
                total_deductions NUMERIC(14,2),
                net_amount NUMERIC(14,2),
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                active BOOLEAN NOT NULL DEFAULT TRUE
            );
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS payslip_lines (
                id SERIAL PRIMARY KEY,
                payslip_id INTEGER NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
                line_type_id INTEGER REFERENCES payroll_line_types(id) ON DELETE RESTRICT,
                section VARCHAR(30) NOT NULL,
                line_code VARCHAR(20),
                description TEXT NOT NULL,
                quantity NUMERIC(12,2),
                earnings_amount NUMERIC(14,2),
                deduction_amount NUMERIC(14,2),
                base_amount NUMERIC(14,2),
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                active BOOLEAN NOT NULL DEFAULT TRUE
            );
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS income_reports (
                id SERIAL PRIMARY KEY,
                report_year INTEGER,
                calendar_year INTEGER,
                payer_cnpj VARCHAR(20),
                payer_name VARCHAR(255),
                beneficiary_cpf VARCHAR(20),
                beneficiary_name VARCHAR(255),
                nature_code VARCHAR(30),
                nature_description VARCHAR(255),
                issued_at TIMESTAMP,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                active BOOLEAN NOT NULL DEFAULT TRUE
            );
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS income_report_lines (
                id SERIAL PRIMARY KEY,
                income_report_id INTEGER NOT NULL REFERENCES income_reports(id) ON DELETE CASCADE,
                line_type_id INTEGER REFERENCES payroll_line_types(id) ON DELETE RESTRICT,
                group_name VARCHAR(120) NOT NULL,
                item_no VARCHAR(20),
                description TEXT NOT NULL,
                amount NUMERIC(14,2),
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                active BOOLEAN NOT NULL DEFAULT TRUE
            );
            """
        )

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_payroll_line_types_tenant_account ON payroll_line_types(tenant_id, account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_payroll_line_types_doc_type ON payroll_line_types(doc_type);")
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_line_type_lookup ON payroll_line_types(tenant_id, account_id, doc_type, COALESCE(code,''), description_normalized);")

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_payslips_tenant_account ON payslips(tenant_id, account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_payslips_year_month ON payslips(year, month);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_payslip_lines_payslip_id ON payslip_lines(payslip_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_payslip_lines_line_type_id ON payslip_lines(line_type_id);")

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_income_reports_tenant_account ON income_reports(tenant_id, account_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_income_reports_report_year ON income_reports(report_year);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_income_reports_beneficiary_cpf ON income_reports(beneficiary_cpf);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_income_report_lines_report_id ON income_report_lines(income_report_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_income_report_lines_line_type_id ON income_report_lines(line_type_id);")

        connection.commit()
    except Exception:
        connection.rollback()
        raise


def rollback(connection):
    cursor = connection.cursor()
    try:
        cursor.execute("DROP TABLE IF EXISTS income_report_lines;")
        cursor.execute("DROP TABLE IF EXISTS income_reports;")
        cursor.execute("DROP TABLE IF EXISTS payslip_lines;")
        cursor.execute("DROP TABLE IF EXISTS payslips;")
        cursor.execute("DROP TABLE IF EXISTS payroll_line_types;")
        connection.commit()
    except Exception:
        connection.rollback()
        raise


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Migration 0012")
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args()

    conn = get_database_connection()
    if args.rollback:
        rollback(conn)
    else:
        apply(conn)
    conn.close()
