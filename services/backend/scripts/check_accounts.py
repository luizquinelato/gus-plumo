import psycopg2
from psycopg2.extras import RealDictCursor

conn = psycopg2.connect('postgresql://plumo:plumo@localhost:5432/plumo')
cursor = conn.cursor(cursor_factory=RealDictCursor)

cursor.execute('''
    SELECT 
        a.id, a.tenant_id, a.user_id, a.bank_id, a.agency, a.account_number,
        u.first_name, u.last_name, u.email,
        b.code, b.name as bank_name
    FROM accounts a
    JOIN users u ON a.user_id = u.id
    JOIN banks b ON a.bank_id = b.id
    WHERE a.active = TRUE
    ORDER BY a.id
''')

rows = cursor.fetchall()

print('\n' + '='*80)
print('CONTAS NO BANCO DE DADOS:')
print('='*80)

for r in rows:
    print(f"\nID: {r['id']}")
    print(f"  Tenant ID: {r['tenant_id']}")
    print(f"  User ID: {r['user_id']}")
    print(f"  Usuário: {r['first_name']} {r['last_name']} ({r['email']})")
    print(f"  Banco: {r['code']} - {r['bank_name']} (ID: {r['bank_id']})")
    print(f"  Agência: {r['agency']}")
    print(f"  Conta: {r['account_number']}")

print('\n' + '='*80)
print(f'TOTAL: {len(rows)} contas')
print('='*80 + '\n')

# Testa especificamente a conta da Lurdes
print('\n' + '='*80)
print('TESTANDO CONTA DA LURDES (Itaú 341, Ag 8046, Conta 377027):')
print('='*80)

cursor.execute('''
    SELECT 
        a.id, a.tenant_id, a.user_id, a.bank_id, a.agency, a.account_number,
        u.first_name, u.last_name, u.email,
        b.code, b.name as bank_name
    FROM accounts a
    JOIN users u ON a.user_id = u.id
    JOIN banks b ON a.bank_id = b.id
    WHERE a.active = TRUE
      AND b.code = '341'
      AND a.agency = '8046'
      AND a.account_number = '377027'
''')

lurdes_account = cursor.fetchone()

if lurdes_account:
    print('\n✅ CONTA ENCONTRADA!')
    print(f"  ID: {lurdes_account['id']}")
    print(f"  Tenant ID: {lurdes_account['tenant_id']}")
    print(f"  User ID: {lurdes_account['user_id']}")
    print(f"  Usuário: {lurdes_account['first_name']} {lurdes_account['last_name']}")
    print(f"  Email: {lurdes_account['email']}")
    print(f"  Banco: {lurdes_account['code']} - {lurdes_account['bank_name']} (ID: {lurdes_account['bank_id']})")
    print(f"  Agência: {lurdes_account['agency']}")
    print(f"  Conta: {lurdes_account['account_number']}")
else:
    print('\n❌ CONTA NÃO ENCONTRADA!')
    print('Verificando se existe banco Itaú...')
    cursor.execute("SELECT id, code, name FROM banks WHERE code = '341'")
    itau = cursor.fetchone()
    if itau:
        print(f"  ✅ Banco Itaú existe: ID={itau['id']}, Code={itau['code']}, Name={itau['name']}")
    else:
        print('  ❌ Banco Itaú NÃO existe!')

print('='*80 + '\n')

conn.close()

