"""Motor único de export Excel (XlsxWriter).

Layout mínimo padrão para todas as exportações em tabela: cabeçalho escuro,
painel congelado, autofiltro, larguras automáticas e formatos por tipo de coluna.
Recebe dados já prontos (a tela decide filtros/ordenação) e apenas os formata.
Gráficos de tabela não fazem parte do motor genérico; o Saldo Parcelado os monta à parte
reutilizando `HEAD_BG` e `MONEY_FMT`. Abas de layout livre (`cells`) aceitam fórmulas, nomes
definidos e gráficos de linha nativos (projeção de consórcio).
"""

import datetime
import io
import math
import re
from typing import Any, Dict, List, Literal

import xlsxwriter
from pydantic import BaseModel, Field

MONEY_FMT = '"R$" #,##0.00;[Red]-"R$" #,##0.00'
HEAD_BG = "#374151"
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# `decimal` é o número sem símbolo de moeda, usado nas planilhas que o wizard
# /importar reimporta (extratos, faturas, benefícios, relatório de faturas).
ColumnKind = Literal["text", "int", "month", "money", "decimal", "percent", "date", "datetime", "monthyear"]

_NUM_FORMATS: Dict[str, str] = {
    "monthyear": "mm/yyyy",
    "int": "0",
    "month": "00",
    "money": MONEY_FMT,
    "decimal": "#,##0.00_);(#,##0.00)",
    # Valor da célula em fração (0,5 = 50%); a tela/importação converte de/para 50.
    "percent": "0.00%",
    "date": "dd/mm/yyyy",
    "datetime": "dd/mm/yyyy hh:mm:ss",
}

# Mesmas cores da tela do extrato (sky = saldo diário; amber = fim do mês).
ROW_STYLE_BG: Dict[str, str] = {"daily": "#E0F2FE", "daily_month_end": "#FEF3C7"}

MAX_SHEETS = 120
MAX_TOTAL_ROWS = 200_000
_BAD_SHEET_CHARS = re.compile(r"[\[\]:*?/\\]")

Cell = str | int | float | bool | None


PIE_CHART_ROWS = 27  # linhas reservadas acima da tabela para o gráfico


class PieSpec(BaseModel):
    """Pizza nativa posicionada acima da tabela da aba."""

    title: str = Field(default="", max_length=100)
    category_column: str
    value_column: str
    # Cor (#RRGGBB) por linha de `rows`, na mesma ordem.
    colors: List[str] = Field(default_factory=list)


CellStyle = Literal["", "title", "section", "head", "label", "input", "calc", "note"]

_CELL_STYLES: Dict[str, Dict[str, Any]] = {
    "title": {"bold": True, "font_size": 14},
    "section": {"bold": True, "bg_color": "#E5E7EB", "bottom": 1},
    "head": {"bold": True, "font_color": "#FFFFFF", "bg_color": HEAD_BG, "valign": "vcenter"},
    "label": {"bold": True},
    # Campos que o usuário edita: fundo amarelo e borda.
    "input": {"bold": True, "bg_color": "#FEF9C3", "border": 1, "border_color": "#CA8A04"},
    "calc": {"font_color": "#6B7280"},
    "note": {"italic": True, "font_color": "#6B7280"},
}


class CellSpec(BaseModel):
    """Célula posicionada (planilhas com layout livre e fórmulas)."""

    r: int = Field(ge=0, le=200_000)
    c: int = Field(ge=0, le=500)
    v: Cell = None
    # Fórmula em inglês, com vírgulas e começando por "=". `v` vira o valor em cache.
    f: str | None = Field(default=None, max_length=2000)
    kind: ColumnKind | None = None
    style: CellStyle = ""


class RangeSpec(BaseModel):
    sheet: str
    r1: int = Field(ge=0)
    c1: int = Field(ge=0)
    r2: int = Field(ge=0)
    c2: int = Field(ge=0)


class SeriesSpec(BaseModel):
    name: str = Field(max_length=100)
    values: RangeSpec
    color: str = "#6b7280"


class LineChartSpec(BaseModel):
    title: str = Field(default="", max_length=100)
    row: int = Field(ge=0)
    col: int = Field(ge=0)
    width: int = Field(default=760, ge=200, le=2000)
    height: int = Field(default=340, ge=150, le=1200)
    categories: RangeSpec
    series: List[SeriesSpec] = Field(min_length=1, max_length=6)
    y_kind: ColumnKind = "money"
    x_kind: ColumnKind = "monthyear"


