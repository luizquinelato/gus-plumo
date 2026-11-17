import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroFilterField,
  CadastroListPageBody,
  CadastroListPageFilterCard,
  CadastroListPageHero,
  CadastroListPageShell,
  CadastroListPageTabs,
  cadastroRowIconBtnCls,
  cadastroRowIconDangerCls,
  listPageTableRowHoverCls,
  listPageTableSectionCls,
  listPageTableTdCls,
} from '../components/CadastroListPageLayout'
import {
  CadastroFieldLabel,
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFieldsGrid,
  CadastroModalFieldsRow,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
  cadastroFieldCls,
  cadastroSectionsStackCls,
} from '../components/CadastroFormLayout'
import { ListPageTable } from '../components/ListPageTable'
import {
  ListTableCheckboxCell,
  ListTableCheckboxHeader,
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableStaticHeader,
} from '../components/ListTableSelectColumns'
import Badge from '../components/Badge'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import LoadingSpinner from '../components/LoadingSpinner'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import Toast from '../components/Toast'
import FloatingFooterBar from '../components/FloatingFooterBar'
import { useConfirm } from '../hooks/useConfirm'
import { useExportRunner } from '../hooks/useExportRunner'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { formatCurrency } from '../utils/currency'
import { formatDateBR, formatDateTimeBR, parseLocalDateTime } from '../utils/dateUtils'
import SortableDateHeader from '../components/SortableDateHeader'
import {
  sortRowsByDate,
  toggleDateSortDirection,
  type DateSortDirection,
} from '../utils/tableDateSort'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import {
  bulkCloseAccountPeriods,
  closeAccountPeriod,
  listAccountPeriodClosureOptions,
  listAccountPeriodClosures,
  previewAccountPeriod,
  reopenAccountPeriod,
} from '../services/accountPeriodClosuresApi'
import type {
  AccountPeriodFilterOptions,
  AccountPeriodItem,
  AccountPeriodItemSource,
  AccountPeriodMonth,
  AccountPeriodSharedClosure,
  AccountPeriodSharedPartner,
  AccountPeriodSplit,
  AccountPeriodStatus,
  AccountPeriodYearResponse,
} from '../types/accountPeriodClosure'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpCircle,
  Calendar,
  CreditCard,
  Eye,
  Filter,
  Gift,
  Landmark,
  Lock,
  Scale,
  Unlock,
  Users,
  X,
  TrendingUp,
  TrendingDown,
  History,
  Download,
} from 'lucide-react'
import { ExportClosureModal } from '../components/ExportClosureModal'
import {
  exportAccountClosureDetailToExcel,
  exportAccountClosureDetailToPdf,
  type AccountClosureDetail,
  type AccountClosureExportRow,
  type ClosureDetailItem,
} from '../utils/exportAccountClosures'

type ClosureTab = 'open' | 'closed'

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

const MONTH_LABELS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const monthKey = (item: Pick<AccountPeriodMonth, 'year' | 'month'>) =>
  `${item.year}-${String(item.month).padStart(2, '0')}`

const monthTitle = (item: Pick<AccountPeriodMonth, 'year' | 'month'>) =>
  `${MONTH_LABELS[item.month - 1]} ${item.year}`

const lastDayLabel = (year: number, month: number) => {
  const last = new Date(year, month, 0).getDate()
  return formatDateBR(`${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`)
}

const MAX_ADJUSTMENT = 99_999_999.99

const formatAmountMask = (cents: string): string => {
  const num = parseInt(cents || '0', 10)
  return (num / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const amountFromCents = (cents: string, negative: boolean) => {
  const abs = parseInt(cents || '0', 10) / 100
  if (!Number.isFinite(abs) || abs === 0) return 0
  return negative ? -abs : abs
}

const apiErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string' && detail.trim()) return detail
  }
  return fallback
}

const statusLabel: Record<AccountPeriodStatus, string> = {
  closed: 'Fechado',
  can_close: 'Pronto para fechar',
  blocked: 'Aguardando anterior',
  pending_shared: 'Aguardando quitação',
  current: 'Mês corrente',
  future: 'Futuro',
  no_data: 'Sem extrato/benefício',
}

const statusTone = (status: AccountPeriodStatus): 'success' | 'info' | 'warning' | 'neutral' => {
  if (status === 'closed') return 'success'
  if (status === 'can_close') return 'info'
  if (status === 'blocked' || status === 'pending_shared') return 'warning'
  return 'neutral'
}

const moneyStyle = (value: number, invert = false) => ({
  color: (invert ? -value : value) >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
})

const hasOfficialOpening = (item: Pick<AccountPeriodMonth, 'status'>) =>
  item.status === 'closed' || item.status === 'can_close' || item.status === 'blocked' || item.status === 'pending_shared' || item.status === 'current'

const emptySplit = { entries: 0, exits: 0 }

const splitOf = (item?: Pick<AccountPeriodMonth, 'split_account' | 'split_shared'> | null) => ({
  account: item?.split_account ?? emptySplit,
  shared: item?.split_shared ?? emptySplit,
})

function FlowSplitLines({
  total,
  account,
  shared,
  invert = false,
  compact = false,
}: {
  total: number
  account: number
  shared: number
  invert?: boolean
  compact?: boolean
}) {
  return (
    <div className={compact ? 'space-y-0.5' : 'space-y-1'}>
      <span className={`block font-semibold tabular-nums ${compact ? 'text-sm' : ''}`} style={moneyStyle(total, invert)}>
        {formatCurrency(total)}
      </span>
      <p className="text-[10px] leading-tight text-gray-500 dark:text-gray-400">
        Conta <span className="tabular-nums">{formatCurrency(account)}</span>
      </p>
      <p className="text-[10px] leading-tight text-gray-500 dark:text-gray-400">
        Comp. <span className="tabular-nums">{formatCurrency(shared)}</span>
      </p>
    </div>
  )
}

const closureTableHeadCls =
  'bg-gray-100 dark:bg-gray-800/80 [&_th]:border-b-2 [&_th]:border-gray-200 dark:[&_th]:border-gray-600'
const closureTableThLeftCls =
  'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
const closureTableThRightCls =
  'px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
const closureTableTdCls = 'border-b border-gray-200 px-3 py-2 dark:border-gray-600'
const closureTableFootCls =
  'border-t-2 border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/50'

function ClosureSummaryPanelCell({
  label,
  icon,
  value,
  hint,
}: {
  label: string
  icon: ReactNode
  value: ReactNode
  hint?: string
}) {
  return (
    <div className="flex min-h-[7.5rem] flex-col justify-center bg-white px-5 py-4 dark:bg-gray-800">
      <div className="mb-2 flex items-center gap-2 text-gray-500 dark:text-gray-400">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-xl font-bold tabular-nums sm:text-2xl">{value}</div>
      {hint ? <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p> : null}
    </div>
  )
}

function BulkCloseSummaryScorecards({ months }: { months: AccountPeriodMonth[] }) {
  const sorted = sortMonths(months)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const totalEntries = sorted.reduce((sum, m) => sum + Number(m.entries), 0)
  const totalExits = sorted.reduce((sum, m) => sum + Number(m.exits), 0)
  const periodLabel =
    sorted.length === 1
      ? monthTitle(first)
      : `${monthTitle(first)} – ${monthTitle(last)}`
  const monthCountLabel = `${sorted.length} mês${sorted.length === 1 ? '' : 'es'}`

  return (
    <article className={`${listPageTableSectionCls} flex flex-col overflow-hidden`}>
      <div
        className="flex items-start gap-3 border-b border-l-4 border-gray-200 px-5 py-4 dark:border-gray-600"
        style={{ borderLeftColor: 'var(--color-1)' }}
      >
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-[color-mix(in_srgb,var(--color-1)_20%,transparent)]"
          style={{
            color: 'var(--color-1)',
            background: 'color-mix(in srgb, var(--color-1) 14%, transparent)',
          }}
        >
          <Landmark size={18} aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Caixa do extrato</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Resumo · {periodLabel}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 divide-y divide-gray-200 dark:divide-gray-600 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        <ClosureSummaryPanelCell
          label="Saldo anterior"
          icon={<History size={14} className="text-gray-600 dark:text-gray-400" />}
          hint={
            hasOfficialOpening(first)
              ? `Início · ${monthTitle(first)}`
              : 'Sem saldo oficial de abertura'
          }
          value={
            hasOfficialOpening(first) ? (
              <span style={moneyStyle(first.opening_balance)}>{formatCurrency(first.opening_balance)}</span>
            ) : (
              <span className="text-gray-400">—</span>
            )
          }
        />
        <ClosureSummaryPanelCell
          label="Entradas"
          icon={<TrendingUp size={14} className="text-[var(--color-success)]" />}
          hint={monthCountLabel}
          value={
            <span className="text-[var(--color-success)]">{formatCurrency(totalEntries)}</span>
          }
        />
        <ClosureSummaryPanelCell
          label="Saídas"
          icon={<TrendingDown size={14} className="text-[var(--color-danger)]" />}
          hint={monthCountLabel}
          value={
            <span className="text-[var(--color-danger)]">
              {totalExits === 0 ? formatCurrency(0) : `−${formatCurrency(Math.abs(totalExits))}`}
            </span>
          }
        />
        <ClosureSummaryPanelCell
          label="Resultado"
          icon={<Scale size={14} className="text-[var(--color-1)]" />}
          hint={`Saldo final · ${monthTitle(last)}`}
          value={
            <span style={moneyStyle(last.closing_balance)}>{formatCurrency(last.closing_balance)}</span>
          }
        />
      </div>
    </article>
  )
}

function CloseModalMonthDetail({
  month,
  showItemSourceColumn = false,
}: {
  month: AccountPeriodMonth
  showItemSourceColumn?: boolean
}) {
  return (
    <>
      <CadastroFormSection
        title="Caixa do extrato"
        hint="Estes totais travam o saldo bancário do mês."
        icon={<Scale size={14} />}
        bodyClassName="p-0"
      >
        <CaixaTotals item={month} />
      </CadastroFormSection>

      <CadastroFormSection
        title="Repartição Conta / Compartilhado"
        hint="Esta divisão é gravada no fechamento para a saúde somar depois."
        icon={<Users size={14} />}
        bodyClassName="p-0"
      >
        <SplitBreakdownTable item={month} />
      </CadastroFormSection>

      <CadastroFormSection
        title="Compartilhado por conta"
        hint="Mesmas entradas, saídas e resultado do compartilhado, separados pela conta parceira."
        icon={<Users size={14} />}
        bodyClassName="p-0"
      >
        <SharedByAccountTable rows={mergeSharedByAccount([month])} />
      </CadastroFormSection>

      {(month.card_items ?? []).length > 0 ? (
        <CadastroFormSection
          title="Itens da fatura"
          hint="Despesa sai na conta/compartilhado do item; estorno entra. O débito bancário reconciliado não conta como 100% da conta."
          icon={<CreditCard size={14} />}
          bodyClassName="p-0"
        >
          <AllocationMiniTable rows={month.card_items ?? []} showSourceColumn={showItemSourceColumn} />
        </CadastroFormSection>
      ) : null}

      {(month.benefit_items ?? []).length > 0 ? (
        <CadastroFormSection
          title="Cartão de benefício"
          hint="Lançamentos do mês do item entram na repartição Conta / Compartilhado. O caixa do extrato não muda."
          icon={<Gift size={14} />}
          bodyClassName="p-0"
        >
          <AllocationMiniTable rows={month.benefit_items ?? []} showSourceColumn={showItemSourceColumn} />
        </CadastroFormSection>
      ) : null}

      <UnmatchedCardWarning items={month.unmatched_card_payments ?? []} />

      {(month.shared_settlements ?? []).length > 0 ? (
        <CadastroFormSection
          title="Acertos compartilhados"
          hint="PIX/pagamento do Balanço e empréstimo gerado no fechamento entram como crédito compartilhado."
          icon={<Scale size={14} />}
          bodyClassName="p-0"
        >
          <AllocationMiniTable rows={month.shared_settlements ?? []} showSourceColumn={showItemSourceColumn} />
        </CadastroFormSection>
      ) : null}
    </>
  )
}

function CaixaTotals({ item }: { item: AccountPeriodMonth }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-gray-300 md:grid-cols-4 md:divide-y-0 dark:divide-gray-600">
      <div className="px-3 py-3">
        <p className="text-xs text-gray-500">Saldo anterior</p>
        {hasOfficialOpening(item) ? (
          <p className="text-base font-bold tabular-nums" style={moneyStyle(item.opening_balance)}>
            {formatCurrency(item.opening_balance)}
          </p>
        ) : (
          <p className="text-base font-bold tabular-nums text-gray-400">—</p>
        )}
      </div>
      <div className="px-3 py-3">
        <p className="text-xs text-gray-500">Entradas</p>
        <p className="text-base font-bold tabular-nums" style={moneyStyle(item.entries)}>
          {formatCurrency(item.entries)}
        </p>
      </div>
      <div className="px-3 py-3">
        <p className="text-xs text-gray-500">Saídas</p>
        <p className="text-base font-bold tabular-nums" style={moneyStyle(item.exits, true)}>
          {formatCurrency(item.exits)}
        </p>
      </div>
      <div className="px-3 py-3">
        <p className="text-xs text-gray-500">Resultado do caixa</p>
        <p className="text-base font-bold tabular-nums" style={moneyStyle(item.closing_balance)}>
          {formatCurrency(item.closing_balance)}
        </p>
      </div>
    </div>
  )
}

