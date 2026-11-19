/** Intervalos de visualização do calendário na projeção mensal (estilo Google Calendar). */

export type CalendarViewMode = 'day' | 'week' | 'half' | 'month'

export const CALENDAR_VIEW_LABELS: Record<CalendarViewMode, string> = {
  day: 'Dia',
  week: 'Semana',
  half: 'Quinzena',
  month: 'Mês',
}

export function daysInMonth(yearMonth: string): number {
  const [y, m] = yearMonth.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

export function clampDay(yearMonth: string, day: number): number {
  return Math.max(1, Math.min(day, daysInMonth(yearMonth)))
}

export function parseYm(yearMonth: string): { year: number; month: number } {
  const [y, m] = yearMonth.split('-').map(Number)
  return { year: y, month: m }
}

export function halfIndexForDay(day: number): 0 | 1 {
  return day >= 15 ? 1 : 0
}

export function visibleDaysForMode(
  mode: CalendarViewMode,
  yearMonth: string,
  anchorDay: number,
): number[] {
  const { year, month } = parseYm(yearMonth)
  const last = daysInMonth(yearMonth)
  const d = clampDay(yearMonth, anchorDay)

  if (mode === 'day') return [d]

  if (mode === 'half') {
    return halfIndexForDay(d) === 0
      ? Array.from({ length: Math.min(14, last) }, (_, i) => i + 1)
      : Array.from({ length: last - 14 }, (_, i) => i + 15)
  }

  if (mode === 'week') {
    const anchor = new Date(year, month - 1, d)
    const dow = anchor.getDay()
    let start = d - dow
    if (start < 1) start = 1
    let end = start + 6
    if (end > last) end = last
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  }

  return Array.from({ length: last }, (_, i) => i + 1)
}

/** Grade 7 colunas: nulls de padding + dias visíveis (modos que não são mês inteiro). */
export function calendarCellsForMode(
  mode: CalendarViewMode,
  yearMonth: string,
  anchorDay: number,
): (number | null)[] {
  const days = visibleDaysForMode(mode, yearMonth, anchorDay)
  if (mode === 'day') {
    return [days[0]]
  }
  if (mode === 'month') {
    const { year, month } = parseYm(yearMonth)
    const offset = new Date(year, month - 1, 1).getDay()
    const all = [...Array(offset).fill(null), ...days] as (number | null)[]
    return all
  }
  const { year, month } = parseYm(yearMonth)
  const offset = new Date(year, month - 1, days[0]).getDay()
  return [...Array(offset).fill(null), ...days] as (number | null)[]
}

function shiftMonthYm(ym: string, n: number): string {
  const { year, month } = parseYm(ym)
  const date = new Date(year, month - 1 + n, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function addCalendarDays(yearMonth: string, day: number, deltaDays: number): {
  yearMonth: string
  anchorDay: number
} {
  const { year, month } = parseYm(yearMonth)
  const dt = new Date(year, month - 1, day + deltaDays)
  return {
    yearMonth: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`,
    anchorDay: dt.getDate(),
  }
}

export function shiftAnchor(
  mode: CalendarViewMode,
  yearMonth: string,
  anchorDay: number,
  delta: -1 | 1,
): { yearMonth: string; anchorDay: number } {
  const d = clampDay(yearMonth, anchorDay)

  if (mode === 'day') return addCalendarDays(yearMonth, d, delta)

  if (mode === 'week') return addCalendarDays(yearMonth, d, delta * 7)

  if (mode === 'half') {
    const hi = halfIndexForDay(d)
    if (delta === -1) {
      if (hi === 1) return { yearMonth, anchorDay: 14 }
      const prevYm = shiftMonthYm(yearMonth, -1)
      return { yearMonth: prevYm, anchorDay: daysInMonth(prevYm) }
    }
    if (hi === 0) return { yearMonth, anchorDay: 15 }
    const nextYm = shiftMonthYm(yearMonth, 1)
    return { yearMonth: nextYm, anchorDay: 1 }
  }

  const nextYm = shiftMonthYm(yearMonth, delta)
  return { yearMonth: nextYm, anchorDay: clampDay(nextYm, d) }
}

/** Avança dia / semana / quinzena só dentro do `yearMonth` atual (sem mudar de mês). */
export function canShiftAnchorInMonth(
  mode: Exclude<CalendarViewMode, 'month'>,
  yearMonth: string,
  anchorDay: number,
  delta: -1 | 1,
): boolean {
  const last = daysInMonth(yearMonth)
  const d = clampDay(yearMonth, anchorDay)

  if (mode === 'day') {
    const next = d + delta
    return next >= 1 && next <= last
  }

  if (mode === 'half') {
    const hi = halfIndexForDay(d)
    if (delta === -1) return hi === 1
    return hi === 0
  }

  const week = visibleDaysForMode('week', yearMonth, d)
  const start = week[0]
  const nextStart = start + delta * 7
  return nextStart >= 1 && nextStart <= last
}

export function shiftAnchorInMonth(
  mode: Exclude<CalendarViewMode, 'month'>,
  yearMonth: string,
  anchorDay: number,
  delta: -1 | 1,
): { yearMonth: string; anchorDay: number } {
  const d = clampDay(yearMonth, anchorDay)
  if (!canShiftAnchorInMonth(mode, yearMonth, d, delta)) {
    return { yearMonth, anchorDay: d }
  }

  if (mode === 'day') {
    return { yearMonth, anchorDay: d + delta }
  }

  if (mode === 'half') {
    return { yearMonth, anchorDay: halfIndexForDay(d) === 1 ? 14 : 15 }
  }

  const week = visibleDaysForMode('week', yearMonth, d)
  const start = week[0] + delta * 7
  return { yearMonth, anchorDay: clampDay(yearMonth, start) }
}

/** Título curto do período (sem repetir mês — usado na 2ª barra de navegação). */
export function periodNavTitle(
  mode: Exclude<CalendarViewMode, 'month'>,
  yearMonth: string,
  anchorDay: number,
): string {
  const d = clampDay(yearMonth, anchorDay)

  if (mode === 'day') {
    return `Dia ${d}`
  }

  if (mode === 'half') {
    return halfIndexForDay(d) === 0 ? '1ª quinzena' : '2ª quinzena'
  }

  const days = visibleDaysForMode('week', yearMonth, d)
  const a = days[0]
  const b = days[days.length - 1]
  if (a === b) return `Dia ${a}`
  return `Dias ${a} a ${b}`
}

export function rangeTitle(
  mode: CalendarViewMode,
  yearMonth: string,
  anchorDay: number,
  monthNames: readonly string[],
): string {
  const { year, month } = parseYm(yearMonth)
  const d = clampDay(yearMonth, anchorDay)
  const monthLabel = `${monthNames[month - 1]} ${year}`

  if (mode === 'month') return monthLabel

  if (mode === 'day') {
    return `${String(d).padStart(2, '0')} ${monthNames[month - 1]} ${year}`
  }

  if (mode === 'half') {
    return halfIndexForDay(d) === 0
      ? `1ª quinzena — ${monthLabel}`
      : `2ª quinzena — ${monthLabel}`
  }

  const days = visibleDaysForMode('week', yearMonth, d)
  const a = days[0]
  const b = days[days.length - 1]
  if (a === b) return `${String(a).padStart(2, '0')} ${monthNames[month - 1]} ${year}`
  return `${String(a).padStart(2, '0')}–${String(b).padStart(2, '0')} ${monthNames[month - 1]} ${year}`
}

export type PeriodTotals = {
  title: string
  income: number
  fixed: number
  variable: number
  total: number
  result: number
  days: number
}

export function periodTotals(
  mode: CalendarViewMode,
  yearMonth: string,
  anchorDay: number,
  income: { expected_date: string; amount: string }[],
  expenses: { expected_date: string; amount: string; kind: string }[],
): PeriodTotals {
  const visible = new Set(visibleDaysForMode(mode, yearMonth, anchorDay))
  const ymPrefix = `${yearMonth}-`
  const inRange = (date: string) => date.startsWith(ymPrefix) && visible.has(Number(date.slice(8, 10)))

  const inc = income.filter((i) => inRange(i.expected_date)).reduce((s, i) => s + Number(i.amount), 0)
  const ex = expenses.filter((e) => inRange(e.expected_date))
  const fixed = ex.filter((e) => e.kind === 'fixed').reduce((s, e) => s + Number(e.amount), 0)
  const variable = ex.filter((e) => e.kind === 'variable').reduce((s, e) => s + Number(e.amount), 0)
  const total = fixed + variable

  const title =
    mode === 'month'
      ? 'Mês inteiro'
      : mode === 'half'
        ? halfIndexForDay(anchorDay) === 0
          ? 'Dias 1 a 14'
          : 'Dia 15 ao fim'
        : mode === 'week'
          ? 'Esta semana'
          : 'Este dia'

  return {
    title,
    income: inc,
    fixed,
    variable,
    total,
    result: inc - total,
    days: visible.size,
  }
}

export function dailyChartPoints(
  yearMonth: string,
  days: number[],
  income: { expected_date: string; amount: string }[],
  expenses: { expected_date: string; amount: string }[],
): { label: string; Entradas: number; Gastos: number; Resultado: number }[] {
  return days.map((day) => {
    const dateKey = `${yearMonth}-${String(day).padStart(2, '0')}`
    const inc = income
      .filter((i) => i.expected_date === dateKey)
      .reduce((s, i) => s + Number(i.amount), 0)
    const gast = expenses
      .filter((e) => e.expected_date === dateKey)
      .reduce((s, e) => s + Number(e.amount), 0)
    return {
      label: String(day),
      Entradas: inc,
      Gastos: gast,
      Resultado: Math.round((inc - gast) * 100) / 100,
    }
  })
}