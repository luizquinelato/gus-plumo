"""
Migration 0033: RBAC v1 — catálogo de páginas (app_pages) e grants por usuário (user_page_grants).
"""

from pathlib import Path
import sys

_backend_root = Path(__file__).resolve().parents[2]
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

from app.core.page_catalog import PLUMO_APP_PAGES  # noqa: E402


def apply(connection):
    cursor = connection.cursor()
    try:
        print("Aplicando Migration 0033: app_pages e user_page_grants...")
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'app_pages'
            ) AS exists;
        """)
        if not cursor.fetchone()["exists"]:
            cursor.execute("""
                CREATE TABLE app_pages (
                    page_key VARCHAR(100) PRIMARY KEY,
                    route VARCHAR(255) NOT NULL,
                    label VARCHAR(255) NOT NULL,
                    group_label VARCHAR(100) NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    admin_only BOOLEAN NOT NULL DEFAULT FALSE,
                    active BOOLEAN NOT NULL DEFAULT TRUE
                );
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_app_pages_active ON app_pages(active);"
            )
            cursor.execute(
                "COMMENT ON TABLE app_pages IS 'Catálogo de páginas navegáveis do Plumo';"
            )

            for page in PLUMO_APP_PAGES:
                cursor.execute(
                    """
                    INSERT INTO app_pages (
                        page_key, route, label, group_label, sort_order, admin_only, active
                    ) VALUES (%s, %s, %s, %s, %s, %s, TRUE)
                    ON CONFLICT (page_key) DO NOTHING;
                    """,
                    (
                        page["page_key"],
                        page["route"],
                        page["label"],
                        page["group_label"],
                        page["sort_order"],
                        page["admin_only"],
                    ),
                )

        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'user_page_grants'
            ) AS exists;
        """)
        if not cursor.fetchone()["exists"]:
            cursor.execute("""
                CREATE TABLE user_page_grants (
                    id SERIAL PRIMARY KEY,
                    tenant_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    page_key VARCHAR(100) NOT NULL,
                    can_read BOOLEAN NOT NULL DEFAULT FALSE,
                    can_write BOOLEAN NOT NULL DEFAULT FALSE,
                    granted_by INTEGER NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    last_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    active BOOLEAN NOT NULL DEFAULT TRUE,
                    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (page_key) REFERENCES app_pages(page_key) ON DELETE CASCADE,
                    FOREIGN KEY (granted_by) REFERENCES users(id),
                    CONSTRAINT uq_user_page_grants UNIQUE (tenant_id, user_id, page_key),
                    CONSTRAINT chk_user_page_grants_write_implies_read
                        CHECK (NOT can_write OR can_read)
                );
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_user_page_grants_tenant "
                "ON user_page_grants(tenant_id);"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_user_page_grants_user "
                "ON user_page_grants(user_id);"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_user_page_grants_page "
                "ON user_page_grants(page_key);"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_user_page_grants_active "
                "ON user_page_grants(active);"
            )
            cursor.execute(
                "COMMENT ON TABLE user_page_grants IS "
                "'Concessões de leitura/escrita por página para usuários não-admin';"
            )

        print("Migration 0033 aplicada com sucesso.")
    except Exception:
        connection.rollback()
        raise
    else:
        connection.commit()


def rollback(connection):
    cursor = connection.cursor()
    try:
        print("Revertendo Migration 0033: grants de página e catálogo app_pages...")
        cursor.execute("DROP TABLE IF EXISTS user_page_grants CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS role_page_grants CASCADE;")
        cursor.execute("DROP TABLE IF EXISTS app_pages CASCADE;")
        print("Migration 0033 revertida com sucesso.")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()