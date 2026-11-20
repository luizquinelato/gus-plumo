"""
Migration 0035: remove role_permission_grants (RBAC simplificado — só páginas por role).
"""


def apply(connection):
    cursor = connection.cursor()
    try:
        print("Aplicando Migration 0035: drop role_permission_grants...")
        cursor.execute("DROP TABLE IF EXISTS role_permission_grants CASCADE;")
        print("Migration 0035 aplicada com sucesso.")
    except Exception:
        connection.rollback()
        raise
    else:
        connection.commit()


def rollback(connection):
    """No-op: apply só remove tabela legada; reverter 0035 não a recria."""
    cursor = connection.cursor()
    try:
        print("Revertendo Migration 0035 (no-op — tabela role_permission_grants não é recriada).")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()