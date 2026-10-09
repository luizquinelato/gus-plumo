export const EXTRATO_DAILY_BALANCE_SOURCE = '__daily_balance__'

/** Subconjunto usado pelo extrato; compatível com ExpenseDetail da ExtratoPage. */
export type ExtratoExpenseRow = {
  id: number
  date: string
  description: string
  amount: number
  source: string
  card_number: string | null
  card_name: string | null
  category: string | null
  subtag_id: number | null
  subtag_name: string | null
  tag_name: string | null
  current_installment: number | null
  total_installments: number | null
  adjustment_type: string | null
  ownership_percentage: number | null
  expense_sharing_id: number | null
  shared_partner_id: number | null
  shared_partner_name: string | null
  shared_partner_bank: string | null
  shared_partner_agency: string | null
  shared_partner_account_number: string | null
  account_id: number | null
  account_name: string | null
  bank_code: string | null
  bank_name: string | null
  account_agency: string | null
  account_number: string | null
  year_month: string | null
  migrated_from_account_id: number | null
  /** Última linha de saldo cumulativo daquele mês civil (no conjunto gerado). */
  daily_month_end?: boolean
}

export function isExtratoDailyBalanceRow(expense: Pick<ExtratoExpenseRow, 'source'>): boolean {
  return expense.source === EXTRATO_DAILY_BALANCE_SOURCE
}

