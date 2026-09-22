import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Label,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Sidebar from '../components/Sidebar'
import {
  CadastroFilterField,
  CadastroListPageBody,
  CadastroListPageEmptyCard,
  CadastroListPageFilterCard,
  CadastroListPageHero,
  CadastroListPageShell,
  CadastroListPageTabs,
  cadastroFilterFieldCls,
  cadastroRowIconBtnCls,
  listPageTableChromeFooterCls,
  listPageTableRowHoverCls,
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
  CadastroModalTabs,
} from '../components/CadastroFormLayout'
import { ListPageTable } from '../components/ListPageTable'
import {
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableStaticHeader,
} from '../components/ListTableSelectColumns'
import LoadingSpinner from '../components/LoadingSpinner'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { formatCurrency } from '../utils/currency'
import { formatDateBR } from '../utils/dateUtils'
import { getIconComponent } from '../utils/iconMapper'
import {
  Activity,
  AlertCircle,
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  Calendar,
  CreditCard,
  Eye,
  Filter,
  Landmark,
  Scale,
  Users,
  Wallet,
} from 'lucide-react'
import SharedAccountDisplay from '../components/SharedAccountDisplay'

type FlowKind = 'entries' | 'exits'
type HealthScope = 'all' | 'account' | 'shared'

interface MonthSplit {
  entries: number
  exits: number
}

interface MonthClosing {
  year: number
  month: number
  year_month: string
  opening_balance: number
  entries: number
  exits: number
  closing_balance: number
  is_open?: boolean
  closed_at?: string | null
  split_account?: MonthSplit | null
  split_shared?: MonthSplit | null
}

interface HealthResponse {
  months: MonthClosing[]
  selected: MonthClosing | null
}

interface FlowDetailItem {
  id: string
  date: string
  description: string
  year_month?: string
  amount: number
  source?: string
  is_manual?: boolean
  migrated_from_account_id?: number | null
  card_id?: number
  card_name?: string | null
  card_number?: string | null
  tag_name?: string | null
  subtag_name?: string | null
  ownership_percentage?: number | null
  shared_partner_id?: number | null
  shared_partner_name?: string | null
  shared_partner_bank?: string | null
  shared_partner_agency?: number | string | null
  shared_partner_account_number?: number | string | null
}

interface FlowMonthDetails {
  year: number
  month: number
  year_month: string
  is_open: boolean
  total: number
  count: number
  items: FlowDetailItem[]
}

interface FlowDetailsResponse {
  kind: FlowKind
  total: number
  count: number
  months: FlowMonthDetails[]
}

interface CategoryItem {
  tag_id: number | null
  tag_name: string
  icon?: string | null
  amount: number
  count: number
  share_pct: number
}

interface CategoryGroup {
  total: number
  items: CategoryItem[]
}

interface CategoriesResponse {
  entries: CategoryGroup
  exits: CategoryGroup
}

interface CategoryView {
  kind: FlowKind
  tag_id: number | null
  tag_name: string
  icon?: string | null
}

const emptyHealth = (): HealthResponse => ({
  months: [],
  selected: null,
})

const cssVar = (name: string, fallback: string) => {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const MONTH_FULL = [
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
]

const periodTitleOf = (year: number | null, month: number | null = null) => {
  if (!year) return 'Todos os períodos'
  if (!month) return String(year)
  return `${MONTH_FULL[month - 1] || String(month)}/${year}`
}

const SCOPE_OPTIONS: { value: HealthScope; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'account', label: 'Conta' },
  { value: 'shared', label: 'Compartilhado' },
]

const scopeTitleOf = (scope: HealthScope) => (
  SCOPE_OPTIONS.find((item) => item.value === scope)?.label || 'Todos'
)

const shortMonthLabel = (yearMonth: string) => {
  const month = Number(yearMonth.slice(5, 7))
  const year = yearMonth.slice(2, 4)
  return `${MONTH_SHORT[month - 1] || yearMonth}/${year}`
}

