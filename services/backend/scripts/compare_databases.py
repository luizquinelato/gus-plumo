#!/usr/bin/env python3
"""
Script para comparar registros entre bancos de dados DEV e PROD.
Identifica registros com valores diferentes na tabela credit_card_invoices.

Uso:
    python compare_databases.py
"""

import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor
from decimal import Decimal

# Configurações dos bancos
PROD_CONFIG = {
    'host': 'localhost',
    'port': 5432,
    'database': 'plumo',
    'user': 'plumo',
    'password': 'plumo'
}

DEV_CONFIG = {
    'host': 'localhost',
    'port': 5433,
    'database': 'plumo_dev',
    'user': 'plumo',
    'password': 'plumo'
}


def get_connection(config, name):
    """Conecta ao banco de dados."""
    try:
        conn = psycopg2.connect(
            host=config['host'],
            port=config['port'],
            database=config['database'],
            user=config['user'],
            password=config['password'],
            cursor_factory=RealDictCursor
        )
        print(f"✅ Conectado ao banco {name} ({config['database']}:{config['port']})")
        return conn
    except Exception as e:
        print(f"❌ Erro ao conectar ao banco {name}: {e}")
        sys.exit(1)


def get_invoices(conn):
    """Busca todos os registros de credit_card_invoices."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            id, year_month, credit_card_id, description, date,
            current_installment, total_installments, amount,
            subtag_id, expense_sharing_id, ownership_percentage
        FROM credit_card_invoices
        ORDER BY year_month, credit_card_id, description, date, current_installment, total_installments
    """)
    return cursor.fetchall()


def create_key(record):
    """Cria chave única para o registro usando ID."""
    return record['id']


def compare_databases():
    """Compara os dois bancos e mostra diferenças."""
    print("\n" + "=" * 60)
    print("  COMPARAÇÃO DE BANCOS - credit_card_invoices")
    print("=" * 60 + "\n")

    # Conecta aos bancos
    prod_conn = get_connection(PROD_CONFIG, "PROD")
    dev_conn = get_connection(DEV_CONFIG, "DEV")

    # Busca registros
    print("\n📊 Carregando registros...")
    prod_records = get_invoices(prod_conn)
    dev_records = get_invoices(dev_conn)

    print(f"   PROD: {len(prod_records)} registros")
    print(f"   DEV:  {len(dev_records)} registros")

    # Cria dicts para lookup
    prod_dict = {create_key(r): r for r in prod_records}
    dev_dict = {create_key(r): r for r in dev_records}

    # Encontra diferenças
    only_in_prod = []
    only_in_dev = []
    different_values = []
    same_values = 0

    # Verifica registros do PROD
    for key, prod_rec in prod_dict.items():
        if key not in dev_dict:
            only_in_prod.append(prod_rec)
        else:
            dev_rec = dev_dict[key]
            if prod_rec['amount'] != dev_rec['amount']:
                different_values.append({
                    'key': key,
                    'prod': prod_rec,
                    'dev': dev_rec,
                    'diff': float(dev_rec['amount']) - float(prod_rec['amount'])
                })
            else:
                same_values += 1

    # Verifica registros do DEV que não estão no PROD
    for key, dev_rec in dev_dict.items():
        if key not in prod_dict:
            only_in_dev.append(dev_rec)

    # Exibe resultados
    print("\n" + "=" * 60)
    print("  RESULTADOS")
    print("=" * 60)

    print(f"\n✅ Registros iguais: {same_values}")
    print(f"⚠️  Registros com valores diferentes: {len(different_values)}")
    print(f"🔴 Apenas em PROD: {len(only_in_prod)}")
    print(f"🔵 Apenas em DEV: {len(only_in_dev)}")

    # Mostra registros com valores diferentes
    if different_values:
        print("\n" + "-" * 60)
        print("  REGISTROS COM VALORES DIFERENTES")
        print("-" * 60)

        total_diff = Decimal('0')
        for item in different_values[:20]:  # Limita a 20
            record_id = item['key']
            prod_rec = item['prod']
            dev_rec = item['dev']
            prod_amt = prod_rec['amount']
            dev_amt = dev_rec['amount']
            diff = item['diff']
            total_diff += Decimal(str(diff))

            print(f"\n📌 ID: {record_id} | {prod_rec['description'][:40]}...")
            print(f"   Year/Month: {prod_rec['year_month']} | Card: {prod_rec['credit_card_id']} | Date: {prod_rec['date']}")
            print(f"   Parcela: {prod_rec['current_installment']}/{prod_rec['total_installments']}")
            print(f"   PROD: {prod_amt:>12.2f}")
            print(f"   DEV:  {dev_amt:>12.2f}")
            print(f"   DIFF: {diff:>+12.2f}")

        if len(different_values) > 20:
            print(f"\n... e mais {len(different_values) - 20} registros")

        print(f"\n📊 DIFERENÇA TOTAL: {total_diff:+.2f}")

    # Fecha conexões
    prod_conn.close()
    dev_conn.close()

    print("\n" + "=" * 60 + "\n")


if __name__ == "__main__":
    compare_databases()

