#!/usr/bin/env python3
"""
Script para gerar arquivos JSON de migration a partir dos dados atuais do banco.
Lê tags, subtags e mapeamentos do banco e gera 2 arquivos JSON:
- 0002_seed_data_inicial_tags_subtags.json
- 0002_seed_data_inicial_mapeamentos.json

Uso:
    python services/backend/scripts/generate_mapping_migration_data.py
"""

import os
import sys
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime

# Adiciona o backend service ao path
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, backend_path)

# Carrega .env global (raiz do projeto) ANTES de qualquer uso de variáveis de ambiente
from dotenv import load_dotenv
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
env_path = os.path.join(project_root, '.env')
load_dotenv(env_path)

def get_database_connection():
    """Obtém conexão com o banco de dados."""
    try:
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
            cursor_factory=RealDictCursor,
            client_encoding='UTF8'
        )
        return connection
    except Exception as e:
        print(f"❌ Falha ao conectar ao banco de dados: {e}")
        sys.exit(1)

def read_accounts(conn):
    """Lê todas as contas do banco."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, TRIM(name) as account_name
        FROM accounts
        WHERE tenant_id = 1 AND active = TRUE
        ORDER BY id
    """)
    return cursor.fetchall()

def read_tags_by_account(conn, account_id):
    """Lê todas as tags de uma conta específica."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, TRIM(name) as name, icon
        FROM tags
        WHERE tenant_id = 1 AND account_id = %s
        ORDER BY TRIM(name)
    """, (account_id,))
    return cursor.fetchall()

def read_subtags_by_account(conn, account_id):
    """Lê todas as subtags de uma conta específica."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT s.id, TRIM(s.name) as name, s.icon, s.type, TRIM(t.name) as tag_name, t.id as tag_id
        FROM subtags s
        JOIN tags t ON s.tag_id = t.id
        WHERE s.tenant_id = 1 AND s.account_id = %s
        ORDER BY TRIM(t.name), TRIM(s.name)
    """, (account_id,))
    return cursor.fetchall()

def read_mappings_by_account(conn, account_id):
    """Lê todos os mapeamentos de uma conta específica.

    NOTA: Valores sensíveis são mantidos CRIPTOGRAFADOS no JSON.
    Isso garante que dados sensíveis não fiquem expostos no arquivo de migração.
    """
    cursor = conn.cursor()

    try:
        cursor.execute("""
            SELECT
                TRIM(tm.original_description) as description,
                tm.mapped_description as custom_description,
                tm.is_sensitive,
                tm.mapping_type,
                tm.pattern,
                tm.regex_pattern,
                tm.priority,
                TRIM(t.name) as tag_name,
                TRIM(s.name) as subtag_name,
                s.type as subtag_type,
                tm.expense_sharing_id,
                tm.my_contribution_percentage,
                TRIM(shared_acc.name) as shared_account_name
            FROM transaction_mappings tm
            JOIN subtags s ON tm.subtag_id = s.id
            JOIN tags t ON s.tag_id = t.id
            LEFT JOIN expense_sharing_settings ess ON tm.expense_sharing_id = ess.id
            LEFT JOIN accounts shared_acc ON ess.shared_account_id = shared_acc.id
            WHERE tm.tenant_id = 1 AND tm.account_id = %s
            ORDER BY TRIM(t.name), TRIM(s.name), tm.mapping_type, tm.priority
        """, (account_id,))

        mappings = cursor.fetchall()

        # Mantém valores criptografados - NÃO descriptografa
        result = []
        for mapping in mappings:
            is_sensitive = mapping['is_sensitive']
            mapping_type = mapping['mapping_type'] or 'exact'

            if is_sensitive:
                print(f"   🔒 Mapeamento sensível encontrado (mantido criptografado)")

            # Para regex/pattern, usa o campo apropriado como original_description
            description = mapping['description']
            if mapping_type == 'regex' and mapping['regex_pattern']:
                description = mapping['regex_pattern']
            elif mapping_type == 'pattern' and mapping['pattern']:
                description = mapping['pattern']

            result.append({
                'description': description,
                'custom_description': mapping['custom_description'],
                'is_sensitive': is_sensitive,
                'mapping_type': mapping_type,
                'priority': mapping['priority'] if mapping['priority'] is not None else 1,
                'tag_name': mapping['tag_name'],
                'subtag_name': mapping['subtag_name'],
                'subtag_type': mapping['subtag_type'],
                'shared_account_name': mapping['shared_account_name'],
                'my_contribution_percentage': float(mapping['my_contribution_percentage']) if mapping['my_contribution_percentage'] else None
            })

        return result
    except Exception as e:
        print(f"   ⚠️  Erro ao ler mapeamentos: {e}")
        # Retorna lista vazia se tabela não existir
        return []

