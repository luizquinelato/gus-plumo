"""
Migration 0034: concessões de páginas por role (role_page_grants) + página de acessos no catálogo.
"""


def apply(connection):
    cursor = connection.cursor()
    try:
        print("Aplicando Migration 0034: role_page_grants...")
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'role_page_grants'
            ) AS exists;
        """)
        if not cursor.fetchone()["exists"]:
            cursor.execute("""
                CREATE TABLE role_page_grants (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL,
                    role VARCHAR(50) NOT NULL,
                    page_key VARCHAR(100) NOT NULL,
                    can_read BOOLEAN NOT NULL DEFAULT FALSE,
                    can_write BOOLEAN NOT NULL DEFAULT FALSE,
                    granted_by INTEGER NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    last_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    active BOOLEAN NOT NULL DEFAULT TRUE,
                    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                    FOREIGN KEY (page_key) REFERENCES app_pages(page_key) ON DELETE CASCADE,
                    FOREIGN KEY (granted_by) REFERENCES users(id),
                    CONSTRAINT uq_role_page_grants UNIQUE (tenant_id, role, page_key),
                    CONSTRAINT chk_role_page_grants_write_implies_read
                        CHECK (NOT can_write OR can_read)
                );
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_role_page_grants_tenant "
                "ON role_page_grants(tenant_id);"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_role_page_grants_role "
                "ON role_page_grants(role);"
            )

        cursor.execute("""
            INSERT INTO app_pages (
                page_key, route, label, group_label, sort_order, admin_only, active
            ) VALUES (
                'configuracoes.acessos',
                '/configuracoes/acessos',
                'Acessos',
                'Configurações',
                515,
                TRUE,
                TRUE
            )
            ON CONFLICT (page_key) DO NOTHING;
        """)

        print("Migration 0034 aplicada com sucesso.")
    except Exception:
        connection.rollback()
        raise
    else:
        connection.commit()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("Revertendo Migration 0034: role_page_grants e página configuracoes.acessos...")
        cursor.execute("DROP TABLE IF EXISTS role_page_grants CASCADE;")
        cursor.execute(
            "DELETE FROM app_pages WHERE page_key = 'configuracoes.acessos';"
        )
        print("Migration 0034 revertida com sucesso.")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()