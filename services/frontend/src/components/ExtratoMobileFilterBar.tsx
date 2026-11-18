import { Filter, SlidersHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import MobileFilterSheet from './MobileFilterSheet'
import Badge from './Badge'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeCount: number
  summary?: string
  onApply: () => void
  onClear: () => void
  applyDisabled?: boolean
  children: ReactNode
}

export default function ExtratoMobileFilterBar({
  open,
  onOpenChange,
  activeCount,
  summary,
  onApply,
  onClear,
  applyDisabled,
  children,
}: Props) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <SlidersHorizontal size={18} className="text-[var(--color-1)]" />
          Filtros
          {activeCount > 0 ? (
            <Badge variant="filter" className="bg-[var(--color-1)] text-[var(--on-color-1)]">
              {activeCount}
            </Badge>
          ) : null}
        </button>
        <button
          type="button"
          disabled={applyDisabled}
          onClick={onApply}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--color-create)', color: 'var(--on-color-create)' }}
        >
          <Filter size={16} />
          Aplicar
        </button>
      </div>
      {summary ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">{summary}</p>
      ) : null}
      <MobileFilterSheet
        open={open}
        title="Filtros do extrato"
        onClose={() => onOpenChange(false)}
        onClear={onClear}
        hasActiveFilters={activeCount > 0}
        onApply={onApply}
        applyDisabled={applyDisabled}
      >
        <div className="space-y-4">{children}</div>
      </MobileFilterSheet>
    </>
  )
}