def generate_tags_subtags_json_by_account(accounts_data):
    """Gera estrutura JSON para tags e subtags por conta."""
    result = []

    for account_data in accounts_data:
        account_name = account_data['account_name']
        tags = account_data['tags']
        subtags = account_data['subtags']

        # Agrupa subtags por tag usando tag_id para evitar duplicatas
        subtags_by_tag_id = {}
        for subtag in subtags:
            tag_id = subtag['tag_id']
            if tag_id not in subtags_by_tag_id:
                subtags_by_tag_id[tag_id] = []

            # Cria chave única para detectar duplicatas
            subtag_key = (subtag['name'], subtag['type'], subtag['icon'])

            # Verifica se já existe essa subtag
            existing = [s for s in subtags_by_tag_id[tag_id] if (s['name'], s['type'], s['icon']) == subtag_key]
            if not existing:
                subtags_by_tag_id[tag_id].append(subtag)

        # Gera estrutura para cada tag
        tags_list = []
        for tag in tags:
            tag_id = tag['id']
            tag_name = tag['name']
            tag_icon = tag['icon'] if tag['icon'] else 'HelpCircle'

            tag_data = {
                "name": tag_name,
                "icon": tag_icon,
                "subtags": []
            }

            # Adiciona subtags da tag (sem duplicatas)
            if tag_id in subtags_by_tag_id:
                for subtag in subtags_by_tag_id[tag_id]:
                    subtag_name = subtag['name']
                    subtag_type = subtag['type'] if subtag.get('type') else 'despesa'
                    subtag_icon = subtag['icon'] if subtag['icon'] else 'HelpCircle'
                    tag_data["subtags"].append({
                        "name": subtag_name,
                        "type": subtag_type,
                        "icon": subtag_icon
                    })

            tags_list.append(tag_data)

        result.append({
            "account_name": account_name,
            "tags": tags_list
        })

    return result

def generate_mappings_json_by_account(accounts_data):
    """Gera estrutura JSON para mapeamentos por conta.

    Campos incluídos:
    - original_description: Descrição original (ou pattern/regex para tipos não-exact)
    - tag: Nome da tag
    - subtag: Nome da subtag
    - type: Tipo da subtag ('despesa' ou 'receita')
    - mapping_type: Tipo de mapeamento ('exact', 'pattern', 'regex')
    - priority: Prioridade do mapeamento (0=alta, 1=média, 2=baixa)
    - is_sensitive: Se o mapeamento é sensível (dados criptografados)
    - mapped_description: Descrição personalizada (opcional, criptografada se is_sensitive=True)
    - shared_account_name: Nome da conta compartilhada (opcional)
    - my_contribution_percentage: Percentual de contribuição (opcional)
    """
    result = []

    for account_data in accounts_data:
        account_name = account_data['account_name']
        mappings = account_data['mappings']

        mappings_list = []
        for mapping in mappings:
            desc = mapping['description']
            tag = mapping['tag_name']
            subtag = mapping['subtag_name'] if mapping['subtag_name'] else 'Outro'
            custom_desc = mapping['custom_description']
            is_sensitive = mapping.get('is_sensitive', False)
            subtag_type = mapping.get('subtag_type', 'despesa')
            mapping_type = mapping.get('mapping_type', 'exact')
            priority = mapping.get('priority', 1)
            shared_account_name = mapping.get('shared_account_name')
            my_contribution_percentage = mapping.get('my_contribution_percentage')

            mapping_data = {
                "original_description": desc,
                "tag": tag,
                "subtag": subtag,
                "type": subtag_type,
                "mapping_type": mapping_type,
                "priority": priority,
                "is_sensitive": is_sensitive
            }

            if custom_desc:
                mapping_data["mapped_description"] = custom_desc

            # Adiciona compartilhamento se definido
            if shared_account_name:
                mapping_data["shared_account_name"] = shared_account_name
            if my_contribution_percentage is not None:
                mapping_data["my_contribution_percentage"] = my_contribution_percentage

            mappings_list.append(mapping_data)

        result.append({
            "account_name": account_name,
            "mappings": mappings_list
        })

    return result

