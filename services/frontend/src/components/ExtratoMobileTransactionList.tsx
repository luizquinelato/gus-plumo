import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  ArrowLeftRight,
  CheckSquare,
  Edit2,
  Gift,
  Landmark,
  MinusSquare,
  Square,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import ListPagination from './ListPagination'
import SharedAccountDisplay from './SharedAccountDisplay'
import { reportRowActionBtnClass } from './CadastroListPageLayout'
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
  /** Seleção em lote (desktop / telas largas). */
  selection?: {
    isSelected: (expense: ExtratoExpenseRow) => boolean
    canSelect: (expense: ExtratoExpenseRow) => boolean
    onToggle: (expense: ExtratoExpenseRow) => void
    bulkActive: boolean
  }
  onOpenActions?: (expense: ExtratoExpenseRow) => void
  onDelete?: (expense: ExtratoExpenseRow) => void
  sort?: {
    sortField: string | null
    sortDirection: 'asc' | 'desc'
    onSort: (field: string) => void
  }
  bulkSelectHeader?: {
    selectAllState: 'none' | 'partial' | 'all'
    onSelectAllToggle: () => void
  }
}

const EXTRATO_SORT_COLUMNS = [
  ['date', 'Data'],
  ['description', 'Descrição'],
  ['tag_name', 'Tag'],
  ['subtag_name', 'Subtag'],
  ['shared_partner_name', 'Compartilhamento'],
  ['amount', 'Total'],
] as const

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

function ownershipPct(expense: ExtratoExpenseRow): number {
  return expense.ownership_percentage == null ? 100 : Number(expense.ownership_percentage)
}

function partnerOwnershipPct(expense: ExtratoExpenseRow): number {
  const mine = ownershipPct(expense)
  return Math.round((100 - mine) * 100) / 100
}

const DESKTOP_CARD_SHELL = 'w-full rounded-md border py-2.5 text-sm transition-colors'

/** Alinhamento horizontal das colunas da grade (header + linhas iguais). */
const GRID_CELL = {
  select: 'flex min-w-0 items-center justify-center self-center',
  line: 'min-w-0 self-center text-left',
  origin: 'flex min-w-0 items-center justify-center self-center',
  data: 'min-w-0 self-center text-left',
  text: 'min-w-0 self-center text-left',
  money: 'min-w-0 w-full self-center text-left',
  actions: 'flex min-w-0 items-center justify-end self-center',
} as const

function GridCell({
  variant,
  children,
  className = '',
}: {
  variant: keyof typeof GRID_CELL
  children: ReactNode
  className?: string
}) {
  return <div className={`${GRID_CELL[variant]} ${className}`}>{children}</div>
}

const HEADER_LABEL =
  'block w-full text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400'

/** Largura mínima do painel para a grade em uma linha (considera sidebar / janela redimensionada). */
const WIDE_ROW_MIN_PX = 1180

const DESKTOP_ROW_GRID =
  'grid w-full grid-cols-[2rem_1.75rem_2.5rem_minmax(6.5rem,7.25rem)_minmax(8rem,2fr)_minmax(4rem,1fr)_minmax(4rem,1fr)_minmax(5rem,1.15fr)_minmax(7rem,1fr)_minmax(7rem,1fr)_minmax(7rem,1fr)_3.25rem] items-center gap-x-3'

function SelectAllHeaderButton({
  selectAllState,
  onToggle,
}: {
  selectAllState: 'none' | 'partial' | 'all'
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="rounded p-0.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
      title={selectAllState === 'none' ? 'Selecionar todos' : 'Limpar seleção'}
    >
      {selectAllState === 'none' && <Square size={16} className="text-gray-400" />}
      {selectAllState === 'partial' && <MinusSquare size={16} className="text-blue-600" />}
      {selectAllState === 'all' && <CheckSquare size={16} className="text-blue-600" />}
    </button>
  )
}

function LineNumberBadge({ n }: { n: number }) {
  return (
    <span className="text-xs font-mono tabular-nums text-gray-500 dark:text-gray-400" title={`Linha ${n}`}>
      {n}
    </span>
  )
}

function SortHeaderButton({
  field,
  label,
  sortField,
  sortDirection,
  onSort,
  align = 'left',
}: {
  field: string
  label: string
  sortField: string | null
  sortDirection: 'asc' | 'desc'
  onSort: (field: string) => void
  align?: 'left' | 'right'
}) {
  const active = sortField === field
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`${HEADER_LABEL} transition-colors hover:text-color-primary ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${active ? '!text-gray-800 dark:!text-gray-200' : ''}`}
    >
      {label}
      {active ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : null}
    </button>
  )
}

