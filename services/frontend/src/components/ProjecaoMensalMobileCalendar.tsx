import { ChevronsRight } from 'lucide-react'
import { listPageTableSectionCls } from './CadastroListPageLayout'
import type { ProjectionSource } from './ProjectionOriginBadge'
import ProjectionLaunchCard from './ProjectionLaunchCard'
import type { CalendarViewMode } from '../utils/projectionCalendarRange'

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const

type IncomeRow = {
  id: number
  description: string
  amount: string
  editable: boolean
  source: ProjectionSource
}

type ExpenseRow = {
  id: number
  description: string
  amount: string
  kind: 'fixed' | 'variable'
  source: ProjectionSource
}

type Props = {
  yearMonth: string
  calendarView?: CalendarViewMode
  visibleDays?: number[]
  byDay: Map<number, ExpenseRow[]>
  incomeByDay: Map<number, IncomeRow[]>
  formatCurrency: (n: number) => string
  debit: (n: number) => string
  debitCls: string
  creditCls: string
  valueOf: (e: ExpenseRow) => number
  onIncome: (inc: IncomeRow) => void
  onExpense: (e: ExpenseRow) => void
  onDelete: (id: number) => void
  deleting?: boolean
}

export default function ProjecaoMensalMobileCalendar({
  yearMonth,
  calendarView = 'month',
  visibleDays,
  byDay,
  incomeByDay,
  formatCurrency,
  debit,
  debitCls,
  creditCls,
  valueOf,
  onIncome,
  onExpense,
  onDelete,
  deleting = false,
}: Props) {
  const [y, m] = yearMonth.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const days =
    visibleDays ??
    (calendarView === 'month'
      ? Array.from({ length: daysInMonth }, (_, i) => i + 1)
      : [])
  const showQuinzenaChrome = calendarView === 'month'

  return (
    <div className="space-y-2">
      {days.map((day) => {
        const incomes = incomeByDay.get(day) ?? []
        const expenses = byDay.get(day) ?? []
        const expenseTotal = expenses.reduce((s, e) => s + valueOf(e), 0)
        const hasItems = incomes.length > 0 || expenses.length > 0
        const weekday = WEEKDAYS[new Date(y, m - 1, day).getDay()]

        return (
          <section
            key={day}
            className={`${listPageTableSectionCls} flex flex-col overflow-hidden ${
              showQuinzenaChrome && day === 15 ? 'ring-2 ring-[var(--color-1)]/35' : ''
            }`}
          >
            {showQuinzenaChrome && day === 15 ? (
              <div className="flex items-center gap-2 border-b border-[var(--color-1)]/30 bg-[color-mix(in_srgb,var(--color-1)_10%,transparent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-1)]">
                <ChevronsRight size={14} />
                2ª quinzena (dia 15 em diante)
              </div>
            ) : null}
            <header className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2.5 dark:border-gray-600">
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
            <div className="space-y-1.5 p-2">
              {!hasItems ? (
                <p className="px-1 py-1 text-xs text-gray-400 dark:text-gray-500">Sem lançamentos</p>
              ) : (
                <ul className="space-y-1.5">
                  {incomes.map((inc) => (
                    <li key={`i-${inc.id}`}>
                      <ProjectionLaunchCard
                        compact
                        source={inc.source}
                        description={inc.description}
                        amount={formatCurrency(Number(inc.amount))}
                        tone="income"
                        deleting={deleting}
                        title={
                          inc.editable
                            ? 'Receita lançada'
                            : 'Projeção automática: toque para excluir ou lance novamente para atualizar'
                        }
                        onOpen={() => onIncome(inc)}
                        onDelete={() => onDelete(inc.id)}
                      />
                    </li>
                  ))}
                  {expenses.map((e) => (
                    <li key={e.id}>
                      <ProjectionLaunchCard
                        compact
                        source={e.source}
                        description={e.description}
                        amount={debit(valueOf(e))}
                        tone={e.kind === 'fixed' ? 'fixed' : 'variable'}
                        deleting={deleting}
                        onOpen={() => onExpense(e)}
                        onDelete={() => onDelete(e.id)}
                      />
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