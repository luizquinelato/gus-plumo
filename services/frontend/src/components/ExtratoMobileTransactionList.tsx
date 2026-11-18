import type { ReactNode } from 'react'
import {
  ArrowLeftRight,
  Gift,
  Landmark,
  TrendingUp,
} from 'lucide-react'
import ListPagination from './ListPagination'
import { formatDateBR } from '../utils/dateUtils'
import {
  isExtratoDailyBalanceRow,
  localDateKeyFromIso,
  type ExtratoExpenseRow,
} from '../utils/extratoDailyBalance'

export type ExtratoMobileTransactionListProps = {
  expenses: ExtratoExpenseRow[]
  formatCurrency: (value: number) => string
  formatDateTime: (dateStr: string) => string
  dailyPartnerCumulative: (dayKey: string | null) => number
  page: number
  perPage: number
  total: number
  onPageChange: (page: number) => void
  onPerPageChange: (perPage: number) => void
}

function amountTone(value: number, strong = false): string {
  const weight = strong ? 'font-semibold' : 'font-medium'
  if (value >= 0) return `${weight} text-green-600 dark:text-green-400`
  return `${weight} text-red-600 dark:text-red-400`
}

function SourceIcon({ expense }: { expense: ExtratoExpenseRow }) {
  if (isExtratoDailyBalanceRow(expense)) {
    return <TrendingUp size={18} style={{ color: 'var(--color-4)' }} aria-hidden />
  }
  if (expense.source === 'bank') {
    return <Landmark size={18} style={{ color: 'var(--color-1)' }} aria-hidden />
  }
  return <Gift size={18} style={{ color: 'var(--color-3)' }} aria-hidden />
}

function mineAndPartnerAmounts(
  expense: ExtratoExpenseRow,
  dailyPartnerCumulative: (dayKey: string | null) => number,
): { mine: number; partner: number } {
  if (isExtratoDailyBalanceRow(expense)) {
    const partnerCum = dailyPartnerCumulative(localDateKeyFromIso(expense.date))
    const mineCum = Math.round((expense.amount - partnerCum) * 100) / 100
    return { mine: mineCum, partner: partnerCum }
  }
  const pct = expense.ownership_percentage == null ? 100 : Number(expense.ownership_percentage)
  const mine = Math.round(expense.amount * pct) / 100
  const partner = Math.round((expense.amount - Math.round(expense.amount * pct) / 100) * 100) / 100
  return { mine, partner }
}

function DailyBalanceCard({
  expense,
  formatCurrency,
  formatDateTime,
  dailyPartnerCumulative,
}: {
  expense: ExtratoExpenseRow
  formatCurrency: (value: number) => string
  formatDateTime: (dateStr: string) => string
  dailyPartnerCumulative: (dayKey: string | null) => number
}) {
  const { mine, partner } = mineAndPartnerAmounts(expense, dailyPartnerCumulative)

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        expense.daily_month_end
          ? 'border-amber-300 bg-amber-50/95 dark:border-amber-700 dark:bg-amber-950/35'
          : 'border-sky-200 bg-sky-50/90 dark:border-sky-800 dark:bg-sky-950/35'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
            <TrendingUp size={16} style={{ color: 'var(--color-4)' }} />
            {expense.daily_month_end ? 'Saldo do mês' : 'Saldo do dia'}
          </p>
          <p className="mt-1 text-sm text-gray-800 dark:text-gray-100">{formatDateTime(expense.date)}</p>
        </div>
        <p className={`shrink-0 text-lg tabular-nums ${amountTone(expense.amount, true)}`}>
          {formatCurrency(expense.amount)}
        </p>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-gray-200/80 pt-2 text-xs dark:border-gray-600/80">
        <div>
          <dt className="text-gray-500 dark:text-gray-400">Minha parte</dt>
          <dd className={`tabular-nums ${amountTone(mine)}`}>{formatCurrency(mine)}</dd>
        </div>
        <div className="text-right">
          <dt className="text-gray-500 dark:text-gray-400">Compartilhado</dt>
          <dd className={`tabular-nums ${amountTone(partner)}`}>{formatCurrency(partner)}</dd>
        </div>
      </dl>
    </div>
  )
}

