"""Export Excel do Saldo Parcelado, com gráfico nativo (XlsxWriter).

Recebe os dados já calculados pela tela (filtros, ordenação e modo do gráfico)
e apenas os formata em um .xlsx com as abas: Resumo, Parcelas do mês e
Compras em aberto.
"""

import io
import re
from datetime import datetime
from typing import List, Literal

import xlsxwriter
from pydantic import BaseModel, Field

from app.services.excel_export_engine import HEAD_BG, MONEY_FMT


class ExportSummary(BaseModel):
    future_total: float
    next_month_total: float
    next_month_label: str | None = None
    purchases_count: int
    remaining_installments_count: int
    last_projected_month_label: str | None = None
    months_count: int


class ExportMonth(BaseModel):
    month_label: str
    total: float
    count: int
    remaining_after: float


class ExportCard(BaseModel):
    card_label: str
    remaining_total: float
    purchases_count: int


class ExportItem(BaseModel):
    card_label: str
    description: str = ""
    tag_name: str | None = None
    subtag_name: str | None = None
    sharing: str = ""
    remaining_installments: int
    current_installment: int
    total_installments: int
    installment_amount: float
    remaining_total: float
    last_projected_month: str | None = None


class ExportBarSeries(BaseModel):
    name: str
    color: str
    values: List[float]


class InstallmentsExportPayload(BaseModel):
    share: Literal["mine", "total"]
    stacked: bool = False
    line_name: str = "Saldo restante"
    line_color: str = "#7c3aed"
    summary: ExportSummary
    months: List[ExportMonth] = Field(default_factory=list)
    bars: List[ExportBarSeries] = Field(default_factory=list)
    cards: List[ExportCard] = Field(default_factory=list)
    items: List[ExportItem] = Field(default_factory=list)


def _color(value: str, fallback: str = "#2563eb") -> str:
    return value if re.fullmatch(r"#[0-9a-fA-F]{6}", value or "") else fallback


def _outflow(value: float) -> float:
    return -abs(value) if abs(value) >= 0.005 else 0


def _write_table(ws, row: int, headers: List[str], head_fmt) -> None:
    for col, header in enumerate(headers):
        ws.write(row, col, header, head_fmt)


