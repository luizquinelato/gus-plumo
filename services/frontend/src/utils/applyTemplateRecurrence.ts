import { dateToLocalString, parseLocalDate } from './dateUtils'

export type RecurrenceUnit = 'days' | 'weeks' | 'months' | 'years'

export interface TemplateRecurrenceSettings {
  rounds: number
  interval: number
  unit: RecurrenceUnit
}

export interface TemplateRowForLaunch {
  template_item_id: number
  date: string
  description: string
  amount: string
  subtag_id: number
  ownership_percentage: string
  expense_sharing_id: number | null
  applyRecurrence: boolean
}

export interface ExpandedTemplateLaunch {
  key: string
  templateItemId: number
  occurrenceIndex: number
  date: string
  description: string
  amount: string
  subtag_id: number
  ownership_percentage: string
  expense_sharing_id: number | null
}

function addMonthsClamped(base: Date, months: number): Date {
  const day = base.getDate()
  const target = new Date(base.getFullYear(), base.getMonth() + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(day, lastDay))
  return target
}

/** Avança `steps` unidades a partir da data base (local). */
export function addByRecurrence(base: Date, steps: number, unit: RecurrenceUnit): Date {
  if (steps <= 0) return new Date(base.getFullYear(), base.getMonth(), base.getDate())
  switch (unit) {
    case 'days':
      return new Date(base.getFullYear(), base.getMonth(), base.getDate() + steps)
    case 'weeks':
      return new Date(base.getFullYear(), base.getMonth(), base.getDate() + steps * 7)
    case 'months':
      return addMonthsClamped(base, steps)
    case 'years':
      return addMonthsClamped(base, steps * 12)
    default:
      return new Date(base.getFullYear(), base.getMonth(), base.getDate())
  }
}

function isActiveAmount(amount: string): boolean {
  const num = parseFloat(amount)
  return !isNaN(num) && num !== 0
}

export function buildExpandedTemplateLaunches(
  rows: TemplateRowForLaunch[],
  recurrence: TemplateRecurrenceSettings,
  dateOverrides: Record<string, string> = {},
): ExpandedTemplateLaunch[] {
  const rounds = Math.max(1, Math.floor(recurrence.rounds))
  const interval = Math.max(1, Math.floor(recurrence.interval))
  const launches: ExpandedTemplateLaunch[] = []

  for (const row of rows) {
    if (!isActiveAmount(row.amount)) continue

    const start = parseLocalDate(row.date.length >= 10 ? row.date.slice(0, 10) : row.date)
    if (!start) continue

    const occurrenceCount = row.applyRecurrence ? rounds : 1

    for (let occurrence = 0; occurrence < occurrenceCount; occurrence++) {
      const key = `${row.template_item_id}-${occurrence}`
      const scheduled =
        occurrence === 0
          ? start
          : addByRecurrence(start, interval * occurrence, recurrence.unit)
      const date =
        dateOverrides[key] ??
        dateToLocalString(scheduled)

      launches.push({
        key,
        templateItemId: row.template_item_id,
        occurrenceIndex: occurrence,
        date,
        description: row.description,
        amount: row.amount,
        subtag_id: row.subtag_id,
        ownership_percentage: row.ownership_percentage,
        expense_sharing_id: row.expense_sharing_id,
      })
    }
  }

  return launches
}

export function countExpandedTemplateLaunches(
  rows: TemplateRowForLaunch[],
  recurrence: TemplateRecurrenceSettings,
): number {
  return buildExpandedTemplateLaunches(rows, recurrence).length
}
