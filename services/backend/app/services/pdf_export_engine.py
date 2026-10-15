"""Motor de export PDF em tabela (ReportLab), análogo ao `excel_export_engine`.

Recebe dados já formatados pela tela (filtros/ordenação decididos lá) e apenas os
desenha: cabeçalho Plumo, tabela com cabeçalho repetido, linha de total e rodapé
"Página X de Y". Layout espelha `frontend/src/utils/pdfTheme.ts` (A4 retrato).
"""

import base64
import io
import re
from typing import List, Literal
from xml.sax.saxutils import escape as xml_escape

from pydantic import BaseModel, Field
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    HRFlowable,
    Image,
    LongTable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

PDF_MEDIA_TYPE = "application/pdf"
MAX_ROWS = 200_000
MAX_CELL_CHARS = 200

BRAND = colors.Color(30 / 255, 58 / 255, 95 / 255)
TEXT = colors.Color(31 / 255, 41 / 255, 55 / 255)
MUTED = colors.Color(100 / 255, 116 / 255, 139 / 255)
BORDER = colors.Color(203 / 255, 213 / 255, 225 / 255)
HEAD_FILL = colors.Color(51 / 255, 65 / 255, 85 / 255)
ZEBRA = colors.Color(248 / 255, 250 / 255, 252 / 255)
FOOT_FILL = colors.Color(226 / 255, 232 / 255, 240 / 255)
POSITIVE = colors.Color(21 / 255, 128 / 255, 61 / 255)
NEGATIVE = colors.Color(185 / 255, 28 / 255, 28 / 255)
# Mesmas cores do Excel/tela (sky = saldo diário; amber = fim do mês).
_ROW_STYLE_BG = {"daily": colors.HexColor("#E0F2FE"), "daily_month_end": colors.HexColor("#FEF3C7")}

MARGIN_X = 14 * mm
TOP = 48 * mm
BOTTOM = 18 * mm
_ALIGN = {"left": TA_LEFT, "right": TA_RIGHT, "center": TA_CENTER}


class PdfColumn(BaseModel):
    header: str = Field(max_length=80)
    # Largura em mm; se omitida, a coluna divide o espaço restante.
    width_mm: float | None = Field(default=None, gt=0, le=180)
    align: Literal["left", "right", "center"] = "left"


Tone = Literal["text", "muted", "brand", "positive", "negative"]
_TONES = {"text": TEXT, "muted": MUTED, "brand": BRAND, "positive": POSITIVE, "negative": NEGATIVE}


class PdfCard(BaseModel):
    label: str = Field(max_length=80)
    value: str = Field(max_length=40)
    note: str = Field(default="", max_length=80)
    tone: Tone = "text"


class PdfLegendEntry(BaseModel):
    name: str = Field(max_length=60)
    color: str = Field(default="#2563eb", max_length=9)
    kind: Literal["bar", "line"] = "bar"


class PdfBlock(BaseModel):
    """Bloco de conteúdo do documento, desenhado na ordem recebida."""

    type: Literal["table", "heading", "text", "cards", "image", "legend", "page_break"]
    # heading / text
    text: str = Field(default="", max_length=400)
    tone: Tone = "text"
    italic: bool = False
    bold: bool = False
    # table
    font_size: float = Field(default=7, ge=5, le=12)
    columns: List[PdfColumn] = Field(default_factory=list, max_length=12)
    rows: List[List[str]] = Field(default_factory=list)
    footer: List[str] = Field(default_factory=list)
    # Cor por célula do corpo (mesmo formato de `rows`); vazio/ausente = padrão.
    tones: List[List[Tone | None]] = Field(default_factory=list)
    footer_tones: List[Tone | None] = Field(default_factory=list)
    bold_columns: List[int] = Field(default_factory=list)
    # Estilo por linha de `rows` (mesma ordem): "", "daily" ou "daily_month_end".
    row_styles: List[str] = Field(default_factory=list)
    # cards / legend / image
    cards: List[PdfCard] = Field(default_factory=list, max_length=6)
    legend: List[PdfLegendEntry] = Field(default_factory=list, max_length=30)
    image_data_url: str = Field(default="", max_length=8_000_000)
    max_height_mm: float = Field(default=80, gt=0, le=200)