function ExtratoDesktopListHeader({
  wideLayout,
  bulkSelectHeader,
  sort,
}: {
  wideLayout: boolean
  bulkSelectHeader?: ExtratoMobileTransactionListProps['bulkSelectHeader']
  sort?: ExtratoMobileTransactionListProps['sort']
}) {
  if (!bulkSelectHeader && !sort) return null

  if (wideLayout) {
    return (
      <div className={`${DESKTOP_ROW_GRID} mb-2 border-b border-gray-200 pb-2 dark:border-gray-700`}>
        <GridCell variant="select">
          {bulkSelectHeader ? (
            <SelectAllHeaderButton
              selectAllState={bulkSelectHeader.selectAllState}
              onToggle={bulkSelectHeader.onSelectAllToggle}
            />
          ) : null}
        </GridCell>
        <GridCell variant="line">
          <span className={`${HEADER_LABEL} text-left`}>#</span>
        </GridCell>
        <GridCell variant="origin">
          <span className={`${HEADER_LABEL} text-center`}>Orig.</span>
        </GridCell>
        <GridCell variant="data">
          {sort ? (
            <SortHeaderButton field="date" label="Data" {...sort} />
          ) : (
            <span className={`${HEADER_LABEL} text-left`}>Data</span>
          )}
        </GridCell>
        <GridCell variant="text">
          {sort ? (
            <SortHeaderButton field="description" label="Descrição" {...sort} />
          ) : (
            <span className={`${HEADER_LABEL} text-left`}>Descrição</span>
          )}
        </GridCell>
        <GridCell variant="text">
          {sort ? (
            <SortHeaderButton field="tag_name" label="Tag" {...sort} />
          ) : (
            <span className={`${HEADER_LABEL} text-left`}>Tag</span>
          )}
        </GridCell>
        <GridCell variant="text">
          {sort ? (
            <SortHeaderButton field="subtag_name" label="Subtag" {...sort} />
          ) : (
            <span className={`${HEADER_LABEL} text-left`}>Subtag</span>
          )}
        </GridCell>
        <GridCell variant="text">
          {sort ? (
            <SortHeaderButton field="shared_partner_name" label="Compartilhamento" {...sort} />
          ) : (
            <span className={`${HEADER_LABEL} text-left`}>Compartilhamento</span>
          )}
        </GridCell>
        <GridCell variant="money">
          <span className={`${HEADER_LABEL} text-left`}>Minha parte</span>
        </GridCell>
        <GridCell variant="money">
          <span className={`${HEADER_LABEL} text-left`}>Compartilhado</span>
        </GridCell>
        <GridCell variant="money">
          {sort ? (
            <SortHeaderButton field="amount" label="Total" {...sort} align="left" />
          ) : (
            <span className={`${HEADER_LABEL} text-left`}>Total</span>
          )}
        </GridCell>
        <GridCell variant="actions" aria-hidden />
      </div>
    )
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-gray-200 pb-2 dark:border-gray-700">
      {bulkSelectHeader ? (
        <SelectAllHeaderButton
          selectAllState={bulkSelectHeader.selectAllState}
          onToggle={bulkSelectHeader.onSelectAllToggle}
        />
      ) : null}
      <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">#</span>
      {sort ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {EXTRATO_SORT_COLUMNS.map(([field, label]) => (
            <button
              key={field}
              type="button"
              onClick={() => sort.onSort(field)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
                sort.sortField === field
                  ? 'bg-[color-mix(in_srgb,var(--color-1)_15%,transparent)] text-gray-900 dark:text-white'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
              }`}
            >
              {label}
              {sort.sortField === field ? (sort.sortDirection === 'asc' ? ' ↑' : ' ↓') : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function useWideRowLayout(containerRef: RefObject<HTMLDivElement | null>) {
  const [wideLayout, setWideLayout] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const update = () => {
      setWideLayout(el.clientWidth >= WIDE_ROW_MIN_PX)
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  return wideLayout
}

function AmountStack({
  amount,
  formatCurrency,
  subLabel,
  strong = false,
  wideLayout = false,
  align = 'left',
}: {
  amount: number
  formatCurrency: (value: number) => string
  subLabel?: string
  strong?: boolean
  wideLayout?: boolean
  align?: 'left' | 'right'
}) {
  const text = formatCurrency(amount)
  const resolvedAlign = wideLayout ? 'left' : align
  return (
    <div className={`min-w-0 w-full ${resolvedAlign === 'right' ? 'text-right' : 'text-left'}`}>
      <p
        className={`tabular-nums ${wideLayout ? 'whitespace-nowrap' : 'break-words'} ${amountTone(amount, strong)} ${strong ? 'font-semibold' : ''}`}
      >
        {text}
      </p>
      {subLabel ? (
        <p className="break-words text-[10px] leading-tight text-gray-500 dark:text-gray-400">{subLabel}</p>
      ) : null}
    </div>
  )
}

function MetaField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 w-full basis-full break-words sm:w-auto sm:flex-1 sm:basis-[calc(50%-0.5rem)]">
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <div className="mt-0.5 text-sm text-gray-800 dark:text-gray-200">{children}</div>
    </div>
  )
}

function DailyBalanceRowCompact({
  expense,
  formatCurrency,
  formatDateTime,
  dailyPartnerCumulative,
  wideLayout,
}: {
  expense: ExtratoExpenseRow
  formatCurrency: (value: number) => string
  formatDateTime: (dateStr: string) => string
  dailyPartnerCumulative: (dayKey: string | null) => number
  wideLayout: boolean
}) {
  const { mine, partner } = mineAndPartnerAmounts(expense, dailyPartnerCumulative)

  const label = expense.daily_month_end ? 'Saldo do mês' : 'Saldo do dia'

  return (
    <div
      className={`${DESKTOP_CARD_SHELL} ${wideLayout ? 'px-0' : 'px-3'} ${
        expense.daily_month_end
          ? 'border-amber-300/80 bg-amber-50/90 dark:border-amber-700 dark:bg-amber-950/35'
          : 'border-sky-200/90 bg-sky-50/80 dark:border-sky-800 dark:bg-sky-950/30'
      }`}
    >
      {wideLayout ? (
        <div className={DESKTOP_ROW_GRID}>
          <GridCell variant="select" aria-hidden />
          <GridCell variant="line" aria-hidden />
          <GridCell variant="origin">
            <TrendingUp size={18} style={{ color: 'var(--color-4)' }} aria-hidden />
          </GridCell>
          <GridCell variant="data">
            <span className="whitespace-nowrap tabular-nums text-gray-900 dark:text-white">{formatDateTime(expense.date)}</span>
          </GridCell>
          <GridCell variant="text">
            <span className="truncate font-medium text-gray-800 dark:text-gray-100">{label}</span>
          </GridCell>
          <GridCell variant="text" className="col-span-3 text-gray-400" aria-hidden>
            —
          </GridCell>
          <GridCell variant="money">
            <AmountStack amount={mine} formatCurrency={formatCurrency} wideLayout />
          </GridCell>
          <GridCell variant="money">
            <AmountStack amount={partner} formatCurrency={formatCurrency} wideLayout />
          </GridCell>
          <GridCell variant="money">
            <AmountStack amount={expense.amount} formatCurrency={formatCurrency} strong wideLayout />
          </GridCell>
          <GridCell variant="actions" aria-hidden />
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <TrendingUp size={18} style={{ color: 'var(--color-4)' }} aria-hidden />
            <span className="shrink-0 whitespace-nowrap tabular-nums text-gray-900 dark:text-white">
              {formatDateTime(expense.date)}
            </span>
            <p className="min-w-0 flex-1 break-words font-medium leading-snug text-gray-800 dark:text-gray-100">
              {label}
            </p>
          </div>
          <div className="grid w-full grid-cols-1 gap-3 border-t border-gray-200/70 pt-2 sm:ml-auto sm:w-auto sm:grid-cols-3 sm:border-0 sm:pt-0 dark:border-gray-600/50">
            <AmountStack amount={mine} formatCurrency={formatCurrency} subLabel="Minha parte" align="left" />
            <AmountStack amount={partner} formatCurrency={formatCurrency} subLabel="Compartilhado" align="left" />
            <AmountStack amount={expense.amount} formatCurrency={formatCurrency} subLabel="Total" strong align="left" />
          </div>
        </div>
      )}
    </div>
  )
}

function TransactionRowCompact({
  expense,
  formatCurrency,
  formatDateTime,
  dailyPartnerCumulative,
  selection,
  onOpenActions,
  onDelete,
  wideLayout,
  lineNumber,
}: {
  expense: ExtratoExpenseRow
  formatCurrency: (value: number) => string
  formatDateTime: (dateStr: string) => string
  dailyPartnerCumulative: (dayKey: string | null) => number
  selection: NonNullable<ExtratoMobileTransactionListProps['selection']>
  onOpenActions?: (expense: ExtratoExpenseRow) => void
  onDelete?: (expense: ExtratoExpenseRow) => void
  wideLayout: boolean
  lineNumber: number
}) {
  const { mine, partner } = mineAndPartnerAmounts(expense, dailyPartnerCumulative)
  const minePct = ownershipPct(expense)
  const partnerPct = partnerOwnershipPct(expense)
  const selected = selection.isSelected(expense)
  const canSelect = selection.canSelect(expense)
  const actionsEnabled = !selection.bulkActive

  const sharingAccount = expense.shared_partner_name
    ? {
        id: expense.shared_partner_id || 0,
        name: expense.shared_partner_name,
        bank: expense.shared_partner_bank ? { name: expense.shared_partner_bank } : null,
        agency: expense.shared_partner_agency,
        account_number: expense.shared_partner_account_number,
      }
    : null

  const checkboxBtn = (
    <button
      type="button"
      onClick={() => selection.onToggle(expense)}
      disabled={!canSelect}
      className={`rounded p-0.5 ${!canSelect ? 'cursor-not-allowed opacity-30' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
      title={!canSelect ? 'Não pode selecionar com o tipo atual' : selected ? 'Remover seleção' : 'Selecionar'}
    >
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px] ${
          selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-400'
        }`}
      >
        {selected ? '✓' : null}
      </span>
    </button>
  )

  const originIcons = (
    <div className="flex items-center gap-0.5">
      <SourceIcon expense={expense} />
      {expense.migrated_from_account_id ? (
        <ArrowLeftRight size={14} className="text-cyan-600 dark:text-cyan-400" aria-label="Invertido" />
      ) : null}
      {expense.source === 'bank' && expense.is_manual && !expense.migrated_from_account_id ? (
        <span
          className="flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white"
          title="Manual"
        >
          M
        </span>
      ) : null}
    </div>
  )

  const actionButtons = (
    <div className="flex items-center justify-end gap-0.5">
      {onOpenActions ? (
        <button
          type="button"
          onClick={() => onOpenActions(expense)}
          disabled={!actionsEnabled}
          className={reportRowActionBtnClass(actionsEnabled)}
          title={actionsEnabled ? 'Ações' : 'Limpe a seleção'}
        >
          <Edit2 size={16} />
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          onClick={() => onDelete(expense)}
          disabled={!actionsEnabled}
          className={reportRowActionBtnClass(actionsEnabled, 'danger')}
          title={actionsEnabled ? 'Excluir' : 'Limpe a seleção'}
        >
          <Trash2 size={16} />
        </button>
      ) : null}
    </div>
  )

  const installmentSuffix =
    expense.current_installment && expense.total_installments ? (
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {' '}
        · {expense.current_installment}/{expense.total_installments}x
      </span>
    ) : null

  return (
    <div
      className={`${DESKTOP_CARD_SHELL} ${wideLayout ? 'px-0' : 'px-3'} ${
        selected
          ? 'border-l-4 border-l-blue-600 border-gray-200 bg-[color-mix(in_srgb,var(--color-1)_7%,transparent)] dark:border-gray-600'
          : 'border-gray-200 hover:border-l-[var(--color-1)] dark:border-gray-600 dark:bg-gray-800/40'
      } bg-white dark:bg-gray-800`}
    >
      {wideLayout ? (
        <div className={DESKTOP_ROW_GRID}>
          <GridCell variant="select">{checkboxBtn}</GridCell>
          <GridCell variant="line">
            <LineNumberBadge n={lineNumber} />
          </GridCell>
          <GridCell variant="origin">{originIcons}</GridCell>
          <GridCell variant="data">
            <span className="whitespace-nowrap tabular-nums text-gray-900 dark:text-white">{formatDateTime(expense.date)}</span>
          </GridCell>
          <GridCell variant="text">
            <p className="truncate text-gray-900 dark:text-white" title={expense.description}>
              {expense.description}
              {installmentSuffix}
            </p>
            {expense.card_number ? (
              <p className="truncate text-xs" style={{ color: 'var(--color-4)' }}>
                {expense.card_name ? `${expense.card_name} · ` : ''}****{expense.card_number}
              </p>
            ) : null}
          </GridCell>
          <GridCell variant="text">
            <span className="block truncate text-gray-800 dark:text-gray-200" title={expense.tag_name ?? undefined}>
              {expense.tag_name || '—'}
            </span>
          </GridCell>
          <GridCell variant="text">
            <span className="block truncate text-gray-800 dark:text-gray-200" title={expense.subtag_name ?? undefined}>
              {expense.subtag_name || '—'}
            </span>
          </GridCell>
          <GridCell variant="text">
            <SharedAccountDisplay allowWrap account={sharingAccount} ownershipPercentage={expense.ownership_percentage} />
          </GridCell>
          <GridCell variant="money">
            <AmountStack amount={mine} formatCurrency={formatCurrency} subLabel={`${minePct.toFixed(2)}%`} wideLayout />
          </GridCell>
          <GridCell variant="money">
            <AmountStack amount={partner} formatCurrency={formatCurrency} subLabel={`${partnerPct.toFixed(2)}%`} wideLayout />
          </GridCell>
          <GridCell variant="money">
            <AmountStack amount={expense.amount} formatCurrency={formatCurrency} strong wideLayout />
          </GridCell>
          <GridCell variant="actions">{actionButtons}</GridCell>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex w-full min-w-0 flex-wrap items-start gap-x-3 gap-y-2">
            {checkboxBtn}
            <LineNumberBadge n={lineNumber} />
            {originIcons}
            <span className="max-w-full shrink-0 whitespace-nowrap tabular-nums text-gray-900 dark:text-white">
              {formatDateTime(expense.date)}
            </span>
            <div className="min-w-0 w-full flex-1 basis-full break-words leading-snug text-gray-900 dark:text-white sm:basis-[12rem]">
              {expense.description}
              {installmentSuffix}
              {expense.card_number ? (
                <span className="mt-0.5 block break-words text-xs" style={{ color: 'var(--color-4)' }}>
                  {expense.card_name ? `${expense.card_name} · ` : ''}****{expense.card_number}
                </span>
              ) : null}
            </div>
            <div className="ml-auto shrink-0">{actionButtons}</div>
          </div>
          <div className="flex w-full min-w-0 flex-wrap gap-x-4 gap-y-2 border-t border-gray-100 pt-2 dark:border-gray-700">
            <MetaField label="Tag">{expense.tag_name || '—'}</MetaField>
            <MetaField label="Subtag">{expense.subtag_name || '—'}</MetaField>
            <MetaField label="Compartilhamento">
              <SharedAccountDisplay
                allowWrap
                account={sharingAccount}
                ownershipPercentage={expense.ownership_percentage}
              />
            </MetaField>
          </div>
          <div className="grid w-full min-w-0 grid-cols-1 gap-3 border-t border-gray-100 pt-2 sm:grid-cols-2 lg:grid-cols-3 dark:border-gray-700">
            <AmountStack
              amount={mine}
              formatCurrency={formatCurrency}
              subLabel={`Minha (${minePct.toFixed(2)}%)`}
              align="left"
            />
            <AmountStack
              amount={partner}
              formatCurrency={formatCurrency}
              subLabel={`Compartilhado (${partnerPct.toFixed(2)}%)`}
              align="left"
            />
            <AmountStack amount={expense.amount} formatCurrency={formatCurrency} subLabel="Total" strong align="left" />
          </div>
        </div>
      )}
    </div>
  )
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
  selection,
  onOpenActions,
  onDelete,
  wideLayout = false,
  lineNumber = 0,
}: {
  expense: ExtratoExpenseRow
  formatCurrency: (value: number) => string
  formatDateTime: (dateStr: string) => string
  dailyPartnerCumulative: (dayKey: string | null) => number
  selection?: ExtratoMobileTransactionListProps['selection']
  onOpenActions?: (expense: ExtratoExpenseRow) => void
  onDelete?: (expense: ExtratoExpenseRow) => void
  wideLayout?: boolean
  lineNumber?: number
}) {
  const { mine, partner } = mineAndPartnerAmounts(expense, dailyPartnerCumulative)

  const tagLine = [expense.tag_name, expense.subtag_name].filter(Boolean).join(' · ')
  if (selection) {
    return (
      <TransactionRowCompact
        expense={expense}
        formatCurrency={formatCurrency}
        formatDateTime={formatDateTime}
        dailyPartnerCumulative={dailyPartnerCumulative}
        selection={selection}
        onOpenActions={onOpenActions}
        onDelete={onDelete}
        wideLayout={wideLayout}
        lineNumber={lineNumber}
      />
    )
  }

  const hasSharing = expense.shared_partner_name != null && expense.shared_partner_name !== ''
  const showPartnerSplit = hasSharing || Math.abs(partner) > 0.001
  const minePct = ownershipPct(expense)
  const partnerPct = partnerOwnershipPct(expense)

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

      <div className="mt-2 text-xs">
        <SharedAccountDisplay
          allowWrap
          account={
            expense.shared_partner_name
              ? {
                  id: expense.shared_partner_id || 0,
                  name: expense.shared_partner_name,
                  bank: expense.shared_partner_bank ? { name: expense.shared_partner_bank } : null,
                  agency: expense.shared_partner_agency,
                  account_number: expense.shared_partner_account_number,
                }
              : null
          }
          ownershipPercentage={expense.ownership_percentage}
        />
      </div>

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
            <dt className="text-gray-500 dark:text-gray-400">Minha parte ({minePct.toFixed(2)}%)</dt>
            <dd className={`tabular-nums ${amountTone(mine)}`}>{formatCurrency(mine)}</dd>
          </div>
          <div className="text-right">
            <dt className="text-gray-500 dark:text-gray-400">Compartilhado ({partnerPct.toFixed(2)}%)</dt>
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
  selection,
  onOpenActions,
  onDelete,
  sort,
  bulkSelectHeader,
}: ExtratoMobileTransactionListProps) {
  const slice = expenses.slice(
    perPage === 0 ? 0 : (page - 1) * perPage,
    perPage === 0 ? expenses.length : page * perPage,
  )

  let lastDayKey: string | null = null
  const compactDesktop = Boolean(selection)
  const listContainerRef = useRef<HTMLDivElement>(null)
  const wideLayout = useWideRowLayout(listContainerRef)

  const listItems = slice.map((expense, index) => {
          const lineNumber = perPage === 0 ? index + 1 : (page - 1) * perPage + index + 1
          const dayKey = localDateKeyFromIso(expense.date)
          const showDayHeader = Boolean(dayKey && dayKey !== lastDayKey)
          if (showDayHeader && dayKey) lastDayKey = dayKey

          const row = isExtratoDailyBalanceRow(expense) ? (
            compactDesktop ? (
              <DailyBalanceRowCompact
                expense={expense}
                formatCurrency={formatCurrency}
                formatDateTime={formatDateTime}
                dailyPartnerCumulative={dailyPartnerCumulative}
                wideLayout={wideLayout}
              />
            ) : (
              <DailyBalanceCard
                expense={expense}
                formatCurrency={formatCurrency}
                formatDateTime={formatDateTime}
                dailyPartnerCumulative={dailyPartnerCumulative}
              />
            )
          ) : (
            <TransactionCard
              expense={expense}
              formatCurrency={formatCurrency}
              formatDateTime={formatDateTime}
              dailyPartnerCumulative={dailyPartnerCumulative}
              selection={selection}
              onOpenActions={onOpenActions}
              onDelete={onDelete}
              wideLayout={wideLayout}
              lineNumber={lineNumber}
            />
          )

          return (
            <li key={`${expense.source}-${expense.id}`} className="list-none space-y-1">
              {showDayHeader && dayKey && !compactDesktop ? (
                <p className="px-0.5 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {formatDateBR(dayKey)}
                </p>
              ) : null}
              {row}
            </li>
          )
  })

  return (
    <div className="space-y-3">
      {compactDesktop ? (
        <div
          ref={listContainerRef}
          className="hidden w-full min-w-0 max-w-full rounded-lg border border-gray-200 bg-white px-3 py-3 md:block dark:border-gray-600 dark:bg-gray-800"
        >
          <ExtratoDesktopListHeader
            wideLayout={wideLayout}
            bulkSelectHeader={bulkSelectHeader}
            sort={sort}
          />
          <ul className="space-y-2">{listItems}</ul>
        </div>
      ) : (
        <ul className="space-y-1">{listItems}</ul>
      )}

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