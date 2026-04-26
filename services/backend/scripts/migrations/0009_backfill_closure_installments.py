#!/usr/bin/env python3
"""
Migration 0009: Backfill Installment Fields in closure_data
Descrição:
  Corrige os itens de cartão de crédito dentro do campo JSONB closure_data
  de todos os fechamentos de balanço (balance_closures), adicionando os campos
  current_installment e total_installments a cada item que não os possua,
  consultando a tabela credit_card_invoices pelo id do item.

Esta migration:
  - NÃO altera schema (sem DDL)
  - Atualiza closure_data (JSONB) de todos os balance_closures existentes
  - É idempotente: itens que já possuem os campos não são reprocessados

Autor: Gus Expenses Platform
Data: 2026-04-26
"""

import json


# Chaves dos grupos de itens de cartão de crédito dentro de cada card
_CC_KEYS = ("credit_card_expense_items", "credit_card_revenue_items")
# Chaves dos dois cards dentro de closure_data
_CARD_KEYS = ("main_account_card", "partner_account_card")


def _fetch_installments(cursor, item_ids: list[int]) -> dict[int, dict]:
    """Retorna {id: {current_installment, total_installments}} para os ids fornecidos."""
    if not item_ids:
        return {}
    cursor.execute(
        """
        SELECT id, current_installment, total_installments
        FROM credit_card_invoices
        WHERE id = ANY(%s)
        """,
        (item_ids,),
    )
    return {
        row["id"]: {
            "current_installment": row["current_installment"],
            "total_installments": row["total_installments"],
        }
        for row in cursor.fetchall()
    }


def _patch_card(card: dict, installments_map: dict[int, dict]) -> bool:
    """
    Adiciona current_installment e total_installments nos itens do card.
    Retorna True se houve alguma alteração.
    """
    changed = False
    for key in _CC_KEYS:
        for item in card.get(key) or []:
            item_id = item.get("id")
            if item_id is None:
                continue
            info = installments_map.get(item_id)
            if info is None:
                continue
            # Só atualiza se os campos ainda não existem no snapshot
            if "current_installment" not in item:
                item["current_installment"] = info["current_installment"]
                changed = True
            if "total_installments" not in item:
                item["total_installments"] = info["total_installments"]
                changed = True
    return changed


def apply(connection):
    """Aplica a migration."""
    print("🚀 Aplicando Migration 0009: Backfill Installment Fields in closure_data")

    cursor = connection.cursor()

    try:
        # Busca todos os fechamentos
        cursor.execute("SELECT id, closure_data FROM balance_closures ORDER BY id")
        closures = cursor.fetchall()
        print(f"   📋 {len(closures)} fechamento(s) encontrado(s)")

        updated = 0
        skipped = 0

        for row in closures:
            closure_id = row["id"]
            closure_data = row["closure_data"]

            # closure_data pode vir como dict (psycopg2 com RealDictCursor + json) ou str
            if isinstance(closure_data, str):
                closure_data = json.loads(closure_data)

            # Coletar todos os ids de itens de cartão de crédito deste fechamento
            all_item_ids: list[int] = []
            for card_key in _CARD_KEYS:
                card = closure_data.get(card_key) or {}
                for cc_key in _CC_KEYS:
                    for item in card.get(cc_key) or []:
                        item_id = item.get("id")
                        if item_id is not None:
                            all_item_ids.append(item_id)

            if not all_item_ids:
                skipped += 1
                continue

            # Buscar dados de parcelas
            installments_map = _fetch_installments(cursor, list(set(all_item_ids)))

            # Aplicar patches nos dois cards
            changed = False
            for card_key in _CARD_KEYS:
                card = closure_data.get(card_key) or {}
                if _patch_card(card, installments_map):
                    changed = True

            if not changed:
                skipped += 1
                continue

            # Persiste o JSON atualizado
            cursor.execute(
                "UPDATE balance_closures SET closure_data = %s::jsonb WHERE id = %s",
                (json.dumps(closure_data, default=str), closure_id),
            )
            updated += 1
            print(f"   ✅ Fechamento #{closure_id} atualizado ({len(all_item_ids)} item(ns) de cartão)")

        connection.commit()
        print(f"✅ Migration 0009 aplicada com sucesso! "
              f"Atualizados: {updated} | Sem itens de cartão: {skipped}")

    except Exception as e:
        connection.rollback()
        print(f"❌ Erro na Migration 0009: {e}")
        raise


def rollback(connection):
    """
    Não há rollback automatizado: os campos adicionados (current_installment,
    total_installments) são aditivos e não quebram versões anteriores.
    Para reverter manualmente, remova os campos do JSON usando jsonb_strip_nulls
    ou uma query UPDATE customizada.
    """
    print("⏭️  Migration 0009 não possui rollback automático (mudança aditiva no JSON).")
    print("   Para reverter, execute manualmente:")
    print("   UPDATE balance_closures")
    print("     SET closure_data = jsonb_strip_nulls(")
    print("       closure_data  -- remova os campos manualmente se necessário")
    print("     );")
