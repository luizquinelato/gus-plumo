import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  open: boolean
  title: string
  onClose: () => void
  onClear?: () => void
  hasActiveFilters?: boolean
  onApply: () => void
  applyDisabled?: boolean
  children: ReactNode
}

export default function MobileFilterSheet({
  open,
  title,
  onClose,
  onClear,
  hasActiveFilters,
  onApply,
  applyDisabled,
  children,
}: Props) {
  if (!open) return null

  return createPortal(
  <>
    <button
      type="button"
      className="fixed inset-0 z-[70] bg-black/50 md:hidden"
      aria-label="Fechar filtros"
      onClick={onClose}
    />
    <div
      className="fixed inset-x-0 bottom-0 z-[71] flex max-h-[min(88vh,640px)] flex-col rounded-t-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 md:hidden"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-filter-sheet-title"
    >
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <h2 id="mobile-filter-sheet-title" className="text-base font-semibold text-gray-900 dark:text-white">
          {title}
        </h2>
        <SheetHeaderActions
          hasActiveFilters={hasActiveFilters}
          onClear={onClear}
          onClose={onClose}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
      <div className="border-t border-gray-200 px-4 pt-3 dark:border-gray-700">
        <button
          type="button"
          disabled={applyDisabled}
          onClick={() => {
            onApply()
            onClose()
          }}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--color-create)', color: 'var(--on-color-create)' }}
        >
          Aplicar filtros
        </button>
      </div>
    </div>
  </>,
  document.body)
}

function SheetHeaderActions({
  hasActiveFilters,
  onClear,
  onClose,
}: {
  hasActiveFilters?: boolean
  onClear?: () => void
  onClose: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      {hasActiveFilters && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="text-sm font-medium"
          style={{ color: 'var(--color-1)' }}
        >
          Limpar
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        aria-label="Fechar"
      >
        <X size={20} />
      </button>
    </div>
  )
}