def build_installments_xlsx(payload: InstallmentsExportPayload) -> bytes:
    buffer = io.BytesIO()
    wb = xlsxwriter.Workbook(buffer, {"in_memory": True})
    head = wb.add_format({"bold": True, "font_color": "#FFFFFF", "bg_color": HEAD_BG, "valign": "vcenter"})
    bold = wb.add_format({"bold": True})
    title = wb.add_format({"bold": True, "font_size": 14})
    section = wb.add_format({"bold": True, "font_size": 12})
    muted = wb.add_format({"font_color": "#6B7280"})
    money = wb.add_format({"num_format": MONEY_FMT})
    money_bold = wb.add_format({"num_format": MONEY_FMT, "bold": True})
    right = wb.add_format({"align": "right"})

    s = payload.summary
    months_n = len(payload.months)

    # ---- Resumo ----
    ws = wb.add_worksheet("Resumo")
    ws.set_column(0, 0, 42)
    ws.set_column(1, 2, 22)
    ws.write(0, 0, "Saldo Parcelado", title)
    ws.write(
        1, 0,
        f"Gerado em {datetime.now():%d/%m/%Y %H:%M} · "
        f"{'Minha parte' if payload.share == 'mine' else 'Valor integral'}",
        muted,
    )
    next_label = f"Próximo período · {s.next_month_label}" if s.next_month_label else "Próximo período"
    totals = [
        ("Saldo total parcelado", _outflow(s.future_total), True),
        (next_label, _outflow(s.next_month_total), True),
        ("Compras em aberto", s.purchases_count, False),
        ("Parcelas a vencer", s.remaining_installments_count, False),
        ("Última parcela", s.last_projected_month_label or "-", False),
        ("Meses com parcelas", s.months_count, False),
    ]
    for i, (label, value, is_money) in enumerate(totals):
        ws.write(3 + i, 0, label, bold)
        ws.write(3 + i, 1, value, money if is_money else right)

    row = 3 + len(totals) + 1
    ws.write(row, 0, "Projeção mês a mês", section)
    row += 1

    # Dados do gráfico ficam na aba "Parcelas do mês"; o gráfico os referencia.
    ws_months = wb.add_worksheet("Parcelas do mês")
    mname = "'Parcelas do mês'"
    if months_n and payload.bars:
        column = wb.add_chart({"type": "column", "subtype": "stacked" if payload.stacked else "clustered"})
        for idx, bar in enumerate(payload.bars):
            col = 4 + idx  # colunas auxiliares a partir da E (logo após "Saldo após o mês")
            ws_months.write(0, col, bar.name, head)
            for r, v in enumerate(bar.values[:months_n]):
                ws_months.write(r + 1, col, v, money)
            column.add_series({
                "name": [mname, 0, col],
                "categories": [mname, 1, 0, months_n, 0],
                "values": [mname, 1, col, months_n, col],
                "fill": {"color": _color(bar.color)},
                "gap": 80,
            })
        line = wb.add_chart({"type": "line"})
        line.add_series({
            "name": payload.line_name,
            "categories": [mname, 1, 0, months_n, 0],
            "values": [mname, 1, 3, months_n, 3],
            "line": {"color": _color(payload.line_color, "#7c3aed"), "width": 2.25},
        })
        column.combine(line)
        column.set_legend({"position": "bottom"})
        column.set_y_axis({"num_format": '"R$" #,##0', "major_gridlines": {"visible": True, "line": {"color": "#E5E7EB"}}})
        column.set_size({"width": 900, "height": 360})
        ws.insert_chart(row, 0, column)
        row += 19
    else:
        ws.write(row, 0, "Sem dados para o gráfico.", muted)
        row += 2

    ws.write(row, 0, "Saldo por cartão", section)
    row += 1
    _write_table(ws, row, ["Cartão", "Compras", "Saldo parcelado"], head)
    for c in payload.cards:
        row += 1
        ws.write(row, 0, c.card_label)
        ws.write(row, 1, c.purchases_count)
        ws.write(row, 2, c.remaining_total, money)

    # ---- Parcelas do mês ----
    ws_months.set_column(0, 0, 18)
    ws_months.set_column(1, 1, 12)
    ws_months.set_column(2, 3, 20)
    ws_months.set_column(4, 4 + max(len(payload.bars), 1) - 1, 20)
    _write_table(ws_months, 0, ["Mês", "Parcelas", "Total do mês", "Saldo após o mês"], head)
    for i, m in enumerate(payload.months, start=1):
        ws_months.write(i, 0, m.month_label)
        ws_months.write(i, 1, m.count)
        ws_months.write(i, 2, m.total, money)
        ws_months.write(i, 3, m.remaining_after, money)
    last = months_n + 1
    ws_months.write(last, 0, "Total projetado", bold)
    ws_months.write(last, 1, s.remaining_installments_count, bold)
    ws_months.write(last, 2, s.future_total, money_bold)
    ws_months.freeze_panes(1, 0)

    # ---- Compras em aberto ----
    ws_items = wb.add_worksheet("Compras em aberto")
    heads = [
        "Cartão", "Descrição", "Tag", "Subtag", "Compartilhamento", "Parcelas futuras",
        "Parcela atual", "Total de parcelas", "Valor da parcela", "Saldo restante", "Até",
    ]
    for col, width in enumerate([30, 44, 18, 18, 28, 12, 14, 14, 18, 18, 12]):
        ws_items.set_column(col, col, width)
    _write_table(ws_items, 0, heads, head)
    for i, it in enumerate(payload.items, start=1):
        ws_items.write_row(i, 0, [it.card_label, it.description, it.tag_name or "", it.subtag_name or "", it.sharing])
        ws_items.write_row(i, 5, [it.remaining_installments, it.current_installment, it.total_installments])
        ws_items.write(i, 8, _outflow(it.installment_amount), money)
        ws_items.write(i, 9, _outflow(it.remaining_total), money)
        ws_items.write(i, 10, it.last_projected_month or "")
    ws_items.autofilter(0, 0, max(len(payload.items), 1), len(heads) - 1)
    ws_items.freeze_panes(1, 0)

    wb.close()
    return buffer.getvalue()
