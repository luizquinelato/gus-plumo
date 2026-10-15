import * as XLSX from 'xlsx'

export const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)

export const EXCEL_FMT_DATE = 'dd/mm/yyyy'
export const EXCEL_FMT_DATETIME = 'dd/mm/yyyy hh:mm:ss'
/** Código de formato Excel (milhar `,` / decimal `.`); o Excel pt-BR exibe como 10.000,00. */
export const EXCEL_FMT_MONEY = '#,##0.00_);(#,##0.00)'
export const EXCEL_FMT_PERCENT = '0.00'

/** Banco guarda 50 (=50%); a célula Excel formatada como % guarda 0,5. */
export function percentToExcel(value: number): number {
  return Math.round(value * 1e4) / 1e6
}

/** Inverso de `percentToExcel`: célula 0,5 (50%) volta a 50. */
export function percentFromExcel(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value * 1e6) / 1e4
}

export function roundExportMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export function jsDateToExcelSerial(date: Date, dateOnly = false): number {
  const y = date.getFullYear()
  const m = date.getMonth()
  const d = date.getDate()
  const hh = dateOnly ? 0 : date.getHours()
  const mi = dateOnly ? 0 : date.getMinutes()
  const ss = dateOnly ? 0 : date.getSeconds()
  return (Date.UTC(y, m, d, hh, mi, ss) - EXCEL_EPOCH_MS) / 86400000
}

export function expenseDateToExcelSerial(dateStr: string, dateOnly = false): number {
  return jsDateToExcelSerial(new Date(dateStr), dateOnly)
}

/** Converte serial Excel (export Plumo) para string BR usada na importação visual. */
export function excelSerialToBrString(serial: number, withTime: boolean): string {
  const ms = Math.round(serial * 86400000) + EXCEL_EPOCH_MS
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  const base = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
  if (!withTime) return base
  return `${base} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

export function applyWorksheetColumnFormats(
  ws: XLSX.WorkSheet,
  dataRowCount: number,
  formatsByHeader: Record<string, string>,
): void {
  if (!ws['!ref'] || dataRowCount <= 0) return
  const range = XLSX.utils.decode_range(ws['!ref'])
  const headerR = range.s.r
  const colByHeader = new Map<string, number>()
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerR, c })
    const header = ws[addr]?.v
    if (header != null) colByHeader.set(String(header), c)
  }
  for (const [header, fmt] of Object.entries(formatsByHeader)) {
    const c = colByHeader.get(header)
    if (c === undefined) continue
    for (let r = headerR + 1; r <= headerR + dataRowCount; r++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr]
      if (!cell || cell.v === '' || cell.v == null) continue
      if (typeof cell.v === 'number') cell.t = 'n'
      cell.z = fmt
      // Evita texto formatado stale (grid errado com barra de fórmula correta).
      delete cell.w
    }
  }
}

export function jsonToFormattedSheet(
  data: Record<string, unknown>[],
  formatsByHeader: Record<string, string>,
): XLSX.WorkSheet {
  const ws = XLSX.utils.json_to_sheet(data)
  applyWorksheetColumnFormats(ws, data.length, formatsByHeader)
  return ws
}
