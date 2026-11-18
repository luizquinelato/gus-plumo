import { useCallback, useMemo, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEscapeKey } from '../hooks/useEscapeKey'

const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const

function monthYearHeadline(yearMonth: string): { title: string; year: string } {
  if (yearMonth === 'Sem mês') return { title: yearMonth, year: '' }
  const [y, m] = yearMonth.split('-')
  const mi = parseInt(m, 10) - 1
  if (!y || mi < 0 || mi > 11) return { title: yearMonth, year: '' }
  return { title: MONTH_NAMES[mi], year: y }
}

type Props = {
  /** Meses com dados, do mais recente ao mais antigo */
  availableMonths: string[]
  activeMonth: string
  onMonthChange: (yearMonth: string) => void
}

export default function InvoicePeriodNavigator({
  availableMonths,
  activeMonth,
  onMonthChange,
}: Props) {
  const [picker, setPicker] = useState<{ year: number; view: 'month' | 'year' } | null>(null)
  const closePicker = useCallback(() => setPicker(null), [])
  useEscapeKey(closePicker, picker != null)

  const activeIndex = useMemo(
    () => availableMonths.findIndex((m) => m === activeMonth),
    [availableMonths, activeMonth],
  )

  const availableSet = useMemo(() => new Set(availableMonths), [availableMonths])

  const yearsInData = useMemo(() => {
    const years = new Set<number>()
    for (const ym of availableMonths) {
      if (ym === 'Sem mês') continue
      const y = parseInt(ym.split('-')[0], 10)
      if (!Number.isNaN(y)) years.add(y)
    }
    return [...years].sort((a, b) => b - a)
  }, [availableMonths])

  const goOlder = () => {
    if (activeIndex < 0 || activeIndex >= availableMonths.length - 1) return
    onMonthChange(availableMonths[activeIndex + 1])
  }

  const goNewer = () => {
    if (activeIndex <= 0) return
    onMonthChange(availableMonths[activeIndex - 1])
  }

  const pickMonth = (year: number, monthNum: number) => {
    const ym = `${year}-${String(monthNum).padStart(2, '0')}`
    if (!availableSet.has(ym)) return
    onMonthChange(ym)
    setPicker(null)
  }

  const activeYear = activeMonth ? parseInt(activeMonth.split('-')[0], 10) : new Date().getFullYear()
  const activeMonthNum = activeMonth ? parseInt(activeMonth.split('-')[1], 10) : 1

  if (availableMonths.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum período com lançamentos no filtro atual.</p>
    )
  }

  const headline = activeMonth ? monthYearHeadline(activeMonth) : null

  return (
    <>
      <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          <Calendar size={14} style={{ color: 'var(--color-1)' }} />
          Período da fatura
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={goOlder}
            disabled={activeIndex < 0 || activeIndex >= availableMonths.length - 1}
            className="rounded-lg border border-gray-300 p-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const y = activeMonth ? parseInt(activeMonth.split('-')[0], 10) : yearsInData[0] ?? new Date().getFullYear()
              setPicker({ year: y, view: 'month' })
            }}
            title="Escolher mês e ano"
            className="flex min-w-0 flex-1 items-center justify-center rounded-lg px-2 py-1.5 text-center hover:bg-gray-100 dark:hover:bg-gray-700/60"
          >
            {headline ? (
              <span className="flex flex-col items-center gap-0.5 leading-tight">
                <span className="text-base font-semibold text-gray-900 dark:text-white sm:text-lg">{headline.title}</span>
                {headline.year ? (
                  <span className="text-sm font-semibold tabular-nums text-[var(--color-1)] dark:text-[var(--color-2)]">
                    {headline.year}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="text-base font-semibold text-gray-500 dark:text-gray-400">Selecione…</span>
            )}
          </button>
          <button
            type="button"
            onClick={goNewer}
            disabled={activeIndex <= 0}
            className="rounded-lg border border-gray-300 p-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600"
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {availableMonths[0] ? (
            <button
              type="button"
              onClick={() => onMonthChange(availableMonths[0])}
              disabled={activeMonth === availableMonths[0]}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[var(--color-1)] hover:text-[var(--color-1)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200"
            >
              Mais recente
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
          {availableMonths.length} {availableMonths.length === 1 ? 'mês' : 'meses'} com lançamentos neste filtro
        </p>
      </div>

      {picker ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(e) => e.target === e.currentTarget && closePicker()}
        >
          <div className="w-full max-w-xs rounded-xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label="Anterior"
                onClick={() =>
                  setPicker({ ...picker, year: picker.year - (picker.view === 'year' ? 12 : 1) })
                }
                className="rounded-lg border border-gray-300 p-1.5 dark:border-gray-600"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPicker({ ...picker, view: picker.view === 'month' ? 'year' : 'month' })}
                className="rounded-lg px-2 py-1 text-sm font-semibold text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700"
              >
                {picker.view === 'month' ? picker.year : 'Ano'}
              </button>
              <button
                type="button"
                aria-label="Próximo"
                onClick={() =>
                  setPicker({ ...picker, year: picker.year + (picker.view === 'year' ? 12 : 1) })
                }
                className="rounded-lg border border-gray-300 p-1.5 dark:border-gray-600"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {picker.view === 'month'
                ? MONTH_NAMES.map((name, i) => {
                    const ym = `${picker.year}-${String(i + 1).padStart(2, '0')}`
                    const hasData = availableSet.has(ym)
                    const selected = activeYear === picker.year && activeMonthNum === i + 1
                    return (
                      <button
                        key={name}
                        type="button"
                        disabled={!hasData}
                        onClick={() => pickMonth(picker.year, i + 1)}
                        className={`rounded-lg px-2 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-35 ${
                          selected
                            ? 'bg-[var(--color-1)] text-[var(--on-color-1)]'
                            : hasData
                              ? 'text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700'
                              : 'text-gray-400 dark:text-gray-600'
                        }`}
                      >
                        {name.slice(0, 3)}
                      </button>
                    )
                  })
                : yearsInData.map((y) => (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setPicker({ year: y, view: 'month' })}
                      className={`rounded-lg px-2 py-2 text-sm ${
                        y === activeYear
                          ? 'bg-[var(--color-1)] text-[var(--on-color-1)]'
                          : 'text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {y}
                    </button>
                  ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}