class PdfExportPayload(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    subtitle: str = Field(default="", max_length=300)
    generated_at: str = Field(default="", max_length=40)
    # Documento com vários blocos (fechamentos, saldo parcelado, ...).
    blocks: List[PdfBlock] = Field(default_factory=list, max_length=2000)
    # --- Atalho de tabela única (extrato e faturas) ---
    font_size: float = Field(default=7, ge=5, le=12)
    columns: List[PdfColumn] = Field(default_factory=list, max_length=12)
    rows: List[List[str]] = Field(default_factory=list)
    # Linha de total opcional (mesmo número de colunas).
    footer: List[str] = Field(default_factory=list)
    # Coluna cujo texto é pintado por sinal (negativo = vermelho, senão verde).
    signed_column: int | None = None
    # Sinais por linha (-1, 0, 1), alinhados a `rows`, usados com `signed_column`.
    signs: List[int] = Field(default_factory=list)


def _clip(value: str) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= MAX_CELL_CHARS else text[: MAX_CELL_CHARS - 1] + "…"


def _draw_chrome(canvas: Canvas, doc, payload: PdfExportPayload, total_pages: int | None) -> None:
    w, h = A4
    canvas.saveState()
    canvas.setFillColor(BRAND)
    canvas.rect(0, h - 3 * mm, w, 3 * mm, stroke=0, fill=1)
    canvas.setFont("Helvetica-Bold", 18)
    canvas.drawString(MARGIN_X, h - 15 * mm, "PLUMO")
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN_X, h - 20 * mm, "Finanças leves, vida plena")
    if payload.generated_at:
        canvas.drawRightString(w - MARGIN_X, h - 15 * mm, f"Gerado em {payload.generated_at}")
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.3)
    canvas.line(MARGIN_X, h - 24 * mm, w - MARGIN_X, h - 24 * mm)
    canvas.setFillColor(TEXT)
    canvas.setFont("Helvetica-Bold", 14)
    canvas.drawString(MARGIN_X, h - 33 * mm, payload.title)
    if payload.subtitle:
        canvas.setFont("Helvetica", 9)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN_X, h - 39 * mm, payload.subtitle)
    canvas.line(MARGIN_X, 12 * mm, w - MARGIN_X, 12 * mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN_X, 7 * mm, "Plumo · Finanças leves, vida plena")
    page = canvas.getPageNumber()
    label = f"Página {page} de {total_pages}" if total_pages else f"Página {page}"
    canvas.drawRightString(w - MARGIN_X, 7 * mm, label)
    canvas.restoreState()


class _NumberedCanvas(Canvas):
    """Canvas em duas passagens para imprimir 'Página X de Y'."""

    payload: PdfExportPayload

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_pages: list = []

    def showPage(self):
        self._saved_pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved_pages)
        for state in self._saved_pages:
            self.__dict__.update(state)
            _draw_chrome(self, None, self.payload, total)
            super().showPage()
        super().save()


def _column_widths(columns: List[PdfColumn]) -> List[float]:
    usable = A4[0] - 2 * MARGIN_X
    fixed = sum((c.width_mm or 0) * mm for c in columns)
    flexible = [c for c in columns if not c.width_mm]
    share = max((usable - fixed) / len(flexible), 12 * mm) if flexible else 0
    return [(c.width_mm * mm) if c.width_mm else share for c in columns]


def _safe(text: str) -> str:
    """Helvetica padrão só cobre cp1252; troca o que não couber."""
    return " ".join(str(text or "").split()).encode("cp1252", "replace").decode("cp1252")