class SheetSpec(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    # Layout livre: quando informado, `rows`/`columns` são ignorados.
    cells: List[CellSpec] = Field(default_factory=list)
    col_widths: Dict[int, int] = Field(default_factory=dict)
    line_charts: List[LineChartSpec] = Field(default_factory=list)
    rows: List[Dict[str, Cell]] = Field(default_factory=list)
    # Ordem das colunas; se vazio, usa a união das chaves na ordem de aparição.
    columns: List[str] = Field(default_factory=list)
    kinds: Dict[str, ColumnKind] = Field(default_factory=dict)
    # Linhas livres acima do cabeçalho (título/resumo) e abaixo da tabela (totais).
    preamble: List[List[Cell]] = Field(default_factory=list)
    footer: List[List[Cell]] = Field(default_factory=list)
    # Estilo por linha de `rows` (mesma ordem): "", "daily" ou "daily_month_end".
    row_styles: List[str] = Field(default_factory=list)
    # Gráfico de pizza acima da tabela (opcional).
    pie: PieSpec | None = None


class ExcelExportPayload(BaseModel):
    sheets: List[SheetSpec] = Field(min_length=1, max_length=MAX_SHEETS)
    # Nomes definidos (nome → referência, ex.: "='Projeção'!$B$5"), usados nas fórmulas das células livres.
    names: Dict[str, str] = Field(default_factory=dict)


def _sheet_name(raw: str, used: set) -> str:
    base = (_BAD_SHEET_CHARS.sub(" ", raw).strip().strip("'") or "Planilha")[:31]
    name, n = base, 2
    while name.lower() in used:
        suffix = f" ({n})"
        name, n = base[: 31 - len(suffix)] + suffix, n + 1
    used.add(name.lower())
    return name


def _write_cell(
    ws, row: int, col: int, value: Cell, kind: str | None, fmts: Dict[str, Any], bg_fmt: Any = None
) -> None:
    """Escreve sem interpretar texto como fórmula (sem `ws.write` genérico).

    `bg_fmt` é o formato só com cor de fundo, usado em strings/booleanos de linhas estilizadas.
    """
    if value is None or value == "":
        return
    if isinstance(value, bool):
        ws.write_string(row, col, "Sim" if value else "Não", bg_fmt)
    elif isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            if bg_fmt is not None:
                ws.write_blank(row, col, None, bg_fmt)
            return
        ws.write_number(row, col, value, fmts.get(kind or ""))
    elif kind in ("int", "month", "money", "decimal", "percent") and re.fullmatch(r"-?\d+(\.\d+)?", value):
        ws.write_number(row, col, float(value), fmts.get(kind))
    else:
        ws.write_string(row, col, str(value), bg_fmt)


def _free_kind(value: Cell) -> str | None:
    """Números em linhas livres (resumo/totais) são valores monetários."""
    return "money" if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _widths(headers: List[str], rows: List[Dict[str, Cell]]) -> List[int]:
    out = []
    for h in headers:
        longest = max([len(str(h))] + [len(str(r.get(h) or "")) for r in rows[:500]])
        out.append(min(max(longest + 2, 10), 60))
    return out


_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _write_free_sheet(wb, ws, spec: SheetSpec, final_names: Dict[str, str]) -> None:
    """Planilha de layout livre: células posicionadas (valor ou fórmula) e gráficos de linha nativos."""
    cache: Dict[tuple, Any] = {}

    def fmt(style: str, kind: str | None):
        key = (style, kind)
        if key not in cache:
            props = dict(_CELL_STYLES.get(style, {}))
            if kind in _NUM_FORMATS:
                props["num_format"] = _NUM_FORMATS[kind]
            cache[key] = wb.add_format(props) if props else None
        return cache[key]

    for cell in spec.cells:
        f = fmt(cell.style, cell.kind)
        if cell.f:
            formula = cell.f if cell.f.startswith("=") else "=" + cell.f
            cached = cell.v if isinstance(cell.v, (int, float, str)) and not isinstance(cell.v, bool) else 0
            ws.write_formula(cell.r, cell.c, formula, f, cached)
        elif cell.v is None or cell.v == "":
            if f is not None:
                ws.write_blank(cell.r, cell.c, None, f)
        elif cell.kind in ("date", "monthyear") and isinstance(cell.v, str) and _ISO_DATE.fullmatch(cell.v):
            ws.write_datetime(cell.r, cell.c, datetime.datetime.fromisoformat(cell.v), f)
        elif isinstance(cell.v, (int, float)) and not isinstance(cell.v, bool):
            if not (isinstance(cell.v, float) and not math.isfinite(cell.v)):
                ws.write_number(cell.r, cell.c, cell.v, f)
        else:
            ws.write_string(cell.r, cell.c, str(cell.v), f)

    for col, width in spec.col_widths.items():
        ws.set_column(col, col, width)

    def ref(rng: RangeSpec) -> list:
        return [final_names.get(rng.sheet, rng.sheet), rng.r1, rng.c1, rng.r2, rng.c2]

    for spec_chart in spec.line_charts:
        chart = wb.add_chart({"type": "line"})
        for s in spec_chart.series:
            color = s.color if re.fullmatch(r"#[0-9a-fA-F]{6}", s.color or "") else "#6b7280"
            chart.add_series({
                "name": s.name,
                "categories": ref(spec_chart.categories),
                "values": ref(s.values),
                "line": {"color": color, "width": 2.25},
            })
        if spec_chart.title:
            chart.set_title({"name": spec_chart.title})
        chart.set_x_axis({"num_format": _NUM_FORMATS.get(spec_chart.x_kind, "General"), "label_position": "low"})
        chart.set_y_axis({"num_format": _NUM_FORMATS.get(spec_chart.y_kind, "General")})
        chart.set_legend({"position": "bottom"})
        chart.set_size({"width": spec_chart.width, "height": spec_chart.height})
        ws.insert_chart(spec_chart.row, spec_chart.col, chart)


def build_table_xlsx(payload: ExcelExportPayload) -> bytes:
    total = sum(len(s.rows) for s in payload.sheets)
    if total > MAX_TOTAL_ROWS:
        raise ValueError(f"Limite de {MAX_TOTAL_ROWS} linhas excedido")

    buffer = io.BytesIO()
    wb = xlsxwriter.Workbook(buffer, {"in_memory": True, "strings_to_formulas": False})
    head = wb.add_format({"bold": True, "font_color": "#FFFFFF", "bg_color": HEAD_BG, "valign": "vcenter"})
    bold = wb.add_format({"bold": True})
    fmts = {k: wb.add_format({"num_format": v}) for k, v in _NUM_FORMATS.items()}
    text_fmt = wb.add_format({"num_format": "@"})
    used: set = set()
    styled_cache: Dict[str, Dict[str, Any]] = {}

    def styled_fmts(bg: str) -> Dict[str, Any]:
        """Formatos numéricos com cor de fundo; a chave "" é só o fundo."""
        if bg not in styled_cache:
            d = {k: wb.add_format({"num_format": v, "bg_color": bg}) for k, v in _NUM_FORMATS.items()}
            d[""] = wb.add_format({"bg_color": bg})
            styled_cache[bg] = d
        return styled_cache[bg]

    finals = [_sheet_name(s.name, used) for s in payload.sheets]
    final_names = {s.name: f for s, f in zip(payload.sheets, finals)}

    for idx_sheet, spec in enumerate(payload.sheets):
        ws = wb.add_worksheet(finals[idx_sheet])
        if spec.cells or spec.line_charts:
            _write_free_sheet(wb, ws, spec, final_names)
            continue
        headers = list(spec.columns)
        for r in spec.rows:
            headers.extend(k for k in r if k not in headers)

        for i, line in enumerate(spec.preamble):
            for c, v in enumerate(line):
                if i == 0 and c == 0 and isinstance(v, str) and v:
                    ws.write_string(i, c, v, bold)
                else:
                    _write_cell(ws, i, c, v, _free_kind(v), fmts)
        top = len(spec.preamble) + (1 if spec.preamble else 0)
        pie = spec.pie if spec.pie and spec.rows else None
        pie_row = top
        if pie:
            top += PIE_CHART_ROWS

        for c, h in enumerate(headers):
            ws.write_string(top, c, h, head)
        for idx, r in enumerate(spec.rows):
            i = top + 1 + idx
            style = spec.row_styles[idx] if idx < len(spec.row_styles) else ""
            bg = ROW_STYLE_BG.get(style)
            row_fmts = styled_fmts(bg) if bg else fmts
            row_text_fmt = (
                wb.add_format({"num_format": "@", "bg_color": bg}) if bg else text_fmt
            )
            for c, h in enumerate(headers):
                kind = spec.kinds.get(h)
                v = r.get(h)
                if bg and (v is None or v == ""):
                    ws.write_blank(i, c, None, row_fmts[""])
                elif kind == "text":
                    if v is not None and v != "":
                        ws.write_string(i, c, str(v), row_text_fmt)
                else:
                    _write_cell(ws, i, c, v, kind, row_fmts, bg_fmt=row_fmts[""] if bg else None)

        for c, w in enumerate(_widths(headers, spec.rows)):
            ws.set_column(c, c, w)
        last = top + len(spec.rows)
        for j, line in enumerate(spec.footer, start=1):
            for c, v in enumerate(line):
                _write_cell(ws, last + j, c, v, _free_kind(v), fmts)
        if pie and pie.category_column in headers and pie.value_column in headers:
            cat_col, val_col = headers.index(pie.category_column), headers.index(pie.value_column)
            sheet_ref = "'" + ws.get_name().replace("'", "''") + "'"
            points = [
                {"fill": {"color": c if re.fullmatch(r"#[0-9a-fA-F]{6}", c or "") else "#9ca3af"}}
                for c in pie.colors[: len(spec.rows)]
            ]
            chart = wb.add_chart({"type": "pie"})
            chart.add_series({
                "name": pie.title or pie.category_column,
                "categories": [sheet_ref, top + 1, cat_col, last, cat_col],
                "values": [sheet_ref, top + 1, val_col, last, val_col],
                "points": points,
                "data_labels": {
                    "category": True, "percentage": True, "leader_lines": True,
                    "position": "outside_end", "separator": "\n",
                },
            })
            if pie.title:
                chart.set_title({"name": pie.title})
            chart.set_legend({"position": "right"})
            chart.set_size({"width": 760, "height": 500})
            ws.insert_chart(pie_row, 0, chart)
        else:
            pie = None
        if not pie:
            ws.freeze_panes(top + 1, 0)
        if headers:
            ws.autofilter(top, 0, max(last, top + 1), len(headers) - 1)

    for name, reference in payload.names.items():
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,60}", name):
            wb.define_name(name, reference)

    wb.close()
    return buffer.getvalue()
