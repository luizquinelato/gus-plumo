import * as XLSX from 'xlsx'
import { parseLocaleAmount } from './currency'
import { excelSerialToBrString } from './excelCellFormat'

export const FATURA_SHEET_NAMES = ['Faturas de Cartão', 'Faturas de Cartao', 'Faturas']

export interface ParsedFaturaRow {
  row_index: number
  year_month: string
  date: string
  description: string
  amount: number
  card_last4?: string
  card_name?: string
  tag?: string
  subtag?: string
  partner_name?: string
  ownership_percentage?: number
  current_installment?: number
  total_installments?: number
  issuer?: string
  /** Decisão "Manter" nos Ajustes: o registro já existente não é alterado. */
  keep_existing?: boolean
}

export interface ParsedFaturaWorkbook {
  rows: ParsedFaturaRow[]
}

function cellStr(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (value == null) return ''
  return String(value).trim()
}

function cellNum(row: Record<string, unknown>, key: string): number | null {
  return parseLocaleAmount(row[key])
}

function cellDate(row: Record<string, unknown>): string {
  const value = row.Data
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return excelSerialToBrString(value, false)
  }
  return cellStr(row, 'Data')
}

function last4(value: string): string {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : digits
}

function yearMonth(row: Record<string, unknown>, date: string): string {
  const year = cellStr(row, 'Ano')
  const month = cellStr(row, 'Mês')
  if (/^\d{4}$/.test(year) && /^\d{1,2}$/.test(month)) {
    return `${year}-${month.padStart(2, '0')}`
  }
  const match = date.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (match) return `${match[3]}-${match[2]}`
  return ''
}

function installments(description: string): { clean: string; current?: number; total?: number } {
  const match = description.match(/\((\d+)\s*\/\s*(\d+)\)\s*$/)
  if (!match) return { clean: description }
  const current = Number(match[1])
  const total = Number(match[2])
  if (!current || !total || current > total || total === 1) return { clean: description }
  return {
    clean: description.slice(0, match.index).trim(),
    current,
    total,
  }
}

function issuerOf(value: string): string | undefined {
  const text = value.trim().toLowerCase()
  if (!text) return undefined
  if (text.includes('mercado') || text === 'mp' || text === 'mercadopago') return 'mercadopago'
  if (text.includes('btg')) return 'btg'
  return undefined
}

function sheetByNames(wb: XLSX.WorkBook): XLSX.WorkSheet | null {
  for (const name of FATURA_SHEET_NAMES) {
    if (wb.Sheets[name]) return wb.Sheets[name]
  }
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' }) as string[][]
    const header = (rows[0] || []).map((cell) => String(cell).trim().toLowerCase())
    if (header.includes('descrição limpa') && header.includes('titular') && header.includes('valor')) {
      return sheet
    }
  }
  return null
}

export async function parseFaturaExportWorkbook(file: File): Promise<ParsedFaturaWorkbook> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const sheet = sheetByNames(wb)
  if (!sheet) {
    throw new Error('Planilha de faturas não reconhecida. Exporte pelo relatório de Faturas.')
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: ParsedFaturaRow[] = []
  rows.forEach((row, index) => {
    const rawDescription = cellStr(row, 'Descrição')
    const clean = cellStr(row, 'Descrição Limpa')
    const parsedInstallment = installments(rawDescription)
    const description = clean || parsedInstallment.clean
    const amount = cellNum(row, 'Valor')
    const date = cellDate(row)
    if (!description || amount == null || !date) return
    const partner = cellStr(row, 'Conta Parceira')
    const ownership = cellNum(row, 'Parte na sua conta (%)')
    const card = cellStr(row, 'Cartão')
    out.push({
      row_index: index + 2,
      year_month: yearMonth(row, date),
      date,
      description,
      amount: -amount,
      card_last4: last4(card) || undefined,
      card_name: cellStr(row, 'Titular') || undefined,
      tag: cellStr(row, 'Tag') || undefined,
      subtag: cellStr(row, 'Subtag') || undefined,
      partner_name: partner || undefined,
      ownership_percentage: ownership ?? undefined,
      current_installment: parsedInstallment.current,
      total_installments: parsedInstallment.total,
      issuer: issuerOf(cellStr(row, 'Emissor')),
    })
  })
  if (!out.length) throw new Error('Nenhum lançamento de fatura na planilha.')
  return { rows: out }
}
