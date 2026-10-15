"""Motor único de export Excel (XlsxWriter).

Layout mínimo padrão para todas as exportações em tabela: cabeçalho escuro,
painel congelado, autofiltro, larguras automáticas e formatos por tipo de coluna.
Recebe dados já prontos (a tela decide filtros/ordenação) e apenas os formata.
Gráficos não fazem parte do motor genérico; o Saldo Parcelado os monta à parte
reutilizando `HEAD_BG` e `MONEY_FMT`.
"""

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
ColumnKind = Literal["text", "int", "month", "money", "decimal", "percent", "date", "datetime"]

_NUM_FORMATS: Dict[str, str] = {
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


class SheetSpec(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    rows: List[Dict[str, Cell]] = Field(default_factory=list)
    # Ordem das colunas; se vazio, usa a união das chaves na ordem de aparição.
    columns: List[str] = Field(default_factory=list)
    kinds: Dict[str, ColumnKind] = Field(default_factory=dict)
    # Linhas livres acima do cabeçalho (título/resumo) e abaixo da tabela (totais).
    preamble: List[List[Cell]] = Field(default_factory=list)
    footer: List[List[Cell]] = Field(default_factory=list)
    # Estilo por linha de `rows` (mesma ordem): "", "daily" ou "daily_month_end".
    row_styles: List[str] = Field(default_factory=list)


class ExcelExportPayload(BaseModel):
    sheets: List[SheetSpec] = Field(min_length=1, max_length=MAX_SHEETS)


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

    for spec in payload.sheets:
        ws = wb.add_worksheet(_sheet_name(spec.name, used))
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
        ws.freeze_panes(top + 1, 0)
        if headers:
            ws.autofilter(top, 0, max(last, top + 1), len(headers) - 1)

    wb.close()
    return buffer.getvalue()