def _table_flowable(block: PdfBlock):
    n_cols = len(block.columns)
    if not n_cols:
        return None
    # Células de texto simples (sem Paragraph): muito mais rápido em milhares de
    # linhas. O texto é truncado com "…" para caber na largura da coluna, então
    # toda linha tem altura fixa.
    widths = _column_widths(block.columns)
    pad = 3.0
    size = block.font_size
    bold_cols = {c for c in block.bold_columns if 0 <= c < n_cols}

    def fit(text: str, col: int, font: str) -> str:
        clean = _clip(text).encode("cp1252", "replace").decode("cp1252")
        avail = widths[col] - 2 * pad
        if stringWidth(clean, font, size) <= avail:
            return clean
        lo, hi = 0, len(clean)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if stringWidth(clean[:mid] + "…", font, size) <= avail:
                lo = mid
            else:
                hi = mid - 1
        return clean[:lo] + "…"

    data = [[fit(c.header, i, "Helvetica-Bold") for i, c in enumerate(block.columns)]]
    for row in block.rows:
        padded = (list(row) + [""] * n_cols)[:n_cols]
        data.append([
            fit(t, i, "Helvetica-Bold" if i in bold_cols else "Helvetica") for i, t in enumerate(padded)
        ])
    if block.footer:
        foot = (list(block.footer) + [""] * n_cols)[:n_cols]
        data.append([fit(t, i, "Helvetica-Bold") for i, t in enumerate(foot)])

    table = LongTable(data, colWidths=widths, repeatRows=1)
    commands = [
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), size),
        ("TEXTCOLOR", (0, 0), (-1, -1), TEXT),
        ("BACKGROUND", (0, 0), (-1, 0), HEAD_FILL),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), pad),
        ("RIGHTPADDING", (0, 0), (-1, -1), pad),
        ("TOPPADDING", (0, 0), (-1, -1), 1.8 * mm / 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.8 * mm / 2),
    ]
    for i, c in enumerate(block.columns):
        commands.append(("ALIGN", (i, 0), (i, -1), c.align.upper()))
    if block.rows:
        commands.append(("ROWBACKGROUNDS", (0, 1), (-1, len(block.rows)), [colors.white, ZEBRA]))
        for r, style in enumerate(block.row_styles[: len(block.rows)]):
            bg = _ROW_STYLE_BG.get(style)
            if bg is not None:
                commands.append(("BACKGROUND", (0, r + 1), (-1, r + 1), bg))
        for r, tone_row in enumerate(block.tones[: len(block.rows)]):
            for col, tone in enumerate(tone_row[:n_cols]):
                if tone:
                    commands.append(("TEXTCOLOR", (col, r + 1), (col, r + 1), _TONES[tone]))
    if block.footer:
        commands.append(("BACKGROUND", (0, -1), (-1, -1), FOOT_FILL))
        commands.append(("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"))
        for col, tone in enumerate(block.footer_tones[:n_cols]):
            if tone:
                commands.append(("TEXTCOLOR", (col, -1), (col, -1), _TONES[tone]))
    table.setStyle(TableStyle(commands))
    return table


def _legacy_block(payload: PdfExportPayload) -> PdfBlock:
    """Converte o atalho de tabela única (colunas/linhas/sinais) em um bloco."""
    n_cols = len(payload.columns)
    tones: List[List[Tone | None]] = []
    sc = payload.signed_column
    if sc is not None and 0 <= sc < n_cols:
        for r in range(len(payload.rows)):
            sign = payload.signs[r] if r < len(payload.signs) else 0
            row: List[Tone | None] = [None] * n_cols
            row[sc] = "negative" if sign < 0 else "positive"
            tones.append(row)
    return PdfBlock(
        type="table", font_size=payload.font_size, columns=payload.columns,
        rows=payload.rows, footer=payload.footer, tones=tones,
    )


def _text_flowables(block: PdfBlock) -> list:
    style = ParagraphStyle(
        "blk", fontName="Helvetica", fontSize=9, leading=12, textColor=TEXT, spaceAfter=3,
    )
    body = xml_escape(_safe(block.text))
    if block.type == "heading":
        style.fontName, style.fontSize, style.leading = "Helvetica-Bold", 11, 14
        style.textColor, style.spaceBefore, style.keepWithNext = BRAND, 8, 1
        return [Paragraph(body, style), HRFlowable(width="100%", thickness=0.4, color=BRAND, spaceAfter=4)]
    style.textColor = _TONES[block.tone]
    if block.bold:
        style.fontName = "Helvetica-Bold"
    elif block.italic:
        style.fontName = "Helvetica-Oblique"
    if block.tone == "muted":
        style.fontSize, style.leading = 8, 10
    return [Paragraph(body, style)]


