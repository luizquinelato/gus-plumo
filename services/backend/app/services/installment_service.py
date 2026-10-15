"""
Serviço de parcelamentos em aberto (saldo parcelado).

Centraliza a identificação de compras parceladas ainda em aberto e a projeção
das parcelas futuras, para que Home/Dashboard e o relatório de Saldo Parcelado
usem exatamente o mesmo critério de cálculo.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import List

from sqlalchemy.orm import Session, aliased

from app.models.unified_models import (
    Account,
    Cartao,
    CreditCardInvoice,
    ExpenseSharingSetting,
    Subtag,
    Tag,
)

MONTH_SHORT_NAMES = {
    1: "Jan", 2: "Fev", 3: "Mar", 4: "Abr", 5: "Mai", 6: "Jun",
    7: "Jul", 8: "Ago", 9: "Set", 10: "Out", 11: "Nov", 12: "Dez",
}


@dataclass
class InstallmentPurchase:
    """Item parcelado da fatura-base, com parcelas futuras ainda pendentes."""
    id: int
    description: str
    purchase_date: date | None
    amount: Decimal  # valor da parcela conforme registrado (preserva sinal)
    installment_amount: Decimal  # valor absoluto da parcela (valor integral da compra)
    my_installment_amount: Decimal  # parcela ajustada por ownership_percentage
    ownership_percentage: Decimal
    current_installment: int
    total_installments: int
    remaining_installments: int
    last_year_month: str  # competência da fatura-base
    card_id: int
    card_name: str
    card_number: str
    card_type: str
    issuer: str | None = None
    subtag_id: int | None = None
    subtag_name: str | None = None
    tag_name: str | None = None
    expense_sharing_id: int | None = None
    shared_partner_name: str | None = None

    @property
    def remaining_total(self) -> Decimal:
        return self.installment_amount * self.remaining_installments

    @property
    def my_remaining_total(self) -> Decimal:
        return self.my_installment_amount * self.remaining_installments


def month_label(year_month: str) -> str:
    """Converte 'YYYY-MM' em 'Mmm/AAAA'."""
    year_str, month_str = year_month.split('-')
    return f"{MONTH_SHORT_NAMES[int(month_str)]}/{year_str}"


def add_months(year_month: str, delta: int) -> str:
    """Soma meses a um 'YYYY-MM'."""
    year_str, month_str = year_month.split('-')
    index = int(year_str) * 12 + (int(month_str) - 1) + delta
    return f"{index // 12}-{str(index % 12 + 1).zfill(2)}"


def projected_months(purchase: InstallmentPurchase) -> List[str]:
    """Meses das parcelas futuras, a partir do mês seguinte ao último registrado."""
    return [
        add_months(purchase.last_year_month, offset)
        for offset in range(1, purchase.remaining_installments + 1)
    ]


def get_open_installment_purchases(
    db: Session,
    tenant_id: int,
    account_id: int,
    card_id: int | None = None,
) -> List[InstallmentPurchase]:
    """Retorna parcelas futuras a partir da última fatura disponível de cada cartão."""
    SharedAccount = aliased(Account)
    current_year_month = date.today().strftime("%Y-%m")
    previous_year_month = add_months(current_year_month, -1)

    # Fatura-base (regra da conta):
    # 1) se a fatura do mês corrente tem parcelas em aberto, ela é a base;
    # 2) senão, a base é a fatura do mês anterior.
    base_query = db.query(CreditCardInvoice.year_month).join(
        Cartao, CreditCardInvoice.credit_card_id == Cartao.id
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        Cartao.account_id == account_id,
        CreditCardInvoice.year_month.in_([current_year_month, previous_year_month]),
        CreditCardInvoice.current_installment.isnot(None),
        CreditCardInvoice.total_installments.isnot(None),
        (CreditCardInvoice.total_installments - CreditCardInvoice.current_installment) > 0,
    )
    if card_id is not None:
        base_query = base_query.filter(CreditCardInvoice.credit_card_id == card_id)

    months_with_open_items = {row.year_month for row in base_query.distinct().all()}
    if current_year_month in months_with_open_items:
        base_year_month = current_year_month
    elif previous_year_month in months_with_open_items:
        base_year_month = previous_year_month
    else:
        return []

    rows = db.query(
        CreditCardInvoice.id,
        CreditCardInvoice.credit_card_id,
        CreditCardInvoice.description,
        CreditCardInvoice.total_installments,
        CreditCardInvoice.current_installment,
        CreditCardInvoice.amount,
        CreditCardInvoice.year_month,
        CreditCardInvoice.date,
        CreditCardInvoice.ownership_percentage,
        CreditCardInvoice.issuer,
        CreditCardInvoice.subtag_id,
        CreditCardInvoice.expense_sharing_id,
        Cartao.number.label('card_number'),
        Cartao.name.label('card_name'),
        Cartao.type.label('card_type'),
        Subtag.name.label('subtag_name'),
        Tag.name.label('tag_name'),
        SharedAccount.name.label('shared_partner_name'),
    ).join(
        Cartao, CreditCardInvoice.credit_card_id == Cartao.id
    ).outerjoin(
        Subtag, CreditCardInvoice.subtag_id == Subtag.id
    ).outerjoin(
        Tag, Subtag.tag_id == Tag.id
    ).outerjoin(
        ExpenseSharingSetting, CreditCardInvoice.expense_sharing_id == ExpenseSharingSetting.id
    ).outerjoin(
        SharedAccount, ExpenseSharingSetting.shared_account_id == SharedAccount.id
    ).filter(
        CreditCardInvoice.tenant_id == tenant_id,
        Cartao.account_id == account_id,
        CreditCardInvoice.year_month == base_year_month,
        CreditCardInvoice.current_installment.isnot(None),
        CreditCardInvoice.total_installments.isnot(None),
        CreditCardInvoice.total_installments > 1,
        *([CreditCardInvoice.credit_card_id == card_id] if card_id is not None else []),
    ).all()

    purchases: List[InstallmentPurchase] = []
    for row in rows:
        remaining_count = row.total_installments - row.current_installment
        if remaining_count <= 0:
            continue

        installment_amount = abs(row.amount)
        ownership = row.ownership_percentage
        ownership = Decimal(100) if ownership is None else Decimal(ownership)

        purchases.append(InstallmentPurchase(
            id=row.id,
            description=row.description or '',
            purchase_date=row.date.date() if row.date else None,
            amount=row.amount,
            installment_amount=installment_amount,
            my_installment_amount=installment_amount * ownership / Decimal(100),
            ownership_percentage=ownership,
            current_installment=row.current_installment,
            total_installments=row.total_installments,
            remaining_installments=remaining_count,
            last_year_month=base_year_month,
            card_id=row.credit_card_id,
            card_name=row.card_name,
            card_number=row.card_number,
            card_type=row.card_type or 'credito',
            issuer=row.issuer,
            subtag_id=row.subtag_id,
            subtag_name=row.subtag_name,
            tag_name=row.tag_name,
            expense_sharing_id=row.expense_sharing_id,
            shared_partner_name=row.shared_partner_name,
        ))

    purchases.sort(
        key=lambda p: (p.purchase_date.strftime("%Y-%m-%d") if p.purchase_date else '', p.description or ''),
        reverse=True,
    )
    return purchases
