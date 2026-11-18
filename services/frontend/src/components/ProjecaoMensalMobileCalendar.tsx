import { ChevronsRight } from 'lucide-react'

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const

type IncomeRow = {
  id: number
  description: string
  amount: string
  editable: boolean
}

type ExpenseRow = {
  id: number
  description: string
  amount: string
  kind: 'fixed' | 'variable'
}

type Props = {
  yearMonth: string
  byDay: Map<number, ExpenseRow[]>
  incomeByDay: Map<number, IncomeRow[]>
  formatCurrency: (n: number) => string
  debit: (n: number) => string
  debitCls: string
  creditCls: string
  valueOf: (e: ExpenseRow) => number
  onIncome: (inc: IncomeRow) => void
  onExpense: (e: ExpenseRow) => void
}

export default function ProjecaoMensalMobileCalendar({
  yearMonth,
  byDay,
  incomeByDay,
  formatCurrency,
  debit,
  debitCls,
  creditCls,
  valueOf,
  onIncome,
  onExpense,
}: Props) {
  const [y, m] = yearMonth.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()

  return (
    <div className="space-y-2">
      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
        const incomes = incomeByDay.get(day) ?? []
        const expenses = byDay.get(day) ?? []
        const expenseTotal = expenses.reduce((s, e) => s + valueOf(e), 0)
        const hasItems = incomes.length > 0 || expenses.length > 0
        const weekday = WEEKDAYS[new Date(y, m - 1, day).getDay()]

        return (
          <section
            key={day}
            className={`overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 ${
              day === 15 ? 'ring-2 ring-[var(--color-1)]/35' : ''
            }`}
          >
            {day === 15 ? (
              <div className="flex items-center gap-2 border-b border-[var(--color-1)]/30 bg-[color-mix(in_srgb,var(--color-1)_10%,transparent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-1)]">
                <ChevronsRight size={14} />
                2ª quinzena (dia 15 em diante)
              </div>
            ) : null}
            <header className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-700">
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{day}</span>
                <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {weekday}
                </span>
              </div>
              {expenses.length > 1 ? (
                <span className={`text-xs font-semibold tabular-nums ${debitCls}`}>{debit(expenseTotal)}</span>
              ) : null}
            </header>
            <div className="px-3 py-2">
              {!hasItems ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">Sem lançamentos</p>
              ) : (
                <ul className="space-y-1.5">
                  {incomes.map((inc) => (
                    <li key={`i-${inc.id}`}>
                      <button
                        type="button"
                        onClick={() => onIncome(inc)}
                        className="flex w-full items-start justify-between gap-2 rounded-lg bg-green-50 px-2.5 py-2 text-left dark:bg-green-900/25"
                      >
                        <span className="min-w-0 flex-1 text-sm text-green-900 dark:text-green-100">
                          <span className="line-clamp-2">{inc.description}</span>
                          {!inc.editable ? (
                            <span className="mt-0.5 block text-[10px] text-green-700/80 dark:text-green-300/80">
                              Projeção automática
                            </span>
                          ) : null}
                        </span>
                        <span className={`shrink-0 text-sm font-semibold tabular-nums ${creditCls}`}>
                          {formatCurrency(Number(inc.amount))}
                        </span>
                      </button>
                    </li>
                  ))}
                  {expenses.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => onExpense(e)}
                        className={`flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${
                          e.kind === 'fixed'
                            ? 'bg-red-50 text-red-900 dark:bg-red-900/25 dark:text-red-100'
                            : 'bg-orange-50 text-orange-900 dark:bg-orange-900/25 dark:text-orange-100'
                        }`}
                      >
                        <span className="line-clamp-2 min-w-0 flex-1">{e.description}</span>
                        <span className={`shrink-0 font-semibold tabular-nums ${debitCls}`}>{debit(valueOf(e))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}