import { ArrowDown, ArrowUp } from 'lucide-react'
import type { DateSortDirection } from '../utils/tableDateSort'

type SortableDateHeaderProps = {
  sortDirection: DateSortDirection
  onToggle: () => void
  label?: string
  className?: string
  align?: 'left' | 'right' | 'center'
}

export default function SortableDateHeader({
  sortDirection,
  onToggle,
  label = 'Data',
  className = '',
  align = 'left',
}: SortableDateHeaderProps) {
  const alignCls =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  const flexCls =
    align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'

  return (
    <th
      scope="col"
      className={`cursor-pointer select-none transition-colors hover:bg-gray-200/80 dark:hover:bg-gray-700/50 ${alignCls} ${className}`.trim()}
      onClick={onToggle}
      aria-sort={sortDirection === 'asc' ? 'ascending' : 'descending'}
    >
      <span className={`inline-flex items-center gap-1 ${flexCls}`}>
        {label}
        {sortDirection === 'asc' ? (
          <ArrowUp size={14} className="shrink-0 text-[var(--color-1)]" aria-hidden />
        ) : (
          <ArrowDown size={14} className="shrink-0 text-[var(--color-1)]" aria-hidden />
        )}
      </span>
    </th>
  )
}