const yearMonthKey = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, '0')}`

const toMoney = (value: number) => Math.round(Number(value || 0) * 100) / 100

const moneyColor = (value: number, invert = false) =>
  (invert ? -value : value) >= 0 ? 'var(--color-success)' : 'var(--color-danger)'

const linearTrend = (values: number[]) => {
  const count = values.length
  if (count === 0) return []
  if (count === 1) return [values[0]]
  const meanX = (count - 1) / 2
  const meanY = values.reduce((sum, value) => sum + value, 0) / count
  let numerator = 0
  let denominator = 0
  values.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY)
    denominator += (index - meanX) ** 2
  })
  const slope = denominator === 0 ? 0 : numerator / denominator
  const intercept = meanY - slope * meanX
  return values.map((_, index) => toMoney(intercept + slope * index))
}

const emptySplit = (): MonthSplit => ({ entries: 0, exits: 0 })

const splitOf = (item?: Pick<MonthClosing, 'split_account' | 'split_shared'> | null) => ({
  account: item?.split_account ?? emptySplit(),
  shared: item?.split_shared ?? emptySplit(),
})

const sumSplit = (months: MonthClosing[], key: 'account' | 'shared'): MonthSplit => ({
  entries: toMoney(months.reduce((sum, item) => sum + Number(splitOf(item)[key].entries || 0), 0)),
  exits: toMoney(months.reduce((sum, item) => sum + Number(splitOf(item)[key].exits || 0), 0)),
})

const aggregateMonths = (months: MonthClosing[]): MonthClosing | null => {
  if (months.length === 0) return null
  const first = months[0]
  const last = months[months.length - 1]
  return {
    ...last,
    year: first.year,
    month: first.month,
    year_month: first.year_month,
    opening_balance: first.opening_balance,
    entries: toMoney(months.reduce((sum, item) => sum + Number(item.entries || 0), 0)),
    exits: toMoney(months.reduce((sum, item) => sum + Number(item.exits || 0), 0)),
    closing_balance: last.closing_balance,
    split_account: sumSplit(months, 'account'),
    split_shared: sumSplit(months, 'shared'),
  }
}

const chartTooltipStyle = {
  backgroundColor: 'var(--bg-card, #fff)',
  border: '1px solid var(--border-color, #e5e7eb)',
  borderRadius: '8px',
}

function MonthAxisTick({
  x = 0,
  y = 0,
  payload,
  openYearMonth,
}: {
  x?: number
  y?: number
  payload?: { value: string }
  openYearMonth?: string | null
}) {
  const value = String(payload?.value ?? '')
  const isOpen = Boolean(openYearMonth && value === openYearMonth)
  return (
    <g transform={`translate(${x},${y})`}>
      {isOpen ? (
        <text
          dy={12}
          textAnchor="middle"
          fontSize={9}
          fontWeight={600}
          fill="var(--color-warning)"
        >
          em aberto
        </text>
      ) : null}
      <text
        dy={isOpen ? 26 : 16}
        textAnchor="middle"
        fontSize={12}
        fill={isOpen ? 'var(--color-warning)' : '#6b7280'}
      >
        {shortMonthLabel(value)}
      </text>
    </g>
  )
}

const emptyCategories = (): CategoriesResponse => ({
  entries: { total: 0, items: [] },
  exits: { total: 0, items: [] },
})

const tableRowCls = `${listPageTableRowHoverCls} [&>td]:border-b [&>td]:border-gray-200 dark:[&>td]:border-gray-700`

function ItemSourceIcons({
  isManual,
  migratedFromAccountId,
  source,
  cardName,
  cardNumber,
}: {
  isManual?: boolean
  migratedFromAccountId?: number | null
  source?: string
  cardName?: string | null
  cardNumber?: string | null
}) {
  if (source === 'card' || cardName) {
    const label = cardFinalLabel(cardName, cardNumber)
    return (
      <div className="flex items-center justify-center" title={label}>
        <CreditCard
          className="inline shrink-0"
          style={{ color: 'var(--color-2)' }}
          size={18}
          aria-label={label}
        />
      </div>
    )
  }
  if (source === 'settlement') {
    return (
      <div className="flex items-center justify-center" title="Acerto compartilhado">
        <Scale
          className="inline shrink-0"
          style={{ color: 'var(--color-1)' }}
          size={18}
          aria-label="Acerto compartilhado"
        />
      </div>
    )
  }
  return (
    <div className="flex items-center justify-center gap-1" title="Extrato bancário">
      <Landmark className="inline" style={{ color: 'var(--color-1)' }} size={18} aria-label="Extrato Bancário" />
      {migratedFromAccountId ? (
        <ArrowLeftRight
          size={14}
          className="text-cyan-600 dark:text-cyan-400"
          aria-label="Item Invertido/Migrado"
          title="Item invertido de outra conta"
        />
      ) : null}
      {isManual && !migratedFromAccountId ? (
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

interface CardViewData {
  id: number
  name: string
  number?: string | null
  description?: string | null
  type?: string | null
  closing_day?: number | null
  invoice_group_name?: string | null
  active?: boolean
  is_account_card?: boolean | null
}

function cardTypeLabel(type?: string | null) {
  if (type === 'beneficios') return 'Benefícios'
  if (type === 'credito') return 'Crédito'
  return type || '—'
}

function CardInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <CadastroFieldLabel>{label}</CadastroFieldLabel>
      <p className="text-sm text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  )
}

function MonthStrip({
  year,
  activeYearMonth,
  months,
  onChange,
}: {
  year: number
  activeYearMonth: string
  months: FlowMonthDetails[]
  onChange: (yearMonth: string) => void
}) {
  const byKey = new Map(months.map((item) => [item.year_month, item]))
  return (
    <div className="grid grid-cols-12 border-b border-gray-200 dark:border-gray-700">
      {MONTH_SHORT.map((label, index) => {
        const month = index + 1
        const key = yearMonthKey(year, month)
        const meta = byKey.get(key)
        const active = activeYearMonth === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`min-w-0 px-0.5 py-2 text-center text-[11px] font-medium leading-tight transition-all ${
              active
                ? 'border-b-2 border-[var(--color-1)] text-[var(--color-1)]'
                : meta?.is_open
                  ? 'border-b-2 border-transparent text-[var(--color-warning)] hover:border-gray-300'
                  : 'border-b-2 border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400'
            }`}
            title={meta?.is_open ? `${label} · mês corrente em aberto` : label}
          >
            <span className="block truncate">{label}</span>
            {meta?.is_open ? (
              <span className="block text-[9px] font-semibold uppercase tracking-wide">aberto</span>
            ) : (
              <span className="block text-[9px] tabular-nums text-gray-400">
                {meta?.count ? meta.count : '\u00a0'}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function SplitHint({ account, shared, invert = false }: { account: number; shared: number; invert?: boolean }) {
  return (
    <p className="mt-1 text-[11px] leading-snug text-gray-500">
      Conta{' '}
      <span className="tabular-nums" style={{ color: moneyColor(account, invert) }}>{formatCurrency(account)}</span>
      {' · '}
      Comp.{' '}
      <span className="tabular-nums" style={{ color: moneyColor(shared, invert) }}>{formatCurrency(shared)}</span>
    </p>
  )
}

function MonthSplitTable({ months }: { months: MonthClosing[] }) {
  const totals = {
    account: sumSplit(months, 'account'),
    shared: sumSplit(months, 'shared'),
  }
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Conta e compartilhado por mês</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Valores gravados no fechamento. A saúde soma estes totais; acertos posteriores só abatem a parte da conta.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-gray-900/50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Mês</th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Entradas conta</th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Entradas comp.</th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Saídas conta</th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Saídas comp.</th>
              <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Resultado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {months.map((item) => {
              const split = splitOf(item)
              const net = toMoney(Number(item.entries || 0) - Number(item.exits || 0))
              return (
                <tr key={item.year_month} className={item.is_open ? 'bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)]' : ''}>
                  <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100">
                    {MONTH_FULL[item.month - 1] || item.month} {item.year}
                    {item.is_open ? (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-warning)]">aberto</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: moneyColor(split.account.entries) }}>
                    {formatCurrency(split.account.entries)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: moneyColor(split.shared.entries) }}>
                    {formatCurrency(split.shared.entries)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: moneyColor(split.account.exits, true) }}>
                    {formatCurrency(split.account.exits)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: moneyColor(split.shared.exits, true) }}>
                    {formatCurrency(split.shared.exits)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: moneyColor(net) }}>
                    {formatCurrency(net)}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 dark:bg-gray-900/40">
            <tr>
              <td className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Total</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: moneyColor(totals.account.entries) }}>
                {formatCurrency(totals.account.entries)}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: moneyColor(totals.shared.entries) }}>
                {formatCurrency(totals.shared.entries)}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: moneyColor(totals.account.exits, true) }}>
                {formatCurrency(totals.account.exits)}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: moneyColor(totals.shared.exits, true) }}>
                {formatCurrency(totals.shared.exits)}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: moneyColor(totals.account.entries + totals.shared.entries - totals.account.exits - totals.shared.exits) }}>
                {formatCurrency(totals.account.entries + totals.shared.entries - totals.account.exits - totals.shared.exits)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function defaultMonthForYear(year: number, months: FlowMonthDetails[]) {
  const open = months.find((item) => item.is_open && item.year === year)
  if (open) return open.year_month
  const inYear = months.filter((item) => item.year === year)
  if (inYear.length) return inYear[inYear.length - 1].year_month
  return yearMonthKey(year, 12)
}

function monthHeading(year: number, month: number, isOpen?: boolean) {
  return `${MONTH_SHORT[month - 1] || month} ${year}${isOpen ? ' · em aberto' : ''}`
}

function byYearMonthDesc<T extends { year_month: string }>(left: T, right: T) {
  return right.year_month.localeCompare(left.year_month)
}

function byDateDesc<T extends { date?: string | null; id: string }>(left: T, right: T) {
  const byDate = (right.date || '').localeCompare(left.date || '')
  if (byDate !== 0) return byDate
  return right.id.localeCompare(left.id)
}

function cardFinalLabel(name?: string | null, number?: string | null) {
  const digits = (number || '').trim()
  const label = name || 'Cartão'
  return digits ? `${label} · final ${digits}` : label
}

function FlowMonthItemsTable({
  month,
  amountColor,
  showTitle = true,
  onViewCard,
}: {
  month: FlowMonthDetails
  amountColor: string
  showTitle?: boolean
  onViewCard: (item: FlowDetailItem) => void
}) {
  if (month.items.length === 0) return null
  return (
    <CadastroFormSection
      title={showTitle ? monthHeading(month.year, month.month, month.is_open) : 'Lançamentos'}
      bodyClassName="p-0"
    >
      <ListPageTable
        framed={false}
        minWidth={980}
        colsRest={
          <>
            <ListTableSpacerCol />
            <col style={{ width: 56, minWidth: 48 }} />
            <col style={{ width: 100, minWidth: 92 }} />
            <col />
            <col style={{ width: 120, minWidth: 110 }} />
            <col style={{ width: 130, minWidth: 110 }} />
            <col style={{ width: 130, minWidth: 110 }} />
            <col style={{ width: 180, minWidth: 160 }} />
            <col style={{ width: 48, minWidth: 44 }} />
          </>
        }
        head={
          <tr>
            <ListTableIndexHeader />
            <ListTableSpacerHeader />
            <ListTableStaticHeader label="Origem" />
            <ListTableStaticHeader label="Data" />
            <ListTableStaticHeader label="Descrição" />
            <ListTableStaticHeader label="Valor" />
            <ListTableStaticHeader label="Tag" />
            <ListTableStaticHeader label="Subtag" />
            <ListTableStaticHeader label="Compartilhamento" />
            <ListTableStaticHeader label="" />
          </tr>
        }
        footer={
          <div className={`${listPageTableChromeFooterCls} flex items-center justify-between gap-3`}>
            <span className="text-sm text-gray-600 dark:text-gray-300">
              {month.count} {month.count === 1 ? 'lançamento' : 'lançamentos'}
            </span>
            <span className="text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100">
              Total {formatCurrency(month.total)}
            </span>
          </div>
        }
      >
        {month.items.slice().sort(byDateDesc).map((item, index) => (
          <tr key={item.id} className={tableRowCls}>
            <ListTableIndexCell index={index + 1} />
            <ListTableSpacerCell />
            <td className={listPageTableTdCls}>
              <ItemSourceIcons
                isManual={item.is_manual}
                migratedFromAccountId={item.migrated_from_account_id}
                source={item.source}
                cardName={item.card_name}
                cardNumber={item.card_number}
              />
            </td>
            <td className={`${listPageTableTdCls} whitespace-nowrap`}>{formatDateBR(item.date)}</td>
            <td className={listPageTableTdCls}>
              <span className="block truncate" title={item.description || undefined}>
                {item.description || '—'}
              </span>
            </td>
            <td className={`${listPageTableTdCls} font-semibold tabular-nums`} style={{ color: amountColor }}>
              {formatCurrency(Number(item.amount))}
            </td>
            <td className={listPageTableTdCls}>
              <span className="block truncate">{item.tag_name || '—'}</span>
            </td>
            <td className={listPageTableTdCls}>
              <span className="block truncate">{item.subtag_name || '—'}</span>
            </td>
            <td className={listPageTableTdCls}>
              <SharedAccountDisplay
                account={item.shared_partner_name ? {
                  id: item.shared_partner_id || 0,
                  name: item.shared_partner_name,
                  bank: item.shared_partner_bank ? { name: item.shared_partner_bank } : null,
                  agency: item.shared_partner_agency,
                  account_number: item.shared_partner_account_number,
                } : null}
                ownershipPercentage={item.ownership_percentage}
              />
            </td>
            <td className={listPageTableTdCls}>
              {item.source === 'card' && item.card_id ? (
                <button
                  type="button"
                  className={cadastroRowIconBtnCls}
                  title={`Ver cartão ${cardFinalLabel(item.card_name, item.card_number)}`}
                  onClick={() => onViewCard(item)}
                >
                  <Eye size={16} />
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </ListPageTable>
    </CadastroFormSection>
  )
}

function CategoryShareTable({
  title,
  hint,
  group,
  tone,
  onView,
}: {
  title: string
  hint: string
  group: CategoryGroup
  tone: 'success' | 'danger'
  onView: (item: CategoryItem) => void
}) {
  const barColor = tone === 'success' ? 'var(--color-success)' : 'var(--color-danger)'
  const maxAmount = group.items.reduce((max, item) => Math.max(max, Number(item.amount || 0)), 0)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-1 text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
      <p className="mb-4 text-sm text-gray-500">
        {hint}
        {group.total > 0 ? ` · total ${formatCurrency(group.total)}` : ''}
      </p>
      {group.items.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">Sem lançamentos categorizados neste período.</p>
      ) : (
        <ListPageTable
          colsRest={
            <>
              <ListTableSpacerCol />
              <col />
              <col style={{ width: 64, minWidth: 56 }} />
              <col style={{ width: 128, minWidth: 112 }} />
              <col style={{ width: 160, minWidth: 140 }} />
              <col style={{ width: 48, minWidth: 44 }} />
            </>
          }
          head={
            <tr>
              <ListTableIndexHeader />
              <ListTableSpacerHeader />
              <ListTableStaticHeader label="Categoria" />
              <ListTableStaticHeader label="Lanç." />
              <ListTableStaticHeader label="Valor" />
              <ListTableStaticHeader label="Participação" />
              <ListTableStaticHeader label="" />
            </tr>
          }
        >
          {group.items.map((item, index) => {
            const Icon = getIconComponent(item.icon)
            const barPct = maxAmount > 0 ? (Number(item.amount) / maxAmount) * 100 : 0
            return (
              <tr key={`${item.tag_id ?? 'none'}-${item.tag_name}`} className={tableRowCls}>
                <ListTableIndexCell index={index + 1} />
                <ListTableSpacerCell />
                <td className={listPageTableTdCls}>
                  <span className="inline-flex items-start gap-2 font-medium text-gray-800 dark:text-gray-100">
                    <Icon size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-1)' }} />
                    <span className="whitespace-normal break-words leading-snug">{item.tag_name}</span>
                  </span>
                </td>
                <td className={`${listPageTableTdCls} tabular-nums`}>{item.count}</td>
                <td
                  className={`${listPageTableTdCls} font-semibold tabular-nums`}
                  style={{ color: barColor }}
                >
                  {formatCurrency(item.amount)}
                </td>
                <td className={listPageTableTdCls}>
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${barPct}%`, backgroundColor: barColor }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-left text-xs tabular-nums text-gray-500">
                      {item.share_pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                    </span>
                  </div>
                </td>
                <td className={listPageTableTdCls}>
                  <button
                    type="button"
                    className={cadastroRowIconBtnCls}
                    title={`Ver ${item.tag_name}`}
                    onClick={() => onView(item)}
                  >
                    <Eye size={16} />
                  </button>
                </td>
              </tr>
            )
          })}
        </ListPageTable>
      )}
    </div>
  )
}

