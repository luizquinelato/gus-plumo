"""
Migration 0006: Corrige registros duplicados de expense_sharing_settings

O sistema de compartilhamento é bidirecional - apenas 1 registro é necessário
por par de contas. Esta migration remove os registros duplicados criados
erroneamente onde account_id != 1 (Gustavo é a conta principal que criou
os compartilhamentos corretos).

Registros removidos: onde account_id != 1 (registros criados pela conta parceira)
Registros mantidos: onde account_id == 1 (registros originais do Gustavo)
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
        return connection
    except Exception as e:
        print(f"❌ Erro ao conectar ao banco: {e}")
        raise

def apply(connection):
    """Aplica a migration."""
    try:
        cursor = connection.cursor()

        print("🔄 Aplicando Migration 0006: Corrige registros duplicados de expense_sharing_settings...")

        # Primeiro, lista os registros que serão deletados para log
        cursor.execute("""
            SELECT id, account_id, shared_account_id, my_contribution_percentage, active
            FROM expense_sharing_settings
            WHERE account_id != 1
        """)
        registros_para_deletar = cursor.fetchall()

        if registros_para_deletar:
            print(f"  📋 Registros duplicados encontrados ({len(registros_para_deletar)}):")
            for r in registros_para_deletar:
                print(f"     - ID: {r['id']}, account_id: {r['account_id']} → shared_account_id: {r['shared_account_id']}, {r['my_contribution_percentage']}%, active: {r['active']}")
        else:
            print("  ✓ Nenhum registro duplicado encontrado")
            connection.commit()
            print("✅ Migration 0006 aplicada com sucesso!")
            return

        # Para cada registro duplicado, encontra o correto e migra as referências
        for r in registros_para_deletar:
            duplicado_id = r['id']
            # O registro correto é onde account_id=1 e shared_account_id = account_id do duplicado
            # Exemplo: duplicado é (account_id=2, shared_account_id=1) → correto é (account_id=1, shared_account_id=2)
            cursor.execute("""
                SELECT id FROM expense_sharing_settings
                WHERE account_id = 1 AND shared_account_id = %s AND active = TRUE
            """, (r['account_id'],))
            correto = cursor.fetchone()

            if correto:
                correto_id = correto['id']
                print(f"  🔄 Migrando referências do ID {duplicado_id} para ID {correto_id}...")

                # Atualiza bank_statements
                cursor.execute("""
                    UPDATE bank_statements SET expense_sharing_id = %s WHERE expense_sharing_id = %s
                """, (correto_id, duplicado_id))
                print(f"     - bank_statements: {cursor.rowcount} registro(s)")

                # Atualiza credit_card_invoices
                cursor.execute("""
                    UPDATE credit_card_invoices SET expense_sharing_id = %s WHERE expense_sharing_id = %s
                """, (correto_id, duplicado_id))
                print(f"     - credit_card_invoices: {cursor.rowcount} registro(s)")

                # Atualiza benefit_card_statements
                cursor.execute("""
                    UPDATE benefit_card_statements SET expense_sharing_id = %s WHERE expense_sharing_id = %s
                """, (correto_id, duplicado_id))
                print(f"     - benefit_card_statements: {cursor.rowcount} registro(s)")

                # Atualiza credit_cards
                cursor.execute("""
                    UPDATE credit_cards SET expense_sharing_id = %s WHERE expense_sharing_id = %s
                """, (correto_id, duplicado_id))
                print(f"     - credit_cards: {cursor.rowcount} registro(s)")

                # Atualiza transaction_mappings
                cursor.execute("""
                    UPDATE transaction_mappings SET expense_sharing_id = %s WHERE expense_sharing_id = %s
                """, (correto_id, duplicado_id))
                print(f"     - transaction_mappings: {cursor.rowcount} registro(s)")

                # Atualiza expense_template_items
                cursor.execute("""
                    UPDATE expense_template_items SET expense_sharing_id = %s WHERE expense_sharing_id = %s
                """, (correto_id, duplicado_id))
                print(f"     - expense_template_items: {cursor.rowcount} registro(s)")
            else:
                print(f"  ⚠️  Não encontrado registro correto para ID {duplicado_id}, setando referências para NULL...")

                # Seta para NULL se não encontrar o correto
                cursor.execute("UPDATE bank_statements SET expense_sharing_id = NULL WHERE expense_sharing_id = %s", (duplicado_id,))
                cursor.execute("UPDATE credit_card_invoices SET expense_sharing_id = NULL WHERE expense_sharing_id = %s", (duplicado_id,))
                cursor.execute("UPDATE benefit_card_statements SET expense_sharing_id = NULL WHERE expense_sharing_id = %s", (duplicado_id,))
                cursor.execute("UPDATE credit_cards SET expense_sharing_id = NULL WHERE expense_sharing_id = %s", (duplicado_id,))
                cursor.execute("UPDATE transaction_mappings SET expense_sharing_id = NULL WHERE expense_sharing_id = %s", (duplicado_id,))
                cursor.execute("UPDATE expense_template_items SET expense_sharing_id = NULL WHERE expense_sharing_id = %s", (duplicado_id,))

        # Agora deleta os registros duplicados
        cursor.execute("""
            DELETE FROM expense_sharing_settings
            WHERE account_id != 1
        """)
        deleted_count = cursor.rowcount
        print(f"  ✓ {deleted_count} registro(s) duplicado(s) removido(s)")

        # Lista os registros restantes
        cursor.execute("""
            SELECT id, account_id, shared_account_id, my_contribution_percentage, active
            FROM expense_sharing_settings
            ORDER BY id
        """)
        registros_restantes = cursor.fetchall()
        
        if registros_restantes:
            print(f"  📋 Registros mantidos ({len(registros_restantes)}):")
            for r in registros_restantes:
                print(f"     - ID: {r['id']}, account_id: {r['account_id']} → shared_account_id: {r['shared_account_id']}, {r['my_contribution_percentage']}%, active: {r['active']}")

        connection.commit()
        print("✅ Migration 0006 aplicada com sucesso!")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro ao aplicar migration: {e}")
        raise

def rollback(connection):
    """Reverte a migration."""
    print("⚠️  Migration 0006 não pode ser revertida automaticamente.")
    print("    Os registros deletados precisariam ser recriados manualmente.")
    print("    Como eram registros duplicados/errados, a reversão não é recomendada.")

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Migration 0006: Corrige registros duplicados de expense_sharing_settings')
    parser.add_argument('--rollback', action='store_true', help='Reverte a migration')
    args = parser.parse_args()

    conn = get_database_connection()
    if args.rollback:
        rollback(conn)
    else:
        apply(conn)
    conn.close()

