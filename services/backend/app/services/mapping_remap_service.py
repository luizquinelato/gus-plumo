# -*- coding: utf-8 -*-
"""Aplica mapeamentos de transação às tabelas extrato, fatura e benefício."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy import func

from app.models.unified_models import BankStatement, BenefitCardStatement, CreditCardInvoice, Subtag

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.models.unified_models import TransactionMapping

logger = logging.getLogger(__name__)

REMAP_TYPE_ORDER = {"regex": 0, "pattern": 1, "exact": 2}


def sort_mappings_for_remap(mappings: list) -> list:
    """Ordem de aplicação: regex → pattern → exact (exato por último, como na importação)."""
    return sorted(
        mappings,
        key=lambda m: (
            REMAP_TYPE_ORDER.get(m.mapping_type or "exact", 99),
            int(m.priority or 0),
            m.id,
        ),
    )


def apply_mapping_remap(
    db: "Session",
    tenant_id: int,
    mapping: "TransactionMapping",
    options,
    mapping_apply_percentage,
) -> tuple[int, int, int]:
    """
    Atualiza bank_statements, credit_card_invoices e benefit_card_statements.
    Retorna (bank_count, cc_count, benefit_count).
    """
    updated_bank = 0
    updated_cc = 0
    updated_benefit = 0

    subtag = db.query(Subtag).filter(Subtag.id == mapping.subtag_id).first()
    subtag_type = subtag.type if subtag else "despesa"
    is_receita = subtag_type == "receita"

    update_values: dict = {"subtag_id": mapping.subtag_id}

    if mapping.expense_sharing_id is not None or not options.skip_sharing_if_null:
        update_values["expense_sharing_id"] = mapping.expense_sharing_id
        update_values["ownership_percentage"] = mapping_apply_percentage(db, mapping, is_receita)

    if mapping.mapping_type == "exact":
        search_description = mapping.original_description
        if mapping.is_sensitive and search_description:
            try:
                from app.utils.crypto_helper import get_crypto_helper

                crypto = get_crypto_helper()
                search_description = crypto.decrypt(search_description)
            except Exception as e:
                logger.warning("Erro ao descriptografar original_description: %s", e)
                search_description = None

        if search_description:
            base_filter_bank = [
                BankStatement.tenant_id == tenant_id,
                func.lower(BankStatement.description) == search_description.lower(),
            ]
            base_filter_cc = [
                CreditCardInvoice.tenant_id == tenant_id,
                func.lower(CreditCardInvoice.description) == search_description.lower(),
            ]
            base_filter_benefit = [
                BenefitCardStatement.tenant_id == tenant_id,
                func.lower(BenefitCardStatement.description) == search_description.lower(),
            ]

            if is_receita:
                base_filter_bank.append(BankStatement.amount > 0)
                base_filter_cc.append(CreditCardInvoice.amount > 0)
                base_filter_benefit.append(BenefitCardStatement.amount > 0)
            else:
                base_filter_bank.append(BankStatement.amount < 0)
                base_filter_cc.append(CreditCardInvoice.amount < 0)
                base_filter_benefit.append(BenefitCardStatement.amount < 0)

            updated_bank = db.query(BankStatement).filter(*base_filter_bank).update(
                update_values, synchronize_session=False
            )
            updated_cc = db.query(CreditCardInvoice).filter(*base_filter_cc).update(
                update_values, synchronize_session=False
            )
            updated_benefit = db.query(BenefitCardStatement).filter(*base_filter_benefit).update(
                update_values, synchronize_session=False
            )

    elif mapping.mapping_type == "pattern" and mapping.pattern:
        from app.utils.sensitive_mapping import decrypt_pattern_for_match

        plain_pattern = decrypt_pattern_for_match(mapping.pattern, mapping.is_sensitive)
        if not plain_pattern:
            return updated_bank, updated_cc, updated_benefit
        pattern_lower = plain_pattern.lower()
        like_pattern = f"%{pattern_lower}%"

        base_filter_bank = [
            BankStatement.tenant_id == tenant_id,
            func.lower(BankStatement.description).like(like_pattern),
        ]
        base_filter_cc = [
            CreditCardInvoice.tenant_id == tenant_id,
            func.lower(CreditCardInvoice.description).like(like_pattern),
        ]
        base_filter_benefit = [
            BenefitCardStatement.tenant_id == tenant_id,
            func.lower(BenefitCardStatement.description).like(like_pattern),
        ]

        if is_receita:
            base_filter_bank.append(BankStatement.amount > 0)
            base_filter_cc.append(CreditCardInvoice.amount > 0)
            base_filter_benefit.append(BenefitCardStatement.amount > 0)
        else:
            base_filter_bank.append(BankStatement.amount < 0)
            base_filter_cc.append(CreditCardInvoice.amount < 0)
            base_filter_benefit.append(BenefitCardStatement.amount < 0)

        updated_bank = db.query(BankStatement).filter(*base_filter_bank).update(
            update_values, synchronize_session=False
        )
        updated_cc = db.query(CreditCardInvoice).filter(*base_filter_cc).update(
            update_values, synchronize_session=False
        )
        updated_benefit = db.query(BenefitCardStatement).filter(*base_filter_benefit).update(
            update_values, synchronize_session=False
        )

    elif mapping.mapping_type == "regex" and mapping.regex_pattern:
        from app.utils.sensitive_mapping import decrypt_regex_for_match

        regex_pattern = decrypt_regex_for_match(mapping.regex_pattern, mapping.is_sensitive)
        if not regex_pattern:
            return updated_bank, updated_cc, updated_benefit
        try:
            base_filter_bank = [
                BankStatement.tenant_id == tenant_id,
                BankStatement.description.op("~*")(regex_pattern),
            ]
            base_filter_cc = [
                CreditCardInvoice.tenant_id == tenant_id,
                CreditCardInvoice.description.op("~*")(regex_pattern),
            ]
            base_filter_benefit = [
                BenefitCardStatement.tenant_id == tenant_id,
                BenefitCardStatement.description.op("~*")(regex_pattern),
            ]

            if is_receita:
                base_filter_bank.append(BankStatement.amount > 0)
                base_filter_cc.append(CreditCardInvoice.amount > 0)
                base_filter_benefit.append(BenefitCardStatement.amount > 0)
            else:
                base_filter_bank.append(BankStatement.amount < 0)
                base_filter_cc.append(CreditCardInvoice.amount < 0)
                base_filter_benefit.append(BenefitCardStatement.amount < 0)

            updated_bank = db.query(BankStatement).filter(*base_filter_bank).update(
                update_values, synchronize_session=False
            )
            updated_cc = db.query(CreditCardInvoice).filter(*base_filter_cc).update(
                update_values, synchronize_session=False
            )
            updated_benefit = db.query(BenefitCardStatement).filter(*base_filter_benefit).update(
                update_values, synchronize_session=False
            )
        except Exception as e:
            logger.warning("Erro ao executar regex '%s': %s", regex_pattern, e)
            raise HTTPException(status_code=400, detail=f"Expressão regex inválida: {str(e)}")

    return updated_bank, updated_cc, updated_benefit
