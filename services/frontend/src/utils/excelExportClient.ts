import axios from 'axios'

/**
 * Cliente do motor único de Excel (backend, XlsxWriter).
 * Os dados já vêm prontos da tela; o backend só formata e devolve o .xlsx.
 */

export type ExcelCell = string | number | boolean | null
export type ExcelRow = Record<string, ExcelCell | undefined>
export type ExcelColumnKind =
  | 'text'
  | 'int'
  | 'month'
  | 'money'
  | 'decimal'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'monthyear'

export type ExcelCellStyle = '' | 'title' | 'section' | 'head' | 'label' | 'input' | 'calc' | 'note'

/** Célula posicionada de planilha livre: valor fixo (`v`) ou fórmula em inglês (`f`; `v` vira o valor em cache). */
export interface ExcelFreeCell {
  r: number
  c: number
  v?: ExcelCell
  f?: string
  kind?: ExcelColumnKind
  style?: ExcelCellStyle
}

export interface ExcelRange {
  sheet: string
  r1: number
  c1: number
  r2: number
  c2: number
}

export interface ExcelLineChart {
  title?: string
  row: number
  col: number
  width?: number
  height?: number
  categories: ExcelRange
  series: { name: string; values: ExcelRange; color: string }[]
  y_kind?: ExcelColumnKind
  x_kind?: ExcelColumnKind
}

export interface ExcelSheetSpec {
  /** Layout livre (fórmulas e gráficos de linha); quando informado, `rows` é ignorado. */
  cells?: ExcelFreeCell[]
  col_widths?: Record<number, number>
  line_charts?: ExcelLineChart[]
  name: string
  rows: ExcelRow[]
  /** Ordem das colunas; se omitido, usa a ordem das chaves das linhas. */
  columns?: string[]
  /** Formato por cabeçalho. `text` grava como texto puro (agência, regex, etc.). */
  kinds?: Record<string, ExcelColumnKind>
  /** Linhas livres acima do cabeçalho (título/resumo). */
  preamble?: ExcelCell[][]
  /** Linhas livres abaixo da tabela (totais). */
  footer?: ExcelCell[][]
  /** Estilo por linha (mesma ordem de `rows`): '', 'daily' ou 'daily_month_end'. */
  row_styles?: string[]
  /** Pizza nativa acima da tabela; `colors` na ordem de `rows` (#RRGGBB). */
  pie?: { title?: string; category_column: string; value_column: string; colors: string[] }
}

export function excelDateStamp(now: Date = new Date()): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/** Gera o .xlsx no backend e baixa. Lança erro se a geração falhar. */
export async function downloadExcel(
  filename: string,
  sheets: ExcelSheetSpec[],
  names: Record<string, string> = {},
): Promise<void> {
  const payload = {
    names,
    sheets: sheets.map((s) => ({
      cells: s.cells ?? [],
      col_widths: s.col_widths ?? {},
      line_charts: s.line_charts ?? [],
      name: s.name,
      rows: s.rows,
      columns: s.columns ?? [],
      kinds: s.kinds ?? {},
      preamble: s.preamble ?? [],
      footer: s.footer ?? [],
      row_styles: s.row_styles ?? [],
      pie: s.pie ?? null,
    })),
  }
  const response = await axios.post<Blob>('/api/reports/export-excel', payload, { responseType: 'blob' })
  saveBlob(response.data, filename)
}

/** Para chamadas "dispare e esqueça" (botões de menu): nunca deixa a promessa rejeitada solta. */
export async function downloadExcelSafe(filename: string, sheets: ExcelSheetSpec[]): Promise<void> {
  try {
    await downloadExcel(filename, sheets)
  } catch (error) {
    console.error('Falha ao gerar Excel', error)
    window.dispatchEvent(
      new CustomEvent('app:error-alert', {
        detail: { title: 'Erro ao exportar', message: 'Não foi possível gerar o arquivo Excel. Tente novamente.' },
      }),
    )
  }
}
