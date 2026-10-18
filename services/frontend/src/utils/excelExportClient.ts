import axios from 'axios'

/**
 * Cliente do motor único de Excel (backend, XlsxWriter).
 * Os dados já vêm prontos da tela; o backend só formata e devolve o .xlsx.
 */

export type ExcelCell = string | number | boolean | null
export type ExcelRow = Record<string, ExcelCell | undefined>
export type ExcelColumnKind = 'text' | 'int' | 'month' | 'money' | 'decimal' | 'percent' | 'date' | 'datetime'

export interface ExcelSheetSpec {
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
export async function downloadExcel(filename: string, sheets: ExcelSheetSpec[]): Promise<void> {
  const payload = {
    sheets: sheets.map((s) => ({
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
