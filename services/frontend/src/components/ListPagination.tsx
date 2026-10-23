import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { listPageTableChromeFooterCls } from './CadastroListPageLayout'

const selectCls =
  'w-auto cursor-pointer rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700 outline-none focus:border-[var(--color-1)] dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200'

export const LIST_PAGINATION_OPTIONS = [50, 100, 200, 0]

const arrowBtnCls =
  'rounded-md p-1.5 text-gray-600 transition-colors hover:bg-gray-200/80 disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-gray-700'

const strongCls = 'font-semibold text-gray-800 dark:text-gray-100'

interface ListPaginationProps {
  /** Total de itens (já filtrados). */
  total: number
  /** Página atual (1-based). */
  page: number
  /** Itens por página; 0 = todos. */
  perPage: number
  onPageChange: (page: number) => void
  onPerPageChange: (perPage: number) => void
  /** Opções do seletor "Por página" (0 = Todos). */
  options?: number[]
}

/**
 * Rodapé padrão de tabelas paginadas (mesmo layout do Vigra):
 * "Por página" | "Mostrando início–fim de total" | setas + números de página.
 * Use como `footer` do ListPageTable, ou dentro de `<tfoot><tr><td colSpan={n} className="p-0">`.
 */
export default function ListPagination({
  total,
  page,
  perPage,
  onPageChange,
  onPerPageChange,
  options = LIST_PAGINATION_OPTIONS,
}: ListPaginationProps) {
  const isAll = perPage === 0
  const totalPages = isAll ? 1 : Math.max(1, Math.ceil(total / perPage))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = total === 0 ? 0 : isAll ? 1 : (safePage - 1) * perPage + 1
  const end = isAll ? total : Math.min(total, safePage * perPage)

  const pages = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const set = new Set<number>([1, totalPages, safePage, safePage - 1, safePage + 1])
    const list = Array.from(set)
      .filter((p) => p >= 1 && p <= totalPages)
      .sort((a, b) => a - b)
    const withGaps: Array<number | 'gap'> = []
    list.forEach((p, i) => {
      if (i > 0 && p - list[i - 1] > 1) withGaps.push('gap')
      withGaps.push(p)
    })
    return withGaps
  }, [totalPages, safePage])

  return (
    <div
      className={`${listPageTableChromeFooterCls} grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-4`}
    >
      <div className="flex min-w-0 items-center gap-2 justify-self-start text-sm text-gray-600 dark:text-gray-400">
        <label className="shrink-0 whitespace-nowrap">Por página:</label>
        <select
          value={perPage}
          onChange={(e) => {
            onPerPageChange(Number(e.target.value))
            onPageChange(1)
          }}
          className={selectCls}
          aria-label="Itens por página"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option === 0 ? 'Todos' : option}
            </option>
          ))}
        </select>
      </div>

      <span className="justify-self-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
        {total === 0 ? (
          'Nenhum item'
        ) : (
          <>
            Mostrando{' '}
            <strong className={strongCls}>
              {start}–{end}
            </strong>{' '}
            de <strong className={strongCls}>{total}</strong>
          </>
        )}
      </span>

      <div className="flex min-h-[28px] items-center justify-end justify-self-end">
        {!isAll && totalPages > 1 ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onPageChange(safePage - 1)}
              disabled={safePage === 1}
              className={arrowBtnCls}
              title="Página anterior"
            >
              <ChevronLeft size={14} />
            </button>
            {pages.map((p, i) =>
              p === 'gap' ? (
                <span key={`gap-${i}`} className="select-none px-1 text-sm text-gray-400">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPageChange(p)}
                  className={`min-w-[28px] rounded-md px-2 py-1 text-sm font-medium transition-colors ${
                    p === safePage
                      ? ''
                      : 'text-gray-600 hover:bg-gray-200/80 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                  style={p === safePage ? { background: 'var(--color-1)', color: 'var(--on-color-1, #fff)' } : undefined}
                >
                  {p}
                </button>
              ),
            )}
            <button
              type="button"
              onClick={() => onPageChange(safePage + 1)}
              disabled={safePage === totalPages}
              className={arrowBtnCls}
              title="Próxima página"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
