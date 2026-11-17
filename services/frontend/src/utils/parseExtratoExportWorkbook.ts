import * as XLSX from 'xlsx'
import { parseLocaleAmount } from './currency'
import { excelSerialToBrString, percentFromExcel } from './excelCellFormat'

const BANK_SHEET_NAMES = ['Extratos Bancários', 'Extratos Bancarios', 'Extratos']
const BENEFIT_SHEET_NAMES = ['Benefícios', 'Beneficios']
const FATURA_SHEET_NAMES = ['Faturas de Cartão', 'Faturas de Cartao', 'Faturas']

const BANK_REQUIRED = ['Data e hora', 'Descrição', 'Valor']
const BENEFIT_REQUIRED = ['Data', 'Movimentação', 'Valor']

export interface ParsedImportRow {
  row_index: number
  date: string
  description: string
  amount: number
  tag?: string
  subtag?: string
  partner_name?: string
  ownership_percentage?: number
  category?: string
  transaction?: string
  card_last4?: string
  payment_method?: string
  /** Decisão "Manter" nos Ajustes: o registro já existente não é alterado. */
  keep_existing?: boolean
}

export interface ParsedExtratoWorkbook {
  bank_rows: ParsedImportRow[]
  benefit_rows: ParsedImportRow[]
  skipped_sheets: string[]
}

function sheetByNames(wb: XLSX.WorkBook, names: string[]): XLSX.WorkSheet | null {
  for (const name of names) {
    if (wb.Sheets[name]) return wb.Sheets[name]
  }
  return null
}

function cellStr(row: Record<string, unknown>, key: string): string {
  const v = row[key]
  if (v == null) return ''
  return String(v).trim()
}

function cellNum(row: Record<string, unknown>, key: string): number | null {
  return parseLocaleAmount(row[key])
}

function cellDateTime(row: Record<string, unknown>, key: string): string {
  const v = row[key]
  if (typeof v === 'number' && !Number.isNaN(v)) {
    return excelSerialToBrString(v, true)
  }
  return cellStr(row, key)
}

function parseBankSheet(sheet: XLSX.WorkSheet): ParsedImportRow[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: ParsedImportRow[] = []
  rows.forEach((row, idx) => {
    const description = cellStr(row, 'Descrição')
    const amount = cellNum(row, 'Valor')
    const date = cellDateTime(row, 'Data e hora')
    if (!description || amount == null || !date) return
    const partner = cellStr(row, 'Conta Parceira')
    const ownership = percentFromExcel(cellNum(row, 'Parte na sua conta (%)'))
    out.push({
      row_index: idx + 2,
      date,
      description,
      amount,
      tag: cellStr(row, 'Tag') || undefined,
      subtag: cellStr(row, 'Subtag') || undefined,
      partner_name: partner || undefined,
      ownership_percentage: ownership ?? undefined,
      category: cellStr(row, 'Categoria') || undefined,
      transaction: cellStr(row, 'Transação') || undefined,
    })
  })
  return out
}

function parseBenefitSheet(sheet: XLSX.WorkSheet): ParsedImportRow[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: ParsedImportRow[] = []
  rows.forEach((row, idx) => {
    const description = cellStr(row, 'Movimentação')
    const amount = cellNum(row, 'Valor')
    const date = cellDateTime(row, 'Data')
    if (!description || amount == null || !date) return
    const partner = cellStr(row, 'Conta Parceira')
    const ownership = percentFromExcel(cellNum(row, 'Parte na sua conta (%)'))
    out.push({
      row_index: idx + 2,
      date,
      description,
      amount,
      tag: cellStr(row, 'Tag') || undefined,
      subtag: cellStr(row, 'Subtag') || undefined,
      partner_name: partner || undefined,
      ownership_percentage: ownership ?? undefined,
      card_last4: cellStr(row, 'Cartão') || undefined,
      payment_method: cellStr(row, 'Meio de Pagamento') || undefined,
    })
  })
  return out
}

function headersMatch(sheet: XLSX.WorkSheet, required: string[]): boolean {
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' }) as string[][]
  const header = (rows[0] || []).map((c) => String(c).trim())
  return required.every((col) => header.includes(col))
}

export async function parseExtratoExportWorkbook(file: File): Promise<ParsedExtratoWorkbook> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })

  let bankSheet = sheetByNames(wb, BANK_SHEET_NAMES)
  let benefitSheet = sheetByNames(wb, BENEFIT_SHEET_NAMES)

  if (!bankSheet && wb.SheetNames[0] && headersMatch(wb.Sheets[wb.SheetNames[0]], BANK_REQUIRED)) {
    bankSheet = wb.Sheets[wb.SheetNames[0]]
  }
  if (!benefitSheet) {
    for (const name of wb.SheetNames) {
      if (BENEFIT_SHEET_NAMES.includes(name) || FATURA_SHEET_NAMES.includes(name) || BANK_SHEET_NAMES.includes(name)) continue
      const sh = wb.Sheets[name]
      if (headersMatch(sh, BENEFIT_REQUIRED)) {
        benefitSheet = sh
        break
      }
    }
  }

  const bank_rows = bankSheet ? parseBankSheet(bankSheet) : []
  const benefit_rows = benefitSheet ? parseBenefitSheet(benefitSheet) : []

  if (!bank_rows.length && !benefit_rows.length) {
    throw new Error(
      'Planilha não reconhecida. Use o Excel gerado por Exportar Excel nesta tela (abas Extratos Bancários e/ou Benefícios).',
    )
  }

  const sheetName = (sheet: XLSX.WorkSheet | null) =>
    sheet ? wb.SheetNames.find((n) => wb.Sheets[n] === sheet) ?? null : null
  const bankSheetName = sheetName(bankSheet)
  const benefitSheetName = sheetName(benefitSheet)

  const skipped_sheets = wb.SheetNames.filter(
    (n) =>
      n !== bankSheetName &&
      n !== benefitSheetName &&
      !BANK_SHEET_NAMES.includes(n) &&
      !BENEFIT_SHEET_NAMES.includes(n),
  )

  return { bank_rows, benefit_rows, skipped_sheets }
}