def _cards_flowable(block: PdfBlock):
    if not block.cards:
        return None
    gap = 3 * mm
    n = len(block.cards)
    width = (A4[0] - 2 * MARGIN_X - gap * (n - 1)) / n
    cells = []
    for card in block.cards:
        lab = ParagraphStyle("cl", fontName="Helvetica", fontSize=7, leading=9, textColor=MUTED)
        val = ParagraphStyle("cv", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=_TONES[card.tone])
        note = ParagraphStyle("cn", fontName="Helvetica", fontSize=6.5, leading=8, textColor=MUTED)
        cells.append([
            Paragraph(xml_escape(_safe(card.label)), lab),
            Paragraph(xml_escape(_safe(card.value)), val),
            Paragraph(xml_escape(_safe(card.note)), note),
        ])
    cols: list = []
    for i, cell in enumerate(cells):
        cols.append(cell)
        if i < n - 1:
            cols.append("")
    widths = []
    for i in range(len(cols)):
        widths.append(width if i % 2 == 0 else gap)
    table = Table([cols], colWidths=widths)
    style = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 4),
             ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("LEFTPADDING", (0, 0), (-1, -1), 6)]
    for i in range(0, len(cols), 2):
        style += [("BOX", (i, 0), (i, 0), 0.4, BORDER, None, None, 1.5), ("BACKGROUND", (i, 0), (i, 0), ZEBRA)]
    table.setStyle(TableStyle(style))
    return table


def _image_flowable(block: PdfBlock):
    prefix, _, encoded = block.image_data_url.partition(",")
    if not encoded or "base64" not in prefix:
        return Paragraph("Gráfico indisponível.", ParagraphStyle("na", fontName="Helvetica", fontSize=8, textColor=MUTED))
    try:
        raw = base64.b64decode(encoded, validate=False)
        reader = ImageReader(io.BytesIO(raw))
        iw, ih = reader.getSize()
    except Exception:
        return Paragraph("Gráfico indisponível.", ParagraphStyle("na", fontName="Helvetica", fontSize=8, textColor=MUTED))
    max_w = A4[0] - 2 * MARGIN_X
    max_h = block.max_height_mm * mm
    scale = min(max_w / iw, max_h / ih)
    return Image(io.BytesIO(raw), width=iw * scale, height=ih * scale, hAlign="LEFT")


def _legend_flowable(block: PdfBlock):
    parts = []
    for entry in block.legend:
        color = entry.color if re.fullmatch(r"#[0-9a-fA-F]{6}", entry.color or "") else "#2563eb"
        mark = "━" if entry.kind == "line" else "■"
        parts.append(f'<font color="{color}">{mark}</font> {xml_escape(_safe(entry.name))}')
    style = ParagraphStyle("lg", fontName="Helvetica", fontSize=8, leading=11, textColor=TEXT, spaceAfter=4)
    return Paragraph("&nbsp;&nbsp;&nbsp; ".join(parts), style)


def _block_flowables(block: PdfBlock) -> list:
    if block.type == "table":
        table = _table_flowable(block)
        return [table, Spacer(1, 3 * mm)] if table is not None else []
    if block.type in ("heading", "text"):
        return _text_flowables(block)
    if block.type == "cards":
        cards = _cards_flowable(block)
        return [cards, Spacer(1, 4 * mm)] if cards is not None else []
    if block.type == "image":
        return [_image_flowable(block), Spacer(1, 2 * mm)]
    if block.type == "legend":
        return [_legend_flowable(block)] if block.legend else []
    return [PageBreak()]


def build_table_pdf(payload: PdfExportPayload) -> bytes:
    """Gera o PDF: `blocks` quando informado; senão a tabela única legada."""
    blocks = payload.blocks or ([_legacy_block(payload)] if payload.columns else [])
    if sum(len(b.rows) for b in blocks) > MAX_ROWS:
        raise ValueError(f"Limite de {MAX_ROWS} linhas excedido")
    story: list = []
    for block in blocks:
        story.extend(_block_flowables(block))

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=MARGIN_X, rightMargin=MARGIN_X, topMargin=TOP, bottomMargin=BOTTOM,
        title=payload.title, author="Plumo",
    )

    def canvas_maker(*args, **kwargs):
        canvas = _NumberedCanvas(*args, **kwargs)
        canvas.payload = payload
        return canvas

    doc.build(story, canvasmaker=canvas_maker)
    return buffer.getvalue()
