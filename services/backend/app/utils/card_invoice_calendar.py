"""Dias de calendário de fatura: fechamento e vencimento."""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.unified_models import Cartao, CreditCardInvoiceGroup


def _clamp_day(day: int, year: int, month: int) -> int:
    last = calendar.monthrange(year, month)[1]
    return min(max(int(day or 14), 1), last)


def date_in_year_month(year_month: str, day: int) -> str:
    """ISO date YYYY-MM-DD para `day` no mês `year_month` (YYYY-MM)."""
    year = int(year_month[:4])
    month = int(year_month[5:7])
    d = _clamp_day(day, year, month)
    return f"{year:04d}-{month:02d}-{d:02d}"


def _prev_month(year: int, month: int) -> tuple[int, int]:
    if month == 1:
        return year - 1, 12
    return year, month - 1


def invoice_billing_window(year_month: str, closing_day: int) -> tuple[date, date]:
    """
    Datas de compra (inclusivas) que entram na fatura `year_month`.

    Fechamento = dia inteiro; o corte para a fatura seguinte é 00:00 do dia depois.
    Ex.: fech. 15 → ciclo 16/mês anterior … 15/mês atual (ambos inclusive).
    """
    year = int(year_month[:4])
    month = int(year_month[5:7])
    close_day = min(max(int(closing_day or 14), 1), 30)
    end_day = min(close_day, calendar.monthrange(year, month)[1])
    end = date(year, month, end_day)
    prev_year, prev_month = _prev_month(year, month)
    prev_close_day = min(close_day, calendar.monthrange(prev_year, prev_month)[1])
    start = date(prev_year, prev_month, prev_close_day) + timedelta(days=1)
    return start, end


def invoice_period_datetimes(year_month: str, closing_day: int) -> tuple[datetime, datetime]:
    """Limites para filtros SQL: início 00:00:00 do primeiro dia; fim 23:59:59 do fechamento."""
    start_d, end_d = invoice_billing_window(year_month, closing_day)
    return (
        datetime.combine(start_d, datetime.min.time()),
        datetime(end_d.year, end_d.month, end_d.day, 23, 59, 59),
    )


def period_open_start_after(period_end: datetime) -> datetime:
    """Primeiro instante aberto após um fechamento (00:00 do dia seguinte ao último dia fechado)."""
    return datetime.combine(period_end.date() + timedelta(days=1), datetime.min.time())


def purchase_date_in_invoice_period(
    purchase: date,
    year_month: str,
    closing_day: int,
) -> bool:
    start, end = invoice_billing_window(year_month, closing_day)
    return start <= purchase <= end


def effective_closing_day(card: Cartao | None) -> int:
    if not card or card.type != "credito":
        return 14
    group = getattr(card, "invoice_group", None)
    if card.invoice_group_id and group is not None:
        return int(group.closing_day or 14)
    return int(card.closing_day or 14)


def effective_due_day(card: Cartao | None) -> int:
    if not card or card.type != "credito":
        return 14
    group = getattr(card, "invoice_group", None)
    if card.invoice_group_id and group is not None:
        return int(group.due_day or 14)
    return int(card.due_day or 14)


def apply_group_calendar_to_card(card: Cartao, group: CreditCardInvoiceGroup) -> None:
    if card.type != "credito":
        return
    card.closing_day = int(group.closing_day or 14)
    card.due_day = int(group.due_day or 14)
