/** Larguras alinhadas a `accountFormatter.ts` (agência 5, conta 9). */

export const AGENCY_EXCEL_WIDTH = 5
export const ACCOUNT_NUMBER_EXCEL_WIDTH = 9

function digitsOnly(v: unknown): string {
  if (v === '' || v == null) return ''
  return String(v).replace(/\D/g, '')
}

export function formatAgencyForExcel(agency: number | string | null | undefined): string {
  const digits = digitsOnly(agency)
  if (!digits) return ''
  return digits.padStart(AGENCY_EXCEL_WIDTH, '0')
}

export function formatAccountNumberForExcel(
  accountNumber: number | string | null | undefined,
): string {
  const digits = digitsOnly(accountNumber)
  if (!digits) return ''
  return digits.padStart(ACCOUNT_NUMBER_EXCEL_WIDTH, '0')
}

/** Converte célula Excel (número ou texto "0020") para inteiro do banco. */
export function parseAgencyFromExcel(v: unknown): number | null {
  const digits = digitsOnly(v)
  if (!digits) return null
  const n = parseInt(digits, 10)
  return Number.isFinite(n) ? n : null
}

export function parseAccountNumberFromExcel(v: unknown): number | null {
  const digits = digitsOnly(v)
  if (!digits) return null
  const n = parseInt(digits, 10)
  return Number.isFinite(n) ? n : null
}
