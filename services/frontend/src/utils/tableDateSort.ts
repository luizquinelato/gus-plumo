export type DateSortDirection = 'asc' | 'desc'

export function parseSortableDate(value: string | null | undefined): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

export function compareDates(
  left: string | null | undefined,
  right: string | null | undefined,
  direction: DateSortDirection,
): number {
  const diff = parseSortableDate(left) - parseSortableDate(right)
  if (diff === 0) return 0
  return direction === 'asc' ? diff : -diff
}

export function toggleDateSortDirection(direction: DateSortDirection): DateSortDirection {
  return direction === 'asc' ? 'desc' : 'asc'
}

export function sortRowsByDate<T>(
  rows: T[],
  getDate: (row: T) => string | null | undefined,
  direction: DateSortDirection,
  tieBreak?: (left: T, right: T) => number,
): T[] {
  return [...rows].sort((left, right) => {
    const byDate = compareDates(getDate(left), getDate(right), direction)
    if (byDate !== 0) return byDate
    return tieBreak ? tieBreak(left, right) : 0
  })
}
