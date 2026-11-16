"""
Quitação de fechamentos de balanço compartilhado (PIX vs empréstimo vinculado).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.unified_models import BalanceClosure, Loan, LoanPayment

SETTLEMENT_PENDING = "pending"
SETTLEMENT_SETTLED = "settled"
SETTLEMENT_LOAN_OPEN = "loan_open"
SETTLEMENT_SETTLED_VIA_LOAN = "settled_via_loan"

LOAN_BLOCKING_STATUSES = (SETTLEMENT_LOAN_OPEN, SETTLEMENT_SETTLED_VIA_LOAN)
SETTLED_STATUSES = (SETTLEMENT_SETTLED, SETTLEMENT_SETTLED_VIA_LOAN)


def effective_settlement_status(closure: BalanceClosure) -> str:
    status = getattr(closure, "settlement_status", None) or SETTLEMENT_PENDING
    if closure.is_settled and status == SETTLEMENT_PENDING:
        return SETTLEMENT_SETTLED
    return status


def apply_settlement_status(closure: BalanceClosure, status: str) -> None:
    closure.settlement_status = status
    closure.is_settled = status in SETTLED_STATUSES


def assert_closure_allows_pix_payments(closure: BalanceClosure) -> None:
    status = effective_settlement_status(closure)
    if status in LOAN_BLOCKING_STATUSES:
        raise ValueError(
            "Este fechamento está vinculado a um empréstimo. "
            "Registre pagamentos na tela de Empréstimos."
        )
    if status == SETTLEMENT_SETTLED:
        raise ValueError("Fechamento já está quitado.")


def loan_type_for_closure_debt(net_balance: Decimal) -> str:
    """Mesma convenção do fluxo de pagamentos: net > 0 = mandante a receber."""
    if net_balance > 0:
        return "lent"
    return "borrowed"


def loan_payments_total(loan_id: int, db: Session) -> Decimal:
    total = (
        db.query(func.coalesce(func.sum(LoanPayment.amount), 0))
        .filter(
            LoanPayment.loan_id == loan_id,
            LoanPayment.active == True,  # noqa: E712
        )
        .scalar()
    )
    return Decimal(str(total or 0))


def loan_remaining_principal(loan: Loan, db: Session) -> Decimal:
    paid = loan_payments_total(loan.id, db)
    return Decimal(str(loan.principal_amount)) - paid


def find_closure_for_settlement_loan(loan: Loan, db: Session) -> BalanceClosure | None:
    if loan.source_table == "balance_closures" and loan.source_id:
        by_source = (
            db.query(BalanceClosure)
            .filter(
                BalanceClosure.id == loan.source_id,
                BalanceClosure.tenant_id == loan.tenant_id,
            )
            .first()
        )
        if by_source:
            return by_source
    return (
        db.query(BalanceClosure)
        .filter(
            BalanceClosure.settlement_loan_id == loan.id,
            BalanceClosure.tenant_id == loan.tenant_id,
        )
        .first()
    )


def maybe_promote_closure_settled_via_loan(
    loan: Loan,
    db: Session,
    *,
    user_id: int | None = None,
) -> BalanceClosure | None:
    """Quando o empréstimo de origem fechamento zera, promove o fechamento para settled_via_loan."""
    closure = find_closure_for_settlement_loan(loan, db)
    if not closure or closure.settlement_loan_id != loan.id:
        return None

    status = effective_settlement_status(closure)
    if status == SETTLEMENT_SETTLED_VIA_LOAN:
        return closure
    if status != SETTLEMENT_LOAN_OPEN:
        return None

    remaining = loan_remaining_principal(loan, db)
    if loan.status != "settled" and remaining > Decimal("0.01"):
        return None

    apply_settlement_status(closure, SETTLEMENT_SETTLED_VIA_LOAN)
    closure.settled_at = loan.settled_at or datetime.now()
    if user_id:
        closure.settled_by = user_id
    closure.settlement_notes = (
        f"Quitado via liquidação do empréstimo #{loan.id}"
        + (f" — {loan.description}" if loan.description else "")
    )
    return closure


def maybe_reopen_closure_from_loan(loan: Loan, db: Session) -> BalanceClosure | None:
    """Se o empréstimo vinculado reabre, volta o fechamento para loan_open (quando estava quitado via empréstimo)."""
    closure = find_closure_for_settlement_loan(loan, db)
    if not closure:
        return None
    if effective_settlement_status(closure) != SETTLEMENT_SETTLED_VIA_LOAN:
        return None
    apply_settlement_status(closure, SETTLEMENT_LOAN_OPEN)
    closure.settled_at = None
    closure.settled_by = None
    auto_note = "Quitado via liquidação do empréstimo"
    notes = closure.settlement_notes or ""
    if auto_note in notes:
        closure.settlement_notes = None
    return closure


def detach_closure_from_deleted_settlement_loan(loan: Loan, db: Session) -> BalanceClosure | None:
    """
    Ao excluir o empréstimo de acerto do fechamento, volta o balanço para pendente
  (permite PIX / novo empréstimo).
    """
    closure = find_closure_for_settlement_loan(loan, db)
    if not closure or closure.settlement_loan_id != loan.id:
        return None

    status = effective_settlement_status(closure)
    if status not in (SETTLEMENT_LOAN_OPEN, SETTLEMENT_SETTLED_VIA_LOAN):
        closure.settlement_loan_id = None
        return closure

    apply_settlement_status(closure, SETTLEMENT_PENDING)
    closure.settlement_loan_id = None
    closure.settled_at = None
    closure.settled_by = None
    notes = (closure.settlement_notes or "").strip()
    for marker in (
        f"Dívida transferida para empréstimo #{loan.id}",
        f"Quitado via liquidação do empréstimo #{loan.id}",
    ):
        if marker in notes:
            notes = notes.replace(marker, "").strip(" —|")
    closure.settlement_notes = notes or None
    return closure


def build_settlement_loan_summary(loan: Loan | None, db: Session) -> dict | None:
    if not loan or not loan.active:
        return None
    paid = loan_payments_total(loan.id, db)
    principal = Decimal(str(loan.principal_amount))
    remaining = principal - paid
    return {
        "id": loan.id,
        "description": loan.description,
        "status": loan.status,
        "loan_type": loan.loan_type,
        "principal_amount": float(principal),
        "total_paid": float(paid),
        "remaining_balance": float(max(remaining, Decimal("0"))),
    }