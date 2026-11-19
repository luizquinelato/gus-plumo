"""Carrega itens de origem importada (extrato, fatura, benefício) — mesmo vocabulário dos empréstimos."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.unified_models import (
    Account,
    Bank,
    BankStatement,
    BenefitCardStatement,
    CreditCardInvoice,
    ExpenseSharingSetting,
    Subtag,
    Tag,
)

ALLOWED_SOURCE_TABLES = frozenset({
    "bank_statements",
    "credit_card_invoices",
    "benefit_card_statements",
})


def load_source_item(
    db: Session,
    tenant_id: int,
    account_id: int,
    source_table: str,
    source_id: int,
):
    if source_table not in ALLOWED_SOURCE_TABLES:
        raise HTTPException(
            status_code=400,
            detail="source_table inválido. Use: 'bank_statements', 'credit_card_invoices' ou 'benefit_card_statements'",
        )
    if source_table == "bank_statements":
        item = db.query(BankStatement).filter(
            BankStatement.id == source_id,
            BankStatement.tenant_id == tenant_id,
            BankStatement.account_id == account_id,
        ).first()
    elif source_table == "credit_card_invoices":
        item = db.query(CreditCardInvoice).filter(
            CreditCardInvoice.id == source_id,
            CreditCardInvoice.tenant_id == tenant_id,
            CreditCardInvoice.account_id == account_id,
        ).first()
    else:
        item = db.query(BenefitCardStatement).filter(
            BenefitCardStatement.id == source_id,
            BenefitCardStatement.tenant_id == tenant_id,
            BenefitCardStatement.account_id == account_id,
        ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item fonte não encontrado")
    return item


def _sharing_partner_id(db: Session, statement: BankStatement, logged_account_id: int) -> int | None:
    if statement.migrated_from_account_id:
        return statement.migrated_from_account_id
    if not statement.expense_sharing_id:
        return None
    setting = db.query(ExpenseSharingSetting).filter(
        ExpenseSharingSetting.id == statement.expense_sharing_id,
    ).first()
    if not setting:
        return None
    if setting.account_id == logged_account_id:
        return setting.shared_account_id
    return setting.account_id


def _partner_account_fields(db: Session, partner_id: int | None) -> dict[str, Any]:
    if not partner_id:
        return {
            "shared_partner_name": None,
            "shared_partner_bank": None,
            "shared_partner_agency": None,
            "shared_partner_account_number": None,
        }
    row = (
        db.query(
            Account.name,
            Bank.name.label("bank_name"),
            Account.agency,
            Account.account_number,
        )
        .outerjoin(Bank, Bank.id == Account.bank_id)
        .filter(Account.id == partner_id)
        .first()
    )
    if not row:
        return {
            "shared_partner_name": None,
            "shared_partner_bank": None,
            "shared_partner_agency": None,
            "shared_partner_account_number": None,
        }
    return {
        "shared_partner_name": row.name,
        "shared_partner_bank": row.bank_name,
        "shared_partner_agency": str(row.agency) if row.agency is not None else None,
        "shared_partner_account_number": str(row.account_number) if row.account_number is not None else None,
    }


def bank_statement_expense_detail(
    db: Session,
    tenant_id: int,
    account_id: int,
    statement_id: int,
) -> dict[str, Any]:
    """Shape compatível com ExpenseDetail do Extrato / EditExpenseModal."""
    statement = load_source_item(db, tenant_id, account_id, "bank_statements", statement_id)
    subtag_name = tag_name = None
    if statement.subtag_id:
        sub = db.query(Subtag).filter(Subtag.id == statement.subtag_id).first()
        if sub:
            subtag_name = sub.name
            if sub.tag_id:
                tag = db.query(Tag).filter(Tag.id == sub.tag_id).first()
                tag_name = tag.name if tag else None
    acct = db.query(Account).filter(Account.id == statement.account_id).first()
    bank_name = bank_code = None
    account_agency = account_number = account_name = None
    if acct:
        account_name = acct.name
        account_agency = str(acct.agency) if acct.agency is not None else None
        account_number = str(acct.account_number) if acct.account_number is not None else None
        if acct.bank_id:
            bank = db.query(Bank).filter(Bank.id == acct.bank_id).first()
            if bank:
                bank_name = bank.name
                bank_code = bank.code
    partner_id = _sharing_partner_id(db, statement, account_id)
    partner = _partner_account_fields(db, partner_id)
    adjustment = "compartilhado" if statement.expense_sharing_id else "proprio"
    dt = statement.date
    if isinstance(dt, datetime):
        date_out = dt
    else:
        date_out = datetime.combine(dt, datetime.min.time())

    linked_invoice = None
    from app.services import invoice_payment_match_service as match_service

    linked = match_service.linked_invoice_summaries_by_statement_ids(
        db, tenant_id, account_id, [statement.id],
    )
    if statement.id in linked:
        linked_invoice = linked[statement.id]

    return {
        "id": statement.id,
        "date": date_out,
        "description": statement.description,
        "amount": Decimal(str(statement.amount)),
        "source": "bank",
        "card_number": None,
        "card_name": None,
        "credit_card_id": None,
        "category": statement.category,
        "transaction": statement.transaction,
        "subtag_id": statement.subtag_id,
        "subtag_name": subtag_name,
        "tag_name": tag_name,
        "current_installment": None,
        "total_installments": None,
        "adjustment_type": adjustment,
        "ownership_percentage": Decimal(str(statement.ownership_percentage or 100)),
        "expense_sharing_id": statement.expense_sharing_id,
        "shared_partner_id": partner_id,
        "shared_partner_name": partner["shared_partner_name"],
        "shared_partner_bank": partner["shared_partner_bank"],
        "shared_partner_agency": partner["shared_partner_agency"],
        "shared_partner_account_number": partner["shared_partner_account_number"],
        "account_id": statement.account_id,
        "account_name": account_name,
        "bank_code": bank_code,
        "bank_name": bank_name,
        "account_agency": account_agency,
        "account_number": account_number,
        "year_month": None,
        "migrated_from_account_id": statement.migrated_from_account_id,
        "is_manual": bool(statement.is_manual),
        "linked_invoice": linked_invoice,
        "daily_month_end": None,
    }