const HealthCheckPage = () => {
  const [draftYear, setDraftYear] = useState('')
  const [draftMonth, setDraftMonth] = useState('')
  const [draftScope, setDraftScope] = useState<HealthScope>('all')
  const [appliedYear, setAppliedYear] = useState<number | 'all' | null>(null)
  const [appliedMonth, setAppliedMonth] = useState<number | 'all' | null>(null)
  const [appliedScope, setAppliedScope] = useState<HealthScope>('all')
  const [filtersApplied, setFiltersApplied] = useState(false)
  const [yearOptions, setYearOptions] = useState<number[]>([])
  const [filtersLoading, setFiltersLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<HealthResponse>(() => emptyHealth())
  const [categories, setCategories] = useState<CategoriesResponse>(() => emptyCategories())
  const [flowKind, setFlowKind] = useState<FlowKind | null>(null)
  const [flowYear, setFlowYear] = useState<number | null>(null)
  const [flowMonth, setFlowMonth] = useState<string | null>(null)
  const [flowLoading, setFlowLoading] = useState(false)
  const [flowError, setFlowError] = useState<string | null>(null)
  const [flowDetails, setFlowDetails] = useState<FlowDetailsResponse | null>(null)
  const [categoryView, setCategoryView] = useState<CategoryView | null>(null)
  const [categoryTab, setCategoryTab] = useState<'chart' | 'items'>('chart')
  const [categoryLoading, setCategoryLoading] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [categoryDetails, setCategoryDetails] = useState<FlowDetailsResponse | null>(null)
  const [cardView, setCardView] = useState<CardViewData | null>(null)

  const yearFilter = appliedYear === 'all' ? null : appliedYear
  const monthFilter = appliedMonth === 'all' || appliedMonth == null ? null : appliedMonth
  const title = periodTitleOf(yearFilter, monthFilter)
  const scopeTitle = scopeTitleOf(appliedScope)
  const resultTitle = `${title} · ${scopeTitle}`
  const colors = useMemo(
    () => ({
      success: cssVar('--color-success', '#16a34a'),
      danger: cssVar('--color-danger', '#dc2626'),
      primary: cssVar('--color-1', '#2563eb'),
    }),
    [],
  )

  const loadOptions = useCallback(async () => {
    setFiltersLoading(true)
    try {
      const response = await axios.get<{ years: number[] }>('/api/financial-health/options')
      setYearOptions(response.data.years ?? [])
    } catch {
      setYearOptions([])
    } finally {
      setFiltersLoading(false)
    }
  }, [])

  const healthParams = useCallback((yearValue: number | null, scope: HealthScope, monthValue: number | null = null) => ({
    ...(yearValue != null ? { year: yearValue } : {}),
    ...(monthValue != null ? { month: monthValue } : {}),
    scope,
  }), [])

  const loadHealth = useCallback(async (yearValue: number | null, scope: HealthScope, monthValue: number | null = null) => {
    setLoading(true)
    setError(null)
    try {
      const params = healthParams(yearValue, scope, monthValue)
      const [healthResponse, categoriesResponse] = await Promise.all([
        axios.get<HealthResponse>('/api/financial-health', { params }),
        axios.get<CategoriesResponse>('/api/financial-health/categories', { params }),
      ])
      setHealth(healthResponse.data)
      setCategories(categoriesResponse.data)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erro ao carregar a Saúde Financeira')
      setHealth(emptyHealth())
      setCategories(emptyCategories())
    } finally {
      setLoading(false)
    }
  }, [healthParams])

  const applyFilters = () => {
    const yearValue = draftYear === '' ? 'all' : Number(draftYear)
    if (yearValue !== 'all' && Number.isNaN(yearValue)) return
    const monthValue = yearValue === 'all' || draftMonth === '' ? 'all' : Number(draftMonth)
    if (monthValue !== 'all' && (Number.isNaN(monthValue) || monthValue < 1 || monthValue > 12)) return
    setAppliedYear(yearValue)
    setAppliedMonth(monthValue)
    setAppliedScope(draftScope)
    setFiltersApplied(true)
  }

  const clearFilters = () => {
    setDraftYear('')
    setDraftMonth('')
    setDraftScope('all')
    setAppliedYear(null)
    setAppliedMonth(null)
    setAppliedScope('all')
    setFiltersApplied(false)
    setHealth(emptyHealth())
    setCategories(emptyCategories())
    setError(null)
  }

  useEffect(() => {
    void loadOptions()
  }, [loadOptions])

  useEffect(() => {
    if (!filtersApplied || appliedYear == null) return
    void loadHealth(yearFilter, appliedScope, monthFilter)
  }, [appliedYear, appliedMonth, appliedScope, filtersApplied, loadHealth, monthFilter, yearFilter])

  useEffect(() => {
    setFlowKind(null)
    setFlowDetails(null)
    setFlowYear(null)
    setFlowMonth(null)
    setFlowError(null)
    setCategoryView(null)
    setCategoryDetails(null)
    setCategoryError(null)
  }, [appliedYear, appliedMonth, appliedScope])

  useEffect(() => {
    if (!flowKind) {
      setFlowDetails(null)
      setFlowYear(null)
      setFlowMonth(null)
      setFlowError(null)
      setFlowLoading(false)
      return
    }
    let cancelled = false
    const loadDetails = async () => {
      setFlowLoading(true)
      setFlowError(null)
      try {
        const response = await axios.get<FlowDetailsResponse>('/api/financial-health/details', {
          params: {
            kind: flowKind,
            ...healthParams(yearFilter, appliedScope, monthFilter),
          },
        })
        if (!cancelled) {
          setFlowDetails(response.data)
          const months = response.data.months ?? []
          const nextYear = yearFilter ?? months[months.length - 1]?.year ?? null
          setFlowYear(nextYear)
          setFlowMonth(
            nextYear != null && monthFilter != null
              ? yearMonthKey(nextYear, monthFilter)
              : nextYear != null
                ? defaultMonthForYear(nextYear, months)
                : null,
          )
        }
      } catch (err: any) {
        if (!cancelled) {
          setFlowDetails(null)
          setFlowYear(null)
          setFlowMonth(null)
          setFlowError(err.response?.data?.detail || 'Erro ao carregar os lançamentos')
        }
      } finally {
        if (!cancelled) setFlowLoading(false)
      }
    }
    void loadDetails()
    return () => {
      cancelled = true
    }
  }, [appliedScope, flowKind, healthParams, monthFilter, yearFilter])

  useEffect(() => {
    if (!categoryView) {
      setCategoryDetails(null)
      setCategoryError(null)
      setCategoryLoading(false)
      return
    }
    let cancelled = false
    const loadCategory = async () => {
      setCategoryLoading(true)
      setCategoryError(null)
      try {
        const response = await axios.get<FlowDetailsResponse>('/api/financial-health/details', {
          params: {
            kind: categoryView.kind,
            tag_id: categoryView.tag_id ?? -1,
            ...healthParams(yearFilter, appliedScope, monthFilter),
          },
        })
        if (!cancelled) setCategoryDetails(response.data)
      } catch (err: any) {
        if (!cancelled) {
          setCategoryDetails(null)
          setCategoryError(err.response?.data?.detail || 'Erro ao carregar a categoria')
        }
      } finally {
        if (!cancelled) setCategoryLoading(false)
      }
    }
    void loadCategory()
    return () => {
      cancelled = true
    }
  }, [appliedScope, categoryView, healthParams, monthFilter, yearFilter])

  const closeCardModal = useCallback(() => {
    setCardView(null)
  }, [])

  const openCardModal = useCallback((item: FlowDetailItem) => {
    if (!item.card_id) return
    const fallback: CardViewData = {
      id: item.card_id,
      name: item.card_name || 'Cartão',
      number: item.card_number || null,
    }
    setCardView(fallback)
    axios.get<CardViewData>(`/api/cartoes/${item.card_id}`)
      .then((response) => {
        setCardView((current) => {
          if (!current || current.id !== response.data.id) return current
          return {
            id: response.data.id,
            name: response.data.name,
            number: response.data.number,
            description: response.data.description,
            type: response.data.type,
            closing_day: response.data.closing_day,
            invoice_group_name: response.data.invoice_group_name,
            active: response.data.active,
            is_account_card: response.data.is_account_card,
          }
        })
      })
      .catch(() => undefined)
  }, [])

  const closeFlowModal = useCallback(() => {
    setCardView(null)
    setFlowKind(null)
    setFlowDetails(null)
    setFlowYear(null)
    setFlowMonth(null)
    setFlowError(null)
  }, [])

  const closeCategoryModal = useCallback(() => {
    setCardView(null)
    setCategoryView(null)
    setCategoryDetails(null)
    setCategoryError(null)
    setCategoryTab('chart')
  }, [])

  useEscapeKey(closeCardModal, cardView != null)
  useEscapeKey(closeFlowModal, flowKind != null && cardView == null)
  useEscapeKey(closeCategoryModal, categoryView != null && cardView == null)

  const selected = aggregateMonths(health.months)
  const opening = Number(selected?.opening_balance || 0)
  const entries = Number(selected?.entries || 0)
  const exits = Number(selected?.exits || 0)
  const closing = Number(selected?.closing_balance || 0)
  const monthCount = health.months.length || 1
  const avgEntries = toMoney(entries / monthCount)
  const avgExits = toMoney(exits / monthCount)
  const hasSeries = health.months.length > 0
  const hasActiveFilters = draftYear !== '' || draftMonth !== '' || draftScope !== 'all' || filtersApplied
  const openMonth = health.months.find((item) => item.is_open) ?? null
  const openYearMonth = openMonth?.year_month ?? null

  const entryTrend = linearTrend(health.months.map((item) => Number(item.entries || 0)))
  const exitTrend = linearTrend(health.months.map((item) => Number(item.exits || 0)))
  const series = health.months.map((item, index) => ({
    ...item,
    label: shortMonthLabel(item.year_month),
    net: toMoney(Number(item.entries || 0) - Number(item.exits || 0)),
    trend_entries: entryTrend[index] ?? 0,
    trend_exits: exitTrend[index] ?? 0,
  }))
  const monthTickInterval = series.length <= 16 ? 0 : 'preserveEnd'

  const openingHint = !selected
    ? 'Sem dados neste período'
    : monthFilter
      ? 'Saldo do rateio até o mês anterior'
    : yearFilter
      ? 'Saldo do rateio até o ano anterior'
      : appliedScope === 'shared'
        ? 'Parte compartilhada no início da série'
        : 'Saldo no início da série'

  const flowMonths = flowDetails?.months ?? []
  const flowYears = useMemo(() => {
    const years = new Set<number>()
    health.months.forEach((item) => years.add(item.year))
    flowMonths.forEach((item) => years.add(item.year))
    return [...years].sort((left, right) => right - left)
  }, [flowMonths, health.months])
  const showYearTabs = yearFilter == null
  const showMonthStrip = monthFilter == null
  const activeFlowYear = flowYear ?? flowYears[0] ?? null
  const activeFlowMonthKey =
    flowMonth ?? (activeFlowYear != null ? defaultMonthForYear(activeFlowYear, flowMonths) : null)
  const activeFlowMonth = activeFlowMonthKey
    ? flowMonths.find((item) => item.year_month === activeFlowMonthKey) ?? {
        year: Number(activeFlowMonthKey.slice(0, 4)),
        month: Number(activeFlowMonthKey.slice(5, 7)),
        year_month: activeFlowMonthKey,
        is_open: openYearMonth === activeFlowMonthKey,
        total: 0,
        count: 0,
        items: [],
      }
    : null

  const categoryChartSeries = useMemo(() => {
    const totals = new Map((categoryDetails?.months ?? []).map((item) => [item.year_month, Number(item.total || 0)]))
    const amounts = health.months.map((item) => totals.get(item.year_month) ?? 0)
    const trend = linearTrend(amounts)
    return health.months.map((item, index) => ({
      year_month: item.year_month,
      amount: amounts[index],
      trend: trend[index] ?? 0,
      is_open: Boolean(item.is_open),
    }))
  }, [categoryDetails, health.months])

  const scorecardCls =
    'rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm dark:border-gray-700 dark:bg-gray-800'
  const scorecardButtonCls = `${scorecardCls} w-full transition-all hover:border-[var(--color-1)] hover:shadow-md`
  const chartCardCls =
    'rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800'

  const emptyAction = (
    <Link
      to="/fechamentos/conta"
      className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
      style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}
    >
      Ir para fechamentos da conta
    </Link>
  )

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <CadastroListPageShell>
        <CadastroListPageBody
          header={
            <CadastroListPageHero
              icon={<Activity className="h-8 w-8" />}
              title="Saúde Financeira"
              subtitle={
                filtersApplied
                  ? `Soma dos fechamentos · ${resultTitle}`
                  : 'A saúde soma a repartição Conta / Compartilhado de cada mês fechado'
              }
            />
          }
          tabs={
            <CadastroListPageFilterCard
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearFilters}
              onApply={applyFilters}
              applying={loading || filtersLoading}
              resultHint={filtersApplied ? resultTitle : undefined}
            >
              <CadastroFilterField label="Ano" icon={<Calendar size={12} />}>
                <select
                  value={draftYear}
                  onChange={(event) => {
                    const value = event.target.value
                    setDraftYear(value)
                    if (value === '') setDraftMonth('')
                  }}
                  className={cadastroFilterFieldCls}
                  disabled={filtersLoading || loading}
                >
                  <option value="">Todos</option>
                  {yearOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </CadastroFilterField>
              <CadastroFilterField label="Mês" icon={<Calendar size={12} />}>
                <select
                  value={draftYear === '' ? '' : draftMonth}
                  onChange={(event) => setDraftMonth(event.target.value)}
                  className={cadastroFilterFieldCls}
                  disabled={filtersLoading || loading || draftYear === ''}
                >
                  <option value="">Todos</option>
                  {MONTH_FULL.map((label, index) => (
                    <option key={label} value={index + 1}>{label}</option>
                  ))}
                </select>
              </CadastroFilterField>
              <CadastroFilterField label="Escopo" icon={<Users size={12} />}>
                <select
                  value={draftScope}
                  onChange={(event) => setDraftScope(event.target.value as HealthScope)}
                  className={cadastroFilterFieldCls}
                  disabled={filtersLoading || loading}
                >
                  {SCOPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </CadastroFilterField>
            </CadastroListPageFilterCard>
          }
        >
          <div className="space-y-6 pb-8">
            {!filtersApplied && !loading && (
              <CadastroListPageEmptyCard
                icon={<Filter className="h-8 w-8 text-[var(--color-1)]" />}
                title="Nenhum filtro aplicado"
                description="Selecione o ano, o mês e o escopo e clique em Aplicar para somar os fechamentos e ver a repartição mês a mês."
              />
            )}

            {filtersApplied && loading && (
              <div className="rounded-xl border border-gray-200 bg-white py-16 dark:border-gray-700 dark:bg-gray-800">
                <LoadingSpinner message={`Carregando ${resultTitle}...`} />
              </div>
            )}

            {filtersApplied && !loading && error && (
              <div className="flex items-start gap-3 rounded-xl border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] p-4">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-danger)]" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Erro</p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{error}</p>
                  <button
                    type="button"
                    onClick={() => void loadHealth(yearFilter, appliedScope, monthFilter)}
                    className="mt-3 text-sm font-semibold text-[var(--color-1)] underline"
                  >
                    Tentar novamente
                  </button>
                </div>
              </div>
            )}

            {filtersApplied && !loading && !error && !hasSeries && (
              <CadastroListPageEmptyCard
                icon={<Scale className="h-8 w-8 text-[var(--color-1)]" />}
                title="Nenhum mês fechado"
                description="A saúde soma a repartição Conta / Compartilhado gravada em cada fechamento. Feche os períodos em Conta para ver a série."
                action={emptyAction}
              />
            )}

            {filtersApplied && !loading && !error && hasSeries && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className={scorecardCls}>
                    <div className="flex items-center gap-3">
                      <Landmark className="h-5 w-5 text-[var(--color-1)]" />
                      <div>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {monthFilter ? 'Saldo mês anterior' : yearFilter ? 'Saldo ano anterior' : 'Saldo inicial'}
                        </p>
                        <p
                          className="text-xl font-bold"
                          style={{ color: opening >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}
                        >
                          {selected ? formatCurrency(opening) : '—'}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">{openingHint}</p>
                  </div>
                  <button
                    type="button"
                    className={scorecardButtonCls}
                    onClick={() => {
                      setCategoryView(null)
                      setFlowKind('entries')
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <ArrowDownCircle className="h-5 w-5 text-[var(--color-success)]" />
                      <div>
                        <p className="text-xs text-gray-600 dark:text-gray-400">Entradas</p>
                        <p className="text-xl font-bold text-[var(--color-success)]">
                          {formatCurrency(entries)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">
                      Média {formatCurrency(avgEntries)} / mês · ver detalhes
                    </p>
                    <SplitHint
                      account={splitOf(selected).account.entries}
                      shared={splitOf(selected).shared.entries}
                    />
                  </button>
                  <button
                    type="button"
                    className={scorecardButtonCls}
                    onClick={() => {
                      setCategoryView(null)
                      setFlowKind('exits')
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <ArrowUpCircle className="h-5 w-5 text-[var(--color-danger)]" />
                      <div>
                        <p className="text-xs text-gray-600 dark:text-gray-400">Saídas</p>
                        <p className="text-xl font-bold text-[var(--color-danger)]">
                          {formatCurrency(exits)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">
                      Média {formatCurrency(avgExits)} / mês · ver detalhes
                    </p>
                    <SplitHint
                      account={splitOf(selected).account.exits}
                      shared={splitOf(selected).shared.exits}
                      invert
                    />
                  </button>
                  <div className={scorecardCls}>
                    <div className="flex items-center gap-3">
                      <Wallet
                        className="h-5 w-5"
                        style={{ color: closing >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}
                      />
                      <div>
                        <p className="text-xs text-gray-600 dark:text-gray-400">Resultado</p>
                        <p
                          className="text-xl font-bold"
                          style={{ color: closing >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}
                        >
                          {formatCurrency(closing)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">
                      {monthFilter ? 'Saldo mês anterior' : yearFilter ? 'Saldo ano anterior' : 'Saldo inicial'} + entradas − saídas
                      {openMonth ? ' · inclui mês corrente em aberto' : ''}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <div className={chartCardCls}>
                    <h3 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
                      Evolução do fechamento
                    </h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={series} margin={{ top: 28, right: 8, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="year_month"
                          stroke="#6b7280"
                          fontSize={12}
                          height={openYearMonth ? 42 : 28}
                          tick={<MonthAxisTick openYearMonth={openYearMonth} />}
                          interval={monthTickInterval}
                        />
                        <YAxis tickFormatter={(value) => formatCurrency(Number(value))} stroke="#6b7280" fontSize={11} width={88} />
                        <Tooltip
                          formatter={(value) => formatCurrency(Number(value))}
                          labelFormatter={(label) => {
                            const key = String(label)
                            const suffix = key === openYearMonth ? ' · mês corrente em aberto' : ''
                            return `${shortMonthLabel(key)}${suffix}`
                          }}
                          contentStyle={chartTooltipStyle}
                        />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="closing_balance"
                          name="Fechamento"
                          stroke={colors.primary}
                          fill={colors.primary}
                          fillOpacity={0.18}
                          strokeWidth={2}
                        />
                        {openYearMonth ? (
                          <ReferenceLine x={openYearMonth} stroke="var(--color-warning)" strokeDasharray="4 4">
                            <Label
                              value="Mês corrente em aberto"
                              position="top"
                              fill="var(--color-warning)"
                              fontSize={11}
                              fontWeight={600}
                            />
                          </ReferenceLine>
                        ) : null}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div className={chartCardCls}>
                    <h3 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
                      Entradas vs saídas
                    </h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <ComposedChart data={series} margin={{ top: 28, right: 8, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="year_month"
                          stroke="#6b7280"
                          fontSize={12}
                          height={openYearMonth ? 42 : 28}
                          tick={<MonthAxisTick openYearMonth={openYearMonth} />}
                          interval={monthTickInterval}
                        />
                        <YAxis tickFormatter={(value) => formatCurrency(Number(value))} stroke="#6b7280" fontSize={11} width={88} />
                        <Tooltip
                          formatter={(value) => formatCurrency(Number(value))}
                          labelFormatter={(label) => {
                            const key = String(label)
                            const suffix = key === openYearMonth ? ' · mês corrente em aberto' : ''
                            return `${shortMonthLabel(key)}${suffix}`
                          }}
                          contentStyle={chartTooltipStyle}
                        />
                        <Legend
                          payload={[
                            { value: 'Entradas', type: 'square', color: colors.success, id: 'entries' },
                            { value: 'Saídas', type: 'square', color: colors.danger, id: 'exits' },
                            { value: 'Tendência entradas', type: 'line', color: colors.success, id: 'trend_entries' },
                            { value: 'Tendência saídas', type: 'line', color: colors.danger, id: 'trend_exits' },
                          ]}
                        />
                        <Bar dataKey="entries" name="Entradas" fill={colors.success} radius={[4, 4, 0, 0]}>
                          {series.map((item) => (
                            <Cell
                              key={`entries-${item.year_month}`}
                              fill={colors.success}
                              fillOpacity={item.is_open ? 0.45 : 1}
                            />
                          ))}
                        </Bar>
                        <Bar dataKey="exits" name="Saídas" fill={colors.danger} radius={[4, 4, 0, 0]}>
                          {series.map((item) => (
                            <Cell
                              key={`exits-${item.year_month}`}
                              fill={colors.danger}
                              fillOpacity={item.is_open ? 0.45 : 1}
                            />
                          ))}
                        </Bar>
                        <Line
                          type="monotone"
                          dataKey="trend_entries"
                          name="Tendência entradas"
                          stroke={colors.success}
                          strokeDasharray="6 4"
                          strokeWidth={2}
                          dot={false}
                          legendType="line"
                        />
                        <Line
                          type="monotone"
                          dataKey="trend_exits"
                          name="Tendência saídas"
                          stroke={colors.danger}
                          strokeDasharray="6 4"
                          strokeWidth={2}
                          dot={false}
                          legendType="line"
                        />
                        {openYearMonth ? (
                          <ReferenceLine x={openYearMonth} stroke="var(--color-warning)" strokeDasharray="4 4">
                            <Label
                              value="Mês corrente em aberto"
                              position="top"
                              fill="var(--color-warning)"
                              fontSize={11}
                              fontWeight={600}
                            />
                          </ReferenceLine>
                        ) : null}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <MonthSplitTable months={health.months} />

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <CategoryShareTable
                    title="Receitas por categoria"
                    hint={`Créditos do extrato agrupados por tag em ${resultTitle.toLowerCase()}`}
                    group={categories.entries}
                    tone="success"
                    onView={(item) => {
                      setFlowKind(null)
                      setCategoryTab('chart')
                      setCategoryView({
                        kind: 'entries',
                        tag_id: item.tag_id,
                        tag_name: item.tag_name,
                        icon: item.icon,
                      })
                    }}
                  />
                  <CategoryShareTable
                    title="Gastos por categoria"
                    hint={`Débitos do extrato e itens das faturas conciliadas, por tag, em ${resultTitle.toLowerCase()}`}
                    group={categories.exits}
                    tone="danger"
                    onView={(item) => {
                      setFlowKind(null)
                      setCategoryTab('chart')
                      setCategoryView({
                        kind: 'exits',
                        tag_id: item.tag_id,
                        tag_name: item.tag_name,
                        icon: item.icon,
                      })
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </CadastroListPageBody>
      </CadastroListPageShell>

      {flowKind && (
        <CadastroModalShell maxWidth="max-w-6xl">
          <CadastroModalHeader
            isEdit={false}
            title={flowKind === 'entries' ? 'Entradas' : 'Saídas'}
            subtitle={`${resultTitle}${flowDetails ? ` · ${flowDetails.count} lançamento${flowDetails.count === 1 ? '' : 's'}` : ''}`}
            icon={flowKind === 'entries' ? <ArrowDownCircle size={18} /> : <ArrowUpCircle size={18} />}
            iconStyle={{
              backgroundColor: flowKind === 'entries' ? 'var(--color-success)' : 'var(--color-danger)',
              color: flowKind === 'entries' ? 'var(--on-color-success)' : 'var(--on-color-danger)',
            }}
            onClose={closeFlowModal}
          />
          <CadastroModalBody
            chrome={
              !flowLoading && !flowError && flowDetails ? (
                <>
                  {showYearTabs && flowYears.length > 0 && activeFlowYear != null ? (
                    <CadastroListPageTabs
                      tabs={flowYears.map((year) => ({
                        key: String(year),
                        label: String(year),
                        count: flowMonths
                          .filter((item) => item.year === year)
                          .reduce((sum, item) => sum + item.count, 0) || undefined,
                      }))}
                      active={String(activeFlowYear)}
                      onChange={(key) => {
                        const nextYear = Number(key)
                        setFlowYear(nextYear)
                        setFlowMonth(defaultMonthForYear(nextYear, flowMonths))
                      }}
                    />
                  ) : null}
                  {showMonthStrip && activeFlowYear != null ? (
                    <div className="mb-4">
                      <MonthStrip
                        year={activeFlowYear}
                        activeYearMonth={activeFlowMonthKey ?? yearMonthKey(activeFlowYear, 1)}
                        months={flowMonths.filter((item) => item.year === activeFlowYear)}
                        onChange={setFlowMonth}
                      />
                    </div>
                  ) : null}
                </>
              ) : null
            }
          >
            {flowLoading && (
              <div className="py-12">
                <LoadingSpinner message="Carregando lançamentos..." />
              </div>
            )}
            {!flowLoading && flowError && (
              <p className="py-8 text-center text-sm text-[var(--color-danger)]">{flowError}</p>
            )}
            {!flowLoading && !flowError && flowDetails && (
              <>
                {activeFlowMonth && activeFlowMonth.items.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-500">Nenhum lançamento neste mês.</p>
                ) : null}
                {activeFlowMonth && activeFlowMonth.items.length > 0 ? (
                  <FlowMonthItemsTable
                    month={activeFlowMonth}
                    amountColor={flowKind === 'entries' ? 'var(--color-success)' : 'var(--color-danger)'}
                    showTitle={monthFilter != null}
                    onViewCard={openCardModal}
                  />
                ) : null}
              </>
            )}
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeFlowModal}
            hideSave
            closeLabel="Fechar"
            leading={
              flowDetails ? (
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  Total do período {formatCurrency(Number(flowDetails.total))}
                </span>
              ) : null
            }
          />
        </CadastroModalShell>
      )}

      {categoryView && (
        <CadastroModalShell maxWidth="max-w-6xl">
          <CadastroModalHeader
            isEdit={false}
            title={categoryView.tag_name}
            subtitle={`${categoryView.kind === 'entries' ? 'Receitas' : 'Gastos'} · ${resultTitle}${categoryDetails ? ` · ${categoryDetails.count} lançamento${categoryDetails.count === 1 ? '' : 's'}` : ''}`}
            icon={categoryView.kind === 'entries' ? <ArrowDownCircle size={18} /> : <ArrowUpCircle size={18} />}
            iconStyle={{
              backgroundColor: categoryView.kind === 'entries' ? 'var(--color-success)' : 'var(--color-danger)',
              color: categoryView.kind === 'entries' ? 'var(--on-color-success)' : 'var(--on-color-danger)',
            }}
            onClose={closeCategoryModal}
          />
          <CadastroModalBody
            chrome={
              <CadastroModalTabs
                ariaLabel="Visualização da categoria"
                tabs={[
                  { key: 'chart', label: 'Gráfico' },
                  { key: 'items', label: 'Lançamentos', badge: categoryDetails?.count || undefined },
                ]}
                active={categoryTab}
                onChange={setCategoryTab}
              />
            }
          >
            {categoryLoading && (
              <div className="py-12">
                <LoadingSpinner message="Carregando categoria..." />
              </div>
            )}
            {!categoryLoading && categoryError && (
              <p className="py-8 text-center text-sm text-[var(--color-danger)]">{categoryError}</p>
            )}
            {!categoryLoading && !categoryError && categoryTab === 'chart' && (
              categoryChartSeries.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">Sem dados para montar o gráfico.</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={categoryChartSeries} margin={{ top: 28, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="year_month"
                      stroke="#6b7280"
                      fontSize={12}
                      height={openYearMonth ? 42 : 28}
                      tick={<MonthAxisTick openYearMonth={openYearMonth} />}
                      interval={monthTickInterval}
                    />
                    <YAxis tickFormatter={(value) => formatCurrency(Number(value))} stroke="#6b7280" fontSize={11} width={88} />
                    <Tooltip
                      formatter={(value) => formatCurrency(Number(value))}
                      labelFormatter={(label) => shortMonthLabel(String(label))}
                      contentStyle={chartTooltipStyle}
                    />
                    <Legend
                      payload={[
                        {
                          value: categoryView.kind === 'entries' ? 'Receitas' : 'Gastos',
                          type: 'square',
                          color: categoryView.kind === 'entries' ? colors.success : colors.danger,
                          id: 'amount',
                        },
                        {
                          value: 'Tendência',
                          type: 'line',
                          color: categoryView.kind === 'entries' ? colors.success : colors.danger,
                          id: 'trend',
                        },
                      ]}
                    />
                    <Bar
                      dataKey="amount"
                      name={categoryView.kind === 'entries' ? 'Receitas' : 'Gastos'}
                      fill={categoryView.kind === 'entries' ? colors.success : colors.danger}
                      radius={[4, 4, 0, 0]}
                    >
                      {categoryChartSeries.map((item) => (
                        <Cell
                          key={item.year_month}
                          fill={categoryView.kind === 'entries' ? colors.success : colors.danger}
                          fillOpacity={item.is_open ? 0.45 : 1}
                        />
                      ))}
                    </Bar>
                    <Line
                      type="monotone"
                      dataKey="trend"
                      name="Tendência"
                      stroke={categoryView.kind === 'entries' ? colors.success : colors.danger}
                      strokeDasharray="6 4"
                      strokeWidth={2}
                      dot={false}
                      legendType="line"
                    />
                    {openYearMonth ? (
                      <ReferenceLine x={openYearMonth} stroke="var(--color-warning)" strokeDasharray="4 4">
                        <Label
                          value="Mês corrente em aberto"
                          position="top"
                          fill="var(--color-warning)"
                          fontSize={11}
                          fontWeight={600}
                        />
                      </ReferenceLine>
                    ) : null}
                  </ComposedChart>
                </ResponsiveContainer>
              )
            )}
            {!categoryLoading && !categoryError && categoryTab === 'items' && (
              (categoryDetails?.months.length ?? 0) === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">Nenhum lançamento nesta categoria.</p>
              ) : (
                <div className="space-y-6">
                  {(categoryDetails?.months ?? []).slice().sort(byYearMonthDesc).map((month) => (
                    <FlowMonthItemsTable
                      key={month.year_month}
                      month={month}
                      amountColor={categoryView.kind === 'entries' ? 'var(--color-success)' : 'var(--color-danger)'}
                      onViewCard={openCardModal}
                    />
                  ))}
                </div>
              )
            )}
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeCategoryModal}
            hideSave
            closeLabel="Fechar"
            leading={
              categoryDetails ? (
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  Total {formatCurrency(Number(categoryDetails.total))}
                </span>
              ) : null
            }
          />
        </CadastroModalShell>
      )}

      {cardView && (
        <CadastroModalShell maxWidth="max-w-lg" zClass="z-[110]">
          <CadastroModalHeader
            isEdit={false}
            title={cardView.name}
            subtitle={cardView.number ? `Final ${cardView.number}` : 'Dados do cartão'}
            icon={<CreditCard size={18} />}
            iconStyle={{
              backgroundColor: 'var(--color-2)',
              color: 'var(--on-color-2, #fff)',
            }}
            onClose={closeCardModal}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Identificação" icon={<CreditCard size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow cols={2}>
                  <CardInfoRow label="Nome" value={cardView.name || '—'} />
                  <CardInfoRow label="Final" value={cardView.number ? String(cardView.number) : '—'} />
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow cols={2}>
                  <CardInfoRow label="Tipo" value={cardTypeLabel(cardView.type)} />
                  <CardInfoRow
                    label="Grupo de fatura"
                    value={cardView.invoice_group_name || '—'}
                  />
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow cols={2}>
                  <CardInfoRow
                    label="Dia de fechamento"
                    value={cardView.closing_day != null ? String(cardView.closing_day) : '—'}
                  />
                  <CardInfoRow
                    label="Cartão da conta"
                    value={cardView.is_account_card ? 'Sim' : 'Não'}
                  />
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow>
                  <CardInfoRow
                    label="Status"
                    value={cardView.active === false ? 'Inativo' : 'Ativo'}
                  />
                </CadastroModalFieldsRow>
                {cardView.description ? (
                  <CadastroModalFieldsRow>
                    <CardInfoRow label="Descrição" value={cardView.description} />
                  </CadastroModalFieldsRow>
                ) : null}
              </CadastroModalFieldsGrid>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter onClose={closeCardModal} hideSave closeLabel="Fechar" />
        </CadastroModalShell>
      )}
    </div>
  )
}

export default HealthCheckPage