def main():
    print("=" * 80)
    print("GERADOR DE ARQUIVOS JSON PARA MIGRATION 0002")
    print("=" * 80)
    print(f"Data: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    print("🔒 NOTA: Valores sensíveis são mantidos CRIPTOGRAFADOS no JSON")
    print("   Isso garante que dados sensíveis não fiquem expostos no arquivo.")
    print()

    conn = get_database_connection()

    # Define o caminho da pasta de migrations
    script_dir = os.path.dirname(os.path.abspath(__file__))
    migrations_dir = os.path.join(script_dir, 'migrations')

    tags_subtags_file = os.path.join(migrations_dir, '0002_seed_data_inicial_tags_subtags.json')
    mapeamentos_file = os.path.join(migrations_dir, '0002_seed_data_inicial_mapeamentos.json')

    try:
        # Lê todas as contas
        accounts = read_accounts(conn)
        print(f"\n[OK] Encontradas {len(accounts)} contas no banco")

        # Para cada conta, lê tags, subtags e mapeamentos
        accounts_data = []
        total_tags = 0
        total_subtags = 0
        total_mappings = 0

        for account in accounts:
            account_id = account['id']
            account_name = account['account_name']

            print(f"\n📋 Processando conta: {account_name} (ID: {account_id})")

            tags = read_tags_by_account(conn, account_id)
            subtags = read_subtags_by_account(conn, account_id)
            mappings = read_mappings_by_account(conn, account_id)

            print(f"   - {len(tags)} tags")
            print(f"   - {len(subtags)} subtags")
            print(f"   - {len(mappings)} mapeamentos")

            total_tags += len(tags)
            total_subtags += len(subtags)
            total_mappings += len(mappings)

            accounts_data.append({
                'account_id': account_id,
                'account_name': account_name,
                'tags': tags,
                'subtags': subtags,
                'mappings': mappings
            })

        print(f"\n[OK] Total lido do banco:")
        print(f"   - {total_tags} tags")
        print(f"   - {total_subtags} subtags")
        print(f"   - {total_mappings} mapeamentos")

        # Gera estruturas JSON por conta
        tags_subtags_data = generate_tags_subtags_json_by_account(accounts_data)
        mapeamentos_data = generate_mappings_json_by_account(accounts_data)

        # Salva tags_subtags.json
        print(f"\n[INFO] Gerando arquivo: {tags_subtags_file}")
        with open(tags_subtags_file, 'w', encoding='utf-8') as f:
            json.dump(tags_subtags_data, f, ensure_ascii=False, indent=2)

        # Salva mapeamentos.json
        print(f"[INFO] Gerando arquivo: {mapeamentos_file}")
        with open(mapeamentos_file, 'w', encoding='utf-8') as f:
            json.dump(mapeamentos_data, f, ensure_ascii=False, indent=2)

        print(f"\n✅ Arquivos JSON gerados com sucesso!")
        print(f"📁 0002_seed_data_inicial_tags_subtags.json: {len(accounts_data)} contas")
        print(f"📁 0002_seed_data_inicial_mapeamentos.json: {len(accounts_data)} contas")
        print(f"\n💡 Agora o migration 0002 lerá esses arquivos automaticamente!")

    finally:
        conn.close()

if __name__ == '__main__':
    main()