function FlowSplitTable({
  split,
}: {
  split: { account: AccountPeriodSplit; shared: AccountPeriodSplit }
}) {
  const rows = [
    { label: 'Entradas', account: split.account.entries, shared: split.shared.entries, invert: false },
    { label: 'Saídas', account: split.account.exits, shared: split.shared.exits, invert: true },
  ]
  const resultAccount = split.account.entries - split.account.exits
  const resultShared = split.shared.entries - split.shared.exits
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className={closureTableHeadCls}>
          <tr>
            <th className={closureTableThLeftCls}>Fluxo</th>
            <th className={closureTableThRightCls}>
              <span className="inline-flex items-center justify-end gap-1">
                <Landmark size={12} />
                Conta
              </span>
            </th>
            <th className={closureTableThRightCls}>
              <span className="inline-flex items-center justify-end gap-1">
                <Users size={12} />
                Compartilhado
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className={`${closureTableTdCls} font-medium text-gray-700 dark:text-gray-200`}>{row.label}</td>
              <td className={`${closureTableTdCls} text-right font-semibold tabular-nums`} style={moneyStyle(row.account, row.invert)}>
                {formatCurrency(row.account)}
              </td>
              <td className={`${closureTableTdCls} text-right font-semibold tabular-nums`} style={moneyStyle(row.shared, row.invert)}>
                {formatCurrency(row.shared)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className={closureTableFootCls}>
          <tr>
            <td className="px-3 py-2.5 font-semibold text-gray-800 dark:text-gray-100">Resultado</td>
            <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={moneyStyle(resultAccount)}>
              {formatCurrency(resultAccount)}
            </td>
            <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={moneyStyle(resultShared)}>
              {formatCurrency(resultShared)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function SplitBreakdownTable({ item }: { item: AccountPeriodMonth }) {
  return <FlowSplitTable split={splitOf(item)} />
}

function mergeSharedByAccount(months: AccountPeriodMonth[]): AccountPeriodSharedPartner[] {
  const byKey = new Map<string, AccountPeriodSharedPartner>()
  for (const month of months) {
    for (const row of month.shared_by_account ?? []) {
      const key = row.shared_partner_id != null
        ? `id:${row.shared_partner_id}`
        : `name:${row.shared_partner_name}`
      const current = byKey.get(key)
      if (current) {
        current.entries += Number(row.entries)
        current.exits += Number(row.exits)
        continue
      }
      byKey.set(key, {
        ...row,
        entries: Number(row.entries),
        exits: Number(row.exits),
      })
    }
  }
  return [...byKey.values()].sort((left, right) =>
    left.shared_partner_name.localeCompare(right.shared_partner_name, 'pt-BR'),
  )
}

function SharedByAccountTable({ rows }: { rows: AccountPeriodSharedPartner[] }) {
  if (rows.length === 0) {
    return <p className="px-3 py-3 text-sm text-gray-500">Nenhum valor compartilhado neste período.</p>
  }
  const totals = rows.reduce(
    (acc, row) => ({
      entries: acc.entries + Number(row.entries),
      exits: acc.exits + Number(row.exits),
    }),
    { entries: 0, exits: 0 },
  )
  const resultTotal = totals.entries - totals.exits
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className={closureTableHeadCls}>
          <tr>
            <th className={closureTableThLeftCls}>Conta</th>
            <th className={closureTableThRightCls}>Entradas</th>
            <th className={closureTableThRightCls}>Saídas</th>
            <th className={closureTableThRightCls}>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const result = Number(row.entries) - Number(row.exits)
            return (
              <tr key={row.shared_partner_id ?? row.shared_partner_name}>
                <td className={closureTableTdCls}>
                  <SharedAccountDisplay
                    compact
                    account={{
                      id: row.shared_partner_id ?? 0,
                      name: row.shared_partner_name,
                      bank: row.shared_partner_bank ? { name: row.shared_partner_bank } : null,
                      agency: row.shared_partner_agency,
                      account_number: row.shared_partner_account_number,
                    }}
                  />
                </td>
                <td className={`${closureTableTdCls} text-right font-semibold tabular-nums`} style={moneyStyle(row.entries)}>
                  {formatCurrency(row.entries)}
                </td>
                <td className={`${closureTableTdCls} text-right font-semibold tabular-nums`} style={moneyStyle(row.exits, true)}>
                  {formatCurrency(row.exits)}
                </td>
                <td className={`${closureTableTdCls} text-right font-semibold tabular-nums`} style={moneyStyle(result)}>
                  {formatCurrency(result)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className={closureTableFootCls}>
          <tr>
            <td className="px-3 py-2.5 font-semibold text-gray-800 dark:text-gray-100">Total</td>
            <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={moneyStyle(totals.entries)}>
              {formatCurrency(totals.entries)}
            </td>
            <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={moneyStyle(totals.exits, true)}>
              {formatCurrency(totals.exits)}
            </td>
            <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={moneyStyle(resultTotal)}>
              {formatCurrency(resultTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function comparePeriodItems(left: AccountPeriodItem, right: AccountPeriodItem) {
  const byDate = right.date.localeCompare(left.date)
  if (byDate !== 0) return byDate
  return String(right.id).localeCompare(String(left.id), undefined, { numeric: true })
}

const isCashItem = (item: AccountPeriodItem) =>
  item.source !== 'card' && item.source !== 'benefit' && item.source !== 'settlement'

type ItemColumnTotals = {
  valor: number
  caixa: number
  account: number
  shared: number
  caixaEntries: number
  caixaExits: number
  accountEntries: number
  accountExits: number
  sharedEntries: number
  sharedExits: number
}

const emptyColumnTotals = (): ItemColumnTotals => ({
  valor: 0,
  caixa: 0,
  account: 0,
  shared: 0,
  caixaEntries: 0,
  caixaExits: 0,
  accountEntries: 0,
  accountExits: 0,
  sharedEntries: 0,
  sharedExits: 0,
})

function addSignedFlow(totals: ItemColumnTotals, field: 'caixa' | 'account' | 'shared', value: number) {
  totals[field] += value
  if (value > 0) {
    if (field === 'caixa') totals.caixaEntries += value
    else if (field === 'account') totals.accountEntries += value
    else totals.sharedEntries += value
  } else if (value < 0) {
    const abs = Math.abs(value)
    if (field === 'caixa') totals.caixaExits += abs
    else if (field === 'account') totals.accountExits += abs
    else totals.sharedExits += abs
  }
}

function itemColumnAmounts(row: AccountPeriodItem): { valor: number; caixa: number; account: number; shared: number } {
  const amount = Number(row.amount)
  return {
    valor: amount,
    caixa: isCashItem(row) ? amount : 0,
    account: Number(row.amount_account ?? (isCashItem(row) ? amount : 0)),
    shared: Number(row.amount_shared ?? 0),
  }
}

function sumItemColumns(rows: AccountPeriodItem[]): ItemColumnTotals {
  return rows.reduce(
    (acc, row) => {
      const cols = itemColumnAmounts(row)
      acc.valor += cols.valor
      addSignedFlow(acc, 'caixa', cols.caixa)
      addSignedFlow(acc, 'account', cols.account)
      addSignedFlow(acc, 'shared', cols.shared)
      return acc
    },
    emptyColumnTotals(),
  )
}

function itemFlowAmount(row: AccountPeriodItem): number {
  const cols = itemColumnAmounts(row)
  if (cols.caixa !== 0) return cols.caixa
  const rest = cols.account + cols.shared
  if (rest !== 0) return rest
  return Number(row.amount) || 0
}

function splitItemsByFlow(items: AccountPeriodItem[]) {
  const receitas: AccountPeriodItem[] = []
  const despesas: AccountPeriodItem[] = []
  for (const item of items) {
    if (itemFlowAmount(item) >= 0) receitas.push(item)
    else despesas.push(item)
  }
  return { receitas, despesas }
}

function itemOccurredAt(item: AccountPeriodItem): Date | null {
  const raw = item.occurred_at || item.date
  if (!raw) return null
  return parseLocalDateTime(raw)
}

function findSharedClosure(
  group: PeriodItemGroup | null,
  closures: AccountPeriodSharedClosure[],
): AccountPeriodSharedClosure | null {
  if (!group || group.kind !== 'shared' || closures.length === 0) return null
  const partnerId = group.partner?.shared_partner_id
  if (partnerId != null) {
    const byPartner = closures.find((row) => row.shared_partner_id === partnerId)
    if (byPartner) return byPartner
  }
  const sharingIds = new Set(
    group.items
      .map((item) => item.expense_sharing_id)
      .filter((id): id is number => id != null),
  )
  return closures.find((row) => (
    row.expense_sharing_id != null && sharingIds.has(row.expense_sharing_id)
  )) ?? null
}

function splitDespesasBySharedCutoff(
  despesas: AccountPeriodItem[],
  cutoff: Date | null,
) {
  if (!cutoff) return { after: [] as AccountPeriodItem[], inPeriod: despesas }
  const after: AccountPeriodItem[] = []
  const inPeriod: AccountPeriodItem[] = []
  for (const item of despesas) {
    const when = itemOccurredAt(item)
    if (when && when.getTime() > cutoff.getTime()) after.push(item)
    else inPeriod.push(item)
  }
  return { after, inPeriod }
}

const SOURCE_ORDER: AccountPeriodItemSource[] = ['bank', 'card', 'benefit', 'settlement']

function itemSourceKey(item: AccountPeriodItem): AccountPeriodItemSource {
  return item.source === 'card' || item.source === 'benefit' || item.source === 'settlement'
    ? item.source
    : 'bank'
}

function groupItemsBySource(items: AccountPeriodItem[]) {
  return SOURCE_ORDER
    .map((source) => ({ source, items: items.filter((item) => itemSourceKey(item) === source) }))
    .filter((entry) => entry.items.length > 0)
}

function SourceLabel({ source }: { source: AccountPeriodItemSource }) {
  const meta = SOURCE_META[source]
  const Icon = meta.Icon
  return (
    <span className="inline-flex items-center gap-2">
      <Icon size={14} style={{ color: meta.color }} />
      {meta.groupLabel}
    </span>
  )
}

function flowCells(entries: number, exits: number, cellCls: string) {
  const result = entries - exits
  return (
    <>
      <td className={cellCls} style={moneyStyle(entries)}>{formatCurrency(entries)}</td>
      <td className={cellCls} style={moneyStyle(exits, true)}>{formatCurrency(exits)}</td>
      <td className={cellCls} style={moneyStyle(result)}>{formatCurrency(result)}</td>
    </>
  )
}

function GroupSourceSummaryTable({ group }: { group: PeriodItemGroup }) {
  const ownView = group.kind === 'own'
  const rows = groupItemsBySource(group.items).map((entry) => ({
    source: entry.source,
    totals: sumItemColumns(entry.items),
  }))
  const bodyCellCls = `${closureTableTdCls} text-right font-semibold tabular-nums`
  const footCellCls = 'px-3 py-2.5 text-right font-semibold tabular-nums'
  const flowHeaders = ['Entradas', 'Saídas', 'Resultado']
  const groupThCls = 'px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className={closureTableHeadCls}>
          {ownView ? (
            <tr>
              <th className={closureTableThLeftCls}>Tipo</th>
              {flowHeaders.map((label) => <th key={label} className={closureTableThRightCls}>{label}</th>)}
            </tr>
          ) : (
            <>
              <tr>
                <th rowSpan={2} className={`${closureTableThLeftCls} align-bottom`}>Tipo</th>
                <th colSpan={3} className={groupThCls}>
                  <span className="inline-flex items-center gap-1"><Landmark size={12} />Conta</span>
                </th>
                <th colSpan={3} className={groupThCls}>
                  <span className="inline-flex items-center gap-1"><Users size={12} />Compartilhado</span>
                </th>
              </tr>
              <tr>
                {[...flowHeaders, ...flowHeaders].map((label, index) => (
                  <th key={`${label}-${index}`} className={closureTableThRightCls}>{label}</th>
                ))}
              </tr>
            </>
          )}
        </thead>
        <tbody>
          {rows.map(({ source, totals }) => (
            <tr key={source}>
              <td className={`${closureTableTdCls} font-medium text-gray-700 dark:text-gray-200`}>
                <SourceLabel source={source} />
              </td>
              {flowCells(totals.accountEntries, totals.accountExits, bodyCellCls)}
              {!ownView && flowCells(totals.sharedEntries, totals.sharedExits, bodyCellCls)}
            </tr>
          ))}
        </tbody>
        <tfoot className={closureTableFootCls}>
          <tr>
            <td className="px-3 py-2.5 font-semibold text-gray-800 dark:text-gray-100">Total</td>
            {flowCells(group.totals.accountEntries, group.totals.accountExits, footCellCls)}
            {!ownView && flowCells(group.totals.sharedEntries, group.totals.sharedExits, footCellCls)}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function PeriodItemsBySource({
  items,
  ownView = false,
}: {
  items: AccountPeriodItem[]
  ownView?: boolean
}) {
  if (items.length === 0) {
    return <p className="px-3 py-4 text-center text-sm text-gray-500">Nenhum lançamento.</p>
  }
  return (
    <div className={`${cadastroSectionsStackCls} p-4 pt-1`}>
      {groupItemsBySource(items).map((entry) => (
        <div key={entry.source} className={listPageTableSectionCls}>
          <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-700 dark:border-gray-600 dark:bg-gray-800/40 dark:text-gray-200">
            <SourceLabel source={entry.source} />
            <span className="font-medium normal-case tracking-normal text-gray-500 dark:text-gray-400">
              {entry.items.length} lançamento{entry.items.length === 1 ? '' : 's'}
            </span>
          </div>
          <PeriodItemsFlowTable items={entry.items} ownView={ownView} />
        </div>
      ))}
    </div>
  )
}

function PeriodItemsFlowTable({
  items,
  ownView = false,
}: {
  items: AccountPeriodItem[]
  ownView?: boolean
}) {
  const [dateSort, setDateSort] = useState<DateSortDirection>('desc')
  const sortedItems = useMemo(
    () =>
      sortRowsByDate(
        items,
        (row) => row.date,
        dateSort,
        (left, right) =>
          String(left.id).localeCompare(String(right.id), undefined, { numeric: true }),
      ),
    [items, dateSort],
  )
  const totals = sumItemColumns(items)
  return (
    <ListPageTable
      framed={false}
      colsRest={
        <>
          <ListTableSpacerCol />
          <col style={{ width: 56, minWidth: 56 }} />
          <col style={{ width: 48, minWidth: 48 }} />
          <col style={{ width: 110, minWidth: 110 }} />
          <col />
          <col style={{ width: 128, minWidth: 128 }} />
          {!ownView && <col style={{ width: 128, minWidth: 128 }} />}
          {!ownView && <col style={{ width: 148, minWidth: 148 }} />}
        </>
      }
      head={
        <tr>
          <ListTableIndexHeader />
          <ListTableSpacerHeader />
          <ListTableStaticHeader label="Fonte" />
          <ListTableStaticHeader label="Emp." className="text-center" />
          <SortableDateHeader
            sortDirection={dateSort}
            onToggle={() => setDateSort((prev) => toggleDateSortDirection(prev))}
            className="px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300"
          />
          <ListTableStaticHeader label="Descrição" />
          <ListTableStaticHeader label="Valor" className="text-right" />
          {!ownView && <ListTableStaticHeader label="Conta" className="text-right" />}
          {!ownView && <ListTableStaticHeader label="Compartilhado" className="text-right" />}
        </tr>
      }
    >
      {sortedItems.map((row, index) => {
        const cols = itemColumnAmounts(row)
        return (
          <tr key={`${row.source ?? 'bank'}-${row.id}`} className={`${listPageTableRowHoverCls} [&>td]:border-b [&>td]:border-gray-200 dark:[&>td]:border-gray-700`}>
            <ListTableIndexCell index={index + 1} />
            <ListTableSpacerCell />
            <td className={listPageTableTdCls}>
              <ItemSourceSymbols item={row} />
            </td>
            <td
              className={`${listPageTableTdCls} text-center font-semibold lowercase text-gray-700 dark:text-gray-200`}
              title={row.kind === 'loan' ? 'Pagamento de empréstimo' : undefined}
            >
              {row.kind === 'loan' ? 'x' : ''}
            </td>
            <td className={`${listPageTableTdCls} whitespace-nowrap`}>{formatDateBR(row.date)}</td>
            <td className={listPageTableTdCls}>
              <span className="inline-flex items-center gap-1.5">
                {row.description || '—'}
                {cols.shared !== 0 ? (
                  <Users size={14} className="shrink-0 text-gray-400" aria-label="Compartilhado" />
                ) : null}
              </span>
            </td>
            {ownView ? (
              cols.account === cols.valor ? (
                <td
                  className={`${listPageTableTdCls} text-right font-semibold tabular-nums`}
                  style={moneyStyle(cols.valor)}
                >
                  {cols.valor === 0 ? <span className="text-gray-400">—</span> : formatCurrency(cols.valor)}
                </td>
              ) : (
                <td
                  className={`${listPageTableTdCls} text-right tabular-nums text-gray-400 line-through`}
                  title="Não entra no resultado da conta (substituído pelos itens do cartão)"
                >
                  {formatCurrency(cols.valor)}
                </td>
              )
            ) : (
              <>
                <td
                  className={`${listPageTableTdCls} text-right font-semibold tabular-nums`}
                  style={moneyStyle(cols.valor)}
                >
                  {cols.valor === 0 ? <span className="text-gray-400">—</span> : formatCurrency(cols.valor)}
                </td>
                <td
                  className={`${listPageTableTdCls} text-right font-semibold tabular-nums`}
                  style={moneyStyle(cols.account)}
                >
                  {cols.account === 0 ? <span className="text-gray-400">—</span> : formatCurrency(cols.account)}
                </td>
                <td
                  className={`${listPageTableTdCls} text-right font-semibold tabular-nums`}
                  style={moneyStyle(cols.shared)}
                >
                  {cols.shared === 0 ? <span className="text-gray-400">—</span> : formatCurrency(cols.shared)}
                </td>
              </>
            )}
          </tr>
        )
      })}
      <tr className={`${closureTableFootCls} [&>td]:border-t-2 [&>td]:border-gray-200 dark:[&>td]:border-gray-600`}>
        <td className={listPageTableTdCls} />
        <ListTableSpacerCell />
        <td className={`${listPageTableTdCls} font-semibold text-gray-800 dark:text-gray-100`} colSpan={4}>
          Total
        </td>
        {ownView ? (
          <td className={`${listPageTableTdCls} text-right font-semibold tabular-nums`} style={moneyStyle(totals.account)}>
            {formatCurrency(totals.account)}
          </td>
        ) : (
          <>
            <td className={`${listPageTableTdCls} text-right font-semibold tabular-nums`} style={moneyStyle(totals.valor)}>
              {formatCurrency(totals.valor)}
            </td>
            <td className={`${listPageTableTdCls} text-right font-semibold tabular-nums`} style={moneyStyle(totals.account)}>
              {formatCurrency(totals.account)}
            </td>
            <td className={`${listPageTableTdCls} text-right font-semibold tabular-nums`} style={moneyStyle(totals.shared)}>
              {formatCurrency(totals.shared)}
            </td>
          </>
        )}
      </tr>
    </ListPageTable>
  )
}

/** Compartilhado com 100% para a conta (0% parceiro) equivale a próprio. */
function isSharedItem(item: AccountPeriodItem) {
  if (item.source === 'settlement') return true
  if (Number(item.amount_shared ?? 0) !== 0) return true
  const hasSharingRef = Boolean(item.shared_partner_id || item.shared_partner_name || item.expense_sharing_id)
  if (!hasSharingRef) return false
  const minePct = item.ownership_percentage == null ? 100 : Number(item.ownership_percentage)
  return minePct < 100
}

function itemGroupKey(item: AccountPeriodItem) {
  if (!isSharedItem(item)) return 'own'
  if (item.shared_partner_id != null) return `partner:${item.shared_partner_id}`
  if (item.expense_sharing_id != null) return `sharing:${item.expense_sharing_id}`
  const name = (item.shared_partner_name || '').trim()
  return name ? `name:${name}` : 'shared:unknown'
}

type PeriodItemGroup = {
  key: string
  kind: 'shared' | 'own'
  partner: AccountPeriodSharedPartner | null
  items: AccountPeriodItem[]
  totals: ItemColumnTotals
}

function groupAccountLabel(group: PeriodItemGroup) {
  if (group.kind === 'own') return 'Conta própria'
  return group.partner?.shared_partner_name ?? 'Conta compartilhada'
}

function partnerFromItem(
  item: AccountPeriodItem,
  partners: AccountPeriodSharedPartner[],
): AccountPeriodSharedPartner {
  const byId = item.shared_partner_id != null
    ? partners.find((row) => row.shared_partner_id === item.shared_partner_id)
    : undefined
  if (byId) return byId
  const byName = item.shared_partner_name
    ? partners.find((row) => row.shared_partner_name === item.shared_partner_name)
    : undefined
  if (byName) return byName
  return {
    shared_partner_id: item.shared_partner_id ?? null,
    shared_partner_name: item.shared_partner_name || 'Conta compartilhada',
    shared_partner_bank: item.shared_partner_bank ?? null,
    shared_partner_agency: item.shared_partner_agency ?? null,
    shared_partner_account_number: item.shared_partner_account_number ?? null,
    entries: 0,
    exits: 0,
  }
}

function groupPeriodItems(
  items: AccountPeriodItem[],
  partners: AccountPeriodSharedPartner[],
): PeriodItemGroup[] {
  const buckets = new Map<string, PeriodItemGroup>()
  for (const item of items) {
    const key = itemGroupKey(item)
    const kind: 'shared' | 'own' = key === 'own' ? 'own' : 'shared'
    let group = buckets.get(key)
    if (!group) {
      group = {
        key,
        kind,
        partner: kind === 'shared' ? partnerFromItem(item, partners) : null,
        items: [],
        totals: emptyColumnTotals(),
      }
      buckets.set(key, group)
    }
    group.items.push(item)
  }
  for (const group of buckets.values()) {
    group.totals = sumItemColumns(group.items)
    group.items.sort(comparePeriodItems)
  }
  const shared = [...buckets.values()]
    .filter((group) => group.kind === 'shared')
    .sort((left, right) =>
      (left.partner?.shared_partner_name || '').localeCompare(right.partner?.shared_partner_name || '', 'pt-BR'),
    )
  const own = buckets.get('own')
  return own ? [own, ...shared] : shared
}

function OpenSharedNotice({
  message,
  onGoToShared,
}: {
  message: string
  onGoToShared: () => void
}) {
  return (
    <div className="mt-5 flex items-start gap-3 rounded-xl border border-[var(--color-warning)]/30 bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] p-3 first:mt-0">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-warning)]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 dark:text-white">
          Fechamento compartilhado em aberto
        </p>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{message}</p>
        <button
          type="button"
          onClick={onGoToShared}
          className="mt-2 text-sm font-semibold text-[var(--color-1)] hover:underline"
        >
          Ir para Fechamentos compartilhados
        </button>
      </div>
    </div>
  )
}

function UnmatchedCardWarning({ items }: { items: AccountPeriodItem[] }) {
  const visible = items.filter((item) => Boolean(item.date))
  if (visible.length === 0) return null
  return (
    <div className="mt-5 flex items-start gap-3 rounded-xl border border-[var(--color-warning)]/30 bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] p-3 first:mt-0">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-warning)]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 dark:text-white">
          Reconciliação sem itens de fatura
        </p>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Há vínculo de reconciliação, mas a fatura do ciclo não trouxe itens. O débito permanece no extrato.
        </p>
        <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-200">
          {visible.map((item) => (
            <li key={String(item.id)} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="truncate">
                {item.date ? `${formatDateBR(item.date)} · ` : ''}
                {item.description || 'Cartão'}
              </span>
              <span className="font-semibold tabular-nums" style={moneyStyle(Number(item.amount))}>
                {formatCurrency(Number(item.amount))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function AllocationMiniTable({
  rows,
  showSourceColumn = false,
}: {
  rows: AccountPeriodItem[]
  /** Coluna Fonte (extrato / benefício / etc.) — ex.: fechamento em lote com vários meses. */
  showSourceColumn?: boolean
}) {
  const [dateSort, setDateSort] = useState<DateSortDirection>('desc')
  const sortedRows = useMemo(
    () =>
      sortRowsByDate(
        rows,
        (row) => row.date,
        dateSort,
        (left, right) =>
          String(left.id).localeCompare(String(right.id), undefined, { numeric: true }),
      ),
    [rows, dateSort],
  )
  const accountTotal = rows.reduce((sum, row) => sum + Number(row.amount_account ?? 0), 0)
  const sharedTotal = rows.reduce((sum, row) => sum + Number(row.amount_shared ?? 0), 0)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className={closureTableHeadCls}>
          <tr>
            {showSourceColumn ? (
              <th className={`${closureTableThLeftCls} w-14`}>Fonte</th>
            ) : null}
            <SortableDateHeader
              sortDirection={dateSort}
              onToggle={() => setDateSort((prev) => toggleDateSortDirection(prev))}
              className={closureTableThLeftCls}
            />
            <th className={closureTableThLeftCls}>Descrição</th>
            <th className={closureTableThRightCls}>Conta</th>
            <th className={closureTableThRightCls}>Comp.</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const accountAmount = Number(row.amount_account ?? 0)
            const sharedAmount = Number(row.amount_shared ?? 0)
            return (
              <tr key={`${row.source ?? 'row'}-${row.id}`}>
                {showSourceColumn ? (
                  <td className={closureTableTdCls}>
                    <ItemSourceSymbols item={row} />
                  </td>
                ) : null}
                <td className={`${closureTableTdCls} whitespace-nowrap`}>{formatDateBR(row.date)}</td>
                <td className={closureTableTdCls}>{row.description || '—'}</td>
                <td className={`${closureTableTdCls} text-right font-semibold tabular-nums`} style={moneyStyle(accountAmount)}>
                  {accountAmount === 0 ? <span className="text-gray-400">—</span> : formatCurrency(accountAmount)}
                </td>
                <td className={`${closureTableTdCls} text-right font-semibold tabular-nums`} style={moneyStyle(sharedAmount)}>
                  {sharedAmount === 0 ? <span className="text-gray-400">—</span> : formatCurrency(sharedAmount)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className={closureTableFootCls}>
          <tr>
            <td
              className="px-3 py-2.5 font-semibold text-gray-800 dark:text-gray-100"
              colSpan={showSourceColumn ? 3 : 2}
            >
              Total
            </td>
            <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={moneyStyle(accountTotal)}>
              {accountTotal === 0 ? <span className="text-gray-400">—</span> : formatCurrency(accountTotal)}
            </td>
            <td className="px-3 py-2.5 text-right font-semibold tabular-nums" style={moneyStyle(sharedTotal)}>
              {sharedTotal === 0 ? <span className="text-gray-400">—</span> : formatCurrency(sharedTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

const SOURCE_META: Record<AccountPeriodItemSource, {
  Icon: typeof Landmark
  color: string
  label: string
  groupLabel: string
}> = {
  bank: { Icon: Landmark, color: 'var(--color-1)', label: 'Extrato Bancário', groupLabel: 'Conta corrente' },
  card: { Icon: CreditCard, color: 'var(--color-2)', label: 'Fatura de Cartão', groupLabel: 'Cartão de crédito' },
  benefit: { Icon: Gift, color: 'var(--color-3)', label: 'Benefício', groupLabel: 'Cartão benefício' },
  settlement: { Icon: Scale, color: 'var(--color-4)', label: 'Acerto compartilhado', groupLabel: 'Acerto compartilhado' },
}

const ItemSourceSymbols = ({ item }: { item: AccountPeriodItem }) => {
  const source = itemSourceKey(item)
  const meta = SOURCE_META[source]
  const Icon = meta.Icon
  return (
    <div className="flex items-center gap-1">
      <Icon className="inline" style={{ color: meta.color }} size={20} aria-label={meta.label} />
      {item.migrated_from_account_id ? (
        <ArrowLeftRight
          size={16}
          className="text-cyan-600 dark:text-cyan-400"
          aria-label="Item invertido de outra conta"
        />
      ) : null}
      {source === 'bank' && item.is_manual && !item.migrated_from_account_id ? (
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white shadow-sm"
          title="Lançamento Manual"
        >
          M
        </span>
      ) : null}
    </div>
  )
}

const previousPeriod = (year: number, month: number) => (
  month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
)

const sortMonths = (items: AccountPeriodMonth[]) =>
  [...items].sort((left, right) => left.year - right.year || left.month - right.month)

const sortMonthsDesc = (items: AccountPeriodMonth[]) =>
  [...items].sort((left, right) => right.year - left.year || right.month - left.month)

function collectPeriodItems(month: AccountPeriodMonth): AccountPeriodItem[] {
  return [
    ...(month.items ?? []),
    ...(month.card_items ?? []),
    ...(month.benefit_items ?? []),
    ...(month.shared_settlements ?? []),
  ]
}

function groupItemsForMonth(month: AccountPeriodMonth, groupKey: string): AccountPeriodItem[] {
  const groups = groupPeriodItems(collectPeriodItems(month), month.shared_by_account ?? [])
  return groups.find((group) => group.key === groupKey)?.items ?? []
}

function bulkCloseGroupsForMonths(months: AccountPeriodMonth[]): PeriodItemGroup[] {
  const allItems: AccountPeriodItem[] = []
  for (const month of months) {
    allItems.push(...collectPeriodItems(month))
  }
  return groupPeriodItems(allItems, mergeSharedByAccount(months))
}

function bulkCloseMonthFlowTotals(
  month: AccountPeriodMonth,
  groupKey: string,
  flow: 'receitas' | 'despesas',
): ItemColumnTotals {
  const { receitas, despesas } = splitItemsByFlow(groupItemsForMonth(month, groupKey))
  return sumItemColumns(flow === 'receitas' ? receitas : despesas)
}

function BulkCloseMonthlyFlowTable({
  months,
  groupKey,
  flow,
  ownView,
}: {
  months: AccountPeriodMonth[]
  groupKey: string
  flow: 'receitas' | 'despesas'
  ownView: boolean
}) {
  const sorted = sortMonths(months)
  const rows = sorted.map((month) => ({
    month,
    totals: bulkCloseMonthFlowTotals(month, groupKey, flow),
  }))
  const yearTotals = rows.reduce(
    (acc, row) => {
      acc.accountEntries += row.totals.accountEntries
      acc.accountExits += row.totals.accountExits
      acc.sharedEntries += row.totals.sharedEntries
      acc.sharedExits += row.totals.sharedExits
      return acc
    },
    emptyColumnTotals(),
  )
  const hasAny = rows.some(
    (row) =>
      row.totals.accountEntries !== 0
      || row.totals.accountExits !== 0
      || row.totals.sharedEntries !== 0
      || row.totals.sharedExits !== 0,
  )
  if (!hasAny) {
    return <p className="px-3 py-4 text-center text-sm text-gray-500">Nenhum lançamento.</p>
  }
  const bodyCellCls = `${closureTableTdCls} text-right font-semibold tabular-nums`
  const footCellCls = 'px-3 py-2.5 text-right font-semibold tabular-nums'
  const flowHeaders = ['Entradas', 'Saídas', 'Resultado']
  const groupThCls =
    'px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
  const dash = <span className="text-gray-400">—</span>
  const flowCell = (entries: number, exits: number, cls: string) => {
    if (entries === 0 && exits === 0) {
      return (
        <>
          <td className={cls}>{dash}</td>
          <td className={cls}>{dash}</td>
          <td className={cls}>{dash}</td>
        </>
      )
    }
    return flowCells(entries, exits, cls)
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className={closureTableHeadCls}>
          {ownView ? (
            <tr>
              <th className={closureTableThLeftCls}>Mês</th>
              {flowHeaders.map((label) => (
                <th key={label} className={closureTableThRightCls}>
                  {label}
                </th>
              ))}
            </tr>
          ) : (
            <>
              <tr>
                <th rowSpan={2} className={`${closureTableThLeftCls} align-bottom`}>
                  Mês
                </th>
                <th colSpan={3} className={groupThCls}>
                  <span className="inline-flex items-center gap-1">
                    <Landmark size={12} />
                    Conta
                  </span>
                </th>
                <th colSpan={3} className={groupThCls}>
                  <span className="inline-flex items-center gap-1">
                    <Users size={12} />
                    Compartilhado
                  </span>
                </th>
              </tr>
              <tr>
                {[...flowHeaders, ...flowHeaders].map((label, index) => (
                  <th key={`${label}-${index}`} className={closureTableThRightCls}>
                    {label}
                  </th>
                ))}
              </tr>
            </>
          )}
        </thead>
        <tbody>
          {rows.map(({ month, totals }) => (
            <tr key={monthKey(month)}>
              <td className={`${closureTableTdCls} font-medium text-gray-800 dark:text-gray-100`}>
                {MONTH_LABELS[month.month - 1]}
              </td>
              {flowCell(totals.accountEntries, totals.accountExits, bodyCellCls)}
              {!ownView && flowCell(totals.sharedEntries, totals.sharedExits, bodyCellCls)}
            </tr>
          ))}
        </tbody>
        <tfoot className={closureTableFootCls}>
          <tr>
            <td className="px-3 py-2.5 font-semibold text-gray-800 dark:text-gray-100">Total</td>
            {flowCell(yearTotals.accountEntries, yearTotals.accountExits, footCellCls)}
            {!ownView && flowCell(yearTotals.sharedEntries, yearTotals.sharedExits, footCellCls)}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function BulkCloseYearDetail({
  monthsInYear,
  activeGroupKey,
  onSelectGroup,
}: {
  monthsInYear: AccountPeriodMonth[]
  activeGroupKey: string
  onSelectGroup: (key: string) => void
}) {
  const groups = useMemo(() => bulkCloseGroupsForMonths(monthsInYear), [monthsInYear])
  const activeGroup = groups.find((group) => group.key === activeGroupKey) ?? groups[0] ?? null
  const ownView = activeGroup?.kind === 'own'

  if (groups.length === 0) {
    return (
      <p className="rounded-xl border border-gray-200 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700">
        Nenhum lançamento nos meses selecionados deste ano.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      <CadastroListPageTabs
        tabs={groups.map((group) => ({
          key: group.key,
          label: groupAccountLabel(group),
          icon: group.kind === 'own' ? <Landmark size={14} /> : <Users size={14} />,
          count: group.items.length,
        }))}
        active={activeGroup?.key ?? groups[0].key}
        onChange={onSelectGroup}
      />
      {activeGroup ? (
        <>
          <CadastroFormSection title="Receitas" icon={<ArrowUpCircle size={14} />} bodyClassName="p-0">
            <BulkCloseMonthlyFlowTable
              months={monthsInYear}
              groupKey={activeGroup.key}
              flow="receitas"
              ownView={ownView}
            />
          </CadastroFormSection>
          <CadastroFormSection title="Despesas" icon={<ArrowDownCircle size={14} />} bodyClassName="p-0">
            <BulkCloseMonthlyFlowTable
              months={monthsInYear}
              groupKey={activeGroup.key}
              flow="despesas"
              ownView={ownView}
            />
          </CadastroFormSection>
        </>
      ) : null}
    </div>
  )
}

function groupModalMonthsByYear(months: AccountPeriodMonth[]) {
  const grouped: Record<string, AccountPeriodMonth[]> = {}
  for (const month of sortMonths(months)) {
    const year = String(month.year)
    if (!grouped[year]) grouped[year] = []
    grouped[year].push(month)
  }
  return {
    sortedYears: Object.keys(grouped).sort(),
    groupedByYear: grouped,
  }
}

function BulkCloseYearTabs({
  months,
  activeYear,
  onSelectYear,
}: {
  months: AccountPeriodMonth[]
  activeYear: string
  onSelectYear: (year: string) => void
}) {
  const { sortedYears, groupedByYear } = useMemo(() => groupModalMonthsByYear(months), [months])

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
        <Calendar size={16} style={{ color: 'var(--color-1)' }} aria-hidden />
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Detalhe por ano</span>
      </div>
      <div className="flex overflow-x-auto px-2">
        {sortedYears.map((year) => {
          const yearMonths = groupedByYear[year] ?? []
          const isActive = activeYear === year
          return (
            <button
              key={year}
              type="button"
              onClick={() => onSelectYear(year)}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-all ${
                isActive
                  ? 'border-[var(--color-1)] text-[var(--color-1)]'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-300'
              }`}
            >
              {year}
              <Badge
                variant="tab"
                tone="brand1"
                className={
                  isActive
                    ? 'bg-[var(--color-1)] text-[var(--on-color-1)]'
                    : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                }
                label={String(yearMonths.length)}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

const yearMonthLabel = (yearMonth: string) => {
  const month = Number(yearMonth.slice(5, 7))
  const year = yearMonth.slice(0, 4)
  return `${MONTH_LABELS[month - 1]} ${year}`
}

const advanceYearMonth = (year: number, month: number) =>
  month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }

type BulkSelectionResolve =
  | { kind: 'invalid'; message: string }
  | { kind: 'full'; months: AccountPeriodMonth[] }
  | { kind: 'partial'; months: AccountPeriodMonth[]; skipped: AccountPeriodMonth[] }

/** Maior sequência consecutiva a partir do próximo mês fechável. */
const resolveCloseBulkSelection = (
  selected: AccountPeriodMonth[],
  nextCloseable: string | null,
): BulkSelectionResolve => {
  if (selected.length === 0) {
    return { kind: 'invalid', message: 'Selecione pelo menos um mês' }
  }
  if (selected.some((item) => item.status === 'current')) {
    return { kind: 'invalid', message: 'Não é possível fechar o mês corrente' }
  }
  if (!nextCloseable) {
    return { kind: 'invalid', message: 'Não há mês disponível para fechar' }
  }

  const selectedByKey = new Map(selected.map((item) => [monthKey(item), item]))
  const run: AccountPeriodMonth[] = []
  let cursor = nextCloseable
  while (selectedByKey.has(cursor)) {
    const item = selectedByKey.get(cursor)!
    run.push(item)
    cursor = monthKey(advanceYearMonth(item.year, item.month))
  }

  if (run.length === 0) {
    return {
      kind: 'invalid',
      message: `A seleção precisa incluir ${yearMonthLabel(nextCloseable)}, o próximo mês a fechar`,
    }
  }

  const runKeys = new Set(run.map((item) => monthKey(item)))
  const skipped = sortMonths(selected.filter((item) => !runKeys.has(monthKey(item))))
  if (skipped.length === 0) return { kind: 'full', months: run }
  return { kind: 'partial', months: run, skipped }
}

/** Maior sequência consecutiva terminando no último mês fechado (reabertura do recente ao antigo). */
const resolveReopenBulkSelection = (
  selected: AccountPeriodMonth[],
  lastClosedYearMonth: string | null,
): BulkSelectionResolve => {
  if (selected.length === 0) {
    return { kind: 'invalid', message: 'Selecione pelo menos um mês' }
  }
  if (!lastClosedYearMonth) {
    return { kind: 'invalid', message: 'Não há mês fechado para reabrir' }
  }

  const selectedByKey = new Map(selected.map((item) => [monthKey(item), item]))
  const runNewestFirst: AccountPeriodMonth[] = []
  let cursor = lastClosedYearMonth
  while (selectedByKey.has(cursor)) {
    const item = selectedByKey.get(cursor)!
    if (!item.id) {
      return {
        kind: 'invalid',
        message: 'Um ou mais meses selecionados não possuem fechamento registrado',
      }
    }
    runNewestFirst.push(item)
    cursor = monthKey(previousPeriod(item.year, item.month))
  }

  if (runNewestFirst.length === 0) {
    return {
      kind: 'invalid',
      message: `A seleção precisa incluir o último mês fechado (${yearMonthLabel(lastClosedYearMonth)})`,
    }
  }

  const run = sortMonths(runNewestFirst)
  const runKeys = new Set(run.map((item) => monthKey(item)))
  const skipped = sortMonths(selected.filter((item) => !runKeys.has(monthKey(item))))
  if (skipped.length === 0) return { kind: 'full', months: run }
  return { kind: 'partial', months: run, skipped }
}

const AccountClosuresPage = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { ConfirmComponent, isConfirmOpen } = useConfirm()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const activeTab: ClosureTab = location.pathname.endsWith('/fechados') ? 'closed' : 'open'

  const [draftYears, setDraftYears] = useState<number[]>([])
  /** null = ainda não aplicado; [] = todos os anos. */
  const [appliedYears, setAppliedYears] = useState<number[] | null>(null)
  const [filtersApplied, setFiltersApplied] = useState(false)
  const [filterOptions, setFilterOptions] = useState<AccountPeriodFilterOptions | null>(null)
  const [filtersLoading, setFiltersLoading] = useState(true)
  const [series, setSeries] = useState<AccountPeriodYearResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })
  const exportRunner = useExportRunner((message) => setToast({ show: true, message, type: 'error' }))
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [modalMonths, setModalMonths] = useState<AccountPeriodMonth[] | null>(null)
  const [bulkCloseActiveYear, setBulkCloseActiveYear] = useState<string | null>(null)
  const [bulkCloseGroupTab, setBulkCloseGroupTab] = useState('own')
  const [modalLoading, setModalLoading] = useState(false)
  const [adjustmentCents, setAdjustmentCents] = useState('')
  const [adjustmentNegative, setAdjustmentNegative] = useState(false)
  const [notes, setNotes] = useState('')
  const [itemsMonth, setItemsMonth] = useState<AccountPeriodMonth | null>(null)
  const [itemsPreview, setItemsPreview] = useState<AccountPeriodMonth | null>(null)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [itemsViewTab, setItemsViewTab] = useState('geral')
  const [reopenModalMonths, setReopenModalMonths] = useState<AccountPeriodMonth[] | null>(null)
  const [reopenDeleteAdjustments, setReopenDeleteAdjustments] = useState(true)
  const [partialBulkPrompt, setPartialBulkPrompt] = useState<{
    action: 'close' | 'reopen'
    included: AccountPeriodMonth[]
    excluded: AccountPeriodMonth[]
  } | null>(null)

  const yearOptions = useMemo(() => {
    const years = filterOptions?.years?.length
      ? filterOptions.years
      : (series?.years ?? [])
    return [...years].sort((left, right) => right - left)
  }, [filterOptions?.years, series?.years])

  const openMonths = useMemo(
    () => (series?.months ?? []).filter((item) => (
      item.status === 'can_close' || item.status === 'blocked' || item.status === 'pending_shared' || item.status === 'current'
    )),
    [series],
  )
  const selectableMonths = useMemo(
    () => openMonths.filter((item) => item.status !== 'current'),
    [openMonths],
  )
  const closedMonths = useMemo(
    () => (series?.months ?? []).filter((item) => item.is_closed),
    [series],
  )
  const visibleMonths = useMemo(
    () => (activeTab === 'open' ? sortMonths(openMonths) : sortMonthsDesc(closedMonths)),
    [activeTab, openMonths, closedMonths],
  )

  const selectedMonths = useMemo(
    () => openMonths.filter((item) => selectedKeys.has(monthKey(item))),
    [openMonths, selectedKeys],
  )

  const selectedClosedMonths = useMemo(
    () => closedMonths.filter((item) => selectedKeys.has(monthKey(item))),
    [closedMonths, selectedKeys],
  )

  const reopenableChain = useMemo(() => {
    const lastClosed = series?.last_closed_year_month ?? filterOptions?.last_closed_year_month
    if (!lastClosed) return [] as AccountPeriodMonth[]
    const byKey = new Map(closedMonths.map((item) => [monthKey(item), item]))
    const chain: AccountPeriodMonth[] = []
    let cursor = lastClosed
    while (byKey.has(cursor)) {
      const item = byKey.get(cursor)!
      chain.push(item)
      const prev = previousPeriod(item.year, item.month)
      cursor = monthKey(prev)
    }
    return chain
  }, [closedMonths, series?.last_closed_year_month, filterOptions?.last_closed_year_month])

  const selectableClosedMonths = useMemo(
    () => reopenableChain.filter((item) => item.id),
    [reopenableChain],
  )

  const selectAllState = useMemo(() => {
    if (selectableMonths.length === 0) return 'none' as const
    const selectedCount = selectableMonths.filter((item) => selectedKeys.has(monthKey(item))).length
    if (selectedCount === 0) return 'none' as const
    if (selectedCount === selectableMonths.length) return 'all' as const
    return 'partial' as const
  }, [selectableMonths, selectedKeys])

  const closedSelectAllState = useMemo(() => {
    if (selectableClosedMonths.length === 0) return 'none' as const
    const selectedCount = selectableClosedMonths.filter((item) => selectedKeys.has(monthKey(item))).length
    if (selectedCount === 0) return 'none' as const
    if (selectedCount === selectableClosedMonths.length) return 'all' as const
    return 'partial' as const
  }, [selectableClosedMonths, selectedKeys])

  const loadOptions = useCallback(async () => {
    setFiltersLoading(true)
    try {
      const data = await listAccountPeriodClosureOptions()
      setFilterOptions(data)
    } catch (err) {
      setError(apiErrorMessage(err, 'Não foi possível carregar os filtros.'))
    } finally {
      setFiltersLoading(false)
    }
  }, [])

  const loadYears = useCallback(async (years: number[]) => {
    setLoading(true)
    setError(null)
    try {
      const data = years.length === 1
        ? await listAccountPeriodClosures(years[0])
        : await listAccountPeriodClosures(null, true)
      if (years.length > 1) {
        const wanted = new Set(years)
        data.months = data.months.filter((item) => wanted.has(item.year))
      }
      setSeries(data)
      setAppliedYears(years)
      setFiltersApplied(true)
      setSelectedKeys(new Set())
    } catch (err) {
      setError(apiErrorMessage(err, 'Não foi possível carregar os fechamentos da conta.'))
      setSeries(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const reloadApplied = useCallback(async () => {
    if (appliedYears == null) return
    await loadYears(appliedYears)
  }, [appliedYears, loadYears])

  useEffect(() => {
    void loadOptions()
  }, [loadOptions])

  useEffect(() => {
    if (filtersLoading || filtersApplied || !filterOptions) return
    void loadYears([])
  }, [filtersLoading, filterOptions, filtersApplied, loadYears])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const handleScroll = () => setShowBackToTop(container.scrollTop > 300)
    handleScroll()
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [loading, activeTab, visibleMonths.length])

  const handleTabChange = (tab: ClosureTab) => {
    setSelectedKeys(new Set())
    navigate(tab === 'closed' ? '/fechamentos/conta/fechados' : '/fechamentos/conta')
  }

  const [exportTarget, setExportTarget] = useState<AccountPeriodMonth | null>(null)

  const handleExportClosure = async (format: 'excel' | 'pdf', absoluteValues: boolean) => {
    if (!exportTarget) return
    // Mesmo conteúdo do modal "Visualizar": busca o preview completo do período.
    let preview: AccountPeriodMonth
    try {
      preview = await previewAccountPeriod(exportTarget.year, exportTarget.month)
    } catch (err) {
      setToast({
        show: true,
        message: apiErrorMessage(err, 'Não foi possível carregar os lançamentos para exportar.'),
        type: 'error',
      })
      return
    }
    const buildRow = (item: AccountPeriodMonth): AccountClosureExportRow => {
      const split = splitOf(item)
      return {
        year: item.year,
        month: item.month,
        monthLabel: MONTH_LABELS[item.month - 1],
        statusLabel: statusLabel[item.status],
        itemCount: item.item_count ?? 0,
        openingBalance: hasOfficialOpening(item) ? item.opening_balance : 0,
        entries: item.entries,
        entriesAccount: split.account.entries,
        entriesShared: split.shared.entries,
        exits: item.exits,
        exitsAccount: split.account.exits,
        exitsShared: split.shared.exits,
        closingBalance: item.closing_balance,
        adjustment: item.adjustment_amount || null,
        closedAt: item.closed_at ?? null,
      }
    }
    const source: AccountPeriodMonth = {
      ...preview,
      status: exportTarget.status,
      closed_at: preview.closed_at ?? exportTarget.closed_at,
      adjustment_amount: preview.adjustment_amount ?? exportTarget.adjustment_amount,
      item_count: preview.item_count ?? exportTarget.item_count,
    }
    const allItems = [
      ...(preview.items ?? []),
      ...(preview.card_items ?? []),
      ...(preview.benefit_items ?? []),
      ...(preview.shared_settlements ?? []),
    ].sort(comparePeriodItems)
    const toDetailItem = (row: AccountPeriodItem): ClosureDetailItem => {
      const cols = itemColumnAmounts(row)
      return {
        date: row.date,
        description: row.description,
        sourceLabel: SOURCE_META[itemSourceKey(row)].label,
        amount: cols.valor,
        amountAccount: cols.account,
        amountShared: cols.shared,
      }
    }
    const detail: AccountClosureDetail = {
      summary: buildRow(source),
      partners: mergeSharedByAccount([preview]).map((p) => ({
        name: p.shared_partner_name,
        entries: Number(p.entries),
        exits: Number(p.exits),
      })),
      groups: groupPeriodItems(allItems, preview.shared_by_account ?? []).map((group) => {
        const flows = splitItemsByFlow(group.items)
        return {
          label: groupAccountLabel(group),
          receitas: flows.receitas.map(toDetailItem),
          despesas: flows.despesas.map(toDetailItem),
        }
      }),
    }
    if (format === 'excel') await exportAccountClosureDetailToExcel(detail, absoluteValues)
    else await exportAccountClosureDetailToPdf(detail, absoluteValues)
  }

  const hasActiveFilters = draftYears.length > 0

  const applyFilters = () => {
    void loadYears([...draftYears].sort((a, b) => a - b))
  }

  const clearFilters = () => {
    setDraftYears([])
  }

  const lastClosedYearMonth = series?.last_closed_year_month ?? filterOptions?.last_closed_year_month
  const lastClosedHint = lastClosedYearMonth
    ? `Último fechado: ${MONTH_LABELS[Number(lastClosedYearMonth.slice(5, 7)) - 1]} ${lastClosedYearMonth.slice(0, 4)}`
    : 'Nenhum mês fechado ainda'

  const toggleSelect = (key: string) => {
    if (activeTab === 'open') {
      if (openMonths.some((item) => monthKey(item) === key && item.status === 'current')) return
    } else if (!closedMonths.some((item) => monthKey(item) === key && item.id)) {
      return
    }
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (activeTab === 'closed') {
      if (closedSelectAllState === 'all') {
        setSelectedKeys(new Set())
        return
      }
      setSelectedKeys(new Set(selectableClosedMonths.map((item) => monthKey(item))))
      return
    }
    if (selectAllState === 'all') {
      setSelectedKeys(new Set())
      return
    }
    setSelectedKeys(new Set(selectableMonths.map((item) => monthKey(item))))
  }

  const scrollToTop = () => {
    setShowBackToTop(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const startCloseModal = (ordered: AccountPeriodMonth[]) => {
    const first = ordered[0]
    if (ordered.length === 1 && !first.can_close) {
      const previous = previousPeriod(first.year, first.month)
      setToast({
        show: true,
        message: first.block_reason || `Feche ${monthTitle(previous)} antes de fechar ${monthTitle(first)}.`,
        type: 'error',
      })
      return
    }
    setModalMonths(ordered)
    setBulkCloseActiveYear(
      ordered.length > 1 ? String(sortMonths(ordered)[0]?.year ?? '') || null : null,
    )
    setBulkCloseGroupTab('own')
    setAdjustmentCents('')
    setAdjustmentNegative(false)
    setNotes('')
    setModalLoading(true)
    void (async () => {
      try {
        const previews = await Promise.all(
          ordered.map((item) => previewAccountPeriod(item.year, item.month)),
        )
        setModalMonths(previews)
      } catch (err) {
        setToast({
          show: true,
          message: apiErrorMessage(err, 'Não foi possível carregar a repartição Conta / Compartilhado.'),
          type: 'error',
        })
      } finally {
        setModalLoading(false)
      }
    })()
  }

  const openCloseModal = (months: AccountPeriodMonth[]) => {
    const resolved = resolveCloseBulkSelection(months, series?.next_closeable_year_month ?? null)
    if (resolved.kind === 'invalid') {
      setToast({ show: true, message: resolved.message, type: 'error' })
      return
    }
    if (resolved.kind === 'partial') {
      setPartialBulkPrompt({ action: 'close', included: resolved.months, excluded: resolved.skipped })
      return
    }
    startCloseModal(resolved.months)
  }

  const closeModal = () => {
    if (saving) return
    setModalMonths(null)
    setBulkCloseActiveYear(null)
    setBulkCloseGroupTab('own')
    setModalLoading(false)
    setAdjustmentCents('')
    setAdjustmentNegative(false)
    setNotes('')
  }

  const bulkCloseGroupedByYear = useMemo(
    () => (modalMonths?.length ? groupModalMonthsByYear(modalMonths) : null),
    [modalMonths],
  )

  useEffect(() => {
    if (!modalMonths?.length || !bulkCloseGroupedByYear) {
      setBulkCloseActiveYear(null)
      setBulkCloseGroupTab('own')
      return
    }
    const { sortedYears } = bulkCloseGroupedByYear
    setBulkCloseActiveYear((prev) => (prev && sortedYears.includes(prev) ? prev : sortedYears[0] ?? null))
  }, [modalMonths, bulkCloseGroupedByYear])

  const bulkCloseMonthsInActiveYear = useMemo(() => {
    if (!bulkCloseGroupedByYear || !bulkCloseActiveYear) return []
    return bulkCloseGroupedByYear.groupedByYear[bulkCloseActiveYear] ?? []
  }, [bulkCloseGroupedByYear, bulkCloseActiveYear])

  useEffect(() => {
    if (bulkCloseMonthsInActiveYear.length === 0) return
    const groups = bulkCloseGroupsForMonths(bulkCloseMonthsInActiveYear)
    if (groups.length === 0) return
    setBulkCloseGroupTab((prev) => (groups.some((group) => group.key === prev) ? prev : groups[0].key))
  }, [bulkCloseMonthsInActiveYear])

  const closeItemsModal = () => {
    setItemsMonth(null)
    setItemsPreview(null)
    setItemsError(null)
    setItemsLoading(false)
    setItemsViewTab('geral')
  }

  const openItemsModal = async (item: AccountPeriodMonth) => {
    setItemsMonth(item)
    setItemsPreview(null)
    setItemsError(null)
    setItemsLoading(true)
    setItemsViewTab('geral')
    try {
      const data = await previewAccountPeriod(item.year, item.month)
      setItemsPreview(data)
    } catch (err) {
      setItemsError(apiErrorMessage(err, 'Não foi possível carregar os lançamentos.'))
    } finally {
      setItemsLoading(false)
    }
  }

  const handleConfirmClose = async () => {
    if (!modalMonths?.length) return
    setSaving(true)
    setError(null)
    const amount = amountFromCents(adjustmentCents, adjustmentNegative)
    const payloadNotes = notes.trim() || undefined
    try {
      if (modalMonths.length === 1) {
        const target = modalMonths[0]
        await closeAccountPeriod({
          year: target.year,
          month: target.month,
          adjustment: amount || undefined,
          notes: payloadNotes,
        })
        setToast({
          show: true,
          message: `${monthTitle(target)} foi fechado.`,
          type: 'success',
        })
      } else {
        const ordered = sortMonths(modalMonths)
        await bulkCloseAccountPeriods({
          months: ordered.map((item) => ({ year: item.year, month: item.month })),
          adjustment: amount || undefined,
          notes: payloadNotes,
        })
        setToast({
          show: true,
          message: `${modalMonths.length} meses foram fechados.`,
          type: 'success',
        })
      }
      setModalMonths(null)
      await reloadApplied()
    } catch (err) {
      setToast({
        show: true,
        message: apiErrorMessage(err, 'Não foi possível fechar o período.'),
        type: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  const startReopenModal = (ordered: AccountPeriodMonth[]) => {
    setReopenDeleteAdjustments(true)
    setReopenModalMonths(ordered)
  }

  const openReopenModal = (months: AccountPeriodMonth[]) => {
    const resolved = resolveReopenBulkSelection(months, lastClosedYearMonth ?? null)
    if (resolved.kind === 'invalid') {
      setToast({ show: true, message: resolved.message, type: 'error' })
      return
    }
    if (resolved.kind === 'partial') {
      setPartialBulkPrompt({ action: 'reopen', included: resolved.months, excluded: resolved.skipped })
      return
    }
    startReopenModal(resolved.months)
  }

  const cancelPartialBulkPrompt = () => {
    setPartialBulkPrompt(null)
  }

  const confirmPartialBulkPrompt = () => {
    if (!partialBulkPrompt) return
    const { action, included } = partialBulkPrompt
    setPartialBulkPrompt(null)
    if (action === 'close') startCloseModal(included)
    else startReopenModal(included)
  }

  const closeReopenModal = () => {
    if (saving) return
    setReopenModalMonths(null)
    setReopenDeleteAdjustments(true)
  }

  const confirmReopen = async () => {
    if (!reopenModalMonths?.length) return
    const ordered = sortMonthsDesc(reopenModalMonths)
    setSaving(true)
    try {
      for (const item of ordered) {
        if (!item.id) continue
        await reopenAccountPeriod(item.id, { deleteAdjustment: reopenDeleteAdjustments })
      }
      const label = reopenModalMonths.length === 1
        ? monthTitle(reopenModalMonths[0])
        : `${reopenModalMonths.length} meses`
      setToast({ show: true, message: `${label} reaberto(s).`, type: 'success' })
      setReopenModalMonths(null)
      setSelectedKeys(new Set())
      await reloadApplied()
    } catch (err) {
      setToast({
        show: true,
        message: apiErrorMessage(err, 'Não foi possível reabrir o período.'),
        type: 'error',
      })
      await reloadApplied()
    } finally {
      setSaving(false)
    }
  }

  const handleReopen = (item: AccountPeriodMonth) => {
    if (!item.id || !item.can_reopen) return
    openReopenModal([item])
  }

  useEscapeKey(closeItemsModal, itemsMonth != null && !isConfirmOpen)
  useEscapeKey(closeModal, modalMonths != null && itemsMonth == null && !isConfirmOpen)
  useEscapeKey(
    closeReopenModal,
    reopenModalMonths != null && modalMonths == null && itemsMonth == null && !isConfirmOpen,
  )
  useEscapeKey(
    cancelPartialBulkPrompt,
    partialBulkPrompt != null && modalMonths == null && reopenModalMonths == null && itemsMonth == null && !isConfirmOpen,
  )

  const newestModalMonth = useMemo(() => {
    if (!modalMonths?.length) return null
    const sorted = sortMonths(modalMonths)
    return sorted[sorted.length - 1] ?? null
  }, [modalMonths])
  const adjustmentValue = amountFromCents(adjustmentCents, adjustmentNegative)
  const projectedClosing = newestModalMonth
    ? Number(newestModalMonth.closing_balance) + adjustmentValue
    : 0
  const footerVisible = selectedKeys.size > 0 || showBackToTop
  const reopenModalHasAdjustments = reopenModalMonths?.some(
    (item) => item.adjustment_amount != null && Number(item.adjustment_amount) !== 0,
  )

  const moneyCell = (value: number, invert = false) => (
    <span className="font-semibold tabular-nums" style={moneyStyle(value, invert)}>
      {formatCurrency(value)}
    </span>
  )

  const openingCell = (item: AccountPeriodMonth) => (
    hasOfficialOpening(item)
      ? moneyCell(item.opening_balance)
      : <span className="text-gray-400">—</span>
  )

  const openingSource = itemsPreview ?? itemsMonth
  const items = useMemo(
    () => [
      ...(itemsPreview?.items ?? []),
      ...(itemsPreview?.card_items ?? []),
      ...(itemsPreview?.benefit_items ?? []),
      ...(itemsPreview?.shared_settlements ?? []),
    ]
      .sort(comparePeriodItems),
    [itemsPreview],
  )
  const itemGroups = useMemo(
    () => groupPeriodItems(items, openingSource?.shared_by_account ?? []),
    [items, openingSource?.shared_by_account],
  )
  const activeItemGroup = itemsViewTab === 'geral'
    ? null
    : itemGroups.find((group) => group.key === itemsViewTab) ?? null
  const activeItemFlows = splitItemsByFlow(activeItemGroup?.items ?? [])
  const activeSharedClosure = findSharedClosure(
    activeItemGroup,
    openingSource?.shared_closures ?? [],
  )
  const sharedCutoff = activeSharedClosure?.closing_date
    ? parseLocalDateTime(activeSharedClosure.closing_date)
    : null
  const activeDespesasSplit = splitDespesasBySharedCutoff(activeItemFlows.despesas, sharedCutoff)
  const showAfterDespesas = Boolean(
    sharedCutoff && activeSharedClosure && activeDespesasSplit.after.length > 0,
  )
  const itemsHeaderSubtitle = (() => {
    if (!itemsPreview) return 'Extrato do período'
    if (activeSharedClosure?.period_start_date && activeSharedClosure.closing_date) {
      return `${items.length} lançamento${items.length === 1 ? '' : 's'} · ${formatDateTimeBR(activeSharedClosure.period_start_date)} a ${formatDateTimeBR(activeSharedClosure.closing_date)}`
    }
    return `${items.length} lançamento${items.length === 1 ? '' : 's'} · caixa do extrato`
  })()
  const previousOpeningPeriod = itemsMonth
    ? previousPeriod(itemsMonth.year, itemsMonth.month)
    : null

  useEffect(() => {
    if (itemsViewTab === 'geral') return
    if (!itemGroups.some((group) => group.key === itemsViewTab)) {
      setItemsViewTab('geral')
    }
  }, [itemGroups, itemsViewTab])

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <CadastroListPageShell>
        <CadastroListPageBody
          scrollRef={scrollContainerRef}
          header={
            <CadastroListPageHero
              icon={<Scale className="h-8 w-8" />}
              title="Fechamentos da conta"
              subtitle="Feche o extrato e grave a repartição Conta / Compartilhado. A saúde financeira soma esses totais mês a mês."
            />
          }
          tabs={
            <CadastroListPageFilterCard
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearFilters}
              onApply={applyFilters}
              applying={loading || filtersLoading}
              resultHint={lastClosedHint}
            >
              <CadastroFilterField label="Ano" icon={<Calendar size={12} />}>
                <MultiSelectDropdown
                  label="Ano"
                  options={yearOptions.map((year) => ({
                    id: year,
                    name: String(year),
                    icon: <Calendar size={14} />,
                    color: 'var(--color-1)',
                  }))}
                  selectedIds={draftYears}
                  onChange={setDraftYears}
                  placeholder="Todos"
                  disabled={filtersLoading || loading}
                />
              </CadastroFilterField>
            </CadastroListPageFilterCard>
          }
        >
          {(filtersLoading || loading) && (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner message={filtersLoading ? 'Carregando filtros...' : 'Carregando fechamentos...'} />
            </div>
          )}

          {!filtersLoading && !loading && error && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-danger)]" />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Erro</p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{error}</p>
              </div>
            </div>
          )}

          {!filtersLoading && !loading && !error && !filtersApplied && (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
              <Filter size={48} className="mx-auto mb-4 text-gray-300 dark:text-gray-600" />
              <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Selecione os filtros</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Escolha os anos (ou deixe Todos) e clique em Aplicar para carregar os fechamentos.
              </p>
            </div>
          )}

          {!loading && filtersApplied && series && (
            <div className={`overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 ${footerVisible ? 'mb-20' : ''}`}>
              <div className="px-4 pt-3">
                <CadastroListPageTabs
                  tabs={[
                    { key: 'open', label: 'Em aberto', icon: <Unlock size={16} />, count: openMonths.length },
                    { key: 'closed', label: 'Fechados', icon: <Lock size={16} />, count: closedMonths.length },
                  ]}
                  active={activeTab}
                  onChange={handleTabChange}
                />
              </div>

              <div className="p-4">
                {visibleMonths.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-500">
                    {activeTab === 'open'
                      ? 'Nenhum mês em aberto para o filtro selecionado.'
                      : 'Nenhum mês fechado para o filtro selecionado.'}
                  </p>
                ) : (
                  <ListPageTable
                    leadingMode={
                      activeTab === 'open' || selectableClosedMonths.length > 0 ? 'bulk' : 'index-only'
                    }
                    colsRest={
                      <>
                        <ListTableSpacerCol />
                        <col style={{ width: 76, minWidth: 76, maxWidth: 76 }} />
                        <col style={{ width: 48, minWidth: 48, maxWidth: 48 }} />
                        <col style={{ width: 120, minWidth: 120, maxWidth: 140 }} />
                      </>
                    }
                    head={
                      <tr>
                        {activeTab === 'open' || selectableClosedMonths.length > 0 ? (
                          <ListTableCheckboxHeader
                            state={activeTab === 'closed' ? closedSelectAllState : selectAllState}
                            onToggle={toggleSelectAll}
                          />
                        ) : null}
                        {activeTab === 'open' || selectableClosedMonths.length > 0 ? null : (
                          <ListTableIndexHeader />
                        )}
                        {activeTab === 'open' || selectableClosedMonths.length > 0 ? (
                          <ListTableIndexHeader />
                        ) : null}
                        <ListTableSpacerHeader />
                        <ListTableStaticHeader label="Ano" />
                        <ListTableStaticHeader label="Nº" />
                        <ListTableStaticHeader label="Mês" />
                        <ListTableStaticHeader label="Status" />
                        <ListTableStaticHeader label="Lançamentos" />
                        <ListTableStaticHeader label="Saldo anterior" />
                        <ListTableStaticHeader label="Entradas" />
                        <ListTableStaticHeader label="Saídas" />
                        <ListTableStaticHeader label="Resultado" />
                        {activeTab === 'closed' ? <ListTableStaticHeader label="Ajuste" /> : null}
                        {activeTab === 'closed' ? <ListTableStaticHeader label="Fechado em" /> : null}
                        <ListTableStaticHeader label="Ações" className="w-[10%]" />
                      </tr>
                    }
                  >
                    {visibleMonths.map((item, index) => {
                      const key = monthKey(item)
                      const selected = selectedKeys.has(key)
                      return (
                        <tr
                          key={key}
                          className={`${listPageTableRowHoverCls} ${
                            selected
                              ? 'table-row-selected bg-[color-mix(in_srgb,var(--color-1)_7%,transparent)]'
                              : ''
                          }`}
                        >
                          {activeTab === 'open' || selectableClosedMonths.length > 0 ? (
                            <ListTableCheckboxCell
                              checked={selected}
                              disabled={
                                activeTab === 'open'
                                  ? item.status === 'current'
                                  : !item.id
                              }
                              onToggle={() => toggleSelect(key)}
                              title={
                                activeTab === 'open'
                                  ? item.status === 'current'
                                    ? (item.block_reason || 'Não é possível fechar o mês corrente')
                                    : item.has_open_shared_closure
                                      ? (item.open_shared_notice || 'Há fechamento compartilhado em aberto. Pagamentos entram pela data real.')
                                      : undefined
                                  : !item.id
                                    ? 'Fechamento indisponível'
                                    : undefined
                              }
                            />
                          ) : (
                            <ListTableIndexCell index={index + 1} />
                          )}
                          {activeTab === 'open' || selectableClosedMonths.length > 0 ? (
                            <ListTableIndexCell index={index + 1} />
                          ) : null}
                          <ListTableSpacerCell />
                          <td className={`${listPageTableTdCls} whitespace-nowrap tabular-nums text-gray-800 dark:text-gray-100`}>
                            {item.year}
                          </td>
                          <td className={`${listPageTableTdCls} tabular-nums text-gray-500 dark:text-gray-400`}>
                            {String(item.month).padStart(2, '0')}
                          </td>
                          <td className={`${listPageTableTdCls} font-semibold text-gray-900 dark:text-white`}>
                            {MONTH_LABELS[item.month - 1]}
                          </td>
                          <td className={listPageTableTdCls}>
                            <Badge
                              variant={badgeVariantForColumnRole('statusPrimary')}
                              tone={statusTone(item.status)}
                              label={statusLabel[item.status]}
                            />
                          </td>
                          <td className={`${listPageTableTdCls} tabular-nums`}>{item.item_count ?? 0}</td>
                          <td className={listPageTableTdCls}>{openingCell(item)}</td>
                          <td className={`${listPageTableTdCls} align-top`}>
                            <FlowSplitLines
                              total={item.entries}
                              account={splitOf(item).account.entries}
                              shared={splitOf(item).shared.entries}
                              compact
                            />
                          </td>
                          <td className={`${listPageTableTdCls} align-top`}>
                            <FlowSplitLines
                              total={item.exits}
                              account={splitOf(item).account.exits}
                              shared={splitOf(item).shared.exits}
                              invert
                              compact
                            />
                          </td>
                          <td className={listPageTableTdCls}>{moneyCell(item.closing_balance)}</td>
                          {activeTab === 'closed' ? (
                            <td className={listPageTableTdCls}>
                              {item.adjustment_amount
                                ? moneyCell(item.adjustment_amount)
                                : <span className="text-gray-400">—</span>}
                            </td>
                          ) : null}
                          {activeTab === 'closed' ? (
                            <td className={`${listPageTableTdCls} whitespace-nowrap`}>
                              {item.closed_at ? formatDateBR(item.closed_at) : '—'}
                            </td>
                          ) : null}
                          <td className={listPageTableTdCls}>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className={cadastroRowIconBtnCls}
                                title={`Ver lançamentos de ${monthTitle(item)}`}
                                onClick={() => void openItemsModal(item)}
                              >
                                <Eye size={16} />
                              </button>
                              <button
                                type="button"
                                className={cadastroRowIconBtnCls}
                                title={`Exportar ${monthTitle(item)}`}
                                onClick={() => setExportTarget(item)}
                              >
                                <Download size={16} />
                              </button>
                              {activeTab === 'open' && (
                                <>
                                  {index === 0 && item.can_close ? (
                                    <button
                                      type="button"
                                      className={cadastroRowIconBtnCls}
                                      title={`Fechar ${monthTitle(item)}`}
                                      disabled={saving}
                                      onClick={() => openCloseModal([item])}
                                      style={{ color: 'var(--color-1)' }}
                                    >
                                      <Unlock size={16} />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className={`${cadastroRowIconBtnCls} cursor-not-allowed opacity-40 hover:bg-transparent hover:text-gray-400`}
                                      title={item.block_reason || `Feche ${monthTitle(previousPeriod(item.year, item.month))} antes deste`}
                                      disabled
                                    >
                                      <Lock size={16} />
                                    </button>
                                  )}
                                  {item.has_open_shared_closure ? (
                                    <button
                                      type="button"
                                      className={cadastroRowIconBtnCls}
                                      title={item.open_shared_notice || 'Há fechamento compartilhado em aberto. Pagamentos entram pela data real.'}
                                      aria-label={item.open_shared_notice || 'Há fechamento compartilhado em aberto'}
                                      onClick={() => navigate('/fechamentos/compartilhado')}
                                      style={{ color: 'var(--color-warning)' }}
                                    >
                                      <AlertTriangle size={16} />
                                    </button>
                                  ) : null}
                                </>
                              )}
                              {activeTab === 'closed' && item.can_reopen && (
                                <button
                                  type="button"
                                  className={cadastroRowIconDangerCls}
                                  title={`Reabrir ${monthTitle(item)}`}
                                  disabled={saving}
                                  onClick={() => void handleReopen(item)}
                                >
                                  <Unlock size={16} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </ListPageTable>
                )}
              </div>
            </div>
          )}
        </CadastroListPageBody>
        <ExportClosureModal
          isOpen={exportTarget !== null}
          onClose={() => setExportTarget(null)}
          onExport={(format, absoluteValues) =>
          void exportRunner.run(format === 'pdf' ? 'Gerando PDF…' : 'Gerando Excel…', () =>
            handleExportClosure(format, absoluteValues),
          )
        }
        />
      </CadastroListPageShell>

      {activeTab === 'open' && selectedKeys.size > 0 && (
        <FloatingFooterBar>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-medium text-color-primary">
                {selectedKeys.size} {selectedKeys.size === 1 ? 'mês selecionado' : 'meses selecionados'}
              </span>
              <button
                type="button"
                onClick={() => setSelectedKeys(new Set())}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X size={14} />
                Limpar
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openCloseModal(selectedMonths)}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--color-save)', color: 'var(--on-color-save)' }}
              >
                <Lock size={14} />
                Fechar selecionados
              </button>
              {showBackToTop && (
                <button
                  type="button"
                  onClick={scrollToTop}
                  className="flex items-center gap-1.5 rounded-lg bg-color-primary px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
                  title="Voltar ao topo"
                >
                  <ArrowUp size={14} />
                  Topo
                </button>
              )}
            </div>
          </div>
        </FloatingFooterBar>
      )}

      {activeTab === 'closed' && selectedKeys.size > 0 && (
        <FloatingFooterBar>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-medium text-color-primary">
                {selectedKeys.size} {selectedKeys.size === 1 ? 'mês selecionado' : 'meses selecionados'}
              </span>
              <button
                type="button"
                onClick={() => setSelectedKeys(new Set())}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X size={14} />
                Limpar
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openReopenModal(selectedClosedMonths)}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: 'var(--crud-delete)' }}
              >
                <Unlock size={14} />
                Reabrir selecionados
              </button>
              {showBackToTop && (
                <button
                  type="button"
                  onClick={scrollToTop}
                  className="flex items-center gap-1.5 rounded-lg bg-color-primary px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
                  title="Voltar ao topo"
                >
                  <ArrowUp size={14} />
                  Topo
                </button>
              )}
            </div>
          </div>
        </FloatingFooterBar>
      )}

      {showBackToTop && selectedKeys.size === 0 && (
        <FloatingFooterBar>
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={scrollToTop}
              className="flex items-center gap-1.5 rounded-lg bg-color-primary px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
              title="Voltar ao topo"
            >
              <ArrowUp size={14} />
              Voltar ao Topo
            </button>
          </div>
        </FloatingFooterBar>
      )}

      {modalMonths && newestModalMonth && (
        <CadastroModalShell maxWidth="max-w-4xl">
          <CadastroModalHeader
            isEdit={false}
            title={modalMonths.length === 1 ? `Fechar ${monthTitle(modalMonths[0])}` : `Fechar ${modalMonths.length} meses`}
            subtitle={
              modalMonths.length === 1
                ? 'Confira o caixa do extrato e a repartição Conta / Compartilhado antes de fechar.'
                : `O ajuste entra no extrato em ${lastDayLabel(newestModalMonth.year, newestModalMonth.month)}.`
            }
            icon={<Lock size={18} />}
            iconStyle={{ backgroundColor: 'var(--color-save)', color: 'var(--on-color-save)' }}
            onClose={closeModal}
          />
          <CadastroModalBody>
            {modalLoading ? (
              <div className="py-12">
                <LoadingSpinner message="Carregando repartição Conta / Compartilhado..." />
              </div>
            ) : (
              <>
            {modalMonths.some((item) => item.has_open_shared_closure) ? (
              <OpenSharedNotice
                message={
                  modalMonths.find((item) => item.open_shared_notice)?.open_shared_notice
                  || 'Há fechamento compartilhado em aberto. Somente os pagamentos realizados até o final deste mês entram neste fechamento.'
                }
                onGoToShared={() => {
                  closeModal()
                  navigate('/fechamentos/compartilhado')
                }}
              />
            ) : null}

            {modalMonths.length > 1 ? (
              <div className="space-y-6">
                <BulkCloseSummaryScorecards months={modalMonths} />
                {bulkCloseActiveYear && bulkCloseMonthsInActiveYear.length > 0 ? (
                  <>
                    <BulkCloseYearTabs
                      months={modalMonths}
                      activeYear={bulkCloseActiveYear}
                      onSelectYear={setBulkCloseActiveYear}
                    />
                    <BulkCloseYearDetail
                      monthsInYear={bulkCloseMonthsInActiveYear}
                      activeGroupKey={bulkCloseGroupTab}
                      onSelectGroup={setBulkCloseGroupTab}
                    />
                  </>
                ) : null}
              </div>
            ) : (
              <CloseModalMonthDetail month={newestModalMonth} />
            )}
              </>
            )}

            {!modalLoading && (
            <CadastroFormSection
              title="Ajuste manual"
              hint={`Positivo lança crédito e negativo lança débito no extrato em ${lastDayLabel(newestModalMonth.year, newestModalMonth.month)}. Deixe em branco para fechar sem ajuste.`}
              icon={<Calendar size={14} />}
            >
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow cols={2}>
                  <label className="block min-w-0">
                    <CadastroFieldLabel>Valor do ajuste</CadastroFieldLabel>
                    <div className="relative mt-0.5">
                      <span
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold"
                        style={adjustmentValue === 0 ? { color: 'var(--color-neutral)' } : moneyStyle(adjustmentValue)}
                      >
                        R$
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={`${adjustmentNegative ? '-' : ''}${formatAmountMask(adjustmentCents)}`}
                        onChange={(event) => {
                          const raw = event.target.value
                          const negative = raw.includes('-')
                          const cents = raw.replace(/\D/g, '')
                          const absValue = parseInt(cents || '0', 10) / 100
                          if (absValue > MAX_ADJUSTMENT) return
                          setAdjustmentNegative(negative)
                          setAdjustmentCents(cents)
                        }}
                        className={`${cadastroFieldCls} pl-9 font-semibold tabular-nums`}
                        style={adjustmentValue === 0 ? undefined : moneyStyle(adjustmentValue)}
                        placeholder="0,00"
                      />
                    </div>
                  </label>
                  <label className="block min-w-0">
                    <CadastroFieldLabel>Observação</CadastroFieldLabel>
                    <input
                      type="text"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      className={`${cadastroFieldCls} mt-0.5`}
                      placeholder="Opcional"
                    />
                  </label>
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow>
                  <div>
                    <p className="text-xs text-gray-500">Resultado após ajuste</p>
                    <p className="text-lg font-bold tabular-nums" style={moneyStyle(projectedClosing)}>
                      {formatCurrency(projectedClosing)}
                    </p>
                  </div>
                </CadastroModalFieldsRow>
              </CadastroModalFieldsGrid>
            </CadastroFormSection>
            )}
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeModal}
            onSave={() => void handleConfirmClose()}
            saving={saving || modalLoading}
            saveLabel={modalMonths.length === 1 ? 'Fechar período' : `Fechar ${modalMonths.length} meses`}
            saveIcon={<Lock size={15} />}
          />
        </CadastroModalShell>
      )}

      {partialBulkPrompt && (
        <CadastroModalShell maxWidth="max-w-lg">
          <CadastroModalHeader
            isEdit={false}
            title="Seleção fora de sequência"
            subtitle={
              partialBulkPrompt.action === 'close'
                ? 'Alguns meses selecionados não formam uma sequência contínua a partir do próximo fechamento.'
                : 'Alguns meses selecionados não formam uma sequência contínua até o último fechado.'
            }
            icon={<AlertTriangle size={18} />}
            iconStyle={{ backgroundColor: 'var(--color-warning)', color: '#fff' }}
            onClose={cancelPartialBulkPrompt}
          />
          <CadastroModalBody>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {partialBulkPrompt.action === 'close'
                ? 'Você pode cancelar ou fechar apenas os meses consecutivos válidos abaixo.'
                : 'Você pode cancelar ou reabrir apenas os meses consecutivos válidos abaixo (do mais recente ao mais antigo).'}
            </p>
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {partialBulkPrompt.action === 'close' ? 'Serão fechados' : 'Serão reabertos'} (
                {partialBulkPrompt.included.length})
              </p>
              <ul className="mt-2 space-y-1 rounded-lg border border-green-200 bg-green-50/80 px-3 py-2 text-sm dark:border-green-900/50 dark:bg-green-950/30">
                {partialBulkPrompt.included.map((item) => (
                  <li key={monthKey(item)} className="font-medium text-gray-800 dark:text-gray-100">
                    {monthTitle(item)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Ficam de fora ({partialBulkPrompt.excluded.length})
              </p>
              <ul className="mt-2 space-y-1 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
                {partialBulkPrompt.excluded.map((item) => (
                  <li key={monthKey(item)} className="text-gray-700 dark:text-gray-300">
                    {monthTitle(item)}
                  </li>
                ))}
              </ul>
            </div>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={cancelPartialBulkPrompt}
            onSave={confirmPartialBulkPrompt}
            saveLabel={
              partialBulkPrompt.action === 'close'
                ? partialBulkPrompt.included.length === 1
                  ? 'Fechar 1 mês'
                  : `Fechar ${partialBulkPrompt.included.length} meses`
                : partialBulkPrompt.included.length === 1
                  ? 'Reabrir 1 mês'
                  : `Reabrir ${partialBulkPrompt.included.length} meses`
            }
            saveIcon={partialBulkPrompt.action === 'close' ? <Lock size={15} /> : <Unlock size={15} />}
            saveTone={partialBulkPrompt.action === 'close' ? 'success' : 'danger'}
          />
        </CadastroModalShell>
      )}

      {reopenModalMonths && reopenModalMonths.length > 0 && (
        <CadastroModalShell maxWidth="max-w-5xl">
          <CadastroModalHeader
            isEdit={false}
            title={
              reopenModalMonths.length === 1
                ? `Reabrir ${monthTitle(reopenModalMonths[0])}?`
                : `Reabrir ${reopenModalMonths.length} meses?`
            }
            subtitle="O fechamento será desfeito e os meses voltarão para em aberto."
            icon={<Unlock size={18} />}
            iconStyle={{ backgroundColor: 'var(--crud-delete)', color: '#fff' }}
            onClose={closeReopenModal}
          />
          <CadastroModalBody>
            <CadastroFormSection
              title="Lançamentos de ajuste"
              hint={
                reopenModalMonths.length === 1
                  ? 'Confirme o que fazer com o lançamento de ajuste deste fechamento, se houver.'
                  : 'Válido para os meses selecionados que possuem ajuste no extrato (geralmente o último mês de cada lote fechado).'
              }
              icon={<Scale size={14} />}
            >
              {reopenModalHasAdjustments ? (
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    <input
                      type="radio"
                      name="reopen-adjustment"
                      checked={reopenDeleteAdjustments}
                      onChange={() => setReopenDeleteAdjustments(true)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-gray-900 dark:text-white">
                        Excluir ajustes do extrato
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Remove os lançamentos de ajuste criados no fechamento (comportamento anterior).
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    <input
                      type="radio"
                      name="reopen-adjustment"
                      checked={!reopenDeleteAdjustments}
                      onChange={() => setReopenDeleteAdjustments(false)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-gray-900 dark:text-white">
                        Manter ajustes no extrato
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Reabre o período mas preserva os lançamentos de ajuste já importados.
                      </span>
                    </span>
                  </label>
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Nenhum dos meses selecionados possui ajuste lançado no extrato.
                </p>
              )}
            </CadastroFormSection>

            <CadastroFormSection
              title="Períodos a reabrir"
              hint={
                reopenModalMonths.length === 1
                  ? 'Resumo do fechamento que será desfeito.'
                  : 'Ordem de execução: do mais recente para o mais antigo.'
              }
              icon={<Calendar size={14} />}
              bodyClassName="p-0"
              className="mt-4"
            >
              <ListPageTable
                framed={false}
                colsRest={
                  <>
                    <ListTableSpacerCol />
                    <col style={{ width: 76, minWidth: 76, maxWidth: 76 }} />
                    <col style={{ width: 48, minWidth: 48, maxWidth: 48 }} />
                    <col style={{ width: 120, minWidth: 120, maxWidth: 140 }} />
                    <col style={{ width: 112, minWidth: 112, maxWidth: 128 }} />
                  </>
                }
                head={
                  <tr>
                    <ListTableIndexHeader />
                    <ListTableSpacerHeader />
                    <ListTableStaticHeader label="Ano" />
                    <ListTableStaticHeader label="Nº" />
                    <ListTableStaticHeader label="Mês" />
                    <ListTableStaticHeader label="Saldo anterior" />
                    <ListTableStaticHeader label="Entradas" />
                    <ListTableStaticHeader label="Saídas" />
                    <ListTableStaticHeader label="Resultado" />
                    <ListTableStaticHeader label="Ajuste" />
                  </tr>
                }
              >
                {sortMonthsDesc(reopenModalMonths).map((item, index) => (
                  <tr key={monthKey(item)} className={listPageTableRowHoverCls}>
                    <ListTableIndexCell index={index + 1} />
                    <ListTableSpacerCell />
                    <td className={`${listPageTableTdCls} whitespace-nowrap tabular-nums text-gray-800 dark:text-gray-100`}>
                      {item.year}
                    </td>
                    <td className={`${listPageTableTdCls} tabular-nums text-gray-500 dark:text-gray-400`}>
                      {String(item.month).padStart(2, '0')}
                    </td>
                    <td className={`${listPageTableTdCls} font-semibold text-gray-900 dark:text-white`}>
                      {MONTH_LABELS[item.month - 1]}
                    </td>
                    <td className={listPageTableTdCls}>{openingCell(item)}</td>
                    <td className={`${listPageTableTdCls} align-top`}>
                      <FlowSplitLines
                        total={item.entries}
                        account={splitOf(item).account.entries}
                        shared={splitOf(item).shared.entries}
                        compact
                      />
                    </td>
                    <td className={`${listPageTableTdCls} align-top`}>
                      <FlowSplitLines
                        total={item.exits}
                        account={splitOf(item).account.exits}
                        shared={splitOf(item).shared.exits}
                        invert
                        compact
                      />
                    </td>
                    <td className={listPageTableTdCls}>{moneyCell(item.closing_balance)}</td>
                    <td className={listPageTableTdCls}>
                      {item.adjustment_amount != null && Number(item.adjustment_amount) !== 0
                        ? moneyCell(item.adjustment_amount)
                        : <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
              </ListPageTable>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeReopenModal}
            onSave={() => void confirmReopen()}
            saving={saving}
            saveLabel={
              reopenModalMonths.length === 1 ? 'Reabrir período' : `Reabrir ${reopenModalMonths.length} meses`
            }
            saveIcon={<Unlock size={15} />}
            saveTone="danger"
          />
        </CadastroModalShell>
      )}

      {itemsMonth && (
        <CadastroModalShell maxWidth="max-w-[95vw] xl:max-w-[90rem]">
          <CadastroModalHeader
            isEdit={false}
            title={`Lançamentos de ${monthTitle(itemsMonth)}`}
            subtitle={itemsHeaderSubtitle}
            icon={<Eye size={18} />}
            iconStyle={{ backgroundColor: 'var(--color-1)', color: 'var(--on-color-1)' }}
            onClose={closeItemsModal}
          />
          <CadastroModalBody
            chrome={
              !itemsLoading && !itemsError ? (
                <CadastroListPageTabs
                  tabs={[
                    { key: 'geral', label: 'Geral', icon: <Scale size={14} /> },
                    ...itemGroups.map((group) => ({
                      key: group.key,
                      label: groupAccountLabel(group),
                      icon: group.kind === 'own' ? <Landmark size={14} /> : <Users size={14} />,
                      count: group.items.length,
                    })),
                  ]}
                  active={itemsViewTab}
                  onChange={setItemsViewTab}
                />
              ) : null
            }
          >
            {itemsLoading && (
              <div className="py-12">
                <LoadingSpinner message="Carregando lançamentos..." />
              </div>
            )}
            {!itemsLoading && itemsError && (
              <p className="py-8 text-center text-sm text-[var(--color-danger)]">{itemsError}</p>
            )}
            {!itemsLoading && !itemsError && itemsViewTab === 'geral' && (
              <div className={cadastroSectionsStackCls}>
                {(itemsPreview ?? itemsMonth)?.has_open_shared_closure ? (
                  <OpenSharedNotice
                    message={
                      (itemsPreview ?? itemsMonth)?.open_shared_notice
                      || 'Há fechamento compartilhado em aberto. Somente os pagamentos realizados até o final deste mês entram neste fechamento.'
                    }
                    onGoToShared={() => {
                      closeItemsModal()
                      navigate('/fechamentos/compartilhado')
                    }}
                  />
                ) : null}
                <CadastroFormSection
                  title="Caixa do extrato"
                  hint={
                    previousOpeningPeriod
                      ? `Saldo em ${lastDayLabel(previousOpeningPeriod.year, previousOpeningPeriod.month)}.`
                      : 'Saldo do mês anterior.'
                  }
                  icon={<Scale size={14} />}
                  bodyClassName="p-0"
                >
                  {openingSource ? (
                    <CaixaTotals item={openingSource} />
                  ) : (
                    <p className="px-3 py-3 text-base font-bold tabular-nums text-gray-400">—</p>
                  )}
                </CadastroFormSection>

                {openingSource ? (
                  <CadastroFormSection
                    title="Repartição Conta / Compartilhado"
                    icon={<Users size={14} />}
                    bodyClassName="p-0"
                  >
                    <SplitBreakdownTable item={openingSource} />
                  </CadastroFormSection>
                ) : null}

                {openingSource ? (
                  <CadastroFormSection
                    title="Compartilhado por conta"
                    hint="Mesmas entradas, saídas e resultado do compartilhado, separados pela conta parceira."
                    icon={<Users size={14} />}
                    bodyClassName="p-0"
                  >
                    <SharedByAccountTable rows={mergeSharedByAccount([openingSource])} />
                  </CadastroFormSection>
                ) : null}
              </div>
            )}
            {!itemsLoading && !itemsError && itemsViewTab !== 'geral' && (
              <div className={cadastroSectionsStackCls}>
                <UnmatchedCardWarning items={itemsPreview?.unmatched_card_payments ?? []} />
                {activeItemGroup ? (
                  <>
                    <CadastroFormSection
                      title={`Resultado · ${groupAccountLabel(activeItemGroup)}`}
                      hint={activeItemGroup.kind === 'own'
                        ? 'Mesma base da aba Geral: entradas, saídas e resultado da conta, por tipo de lançamento.'
                        : 'Mesma base da aba Geral: entradas, saídas e resultado da parte pessoal e da compartilhada, por tipo de lançamento.'}
                      icon={<Scale size={14} />}
                      bodyClassName="p-0"
                    >
                      <GroupSourceSummaryTable group={activeItemGroup} />
                    </CadastroFormSection>
                    <CadastroFormSection
                      title="Receitas"
                      icon={<ArrowUpCircle size={14} />}
                      bodyClassName="p-0"
                    >
                      <PeriodItemsBySource items={activeItemFlows.receitas} ownView={activeItemGroup.kind === 'own'} />
                    </CadastroFormSection>
                    {showAfterDespesas ? (
                      <CadastroFormSection
                        title="Despesas · Depois do período compartilhado"
                        hint={`Após ${formatDateTimeBR(activeSharedClosure?.closing_date || '')} · neste mês`}
                        icon={<ArrowDownCircle size={14} />}
                        bodyClassName="p-0"
                      >
                        <PeriodItemsBySource items={activeDespesasSplit.after} ownView={activeItemGroup.kind === 'own'} />
                      </CadastroFormSection>
                    ) : null}
                    <CadastroFormSection
                      title={showAfterDespesas ? 'Despesas · No período compartilhado' : 'Despesas'}
                      hint={
                        showAfterDespesas && activeSharedClosure?.period_start_date && activeSharedClosure.closing_date
                          ? `${formatDateTimeBR(activeSharedClosure.period_start_date)} a ${formatDateTimeBR(activeSharedClosure.closing_date)}`
                          : undefined
                      }
                      icon={<ArrowDownCircle size={14} />}
                      bodyClassName="p-0"
                    >
                      <PeriodItemsBySource
                        items={showAfterDespesas ? activeDespesasSplit.inPeriod : activeItemFlows.despesas}
                        ownView={activeItemGroup.kind === 'own'}
                      />
                    </CadastroFormSection>
                  </>
                ) : (
                  <p className="px-3 py-4 text-center text-sm text-gray-500">Nenhum lançamento neste período.</p>
                )}
              </div>
            )}
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeItemsModal}
            hideSave
            closeLabel="Fechar"
          />
        </CadastroModalShell>
      )}

      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.type === 'success' ? 4000 : 5000}
          onClose={() => setToast((prev) => ({ ...prev, show: false }))}
        />
      )}
      {exportRunner.overlay}
      <ConfirmComponent />
    </div>
  )
}

export default AccountClosuresPage