function TransactionCard({
  expense,
  formatCurrency,
  formatDateTime,
  dailyPartnerCumulative,
}: {
  expense: ExtratoExpenseRow
  formatCurrency: (value: number) => string
  formatDateTime: (dateStr: string) => string
  dailyPartnerCumulative: (dayKey: string | null) => number
}) {
  const { mine, partner } = mineAndPartnerAmounts(expense, dailyPartnerCumulative)
  const hasSharing = expense.shared_partner_name != null && expense.shared_partner_name !== ''
  const showPartnerSplit = hasSharing || Math.abs(partner) > 0.001

  const tagLine = [expense.tag_name, expense.subtag_name].filter(Boolean).join(' · ')

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start gap-3">
        <MotionIconWrap>
          <SourceIcon expense={expense} />
        </MotionIconWrap>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-sm font-medium leading-snug text-gray-900 dark:text-white">
              {expense.description}
              {expense.current_installment && expense.total_installments ? (
                <span className="font-normal text-gray-500 dark:text-gray-400">
                  {' '}
                  · {expense.current_installment}/{expense.total_installments}x
                </span>
              ) : null}
            </p>
            <p className={`shrink-0 text-base tabular-nums ${amountTone(expense.amount, true)}`}>
              {formatCurrency(expense.amount)}
            </p>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatDateTime(expense.date)}</p>
        </div>
      </div>

      {(tagLine || expense.card_number) && (
        <div className="mt-2 space-y-0.5 text-xs text-gray-600 dark:text-gray-300">
          {tagLine ? <p>{tagLine}</p> : null}
          {expense.card_number ? (
            <p style={{ color: 'var(--color-4)' }}>
              {expense.card_name ? `${expense.card_name} · ` : ''}
              ****{expense.card_number}
            </p>
          ) : null}
        </div>
      )}

      {hasSharing ? (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="font-medium text-gray-600 dark:text-gray-300">Compartilhamento:</span>{' '}
          {expense.shared_partner_name}
        </p>
      ) : null}

      {expense.migrated_from_account_id ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-cyan-700 dark:text-cyan-400">
          <ArrowLeftRight size={14} />
          Invertido de outra conta
        </p>
      ) : null}

      {expense.source === 'bank' && expense.is_manual && !expense.migrated_from_account_id ? (
        <p className="mt-1 text-xs font-medium text-orange-600 dark:text-orange-400">Lançamento manual</p>
      ) : null}

      {showPartnerSplit ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-gray-100 pt-2 text-xs dark:border-gray-700">
          <div>
            <dt className="text-gray-500 dark:text-gray-400">Minha parte</dt>
            <dd className={`tabular-nums ${amountTone(mine)}`}>{formatCurrency(mine)}</dd>
          </div>
          <div className="text-right">
            <dt className="text-gray-500 dark:text-gray-400">Compartilhado</dt>
            <dd className={`tabular-nums ${amountTone(partner)}`}>{formatCurrency(partner)}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  )
}

function MotionIconWrap({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
      {children}
    </div>
  )
}

export default function ExtratoMobileTransactionList({
  expenses,
  formatCurrency,
  formatDateTime,
  dailyPartnerCumulative,
  page,
  perPage,
  total,
  onPageChange,
  onPerPageChange,
}: ExtratoMobileTransactionListProps) {
  const slice = expenses.slice(
    perPage === 0 ? 0 : (page - 1) * perPage,
    perPage === 0 ? expenses.length : page * perPage,
  )

  let lastDayKey: string | null = null

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {slice.map((expense) => {
          const dayKey = localDateKeyFromIso(expense.date)
          const showDayHeader = Boolean(dayKey && dayKey !== lastDayKey)
          if (showDayHeader && dayKey) lastDayKey = dayKey

          const row = isExtratoDailyBalanceRow(expense) ? (
            <DailyBalanceCard
              expense={expense}
              formatCurrency={formatCurrency}
              formatDateTime={formatDateTime}
              dailyPartnerCumulative={dailyPartnerCumulative}
            />
          ) : (
            <TransactionCard
              expense={expense}
              formatCurrency={formatCurrency}
              formatDateTime={formatDateTime}
              dailyPartnerCumulative={dailyPartnerCumulative}
            />
          )

          return (
            <li key={`${expense.source}-${expense.id}`} className="list-none space-y-2">
              {showDayHeader && dayKey ? (
                <p className="px-0.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {formatDateBR(dayKey)}
                </p>
              ) : null}
              {row}
            </li>
          )
        })}
      </ul>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <ListPagination
          total={total}
          page={page}
          perPage={perPage}
          onPageChange={onPageChange}
          onPerPageChange={onPerPageChange}
          options={[25, 50, 100, 0]}
        />
      </div>
    </div>
  )
}