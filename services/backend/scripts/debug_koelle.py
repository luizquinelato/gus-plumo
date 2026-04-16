#!/usr/bin/env python
"""Debug script para verificar registros Koelle no banco"""

import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = "postgresql://gusexpenses:gusexpenses@localhost:5432/gusexpenses"

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor(cursor_factory=RealDictCursor)

print("=" * 80)
print("REGISTROS COM 'KOELLE' NO BANCO:")
print("=" * 80)

cur.execute("""
    SELECT id, date, category, transaction, description, amount 
    FROM bank_statements 
    WHERE description ILIKE '%koelle%' 
    ORDER BY date DESC 
    LIMIT 10
""")

for row in cur.fetchall():
    print(f"ID: {row['id']}")
    print(f"  Date: {row['date']}")
    print(f"  Category: '{row['category']}'")
    print(f"  Transaction: '{row['transaction']}'")
    print(f"  Description: '{row['description']}'")
    print(f"  Amount: {row['amount']}")
    print()

cur.close()
conn.close()