/** API pode serializar Decimal como string; normaliza para número finito. */
export function parseExtratoAmount(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return 0
    const parsed = Number.parseFloat(trimmed.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function localDateKeyFromIso(dateStr: string): string | null {
  if (!dateStr) return null
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return null
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function endOfLocalDayIso(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString()
}

/** YYYY-MM-DD do dia civil anterior (timezone local). */
export function previousLocalDayKey(dayKey: string): string | null {
  const parts = dayKey.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null
  const [year, month, day] = parts
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() - 1)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dailyBalanceRowId(dayKey: string): number {
  return -Math.abs(Number(dayKey.replace(/-/g, '')) % 1_000_000_000)
}

function makeDailyBalanceRow(dayKey: string, cumulativeAmount: number): ExtratoExpenseRow {
  const [year, month, day] = dayKey.split('-')
  const labelDate = `${day}/${month}/${year}`

  return {
    id: dailyBalanceRowId(dayKey),
    date: endOfLocalDayIso(dayKey),
    description: `Saldo cumulativo · ${labelDate}`,
    amount: cumulativeAmount,
    source: EXTRATO_DAILY_BALANCE_SOURCE,
    card_number: null,
    card_name: null,
    category: null,
    subtag_id: null,
    subtag_name: null,
    tag_name: null,
    current_installment: null,
    total_installments: null,
    adjustment_type: null,
    ownership_percentage: null,
    expense_sharing_id: null,
    shared_partner_id: null,
    shared_partner_name: null,
    shared_partner_bank: null,
    shared_partner_agency: null,
    shared_partner_account_number: null,
    account_id: null,
    account_name: null,
    bank_code: null,
    bank_name: null,
    account_agency: null,
    account_number: null,
    year_month: dayKey,
    migrated_from_account_id: null,
  }
}

export function buildDailyBalanceRows(
  expenses: ExtratoExpenseRow[],
  openingBeforePeriod = 0,
  periodStartDayKey: string | null = null,
): ExtratoExpenseRow[] {
  const realRows = expenses.filter((row) => !isExtratoDailyBalanceRow(row))
  const netByDay = new Map<string, number>()

  for (const row of realRows) {
    const dayKey = localDateKeyFromIso(row.date)
    if (!dayKey) continue
    // Com filtro de início: abertura já inclui tudo antes do período; ignora lançamentos
    // com data anterior (ex.: compra em junho na fatura de julho).
    if (periodStartDayKey && dayKey < periodStartDayKey) continue
    const amount = parseExtratoAmount(row.amount)
    netByDay.set(dayKey, (netByDay.get(dayKey) ?? 0) + amount)
  }

  const sortedDayKeys = [...netByDay.keys()].sort()
  let closingBalance = parseExtratoAmount(openingBeforePeriod)
  const dailyRows: ExtratoExpenseRow[] = []

  if (periodStartDayKey) {
    const dayBeforePeriod = previousLocalDayKey(periodStartDayKey)
    if (dayBeforePeriod && !netByDay.has(dayBeforePeriod)) {
      dailyRows.push(makeDailyBalanceRow(dayBeforePeriod, closingBalance))
    }
  }

  for (const dayKey of sortedDayKeys) {
    const opening = closingBalance
    const dayNet = parseExtratoAmount(netByDay.get(dayKey) ?? 0)
    closingBalance = parseExtratoAmount(opening + dayNet)
    dailyRows.push(makeDailyBalanceRow(dayKey, closingBalance))
  }

  return applyMonthEndDailyBalanceMarkers(dailyRows)
}

/** Marca a última linha de saldo de cada mês (YYYY-MM) no lote gerado. */
function applyMonthEndDailyBalanceMarkers(rows: ExtratoExpenseRow[]): ExtratoExpenseRow[] {
  const lastDayByMonth = new Map<string, string>()
  for (const row of rows) {
    const dayKey = row.year_month
    if (!dayKey || dayKey.length < 7) continue
    const monthKey = dayKey.slice(0, 7)
    const prev = lastDayByMonth.get(monthKey)
    if (!prev || dayKey > prev) {
      lastDayByMonth.set(monthKey, dayKey)
    }
  }

  return rows.map((row) => {
    const dayKey = row.year_month
    if (!dayKey) return row
    const monthKey = dayKey.slice(0, 7)
    const isMonthEnd = lastDayByMonth.get(monthKey) === dayKey
    const [year, month, day] = dayKey.split('-')
    const labelDate = `${day}/${month}/${year}`
    if (!isMonthEnd) {
      return {
        ...row,
        daily_month_end: false,
        description: `Saldo cumulativo · ${labelDate}`,
      }
    }
    return {
      ...row,
      daily_month_end: true,
      description: `Saldo cumulativo · Final do mês · ${labelDate}`,
    }
  })
}

export function mergeExpensesWithDailyBalance<T extends ExtratoExpenseRow>(
  expenses: T[],
  includeDailyBalance: boolean,
  openingBeforePeriod = 0,
  periodStartDayKey: string | null = null,
  serverDailyRows: T[] | null | undefined = null,
): T[] {
  const base = expenses.filter((row) => !isExtratoDailyBalanceRow(row))
  if (!includeDailyBalance) return base
  if (serverDailyRows && serverDailyRows.length > 0) {
    return [...base, ...serverDailyRows]
  }
  return [
    ...base,
    ...(buildDailyBalanceRows(base, openingBeforePeriod, periodStartDayKey) as T[]),
  ]
}

export function sortExtratoExpenses<T extends ExtratoExpenseRow>(
  rows: T[],
  sortField: string | null,
  sortDirection: 'asc' | 'desc',
): T[] {
  if (!sortField) return rows

  const sorted = [...rows].sort((left, right) => {
    let leftValue: string | number = left[sortField as keyof ExtratoExpenseRow] as string | number
    let rightValue: string | number = right[sortField as keyof ExtratoExpenseRow] as string | number

    if (leftValue === null || leftValue === undefined) return 1
    if (rightValue === null || rightValue === undefined) return -1

    if (sortField === 'date') {
      leftValue = new Date(String(leftValue)).getTime()
      rightValue = new Date(String(rightValue)).getTime()
    } else if (sortField === 'amount') {
      leftValue = parseExtratoAmount(leftValue)
      rightValue = parseExtratoAmount(rightValue)
    } else {
      leftValue = String(leftValue).toLowerCase()
      rightValue = String(rightValue).toLowerCase()
    }

    if (leftValue < rightValue) return sortDirection === 'asc' ? -1 : 1
    if (leftValue > rightValue) return sortDirection === 'asc' ? 1 : -1
    return 0
  })

  return sorted
}

/** Fundo neutro para saldo cumulativo; destaque no fechamento do mês. */
export function dailyBalanceRowClass(row?: Pick<ExtratoExpenseRow, 'daily_month_end'>): string {
  if (row?.daily_month_end) {
    return 'table-row-daily-balance table-row-daily-balance-month-end bg-amber-50/95 dark:bg-amber-950/35 border-l-amber-500 dark:border-l-amber-400'
  }
  return 'table-row-daily-balance bg-sky-50/90 dark:bg-sky-950/35 border-l-sky-500 dark:border-l-sky-400'
}
