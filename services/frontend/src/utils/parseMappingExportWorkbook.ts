import * as XLSX from 'xlsx'
import { percentFromExcel } from './excelCellFormat'

const SHEET_NAMES = ['Mapeamentos']

export interface ParsedMappingImportRow {
  row_index: number
  mapping_id: number | null
  match: string
  criterion: string
  priority: string | number | null
  mapped_description: string
  subtag_type: string
  tag_name: string
  subtag_name: string
  partner_name: string
  contribution_pct: number | null
  is_sensitive: string
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
  const v = row[key]
  if (v == null || v === '') return null
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  const n = Number(String(v).replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

function cellId(row: Record<string, unknown>): number | null {
  const v = row.ID
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  return Number.isNaN(n) ? null : n
}

export async function parseMappingExportWorkbook(file: File): Promise<ParsedMappingImportRow[]> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })

  let sheet = sheetByNames(wb, SHEET_NAMES)
  if (!sheet && wb.SheetNames.length > 0) {
    const first = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<string[]>(first, { header: 1, defval: '' }) as string[][]
    const header = (rows[0] || []).map((c) => String(c).trim())
    if (header.includes('Match') && header.includes('Subtag')) {
      sheet = first
    }
  }

  if (!sheet) {
    throw new Error('Planilha "Mapeamentos" não encontrada. Use o arquivo exportado nesta tela.')
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: ParsedMappingImportRow[] = []

  rows.forEach((row, idx) => {
    const match = cellStr(row, 'Match')
    const subtag = cellStr(row, 'Subtag')
    if (!match && !subtag) return

    out.push({
      row_index: idx + 2,
      mapping_id: cellId(row),
      match,
      criterion: cellStr(row, 'Critério'),
      priority: row.Prioridade as string | number | null,
      mapped_description: cellStr(row, 'Descrição mapeada'),
      subtag_type: cellStr(row, 'Tipo'),
      tag_name: cellStr(row, 'Tag'),
      subtag_name: subtag,
      partner_name: cellStr(row, 'Conta parceira'),
      contribution_pct: percentFromExcel(cellNum(row, 'Contribuição (%)')),
      is_sensitive: cellStr(row, 'Sensível'),
    })
  })

  if (!out.length) {
    throw new Error('Nenhuma linha de mapeamento encontrada na planilha.')
  }

  return out
}
