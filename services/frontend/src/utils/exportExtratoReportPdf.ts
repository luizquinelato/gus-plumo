import { downloadPdf, type PdfBlock, type PdfColumn } from './pdfExportClient'
import { rowStyles, withDailyBalance, type ExpenseExportData, type FaturaReportExportItem } from './exportToExcel'
import { EXTRATO_DAILY_BALANCE_SOURCE as DAILY_BALANCE_SOURCE } from './extratoDailyBalance'

const downloadTablePdf = downloadPdf

function formatDateBr(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('pt-BR')
}

function formatMoney(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function sourceLabel(source: string): string {
  if (source === 'bank') return 'Extrato'
  if (source === 'benefit') return 'Benefício'
  if (source === 'card') return 'Cartão'
  return source
}

/** PDF do relatório de faturas (cartão de crédito), mesmo padrão visual do extrato. */
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-')
  const name = MONTH_NAMES[Number(m) - 1]
  return name ? `${name} de ${y}` : yearMonth
}

function cardLabel(row: FaturaReportExportItem): string {
  return [row.card_name, row.card_number ? `•••• ${row.card_number.slice(-4)}` : ''].filter(Boolean).join(' ') || 'Cartão'
}

function faturaTableBlock(items: FaturaReportExportItem[], withCardColumn: boolean): PdfBlock {
  const sorted = [...items].sort(
    (a, b) => a.year_month.localeCompare(b.year_month) || new Date(a.date).getTime() - new Date(b.date).getTime(),
  )
  const total = sorted.reduce((sum, row) => sum + row.amount, 0)
  const columns: PdfColumn[] = [
    { header: 'Data', width_mm: 18 },
    ...(withCardColumn ? [{ header: 'Cartão' }, { header: 'Fatura', width_mm: 20 }] : []),
    { header: 'Descrição' },
    { header: 'Parc.', width_mm: 12, align: 'center' },
    { header: 'Tag / Subtag' },
    { header: 'Valor', width_mm: 24, align: 'right' },
  ]
  const rows = sorted.map((row) => [
    formatDateBr(row.date),
    ...(withCardColumn ? [cardLabel(row), row.year_month] : []),
    row.description || '',
    row.total_installments && row.total_installments > 1 ? `${row.current_installment ?? '-'}/${row.total_installments}` : '',
    [row.tag_name, row.subtag_name].filter(Boolean).join(' / '),
    formatMoney(row.amount),
  ])
  const n = columns.length
  return {
    type: 'table',
    font_size: 7,
    columns,
    rows,
    footer: Array.from({ length: n }, (_, i) => (i === 0 ? 'Total' : i === n - 1 ? formatMoney(total) : '')),
    tones: sorted.map((row) => [...Array(n - 1).fill(null), row.amount < 0 ? 'negative' : 'positive']),
    footer_tones: [...Array(n - 1).fill(null), total < 0 ? 'negative' : 'positive'],
  }
}

export interface FaturasPdfOptions {
  /** 'separate' (padrão): ano/mês, uma tabela por cartão, página nova por mês; 'unified': uma tabela só. */
  mode?: 'unified' | 'separate'
}

/** PDF do relatório de faturas (cartão de crédito). */
export async function exportFaturasReportToPdf(
  items: FaturaReportExportItem[],
  subtitle?: string,
  options: FaturasPdfOptions = {},
): Promise<void> {
  if (!items.length) return
  const blocks: PdfBlock[] = []
  if (options.mode === 'unified') {
    blocks.push(faturaTableBlock(items, true))
  } else {
    const months = [...new Set(items.map((i) => i.year_month))].sort()
    months.forEach((ym, idx) => {
      if (idx > 0) blocks.push({ type: 'page_break' })
      blocks.push({ type: 'heading', text: monthLabel(ym) })
      const monthItems = items.filter((i) => i.year_month === ym)
      const cards = [...new Set(monthItems.map(cardLabel))].sort()
      for (const card of cards) {
        blocks.push({ type: 'text', text: card, bold: true })
        blocks.push(faturaTableBlock(monthItems.filter((i) => cardLabel(i) === card), false))
      }
    })
  }
  await downloadTablePdf(`faturas_${pdfDateStamp()}.pdf`, {
    title: 'Relatório de Faturas',
    subtitle: [subtitle, `${items.length} lançamento(s)`].filter(Boolean).join(' · '),
    blocks,
  })
}

function pdfDateStamp(): string {
  const stamp = new Date()
  return `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}`
}

export interface ExtratoPdfOptions {
  /** 'separate' (padrão): extrato primeiro, depois benefícios; 'unified': uma tabela só. */
  mode?: 'unified' | 'separate'
  /** Linhas de saldo diário (já filtradas pelo checkbox do modal). */
  dailyBalanceRows?: ExpenseExportData[]
}

const PDF_COLUMNS: PdfColumn[] = [
  { header: 'Data', width_mm: 20 },
  { header: 'Fonte', width_mm: 18 },
  { header: 'Descrição' },
  { header: 'Valor', width_mm: 24, align: 'right' },
  { header: 'Tag' },
  { header: 'Subtag' },
]

function extratoTableBlock(rows: ExpenseExportData[]): PdfBlock {
  const sorted = [...rows].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  return {
    type: 'table',
    font_size: 7.5,
    columns: PDF_COLUMNS,
    rows: sorted.map((row) => [
      formatDateBr(row.date),
      row.source === DAILY_BALANCE_SOURCE ? 'Saldo diário' : sourceLabel(row.source),
      row.description || '',
      formatMoney(row.amount),
      row.tag_name || '',
      row.subtag_name || '',
    ]),
    tones: sorted.map((row) => [null, null, null, row.amount < 0 ? 'negative' : 'positive', null, null]),
    row_styles: rowStyles(sorted),
  }
}

/** PDF do extrato, gerado no backend (ReportLab). Sempre ordenado por data (mais antigo primeiro). */
export async function exportExtratoReportToPdf(
  expenses: ExpenseExportData[],
  title = 'Extrato de transações',
  options: ExtratoPdfOptions = {},
): Promise<void> {
  if (!expenses.length) return
  const daily = options.dailyBalanceRows ?? []
  const blocks: PdfBlock[] = []
  if (options.mode === 'unified') {
    blocks.push(extratoTableBlock(withDailyBalance(expenses, daily)))
  } else {
    const benefits = expenses.filter((e) => e.source === 'benefit')
    const others = expenses.filter((e) => e.source !== 'benefit')
    if (others.length) {
      if (benefits.length) blocks.push({ type: 'heading', text: 'Extrato' })
      blocks.push(extratoTableBlock(withDailyBalance(others, daily)))
    }
    if (benefits.length) {
      if (others.length) blocks.push({ type: 'page_break' })
      blocks.push({ type: 'heading', text: 'Benefícios' })
      blocks.push(extratoTableBlock(withDailyBalance(benefits, daily)))
    }
  }
  await downloadTablePdf(`extrato_${pdfDateStamp()}.pdf`, {
    title,
    subtitle: `${expenses.length} lançamento(s)`,
    blocks,
  })
}
