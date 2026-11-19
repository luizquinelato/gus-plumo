import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsRight,
  Copy,
  CreditCard,
  Eraser,
  FileSpreadsheet,
  FileText,
  Loader2,
  Maximize2,
  Landmark,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import CadastroExcelMenu, { CadastroListHeaderActions } from '../components/CadastroExcelMenu'
import { DateField } from '../components/date'
import Sidebar from '../components/Sidebar'
import PortalOnly from '../components/PortalOnly'
import { useMobileTopBarActions } from '../contexts/MobileTopBarActionsContext'
import ProjecaoMensalMobileCalendar from '../components/ProjecaoMensalMobileCalendar'
import {
  ProjectionOriginBadge,
  ProjectionOriginLegend,
  defaultProjectionOriginVisibility,
  isProjectionOriginVisible,
  type ProjectionOriginKey,
  type ProjectionSource,
} from '../components/ProjectionOriginBadge'
import ProjectionLaunchCard from '../components/ProjectionLaunchCard'
import { idsManualOverlappingConta } from '../utils/projectionDuplicateDescriptions'
import ExtratoExpenseFlowHost, { type ExtratoFlowExpense } from '../components/ExtratoExpenseFlowHost'
import {
  CALENDAR_VIEW_LABELS,
  type CalendarViewMode,
  calendarCellsForMode,
  clampDay,
  dailyChartPoints,
  periodTotals,
  rangeTitle,
  shiftAnchor,
  visibleDaysForMode,
} from '../utils/projectionCalendarRange'

const OPENING_BALANCE_LABEL = 'Saldo mês anterior'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageShell,
  CadastroListPrimaryButton,
  cadastroFilterFieldCls,
  listPageTableRowHoverCls,
  listPageTableThCls,
  MOBILE_REPORT_INSET_CLS,
  MOBILE_REPORT_SHELL_CLS,
} from '../components/CadastroListPageLayout'
import { useDeviceMode } from '../contexts/DeviceModeContext'
import { ListPageNestedTable } from '../components/ListPageTable'
import {
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
} from '../components/ListTableSelectColumns'
import {
  CadastroFieldLabel,
  CadastroFormSection,
  CadastroModalFieldsGrid,
  CadastroModalFieldsRow,
  cadastroAccentControlCls,
  cadastroFieldCls,
  cadastroOptionLabelCls,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from '../components/CadastroFormLayout'
import { useConfirm } from '../hooks/useConfirm'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useExportRunner } from '../hooks/useExportRunner'
import { downloadExcel, excelDateStamp, type ExcelRow } from '../utils/excelExportClient'
import { downloadPdf, type PdfBlock } from '../utils/pdfExportClient'
import LoadingSpinner from '../components/LoadingSpinner'
import Toast from '../components/Toast'
import { formatCurrency } from '../utils/currency'

type Kind = 'fixed' | 'variable'

interface BreakdownItem {
  card_id: number
  card_name: string
  card_number: string
  amount: string
  my_amount: string
  description?: string
  date?: string | null
  inactive?: boolean
}

interface Expense {
  id: number
  year_month: string
  expected_date: string
  description: string
  amount: string
  my_amount: string
  kind: Kind
  source: ProjectionSource
  breakdown?: BreakdownItem[] | null
  editable?: boolean
  is_actual?: boolean
  source_table?: string | null
  source_id?: number | null
  extrato_actions?: boolean
}

interface Totals {
  fixed: string
  variable: string
  total: string
  my_fixed: string
  my_variable: string
  my_total: string
}

interface Income {
  id: number
  editable: boolean
  description: string
  amount: string
  expected_date: string
  source: ProjectionSource
  is_actual?: boolean
  source_table?: string | null
  source_id?: number | null
  extrato_actions?: boolean
}

interface AutoLine extends Income {
  income: boolean
}

interface CardOption {
  id: number
  name: string
  number: string
  type: string
  active?: boolean
}

interface ExpenseRowForm {
  expected_date: string
  description: string
  amount: string
  kind: Kind
}

interface CardFormState {
  cardIds: number[]
  launchMode: 'invoice' | 'installments'
  sharing: 'own' | 'mine'
}

interface InvoicePreviewRow {
  card_id: number
  card_name: string
  card_number: string
  invoice_year_month: string
  due_day: number
  has_invoice: boolean
  amount: string
  my_amount: string
}

interface ManualExpenseLaunchForm {
  expenseRows: ExpenseRowForm[]
}

interface IncomeLaunchForm {
  periods: number
  /** Adiantamento na projeção no dia 15, mesmo quando o holerite veio em outra data. */
  advanceOnDay15: boolean
}

const launchOptionBtnCls =
  'flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-[var(--color-1)] hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700/50'

const launchHubBtnCls = (active: boolean) =>
  active
    ? 'flex w-full items-center gap-3 rounded-lg border-2 border-[var(--color-1)] bg-[var(--color-1)]/5 px-3 py-2.5 text-left'
    : launchOptionBtnCls

interface InstallmentPreview {
  card_id: number
  card_name: string
  card_number: string
  description: string
  installment: number
  total_installments: number
  amount: string
  my_amount: string
}

interface MonthData {
  year_month: string
  items: Expense[]
  totals: Totals
  income?: Income[]
  income_total?: string
}

interface OverviewMonth {
  year_month: string
  income: string
  expenses: string
  result: string
  income_h1: string
  income_h2: string
  expenses_h1: string
  expenses_h2: string
}

interface FormState {
  id?: number
  expected_date: string
  description: string
  amount: string
  kind: Kind
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const currentYearMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const todayLocal = () => {
  const d = new Date()
  return `${currentYearMonth()}-${String(d.getDate()).padStart(2, '0')}`
}

const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const SOURCE_LABELS: Record<Expense['source'], string> = {
  manual: 'Manual',
  clone: 'Clonado',
  card_invoice: 'Fatura do cartão',
  card_item_manual: 'Item de cartão',
  card_item_installment: 'Parcela de cartão',
  payroll: 'Folha',
  bank_statement: 'Extrato',
}

const EXPORT_COLUMNS = ['Data', 'Descrição', 'Tipo', 'Origem', 'Valor', 'Minha parte']

const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const monthTitle = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]}/${y}`
}

const MAX_MASK_CENTS = 9999999999

/** Valor guardado como decimal com ponto ("-1234.56"); exibido com máscara BRL ("-1.234,56"). */
function maskMoneyDisplay(value: string): string {
  if (!value) return ''
  if (value === '-') return '-'
  const n = Number(value)
  if (Number.isNaN(n)) return ''
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Texto digitado -> decimal com ponto. Dígitos viram centavos; "-" em qualquer posição deixa negativo. */
function parseMoneyInput(raw: string): string {
  const negative = raw.includes('-')
  const digits = raw.replace(/\D/g, '')
  const cents = parseInt(digits || '0', 10)
  if (!cents) return negative ? '-' : ''
  const value = (Math.min(cents, MAX_MASK_CENTS) / 100).toFixed(2)
  return negative ? `-${value}` : value
}

function MoneyMaskInput({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder="0,00"
      value={maskMoneyDisplay(value)}
      onChange={(e) => onChange(parseMoneyInput(e.target.value))}
      className={className}
    />
  )
}


interface ExportLine {
  date: string
  description: string
  type: string
  origin: string
  amount: number
  mine: number | null
}

/** Entradas positivas e gastos negativos, ordenados por data. */
function monthExportLines(month: MonthData): ExportLine[] {
  const incomes: ExportLine[] = (month.income ?? []).map((i) => ({
    date: i.expected_date,
    description: i.description,
    type: 'Receita',
    origin: SOURCE_LABELS[i.source] ?? i.source,
    amount: Number(i.amount),
    mine: null,
  }))
  const expenses: ExportLine[] = month.items.map((e) => ({
    date: e.expected_date,
    description: e.description,
    type: e.kind === 'fixed' ? 'Despesa fixa' : 'Despesa variável',
    origin: SOURCE_LABELS[e.source] ?? e.source,
    amount: -Number(e.amount),
    mine: -Number(e.my_amount),
  }))
  return [...incomes, ...expenses].sort((a, b) => a.date.localeCompare(b.date))
}

const debit = (value: number) => (value > 0 ? `-${formatCurrency(value)}` : formatCurrency(0))
const debitCls = 'text-red-600 dark:text-red-400'
const creditCls = 'text-green-600 dark:text-green-400'

type DetailBreakdownSortField = 'date' | 'description' | 'amount'

const formatProjectionLineDate = (d?: string | null) => {
  if (!d) return '—'
  const s = d.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—'
  const [y, m, day] = s.split('-')
  return `${day}/${m}/${y}`
}

function compareBreakdownRows(
  a: BreakdownItem,
  b: BreakdownItem,
  field: DetailBreakdownSortField,
  direction: 'asc' | 'desc',
) {
  let cmp = 0
  if (field === 'date') {
    const da = a.date?.slice(0, 10) ?? ''
    const db = b.date?.slice(0, 10) ?? ''
    if (!da && db) cmp = 1
    else if (da && !db) cmp = -1
    else cmp = da.localeCompare(db)
  } else if (field === 'description') {
    const ta = a.description ?? a.card_name ?? ''
    const tb = b.description ?? b.card_name ?? ''
    cmp = ta.localeCompare(tb, 'pt-BR', { sensitivity: 'base' })
  } else {
    cmp = Number(a.my_amount ?? a.amount) - Number(b.my_amount ?? b.amount)
  }
  return direction === 'asc' ? cmp : -cmp
}

function DetailSortableTh({
  label,
  field,
  activeField,
  direction,
  onSort,
  align = 'left',
}: {
  label: string
  field: DetailBreakdownSortField
  activeField: DetailBreakdownSortField
  direction: 'asc' | 'desc'
  onSort: (field: DetailBreakdownSortField) => void
  align?: 'left' | 'right'
}) {
  const active = activeField === field
  const alignCls = align === 'right' ? 'text-right' : 'text-left'
  const flexCls = align === 'right' ? 'justify-end' : 'justify-start'
  return (
    <th
      onClick={() => onSort(field)}
      className={`${listPageTableThCls} ${alignCls} cursor-pointer select-none transition-colors hover:bg-gray-200/60 dark:hover:bg-gray-700/50`}
    >
      <span className={`inline-flex items-center gap-1 px-3 py-2 ${flexCls}`}>
        <span>{label}</span>
        {active ? (
          direction === 'asc' ? (
            <ArrowUp size={13} className="shrink-0 text-[var(--color-1)]" />
          ) : (
            <ArrowDown size={13} className="shrink-0 text-[var(--color-1)]" />
          )
        ) : (
          <ArrowUpDown size={13} className="shrink-0 text-gray-400 opacity-40" />
        )}
      </span>
    </th>
  )
}

function CardProjectionDetailTable({
  detail,
  valueOf,
}: {
  detail: Expense
  valueOf: (e: Expense) => number
}) {
  const [sort, setSort] = useState<{ field: DetailBreakdownSortField; direction: 'asc' | 'desc' }>({
    field: 'date',
    direction: 'desc',
  })

  useEffect(() => {
    setSort({ field: 'date', direction: 'desc' })
  }, [detail.id])

  const rows = useMemo(() => {
    const base: BreakdownItem[] = detail.breakdown?.length
      ? detail.breakdown
      : [
          {
            card_id: 0,
            card_name: detail.description,
            card_number: '',
            amount: detail.amount,
            my_amount: detail.my_amount,
            date: detail.expected_date,
            description: detail.description,
          },
        ]
    return [...base].sort((a, b) => compareBreakdownRows(a, b, sort.field, sort.direction))
  }, [detail, sort])

  const onSort = (field: DetailBreakdownSortField) => {
    setSort((prev) =>
      prev.field === field
        ? { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: field === 'date' ? 'desc' : 'asc' },
    )
  }

  return (
    <>
      <ListPageNestedTable
        alignWithListLeading
        leadingMode="index-only"
        colsRest={
          <>
            <ListTableSpacerCol />
            <col style={{ width: 108 }} />
            <col />
            <col style={{ width: 120 }} />
          </>
        }
        head={
          <tr>
            <ListTableIndexHeader />
            <ListTableSpacerHeader />
            <DetailSortableTh
              label="Data"
              field="date"
              activeField={sort.field}
              direction={sort.direction}
              onSort={onSort}
            />
            <DetailSortableTh
              label="Descrição"
              field="description"
              activeField={sort.field}
              direction={sort.direction}
              onSort={onSort}
            />
            <DetailSortableTh
              label="Valor"
              field="amount"
              activeField={sort.field}
              direction={sort.direction}
              onSort={onSort}
              align="right"
            />
          </tr>
        }
      >
        {rows.map((b, i) => (
          <tr key={`${b.card_id}-${b.description ?? ''}-${b.date ?? ''}-${i}`} className={listPageTableRowHoverCls}>
            <ListTableIndexCell index={i + 1} />
            <ListTableSpacerCell />
            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-sm text-gray-700 dark:text-gray-300">
              {formatProjectionLineDate(b.date)}
            </td>
            <td className="px-3 py-2">
              <span className="block text-gray-900 dark:text-gray-100">
                {b.description ?? `${b.card_name}${b.card_number ? ` •${b.card_number}` : ''}`}
              </span>
              {b.description && b.card_name ? (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {b.card_name}
                  {b.card_number ? ` •${b.card_number}` : ''}
                  {b.inactive ? ' · Inativo' : ''}
                </span>
              ) : null}
            </td>
            <td className={`px-3 py-2 text-right tabular-nums ${debitCls}`}>
              {debit(Number(b.my_amount ?? b.amount))}
            </td>
          </tr>
        ))}
      </ListPageNestedTable>
      <p className="border-t border-gray-200 px-3 py-2 text-right text-sm font-semibold text-gray-800 dark:border-gray-700 dark:text-gray-100">
        Total <span className={debitCls}>{debit(valueOf(detail))}</span>
      </p>
    </>
  )
}

export default function ProjecaoMensalPage() {
  const { isMobile } = useDeviceMode()
  const { setActions } = useMobileTopBarActions()
  const { showConfirm, ConfirmComponent } = useConfirm()
  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('month')
  const [anchorDay, setAnchorDay] = useState(() => new Date().getDate())
  const [originVisible, setOriginVisible] = useState(defaultProjectionOriginVisibility)
  const [descriptionQuery, setDescriptionQuery] = useState('')
  const [filterSimilarDescriptions, setFilterSimilarDescriptions] = useState(false)
  const [data, setData] = useState<MonthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const busy = saving || deleting
  const [detail, setDetail] = useState<Expense | null>(null)
  const closeDetail = useCallback(() => setDetail(null), [])
  useEscapeKey(closeDetail, detail != null && !busy)
  const closeForm = useCallback(() => setForm(null), [])
  useEscapeKey(closeForm, form != null && detail == null && !busy)
  const [autoIncome, setAutoIncome] = useState<AutoLine | null>(null)
  const closeAutoIncome = useCallback(() => setAutoIncome(null), [])
  useEscapeKey(closeAutoIncome, autoIncome != null && !busy)
  const [extratoHubOpen, setExtratoHubOpen] = useState(false)
  const [extratoExpense, setExtratoExpense] = useState<ExtratoFlowExpense | null>(null)
  const closeExtratoHub = useCallback(() => {
    setExtratoHubOpen(false)
    setExtratoExpense(null)
  }, [])
  const [launchHubOpen, setLaunchHubOpen] = useState(false)
  const [hubView, setHubView] = useState<'main' | 'clear'>('main')
  const [manualExpenseForm, setManualExpenseForm] = useState<ManualExpenseLaunchForm | null>(null)
  const [incomeLaunchForm, setIncomeLaunchForm] = useState<IncomeLaunchForm | null>(null)
  const [cardForm, setCardForm] = useState<CardFormState | null>(null)
  const [cardOptions, setCardOptions] = useState<CardOption[]>([])
  const [invoicePreview, setInvoicePreview] = useState<InvoicePreviewRow[]>([])
  const [installmentPreview, setInstallmentPreview] = useState<InstallmentPreview[]>([])
  const [cardPreviewLoading, setCardPreviewLoading] = useState(false)
  /** Preferência de seleção entre modos (fatura / estimativa); não encolhe ao trocar de opção. */
  const [, setCardLaunchSelection] = useState<number[]>([])

  const launchableIdsFromInvoice = (rows: InvoicePreviewRow[]) =>
    rows.filter((r) => r.has_invoice).map((r) => r.card_id)

  const launchableIdsFromInstallments = (rows: InstallmentPreview[]) => {
    const counts = new Map<number, number>()
    for (const p of rows) counts.set(p.card_id, (counts.get(p.card_id) ?? 0) + 1)
    return [...counts.keys()]
  }

  const applyCardSelectionForPreview = useCallback(
    (launchMode: 'invoice' | 'installments', invoice: InvoicePreviewRow[], installments: InstallmentPreview[]) => {
      const launchableIds =
        launchMode === 'invoice'
          ? launchableIdsFromInvoice(invoice)
          : launchableIdsFromInstallments(installments)
      setCardLaunchSelection((pref) => {
        const preference = pref.length === 0 ? launchableIds : pref
        const picked = preference.filter((id) => launchableIds.includes(id))
        const cardIds = picked.length > 0 ? picked : launchableIds
        setCardForm((prev) => {
          if (!prev) return prev
          if (
            cardIds.length === prev.cardIds.length &&
            cardIds.every((id, i) => id === prev.cardIds[i])
          ) {
            return prev
          }
          return { ...prev, cardIds }
        })
        return pref.length === 0 ? launchableIds : pref
      })
    },
    [],
  )

  const fetchCardPreview = useCallback(
    async (mode: 'invoice' | 'installments', sharing: 'own' | 'mine', cardIds: number[]) => {
      const key = cardIds.join(',')
      if (!key) {
        setInvoicePreview([])
        setInstallmentPreview([])
        applyCardSelectionForPreview(mode, [], [])
        return
      }
      setCardPreviewLoading(true)
      try {
        if (mode === 'invoice') {
          const res = await axios.get<InvoicePreviewRow[]>('/api/monthly-projections/invoice-preview', {
            params: { year_month: yearMonth, card_ids: key, sharing },
          })
          setInvoicePreview(res.data)
          setInstallmentPreview([])
          applyCardSelectionForPreview('invoice', res.data, [])
        } else {
          const res = await axios.get<InstallmentPreview[]>('/api/monthly-projections/installments-preview', {
            params: { year_month: yearMonth, card_ids: key, sharing },
          })
          setInstallmentPreview(res.data)
          setInvoicePreview([])
          applyCardSelectionForPreview('installments', [], res.data)
        }
      } catch (err) {
        console.error('Erro ao carregar prévia de cartões:', err)
        setInvoicePreview([])
        setInstallmentPreview([])
      } finally {
        setCardPreviewLoading(false)
      }
    },
    [yearMonth, applyCardSelectionForPreview],
  )
  const closeLaunchHub = useCallback(() => {
    setLaunchHubOpen(false)
    setHubView('main')
  }, [])
  const closeManualExpenseForm = useCallback(() => setManualExpenseForm(null), [])
  const closeIncomeLaunchForm = useCallback(() => setIncomeLaunchForm(null), [])
  const closeCardForm = useCallback(() => {
    setCardForm(null)
    setCardLaunchSelection([])
  }, [])
  useEscapeKey(closeLaunchHub, launchHubOpen && !busy)
  useEscapeKey(closeManualExpenseForm, manualExpenseForm != null && !busy)
  useEscapeKey(closeIncomeLaunchForm, incomeLaunchForm != null && !busy)
  useEscapeKey(closeCardForm, cardForm != null && !busy)

  const [overview, setOverview] = useState<OverviewMonth[]>([])
  const [chartView, setChartView] = useState<'month' | 'half'>('half')
  const [chartSectionOpen, setChartSectionOpen] = useState(true)
  const [chartMax, setChartMax] = useState(false)
  const closeChartMax = useCallback(() => setChartMax(false), [])
  useEscapeKey(closeChartMax, chartMax)
  const loadOverview = useCallback(async () => {
    try {
      const res = await axios.get<OverviewMonth[]>('/api/monthly-projections/overview')
      setOverview(res.data)
    } catch (err) {
      console.error('Erro ao carregar visão dos próximos meses:', err)
    }
  }, [])

  const overviewChart = useMemo(
    () => {
      // Regressão linear (mínimos quadrados) sobre o resultado mensal.
      const n = overview.length
      const ys = overview.map((m) => Number(m.result))
      const meanX = (n - 1) / 2
      const meanY = n ? ys.reduce((a, b) => a + b, 0) / n : 0
      let num = 0
      let den = 0
      ys.forEach((y, i) => {
        num += (i - meanX) * (y - meanY)
        den += (i - meanX) ** 2
      })
      const slope = den ? num / den : 0
      return overview.map((m, i) => {
        const [y, mo] = m.year_month.split('-').map(Number)
        return {
          label: `${MONTH_NAMES[mo - 1].slice(0, 3)}/${String(y).slice(2)}`,
          Entradas: Number(m.income),
          Gastos: Number(m.expenses),
          'Tendência do resultado': Math.round((meanY + slope * (i - meanX)) * 100) / 100,
          'Entradas 1ª quinz.': Number(m.income_h1),
          'Entradas 2ª quinz.': Number(m.income_h2),
          'Gastos 1ª quinz.': Number(m.expenses_h1),
          'Gastos 2ª quinz.': Number(m.expenses_h2),
        }
      })
    },
    [overview],
  )

  // Recarrega sem spinner: o calendário continua visível (usado após excluir, mover, editar etc.)
  const load = useCallback(async () => {
    setError(null)
    void loadOverview()
    try {
      const res = await axios.get<MonthData>('/api/monthly-projections', { params: { year_month: yearMonth } })
      setData(res.data)
    } catch (err) {
      console.error('Erro ao carregar gastos esperados:', err)
      setError('Não foi possível carregar os gastos esperados.')
    } finally {
      setLoading(false)
    }
  }, [yearMonth, loadOverview])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEffect(() => {
    setAnchorDay((d) => clampDay(yearMonth, d))
  }, [yearMonth])

  const exportRunner = useExportRunner((message) =>
    window.dispatchEvent(new CustomEvent('app:error-alert', { detail: { title: 'Erro ao exportar', message } })),
  )

  const MAX_EXPORT_MONTHS = 36
  const [exportOpt, setExportOpt] = useState<
    { kind: 'excel' | 'pdf'; mode: 'current' | 'range'; from: string; to: string } | null
  >(null)
  const closeExportOpt = useCallback(() => setExportOpt(null), [])
  useEscapeKey(closeExportOpt, exportOpt != null)

  const exportRange = (o: { mode: 'current' | 'range'; from: string; to: string }): string[] => {
    if (o.mode === 'current') return [yearMonth]
    const list: string[] = []
    for (let ym = o.from; ym <= o.to && list.length < MAX_EXPORT_MONTHS; ym = shiftMonth(ym, 1)) list.push(ym)
    return list
  }
  const exportRangeValid = (o: { from: string; to: string }) =>
    /^\d{4}-\d{2}$/.test(o.from) && /^\d{4}-\d{2}$/.test(o.to) && o.from <= o.to

  const confirmExport = () => {
    if (!exportOpt || (exportOpt.mode === 'range' && !exportRangeValid(exportOpt))) return
    const months = exportRange(exportOpt)
    const kind = exportOpt.kind
    setExportOpt(null)
    if (kind === 'excel') void handleExportExcel(months)
    else void handleExportPdf(months)
  }

  /** Busca os dados de cada mês informado. */
  const fetchExportMonths = async (months: string[]) => {
    const results = await Promise.all(
      months.map((ym) => axios.get<MonthData>('/api/monthly-projections', { params: { year_month: ym } })),
    )
    return results.map((res, i) => ({ ym: months[i], lines: monthExportLines(res.data) }))
  }

  const handleExportExcel = (monthList: string[]) =>
    exportRunner.run('Gerando Excel…', async () => {
      const months = await fetchExportMonths(monthList)
      const sheets = months.map(({ ym, lines }) => {
        const total = lines.reduce((acc, l) => acc + l.amount, 0)
        const rows: ExcelRow[] = lines.map((l) => ({
          Data: brDate(l.date),
          Descrição: l.description,
          Tipo: l.type,
          Origem: l.origin,
          Valor: l.amount,
          'Minha parte': l.mine,
        }))
        return {
          name: ym,
          rows,
          columns: EXPORT_COLUMNS,
          kinds: { Valor: 'money' as const, 'Minha parte': 'money' as const },
          preamble: [[monthTitle(ym)]],
          footer: [['Resultado do mês', '', '', '', total]],
        }
      })
      await downloadExcel(`projecao_mensal_${excelDateStamp()}.xlsx`, sheets)
    })

  const handleExportPdf = (monthList: string[]) =>
    exportRunner.run('Gerando PDF…', async () => {
      const months = await fetchExportMonths(monthList)
      const blocks: PdfBlock[] = []
      months.forEach(({ ym, lines }, idx) => {
        if (idx > 0) blocks.push({ type: 'page_break' })
        const total = lines.reduce((acc, l) => acc + l.amount, 0)
        const money = (v: number) => formatCurrency(v)
        blocks.push({ type: 'heading', text: monthTitle(ym) })
        blocks.push({
          type: 'table',
          font_size: 7,
          columns: [
            { header: 'Data', width_mm: 20 },
            { header: 'Descrição' },
            { header: 'Tipo', width_mm: 28 },
            { header: 'Origem', width_mm: 30 },
            { header: 'Valor', align: 'right', width_mm: 24 },
            { header: 'Minha parte', align: 'right', width_mm: 24 },
          ],
          rows: lines.map((l) => [
            brDate(l.date),
            l.description || '-',
            l.type,
            l.origin || '-',
            money(l.amount),
            l.mine == null ? '-' : money(l.mine),
          ]),
          tones: lines.map((l) => [null, null, null, null, l.amount < 0 ? 'negative' : 'positive', null]),
          footer: ['Resultado do mês', '', '', '', money(total), ''],
          footer_tones: [null, null, null, null, total < 0 ? 'negative' : 'positive', null],
        })
      })
      await downloadPdf(`projecao_mensal_${excelDateStamp()}.pdf`, {
        title: 'Projeção Mensal',
        subtitle: `${months.length} mês(es)`,
        blocks,
      })
    })

  const valueOf = useCallback((e: Expense) => Number(e.amount), [])

  const byDay = useMemo(() => {
    const map = new Map<number, Expense[]>()
    for (const item of data?.items ?? []) {
      const day = Number(item.expected_date.slice(8, 10))
      map.set(day, [...(map.get(day) ?? []), item])
    }
    return map
  }, [data])

  const incomeByDay = useMemo(() => {
    const map = new Map<number, Income[]>()
    for (const item of data?.income ?? []) {
      const day = Number(item.expected_date.slice(8, 10))
      map.set(day, [...(map.get(day) ?? []), item])
    }
    return map
  }, [data])

  const toggleOriginVisible = useCallback((key: ProjectionOriginKey) => {
    setOriginVisible((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const descriptionQueryNorm = descriptionQuery.trim().toLowerCase()

  const matchesCalendarDescription = useCallback(
    (description: string) => {
      if (!descriptionQueryNorm) return true
      return description.toLowerCase().includes(descriptionQueryNorm)
    },
    [descriptionQueryNorm],
  )

  const similarDescriptionIds = useMemo(() => {
    const lines = [
      ...(data?.items ?? []).map((item) => ({
        id: item.id,
        description: item.description,
        source: item.source,
      })),
      ...(data?.income ?? []).map((item) => ({
        id: item.id,
        description: item.description,
        source: item.source,
      })),
    ]
    return idsManualOverlappingConta(lines)
  }, [data])

  const byDayFiltered = useMemo(() => {
    const map = new Map<number, Expense[]>()
    for (const [day, list] of byDay) {
      map.set(
        day,
        list.filter((item) => {
          if (!isProjectionOriginVisible(item.source, originVisible)) return false
          if (!matchesCalendarDescription(item.description)) return false
          if (filterSimilarDescriptions && !similarDescriptionIds.has(item.id)) return false
          return true
        }),
      )
    }
    return map
  }, [byDay, originVisible, matchesCalendarDescription, filterSimilarDescriptions, similarDescriptionIds])

  const incomeByDayFiltered = useMemo(() => {
    const map = new Map<number, Income[]>()
    for (const [day, list] of incomeByDay) {
      map.set(
        day,
        list.filter((item) => {
          if (!isProjectionOriginVisible(item.source, originVisible)) return false
          if (!matchesCalendarDescription(item.description)) return false
          if (filterSimilarDescriptions && !similarDescriptionIds.has(item.id)) return false
          return true
        }),
      )
    }
    return map
  }, [incomeByDay, originVisible, matchesCalendarDescription, filterSimilarDescriptions, similarDescriptionIds])

  const visibleDays = useMemo(
    () => visibleDaysForMode(calendarView, yearMonth, anchorDay),
    [calendarView, yearMonth, anchorDay],
  )

  const cells = useMemo(
    () => calendarCellsForMode(calendarView, yearMonth, anchorDay),
    [calendarView, yearMonth, anchorDay],
  )

  const showQuinzenaChrome = calendarView === 'month'

  /** Dias 14 e 15 na mesma linha da grade → divisor vertical; senão, divisor horizontal. */
  const quinzenaDividerVertical = useMemo(() => {
    if (!showQuinzenaChrome) return true
    const i14 = cells.findIndex((d) => d === 14)
    const i15 = cells.findIndex((d) => d === 15)
    if (i14 < 0 || i15 < 0) return true
    return Math.floor(i14 / 7) === Math.floor(i15 / 7)
  }, [cells, showQuinzenaChrome])

  /** Célula no meio da linha do dia 14 (índice de coluna 3) para o marcador na divisão horizontal. */
  const quinzenaHorizontalMarkerIndex = useMemo(() => {
    if (!showQuinzenaChrome || quinzenaDividerVertical) return -1
    const i14 = cells.findIndex((d) => d === 14)
    if (i14 < 0) return -1
    return Math.floor(i14 / 7) * 7 + 3
  }, [cells, quinzenaDividerVertical, showQuinzenaChrome])

  const amountNum = form ? parseFloat(form.amount) : NaN
  const amountColor = amountNum > 0 ? creditCls : amountNum < 0 ? debitCls : 'text-gray-600 dark:text-gray-400'

  const openNew = (day: number) =>
    setForm({ expected_date: `${yearMonth}-${String(day).padStart(2, '0')}`, description: '', amount: '', kind: 'fixed' })

  const isCardProjection = (e: Expense) => e.source === 'card_invoice' || e.source === 'card_item_installment'

  const openAutomatic = (line: AutoLine) => setAutoIncome(line)

  const openExtratoFromProjection = async (sourceId: number) => {
    try {
      const res = await axios.get(`/api/source-items/bank_statements/${sourceId}/expense-detail`)
      const raw = res.data as Record<string, unknown>
      const dateVal = raw.date
      const dateStr =
        typeof dateVal === 'string'
          ? dateVal
          : dateVal != null
            ? new Date(String(dateVal)).toISOString()
            : ''
      setExtratoExpense({
        id: Number(raw.id),
        date: dateStr,
        description: String(raw.description ?? ''),
        amount: Number(raw.amount),
        source: String(raw.source ?? 'bank'),
        card_number: (raw.card_number as string | null) ?? null,
        card_name: (raw.card_name as string | null) ?? null,
        category: (raw.category as string | null) ?? null,
        subtag_id: (raw.subtag_id as number | null) ?? null,
        subtag_name: (raw.subtag_name as string | null) ?? null,
        tag_name: (raw.tag_name as string | null) ?? null,
        ownership_percentage:
          raw.ownership_percentage != null ? Number(raw.ownership_percentage) : null,
        expense_sharing_id: (raw.expense_sharing_id as number | null) ?? null,
        shared_partner_id: (raw.shared_partner_id as number | null) ?? null,
        shared_partner_name: (raw.shared_partner_name as string | null) ?? null,
        migrated_from_account_id: (raw.migrated_from_account_id as number | null) ?? null,
        linked_invoice: (raw.linked_invoice as ExtratoFlowExpense['linked_invoice']) ?? null,
      })
      setExtratoHubOpen(true)
      setAutoIncome(null)
      setDetail(null)
    } catch (err) {
      console.error('Erro ao abrir lançamento do extrato:', err)
      setError('Não foi possível abrir o lançamento no extrato.')
    }
  }

  const openBankStatementLine = (line: {
    id: number
    description: string
    amount: string
    expected_date: string
    source: ProjectionSource
    extrato_actions?: boolean
    source_table?: string | null
    source_id?: number | null
    income: boolean
  }) => {
    if (
      line.extrato_actions
      && line.source_table === 'bank_statements'
      && line.source_id != null
    ) {
      void openExtratoFromProjection(line.source_id)
      return
    }
    if (line.source === 'bank_statement' && line.description.trim() === OPENING_BALANCE_LABEL) {
      openAutomatic({ ...line, editable: false })
      return
    }
    if (line.source === 'bank_statement' || line.source === 'payroll') {
      openAutomatic({ ...line, editable: false })
      return
    }
    if (line.income) {
      openEditIncome(line as Income)
    }
  }

  const openEdit = (e: Expense) => {
    if (isCardProjection(e)) {
      setDetail(e)
      return
    }
    if (e.source === 'bank_statement') {
      openBankStatementLine({ ...e, income: false })
      return
    }
    if (e.editable === false) {
      openAutomatic({
        id: e.id,
        description: e.description,
        amount: e.amount,
        expected_date: e.expected_date,
        source: e.source,
        editable: false,
        income: false,
      })
      return
    }
    setForm({ id: e.id, expected_date: e.expected_date, description: e.description, amount: `-${e.amount}`, kind: e.kind })
  }

  const [dragOverDay, setDragOverDay] = useState<number | null>(null)

  const canDragExpense = (e: Expense) => e.editable !== false && !isCardProjection(e)

  const moveToDay = async (drag: { id: number; income: boolean }, day: number) => {
    const found: Expense | Income | undefined = drag.income
      ? data?.income?.find((x) => x.id === drag.id)
      : data?.items.find((x) => x.id === drag.id)
    if (!found) return
    const date = `${yearMonth}-${String(day).padStart(2, '0')}`
    if (found.expected_date === date) return
    try {
      await axios.put(`/api/monthly-projections/${drag.id}`, {
        expected_date: date,
        description: found.description,
        amount: drag.income ? Number(found.amount) : -Number(found.amount),
        kind: drag.income ? 'fixed' : (found as Expense).kind,
      })
      await load()
    } catch (err) {
      console.error('Erro ao mover lançamento:', err)
      setError('Não foi possível mover o lançamento.')
    }
  }

  const openEditIncome = (inc: Income) =>
    inc.editable &&
    setForm({ id: inc.id, expected_date: inc.expected_date, description: inc.description, amount: inc.amount, kind: 'fixed' })

  const launchIncome = async () => {
    if (!incomeLaunchForm) return
    setSaving(true)
    try {
      await axios.post('/api/monthly-projections/launch-income', {
        year_month: yearMonth,
        periods: incomeLaunchForm.periods,
        advance_on_day_15: incomeLaunchForm.advanceOnDay15,
      })
      await load()
      setIncomeLaunchForm(null)
    } catch (err) {
      console.error('Erro ao lançar projeção de receitas:', err)
      setError('Não foi possível lançar a projeção de receitas.')
    } finally {
      setSaving(false)
    }
  }

  const openLaunchHub = () => {
    setHubView('main')
    setLaunchHubOpen(true)
  }

  const openManualExpenseLaunch = () => {
    setLaunchHubOpen(false)
    setManualExpenseForm({
      expenseRows: [{ expected_date: `${yearMonth}-01`, description: '', amount: '', kind: 'fixed' }],
    })
  }

  const openIncomeLaunch = () => {
    setLaunchHubOpen(false)
    setIncomeLaunchForm({ periods: 1, advanceOnDay15: true })
  }

  const openCardLaunch = async () => {
    setLaunchHubOpen(false)
    setCardLaunchSelection([])
    const launchMode: CardFormState['launchMode'] = 'invoice'
    const sharing: CardFormState['sharing'] = 'mine'
    try {
      const res = await axios.get<CardOption[]>('/api/cartoes/', { params: { incluir_inativos: true } })
      const allCredit = res.data.filter((c) => c.type === 'credito')
      const credit = allCredit.filter((c) => c.active !== false)
      const ids = credit.map((c) => c.id)
      setCardOptions(credit)
      setCardForm({ cardIds: [], launchMode, sharing })
      await fetchCardPreview(launchMode, sharing, ids)
    } catch (err) {
      console.error('Erro ao carregar cartões:', err)
      setError('Não foi possível carregar os cartões.')
      setCardForm(null)
    }
  }

  const toggleCardSelected = (id: number) => {
    setCardLaunchSelection((pref) => {
      const has = pref.includes(id)
      return has ? pref.filter((x) => x !== id) : [...pref, id]
    })
    setCardForm((prev) => {
      if (!prev) return prev
      const has = prev.cardIds.includes(id)
      const cardIds = has ? prev.cardIds.filter((x) => x !== id) : [...prev.cardIds, id]
      return { ...prev, cardIds }
    })
  }

  const updateExpenseRow = (index: number, patch: Partial<ExpenseRowForm>) =>
    setManualExpenseForm((prev) =>
      prev && { ...prev, expenseRows: prev.expenseRows.map((r, i) => (i === index ? { ...r, ...patch } : r)) },
    )

  const launchExpenses = async () => {
    if (!manualExpenseForm) return
    setSaving(true)
    try {
      for (const r of manualExpenseForm.expenseRows) {
        await axios.post('/api/monthly-projections', {
          expected_date: r.expected_date,
          description: r.description.trim(),
          amount: -Math.abs(Number(r.amount)),
          kind: r.kind,
        })
      }
      await load()
      setManualExpenseForm(null)
    } catch (err) {
      console.error('Erro ao lançar despesas:', err)
      setError('Não foi possível lançar as despesas.')
    } finally {
      setSaving(false)
    }
  }

  const launchCards = async () => {
    if (!cardForm) return
    setSaving(true)
    try {
      await axios.post('/api/monthly-projections/launch-cards', {
        year_month: yearMonth,
        card_ids: cardForm.cardIds,
        mode: cardForm.launchMode,
        sharing: cardForm.sharing,
      })
      await load()
      setCardForm(null)
    } catch (err) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.detail : null
      setError(typeof msg === 'string' ? msg : 'Não foi possível lançar a projeção de cartões.')
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      const body = {
        expected_date: form.expected_date,
        description: form.description,
        amount: Number(form.amount),
        kind: form.kind,
      }
      if (form.id) await axios.put(`/api/monthly-projections/${form.id}`, body)
      else await axios.post('/api/monthly-projections', body)
      await load()
      setForm(null)
    } catch (err) {
      console.error('Erro ao salvar gasto esperado:', err)
      setError('Não foi possível salvar o gasto.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!form?.id) return
    setDeleting(true)
    try {
      await axios.delete(`/api/monthly-projections/${form.id}`)
      await load()
      setForm(null)
    } catch (err) {
      console.error('Erro ao excluir gasto esperado:', err)
      setError('Não foi possível excluir o gasto.')
    } finally {
      setDeleting(false)
    }
  }

  const removeAutomatic = async (id: number) => {
    setDeleting(true)
    try {
      await axios.delete(`/api/monthly-projections/${id}`)
      await load()
      setDetail(null)
      setAutoIncome(null)
    } catch (err) {
      console.error('Erro ao excluir projeção automática:', err)
      setError('Não foi possível excluir a projeção.')
    } finally {
      setDeleting(false)
    }
  }

  // Seletor rápido: grade de meses do ano; clicar no ano abre a grade de anos.
  const [picker, setPicker] = useState<{ year: number; view: 'month' | 'year' } | null>(null)
  const closePicker = useCallback(() => setPicker(null), [])
  useEscapeKey(closePicker, picker != null)
  const pickMonth = (m: number) => {
    if (!picker) return
    setYearMonth(`${picker.year}-${String(m).padStart(2, '0')}`)
    setPicker(null)
  }

  const [cloneMonths, setCloneMonths] = useState<string | null>(null)
  const closeClone = useCallback(() => setCloneMonths(null), [])
  useEscapeKey(closeClone, cloneMonths != null && !busy)

  const [cloneCards, setCloneCards] = useState(true)

  const [whatsappDate, setWhatsappDate] = useState<string | null>(null)
  const closeWhatsapp = useCallback(() => setWhatsappDate(null), [])
  useEscapeKey(closeWhatsapp, whatsappDate != null && !busy)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const closeToast = useCallback(() => setToast(null), [])

  const sendWhatsapp = async () => {
    if (!whatsappDate) return
    setSaving(true)
    try {
      const { data: res } = await axios.post('/api/monthly-projections/send-whatsapp', { date: whatsappDate })
      setWhatsappDate(null)
      setToast({ message: `Enviado: ${res.sent} despesa(s) de ${whatsappDate.split('-').reverse().join('/')}.`, type: 'success' })
    } catch (err) {
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : null
      setToast({ message: typeof detail === 'string' ? detail : 'Não foi possível enviar a mensagem.', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const cloneNext = async () => {
    const months = Math.min(24, Math.max(1, Math.floor(Number(cloneMonths) || 1)))
    setSaving(true)
    try {
      await axios.post('/api/monthly-projections/clone', {
        source_year_month: yearMonth,
        months,
        include_cards: cloneCards,
      })
      setCloneMonths(null)
      setYearMonth(shiftMonth(yearMonth, 1))
    } catch (err) {
      setCloneMonths(null)
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : null
      setError(typeof detail === 'string' ? detail : 'Não foi possível clonar o mês.')
    } finally {
      setSaving(false)
    }
  }

  type LaunchStatementsResponse = {
    created: number
    payroll_confirmation?: {
      description: string
      amount: string
      expected_day: number
      matched_in_extrato: boolean
    }[]
  }

  const postLaunchStatements = async (
    payrollReconcile?: 'keep' | 'clear',
  ): Promise<LaunchStatementsResponse> => {
    const res = await axios.post<LaunchStatementsResponse>('/api/monthly-projections/launch-statements', {
      year_month: yearMonth,
      payroll_reconcile: payrollReconcile ?? null,
    })
    return res.data
  }

  const runLaunchStatements = async () => {
    setLaunchHubOpen(false)
    setSaving(true)
    try {
      let payrollReconcile: 'keep' | 'clear' | undefined
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await postLaunchStatements(payrollReconcile)
        if (res.payroll_confirmation?.length) {
          const lines = res.payroll_confirmation
            .map(
              (p) =>
                `${p.description} — ${formatCurrency(Number(p.amount))} (dia ${p.expected_day})`,
            )
            .join('\n')
          const clearPayroll = await showConfirm({
            title: 'Folha não encontrada no extrato',
            message: `Não há no extrato uma entrada com o valor exato deste(s) lançamento(s) de folha:\n\n${lines}\n\nRemover a projeção da folha ou manter?`,
            confirmText: 'Limpar folha',
            cancelText: 'Manter folha',
            type: 'warning',
          })
          payrollReconcile = clearPayroll ? 'clear' : 'keep'
          continue
        }
        await load()
        setToast({ message: `Extrato atualizado: ${res.created} lançamento(s).`, type: 'success' })
        return
      }
      setError('Não foi possível concluir a atualização com o extrato.')
    } catch (err) {
      console.error('Erro ao atualizar projeção com extrato:', err)
      setError('Não foi possível atualizar a projeção com o extrato.')
    } finally {
      setSaving(false)
    }
  }

  const launchStatements = async () => {
    const label = `${MONTH_NAMES[Number(yearMonth.slice(5, 7)) - 1]} ${yearMonth.slice(0, 4)}`
    const confirmed = await showConfirm({
      title: 'Atualizar com extrato',
      message: `Recriar os lançamentos da conta em ${label} com base no extrato importado? Substitui origem Conta. A folha com valor igual no extrato some sozinha; se não achar, pergunta. Lançamentos manuais não são alterados nem removidos (mesmo com descrição parecida). Cartão não muda.`,
      confirmText: 'Atualizar',
      cancelText: 'Cancelar',
      type: 'warning',
    })
    if (!confirmed) return
    await runLaunchStatements()
  }

  const clearMonth = async (scope: 'manual' | 'account' | 'card' | 'all') => {
    const label = `${MONTH_NAMES[Number(yearMonth.slice(5, 7)) - 1]} ${yearMonth.slice(0, 4)}`
    const copy = {
      manual: `Excluir os lançamentos manuais de ${label}? Conta, cartão e folha permanecem.`,
      account: `Excluir os lançamentos da conta em ${label}? Manuais, cartão e folha permanecem.`,
      card: `Excluir fatura e parcelas de cartão em ${label}? Manuais, conta e folha permanecem.`,
      all: `Excluir definitivamente todos os itens de ${label}, inclusive a folha? Esta ação não pode ser desfeita.`,
    }[scope]
    const confirmed = await showConfirm({
      title: 'Limpar mês',
      message: copy,
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      type: 'danger',
    })
    if (!confirmed) return
    try {
      await axios.delete('/api/monthly-projections', { params: { year_month: yearMonth, scope } })
      await load()
      closeLaunchHub()
    } catch (err) {
      console.error('Erro ao limpar mês:', err)
      setError('Não foi possível limpar o mês.')
    }
  }

  const reportMenuReady = !loading && data != null

  useEffect(() => {
    if (!isMobile) {
      setActions(null)
      return
    }
    setActions(
      <CadastroExcelMenu
        compact
        menuTitle="Mais ações"
        exportDisabled={!reportMenuReady}
        extraItems={[
          {
            id: 'excel',
            label: 'Exportar Excel',
            icon: <FileSpreadsheet size={16} />,
            onClick: () => setExportOpt({ kind: 'excel', mode: 'current', from: yearMonth, to: yearMonth }),
          },
          {
            id: 'pdf',
            label: 'Exportar PDF',
            icon: <FileText size={16} />,
            onClick: () => setExportOpt({ kind: 'pdf', mode: 'current', from: yearMonth, to: yearMonth }),
          },
        ]}
      />,
    )
    return () => setActions(null)
  }, [isMobile, setActions, yearMonth, reportMenuReady])

  const [year, month] = yearMonth.split('-').map(Number)

  const installmentCountByCard = useMemo(() => {
    const m = new Map<number, number>()
    for (const p of installmentPreview) {
      m.set(p.card_id, (m.get(p.card_id) ?? 0) + 1)
    }
    return m
  }, [installmentPreview])

  const launchableCards = useMemo(() => {
    if (!cardForm) return []
    if (cardForm.launchMode === 'invoice') {
      const ids = new Set(invoicePreview.filter((r) => r.has_invoice).map((r) => r.card_id))
      return cardOptions.filter((c) => ids.has(c.id))
    }
    return cardOptions.filter((c) => (installmentCountByCard.get(c.id) ?? 0) > 0)
  }, [cardForm, cardOptions, invoicePreview, installmentCountByCard])

  const cardLaunchBlockedReason = useMemo(() => {
    if (!cardForm || cardPreviewLoading) return null
    if (launchableCards.length === 0) {
      return cardForm.launchMode === 'invoice'
        ? 'Nenhum cartão com fatura importada neste ciclo. Importe a fatura ou use Estimativa.'
        : 'Nenhum cartão com parcelas em aberto neste mês. Use Fatura atual se já importou a fatura.'
    }
    if (cardForm.cardIds.length === 0) return 'Selecione ao menos um cartão.'
    return null
  }, [cardForm, cardPreviewLoading, launchableCards.length, cardForm?.cardIds.length])

  // Totais por metade do mês: 1ª = dias 1–14, 2ª = dias 15 em diante.
  const halfSummary = (second: boolean) => {
    const inHalf = (date: string) => (Number(date.slice(8, 10)) >= 15) === second
    const income = (data?.income ?? []).filter((i) => inHalf(i.expected_date)).reduce((s, i) => s + Number(i.amount), 0)
    const expenses = (data?.items ?? []).filter((e) => inHalf(e.expected_date))
    const sumKind = (kind: Kind) => expenses.filter((e) => e.kind === kind).reduce((s, e) => s + Number(e.amount), 0)
    const fixed = sumKind('fixed')
    const variable = sumKind('variable')
    const daysInMonth = new Date(year, month, 0).getDate()
    const days = second ? daysInMonth - 14 : 14
    return { income, fixed, variable, total: fixed + variable, result: income - (fixed + variable), days }
  }
  const summaryBlocks = useMemo(() => {
    if (calendarView === 'month') {
      return [
        { title: 'Dias 1 a 14', ...halfSummary(false) },
        { title: 'Dia 15 ao fim', ...halfSummary(true) },
      ]
    }
    return [periodTotals(calendarView, yearMonth, anchorDay, data?.income ?? [], data?.items ?? [])]
  }, [calendarView, yearMonth, anchorDay, data])

  const periodChartData = useMemo(
    () => dailyChartPoints(yearMonth, visibleDays, data?.income ?? [], data?.items ?? []),
    [yearMonth, visibleDays, data],
  )

  const goCalendarPrev = () => {
    if (calendarView === 'month') setYearMonth(shiftMonth(yearMonth, -1))
    else {
      const next = shiftAnchor(calendarView, yearMonth, anchorDay, -1)
      setYearMonth(next.yearMonth)
      setAnchorDay(next.anchorDay)
    }
  }

  const goCalendarNext = () => {
    if (calendarView === 'month') setYearMonth(shiftMonth(yearMonth, 1))
    else {
      const next = shiftAnchor(calendarView, yearMonth, anchorDay, 1)
      setYearMonth(next.yearMonth)
      setAnchorDay(next.anchorDay)
    }
  }

  const goCurrentMonth = () => {
    setYearMonth(currentYearMonth())
    setAnchorDay(new Date().getDate())
  }

  const monthNavLabel = calendarView === 'month' ? 'Mês' : 'Período'

  const calendarViewToggle = (
    <div className="flex w-full rounded-lg border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-700 dark:bg-gray-800 sm:inline-flex sm:w-auto">
      {(['day', 'week', 'half', 'month'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => {
            setCalendarView(mode)
            const todayYm = currentYearMonth()
            if (yearMonth === todayYm) setAnchorDay(new Date().getDate())
          }}
          className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-all sm:flex-none sm:px-3 sm:py-1 ${
            calendarView === mode
              ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
          }`}
        >
          {CALENDAR_VIEW_LABELS[mode]}
        </button>
      ))}
    </div>
  )

  const chartViewToggle = (
    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-700 dark:bg-gray-800">
      {([['month', 'Mensal'], ['half', 'Quinzenal']] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => setChartView(value)}
          className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
            chartView === value
              ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )

  const chartUsesOverview = calendarView === 'month'
  const activeChartData = chartUsesOverview ? overviewChart : periodChartData
  const chartHasData = activeChartData.length > 0

  const chartElement = (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={activeChartData}
        margin={isMobile ? { top: 8, right: 4, left: -4, bottom: 0 } : { top: 8, right: 8, left: 8, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af55" />
        <XAxis dataKey="label" tick={{ fontSize: isMobile ? 10 : 12 }} angle={isMobile ? -35 : 0} textAnchor={isMobile ? 'end' : 'middle'} height={isMobile ? 48 : 30} />
        <YAxis tick={{ fontSize: isMobile ? 9 : 12 }} width={isMobile ? 52 : 70} tickFormatter={(v: number) => formatCurrency(v)} />
        <Tooltip formatter={(v) => formatCurrency(Number(v))} />
        <Legend wrapperStyle={isMobile ? { fontSize: 10 } : undefined} />
        <ReferenceLine y={0} stroke="#6b7280" />
        {chartUsesOverview ? (
          chartView === 'month' ? (
            [
              <Bar key="e" dataKey="Entradas" fill="#16a34a" />,
              <Bar key="g" dataKey="Gastos" fill="#dc2626" />,
            ]
          ) : (
            [
              <Bar key="e1" dataKey="Entradas 1ª quinz." fill="#4ade80" />,
              <Bar key="e2" dataKey="Entradas 2ª quinz." fill="#15803d" />,
              <Bar key="g1" dataKey="Gastos 1ª quinz." fill="#f87171" />,
              <Bar key="g2" dataKey="Gastos 2ª quinz." fill="#b91c1c" />,
            ]
          )
        ) : (
          [
            <Bar key="e" dataKey="Entradas" fill="#16a34a" />,
            <Bar key="g" dataKey="Gastos" fill="#dc2626" />,
            <Line key="r" type="monotone" dataKey="Resultado" stroke="#2563eb" strokeWidth={2} dot={false} />,
          ]
        )}
        {chartUsesOverview ? (
          <Line type="linear" dataKey="Tendência do resultado" stroke="#2563eb" strokeWidth={2} strokeDasharray="6 4" dot={false} />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  )


  return (
    <div
      className={`flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900 ${MOBILE_REPORT_SHELL_CLS}`}
    >
      <Sidebar />
      <div className={MOBILE_REPORT_INSET_CLS}>
      <CadastroListPageShell>
        <CadastroListPageBody
          scroll={!isMobile}
          header={
            <CadastroListPageHero
              icon={<CalendarDays className="w-8 h-8" />}
              title="Projeção Mensal"
              subtitle="Planejamento mensal de entradas e gastos fixos e variáveis"
              actions={
                <CadastroListHeaderActions
                  menu={{
                    menuTitle: 'Mais ações',
                    exportDisabled: !reportMenuReady,
                    extraItems: [
                      { id: 'excel', label: 'Exportar Excel', icon: <FileSpreadsheet size={16} />, onClick: () => setExportOpt({ kind: 'excel', mode: 'current', from: yearMonth, to: yearMonth }) },
                      { id: 'pdf', label: 'Exportar PDF', icon: <FileText size={16} />, onClick: () => setExportOpt({ kind: 'pdf', mode: 'current', from: yearMonth, to: yearMonth }) },
                    ],
                  }}
                >
                  <PortalOnly>
                  <button
                    type="button"
                    onClick={() => setWhatsappDate(todayLocal())}
                    title="Enviar despesas do dia por WhatsApp"
                    aria-label="Enviar despesas do dia por WhatsApp"
                    className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white p-2 text-green-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-green-400 dark:hover:bg-gray-700"
                  >
                    <MessageCircle size={18} />
                  </button>
                  <CadastroListPrimaryButton
                    label="Ações"
                    icon={<SlidersHorizontal size={18} />}
                    onClick={openLaunchHub}
                  />
                  </PortalOnly>
                </CadastroListHeaderActions>
              }
            />
          }
        >
          <div className={`flex min-h-0 flex-1 flex-col gap-4 ${isMobile ? 'min-w-0' : 'overflow-y-auto scroll-slim'}`}>
            <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 max-md:mx-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={goCalendarPrev}
                    className="rounded-lg border border-gray-300 p-2 dark:border-gray-600"
                    aria-label={calendarView === 'month' ? 'Mês anterior' : `${monthNavLabel} anterior`}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPicker({ year, view: 'month' })}
                    title="Escolher mês e ano"
                    className="flex min-w-0 flex-1 flex-col items-center rounded-lg px-2 py-1 text-center hover:bg-gray-100 dark:hover:bg-gray-700/60 sm:min-w-[10rem] sm:flex-none"
                  >
                    {calendarView === 'month' ? (
                      <>
                        <span className="text-base font-semibold text-gray-900 dark:text-white sm:text-lg">{MONTH_NAMES[month - 1]}</span>
                        <span className="text-sm font-semibold tabular-nums text-[var(--color-1)]">{year}</span>
                      </>
                    ) : (
                      <span className="text-base font-semibold text-gray-900 dark:text-white sm:text-lg">
                        {rangeTitle(calendarView, yearMonth, anchorDay, MONTH_NAMES)}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={goCalendarNext}
                    className="rounded-lg border border-gray-300 p-2 dark:border-gray-600"
                    aria-label={calendarView === 'month' ? 'Próximo mês' : `Próximo ${monthNavLabel.toLowerCase()}`}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={goCurrentMonth}
                  disabled={
                    calendarView === 'month'
                      ? yearMonth === currentYearMonth()
                      : yearMonth === currentYearMonth() && anchorDay === new Date().getDate()
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 sm:w-auto"
                >
                  Mês atual
                </button>
              </div>
              <div className="flex w-full justify-stretch sm:w-auto sm:shrink-0 sm:justify-end">{calendarViewToggle}</div>
            </div>
            </div>

            {chartHasData && (
              <div className="shrink-0 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    aria-expanded={chartSectionOpen}
                    onClick={() => setChartSectionOpen((open) => !open)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
                  >
                    <ChevronDown
                      size={16}
                      className={`shrink-0 text-gray-500 transition-transform dark:text-gray-400 ${chartSectionOpen ? '' : '-rotate-90'}`}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-700 dark:text-gray-200">
                        {chartUsesOverview ? 'Gráfico — próximos meses' : 'Gráfico — período visível'}
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                        {chartUsesOverview
                          ? `Atualiza ao editar projeções; o mês em foco é ${MONTH_NAMES[month - 1]} ${year}.`
                          : rangeTitle(calendarView, yearMonth, anchorDay, MONTH_NAMES)}
                      </span>
                    </span>
                  </button>
                  {chartSectionOpen ? (
                    <div className="flex shrink-0 items-center gap-2">
                      {chartUsesOverview ? chartViewToggle : null}
                      <button
                        type="button"
                        onClick={() => setChartMax(true)}
                        title="Maximizar gráfico"
                        aria-label="Maximizar gráfico"
                        className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
                      >
                        <Maximize2 size={14} />
                      </button>
                    </div>
                  ) : null}
                </div>
                {chartSectionOpen ? <div className={`mt-2 ${isMobile ? 'h-64' : 'h-56'}`}>{chartElement}</div> : null}
              </div>
            )}

            <div className={`grid grid-cols-1 gap-3 ${calendarView === 'month' ? 'md:grid-cols-[1fr_auto_1fr]' : ''}`}>
              {summaryBlocks.map((h, idx) => (
                <Fragment key={h.title}>
                  {calendarView === 'month' && idx === 1 && (
                    <div className="relative hidden w-[3px] rounded-full bg-[var(--color-1)] md:block">
                      <span
                        title="Segunda metade do mês (dia 15 em diante)"
                        className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--color-1)] text-white shadow"
                      >
                        <ChevronsRight className="h-4 w-4" />
                      </span>
                    </div>
                  )}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{h.title}</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                        <p className="text-xs text-gray-500">Entradas</p>
                        <p className={`text-lg font-semibold tabular-nums ${creditCls}`}>{formatCurrency(h.income)}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                        <p className="text-xs text-gray-500">Gastos</p>
                        <p className={`text-lg font-semibold tabular-nums ${debitCls}`}>{debit(h.total)}</p>
                        <div className="mt-1 flex items-stretch divide-x divide-gray-200 tabular-nums dark:divide-gray-600">
                          <div className="pr-2">
                            <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Fixos</p>
                            <p className={`text-xs font-semibold ${debitCls}`}>{debit(h.fixed)}</p>
                          </div>
                          <div className="pl-2">
                            <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Variáveis</p>
                            <p className={`text-xs font-semibold ${debitCls}`}>{debit(h.variable)}</p>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                        <p className="text-xs text-gray-500">Resultado</p>
                        <p className={`text-lg font-semibold tabular-nums ${h.result >= 0 ? creditCls : debitCls}`}>{formatCurrency(h.result)}</p>
                        {h.result > 0 && (
                          <p
                            title={`Resultado dividido pelos ${h.days} dias desta metade`}
                            className="mt-1 text-xs tabular-nums text-gray-500 dark:text-gray-400"
                          >
                            Pode gastar ~{formatCurrency(h.result / h.days)}/dia
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </Fragment>
              ))}
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex flex-col gap-2">
              <ProjectionOriginLegend
                visible={originVisible}
                onToggle={toggleOriginVisible}
                filterSimilarDescriptions={filterSimilarDescriptions}
                onFilterSimilarDescriptionsChange={setFilterSimilarDescriptions}
              />
              <div className="relative w-full min-w-0">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                  aria-hidden
                />
                <input
                  type="search"
                  value={descriptionQuery}
                  onChange={(e) => setDescriptionQuery(e.target.value)}
                  placeholder="Buscar por descrição no calendário"
                  aria-label="Buscar lançamentos por descrição"
                  className={`${cadastroFilterFieldCls} h-9 w-full pl-9 ${descriptionQuery ? 'pr-9' : 'pr-2'}`}
                />
                {descriptionQuery ? (
                  <button
                    type="button"
                    onClick={() => setDescriptionQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Limpar busca"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
            {loading ? (
              <LoadingSpinner />
            ) : isMobile ? (
              <ProjecaoMensalMobileCalendar
                yearMonth={yearMonth}
                calendarView={calendarView}
                visibleDays={visibleDays}
                byDay={byDayFiltered}
                incomeByDay={incomeByDayFiltered}
                formatCurrency={formatCurrency}
                debit={debit}
                debitCls={debitCls}
                creditCls={creditCls}
                valueOf={(e) => Number(e.amount)}
                onIncome={(inc) =>
                  inc.source === 'bank_statement' || !inc.editable
                    ? openBankStatementLine({ ...(inc as Income), income: true })
                    : openEditIncome(inc as Income)
                }
                onExpense={(e) => openEdit(e as Expense)}
                onDelete={(id) => void removeAutomatic(id)}
                deleting={deleting}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <div
                className={`grid gap-px overflow-hidden bg-gray-200 dark:bg-gray-700 ${
                  calendarView === 'day' ? 'min-w-0 grid-cols-1' : 'min-w-[42rem] grid-cols-7'
                }`}
                style={{
                  gridTemplateRows:
                    calendarView === 'day'
                      ? `minmax(200px, auto)`
                      : `auto repeat(${Math.ceil(cells.length / 7)}, minmax(88px, auto))`,
                }}
              >
                {calendarView !== 'day'
                  ? WEEKDAYS.map((d) => (
                      <div key={d} className="bg-gray-100 p-2 text-center text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {d}
                      </div>
                    ))
                  : null}
                {cells.map((day, i) => {
                  const items = day ? byDayFiltered.get(day) ?? [] : []
                  const dayTotal = items.reduce((s, e) => s + valueOf(e), 0)
                  // Divisor entre os dias 14 e 15: borda inferior nos dias 8–14 (acima da 2ª metade)
                  // e borda direita no dia 14 quando o 15 está na mesma linha.
                  const shadows: string[] = []
                  if (showQuinzenaChrome) {
                    if (day !== null && day >= 8 && day <= 14) shadows.push('inset 0 -3px 0 0 var(--color-1)')
                    if (day === 14 && quinzenaDividerVertical && i % 7 < 6) shadows.push('inset -3px 0 0 0 var(--color-1)')
                  }
                  return (
                    <div
                      key={i}
                      style={shadows.length ? { boxShadow: shadows.join(', ') } : undefined}
                      onDragOver={day ? (ev) => { ev.preventDefault(); setDragOverDay(day) } : undefined}
                      onDragLeave={day ? () => setDragOverDay((d) => (d === day ? null : d)) : undefined}
                      onDrop={
                        day
                          ? (ev) => {
                              ev.preventDefault()
                              setDragOverDay(null)
                              try {
                                const drag = JSON.parse(ev.dataTransfer.getData('text/plain'))
                                if (typeof drag?.id === 'number') void moveToDay(drag, day)
                              } catch {
                                /* arraste de outra origem */
                              }
                            }
                          : undefined
                      }
                      className={`group relative min-h-[88px] p-1.5 ${
                        day === null
                          ? 'bg-gray-50 dark:bg-gray-950'
                          : dragOverDay === day
                            ? 'bg-blue-50 dark:bg-blue-950'
                            : 'bg-white dark:bg-gray-900'
                      }`}
                    >
                      {showQuinzenaChrome && i === quinzenaHorizontalMarkerIndex && (
                        <span
                          title="Segunda metade do mês (dia 15 em diante)"
                          className="pointer-events-none absolute bottom-0 left-1/2 z-10 flex h-6 w-6 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full bg-[var(--color-1)] text-white shadow"
                        >
                          <ChevronsDown className="h-4 w-4" />
                        </span>
                      )}
                      {showQuinzenaChrome && day === 15 && quinzenaDividerVertical && (
                        <span
                          title="Segunda metade do mês (dia 15 em diante)"
                          className="pointer-events-none absolute left-0 top-1/2 z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--color-1)] text-white shadow"
                        >
                          <ChevronsRight className="h-4 w-4" />
                        </span>
                      )}
                      {day && (
                        <>
                          <div className="flex items-center justify-between text-base font-semibold text-gray-700 dark:text-gray-200">
                            <span>{day}</span>
                            <button type="button" onClick={() => openNew(day)} className="rounded p-1 opacity-0 hover:bg-gray-200 group-hover:opacity-100 dark:hover:bg-gray-700" aria-label={`Adicionar lançamento no dia ${day}`}>
                              <Plus className="h-5 w-5" />
                            </button>
                          </div>
                          <div className="mt-1 space-y-1.5">
                            {(incomeByDayFiltered.get(day) ?? []).map((inc) => (
                              <ProjectionLaunchCard
                                key={inc.id}
                                compact
                                source={inc.source}
                                description={inc.description}
                                amount={formatCurrency(Number(inc.amount))}
                                tone="income"
                                draggable={inc.editable}
                                deleting={deleting}
                                title={inc.editable ? 'Receita lançada' : 'Projeção automática: clique para excluir ou lance novamente para atualizar'}
                                onDragStart={(ev) => ev.dataTransfer.setData('text/plain', JSON.stringify({ id: inc.id, income: true }))}
                                onOpen={() =>
                                  inc.source === 'bank_statement' || !inc.editable
                                    ? openBankStatementLine({ ...inc, income: true })
                                    : openEditIncome(inc)
                                }
                                onDelete={() => void removeAutomatic(inc.id)}
                              />
                            ))}
                            {items.map((e) => (
                              <ProjectionLaunchCard
                                key={e.id}
                                compact
                                source={e.source}
                                description={e.description}
                                amount={debit(valueOf(e))}
                                tone={e.kind === 'fixed' ? 'fixed' : 'variable'}
                                draggable={canDragExpense(e)}
                                deleting={deleting}
                                onDragStart={(ev) => ev.dataTransfer.setData('text/plain', JSON.stringify({ id: e.id, income: false }))}
                                onOpen={() => openEdit(e)}
                                onDelete={() => void removeAutomatic(e.id)}
                              />
                            ))}
                          </div>
                          {items.length > 1 && <p className={`mt-1 text-right text-[10px] font-semibold ${debitCls}`}>{debit(dayTotal)}</p>}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
              </div>
            )}
          </div>
        </CadastroListPageBody>
      </CadastroListPageShell>
      </div>

      {detail && (
        <CadastroModalShell maxWidth="max-w-2xl">
          <CadastroModalHeader
            isEdit={false}
            title={detail.description}
            titleAddon={
              <span
                className={`inline-flex min-w-[88px] items-center justify-center rounded px-3 py-1 text-xs font-semibold text-white ${
                  detail.source === 'card_invoice' ? 'bg-green-600' : 'bg-amber-600'
                }`}
              >
                {detail.source === 'card_invoice' ? 'Fatura atual' : 'Estimativa'}
              </span>
            }
            subtitle={`${
              detail.source === 'card_invoice' ? 'Fatura importada do ciclo' : 'Parcelas em aberto no mês'
            } • vencimento ${detail.expected_date.split('-').reverse().join('/')}`}
            onClose={() => setDetail(null)}
            closeDisabled={busy}
            icon={<CreditCard size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection
              title="Detalhes"
              icon={<CreditCard size={14} />}
              hint="Um lançamento por cartão; abaixo, as linhas que compõem o valor."
              bodyClassName="p-0"
            >
              <CardProjectionDetailTable detail={detail} valueOf={valueOf} />
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={() => setDetail(null)}
            closeDisabled={busy}
            closeLabel="Fechar"
            hideSave
            leading={
              <button
                type="button"
                onClick={() => void removeAutomatic(detail.id)}
                disabled={deleting}
                className="inline-flex items-center gap-1 text-sm font-medium text-red-600 disabled:opacity-60 dark:text-red-400"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Excluir
              </button>
            }
          />
        </CadastroModalShell>
      )}

      {picker && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onMouseDown={(e) => e.target === e.currentTarget && closePicker()}
        >
          <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-800 sm:max-w-xs">
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label="Anterior"
                onClick={() => setPicker({ ...picker, year: picker.year - (picker.view === 'year' ? 12 : 1) })}
                className="rounded-lg border border-gray-300 p-1.5 dark:border-gray-600"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPicker({ ...picker, view: picker.view === 'month' ? 'year' : 'month' })}
                title={picker.view === 'month' ? 'Escolher ano' : 'Voltar aos meses'}
                className="rounded-lg px-2 py-1 text-sm font-semibold text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700"
              >
                {picker.view === 'month' ? picker.year : `${picker.year - 5} – ${picker.year + 6}`}
              </button>
              <button
                type="button"
                aria-label="Próximo"
                onClick={() => setPicker({ ...picker, year: picker.year + (picker.view === 'year' ? 12 : 1) })}
                className="rounded-lg border border-gray-300 p-1.5 dark:border-gray-600"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {picker.view === 'month'
                ? MONTH_NAMES.map((name, i) => {
                    const selected = picker.year === year && i + 1 === month
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => pickMonth(i + 1)}
                        className={`rounded-lg px-2 py-2.5 text-sm font-medium ${selected ? 'bg-[var(--color-primary)] text-white' : 'text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700'}`}
                      >
                        {name.slice(0, 3)}
                      </button>
                    )
                  })
                : Array.from({ length: 12 }, (_, i) => picker.year - 5 + i).map((y) => (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setPicker({ year: y, view: 'month' })}
                      className={`rounded-lg px-2 py-2 text-sm ${y === year ? 'bg-[var(--color-primary)] text-white' : 'text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700'}`}
                    >
                      {y}
                    </button>
                  ))}
            </div>
          </div>
        </div>
      )}

      {exportOpt && (
        <CadastroModalShell maxWidth="max-w-md">
          <CadastroModalHeader
            isEdit={false}
            title={exportOpt.kind === 'excel' ? 'Exportar Excel' : 'Exportar PDF'}
            subtitle={`${MONTH_NAMES[month - 1]} ${year}`}
            onClose={closeExportOpt}
            icon={exportOpt.kind === 'excel' ? <FileSpreadsheet size={18} /> : <FileText size={18} />}
          />
          <CadastroModalBody>
            <div className="space-y-3 p-4 text-sm text-gray-700 dark:text-gray-300">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={exportOpt.mode === 'current'}
                  onChange={() => setExportOpt({ ...exportOpt, mode: 'current' })}
                />
                Apenas o mês selecionado ({MONTH_NAMES[month - 1]} {year})
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={exportOpt.mode === 'range'}
                  onChange={() => setExportOpt({ ...exportOpt, mode: 'range' })}
                />
                Período (de / até)
              </label>
              {exportOpt.mode === 'range' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <CadastroFieldLabel>De</CadastroFieldLabel>
                    <input
                      type="month"
                      value={exportOpt.from}
                      onChange={(e) => setExportOpt({ ...exportOpt, from: e.target.value })}
                      className={cadastroFieldCls}
                    />
                  </div>
                  <div>
                    <CadastroFieldLabel>Até</CadastroFieldLabel>
                    <input
                      type="month"
                      value={exportOpt.to}
                      onChange={(e) => setExportOpt({ ...exportOpt, to: e.target.value })}
                      className={cadastroFieldCls}
                    />
                  </div>
                  <p className="col-span-2 text-xs text-gray-500">
                    {exportRangeValid(exportOpt)
                      ? `${exportRange(exportOpt).length} mês(es), no máximo ${MAX_EXPORT_MONTHS}.`
                      : 'Informe um período válido (De deve ser anterior ou igual a Até).'}
                  </p>
                </div>
              )}
            </div>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeExportOpt}
            onSave={confirmExport}
            saving={false}
            saveLabel="Exportar"
            disabled={exportOpt.mode === 'range' && !exportRangeValid(exportOpt)}
          />
        </CadastroModalShell>
      )}

      {whatsappDate != null && (
        <CadastroModalShell maxWidth="max-w-md">
          <CadastroModalHeader
            isEdit={false}
            title="Enviar por WhatsApp"
            subtitle="Despesas do dia na projeção mensal"
            onClose={closeWhatsapp}
            closeDisabled={busy}
            icon={<MessageCircle size={18} />}
          />
          <CadastroModalBody>
            <div className="space-y-3 p-4 text-sm text-gray-700 dark:text-gray-300">
              <div>
                <CadastroFieldLabel>Dia</CadastroFieldLabel>
                <DateField value={whatsappDate} onChange={setWhatsappDate} className={cadastroFieldCls} />
              </div>
            </div>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeWhatsapp}
            onSave={sendWhatsapp}
            saving={saving}
            saveLabel="Enviar"
            disabled={saving || !whatsappDate}
            closeDisabled={busy}
          />
        </CadastroModalShell>
      )}

      <ExtratoExpenseFlowHost
        expense={extratoExpense}
        hubOpen={extratoHubOpen}
        onClose={closeExtratoHub}
        onChanged={() => void load()}
        onToast={(message, type) => setToast({ message, type })}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={closeToast} />}

      {cloneMonths != null && (
        <CadastroModalShell maxWidth="max-w-md">
          <CadastroModalHeader
            isEdit={false}
            title="Clonar"
            subtitle={`${MONTH_NAMES[month - 1]} ${year}`}
            onClose={closeClone}
            closeDisabled={busy}
            icon={<Copy size={18} />}
          />
          <CadastroModalBody>
            <div className="space-y-3 p-4 text-sm text-gray-700 dark:text-gray-300">
              <div>
                <CadastroFieldLabel>Quantos meses à frente?</CadastroFieldLabel>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={cloneMonths}
                  onChange={(e) => setCloneMonths(e.target.value)}
                  className={cadastroFieldCls}
                />
              </div>
              <label className={`${cadastroOptionLabelCls} items-start`}>
                <input
                  type="checkbox"
                  checked={cloneCards}
                  onChange={(e) => setCloneCards(e.target.checked)}
                  className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                />
                <span>
                  <span className="block font-medium text-gray-900 dark:text-white">Incluir despesas de cartão</span>
                  <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                    Copia também faturas e itens automáticos de cartão, além de receitas e despesas manuais.
                  </span>
                </span>
              </label>
              <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                Copia receitas e despesas de {MONTH_NAMES[month - 1]} {year} para os próximos{' '}
                {Math.min(24, Math.max(1, Math.floor(Number(cloneMonths) || 1)))} mês(es), mantendo o mesmo dia do mês.
                Se já existir lançamento igual no destino, o valor é atualizado; caso contrário, um novo item é criado.
                Lançamentos do extrato não são copiados.
              </p>
            </div>
          </CadastroModalBody>
          <CadastroModalFooter onClose={closeClone} onSave={cloneNext} saving={saving} saveLabel="Clonar" disabled={saving} closeDisabled={busy} />
        </CadastroModalShell>
      )}

      {autoIncome && (
        <CadastroModalShell maxWidth="max-w-md">
          <CadastroModalHeader
            isEdit={false}
            title={autoIncome.description}
            titleAddon={<ProjectionOriginBadge source={autoIncome.source} />}
            subtitle={
              autoIncome.source === 'bank_statement' && autoIncome.description.trim() === OPENING_BALANCE_LABEL
                ? `Saldo calculado • ${autoIncome.expected_date.split('-').reverse().join('/')}`
                : `Projeção automática • ${autoIncome.expected_date.split('-').reverse().join('/')}`
            }
            onClose={closeAutoIncome}
            closeDisabled={busy}
            icon={autoIncome.source === 'bank_statement' ? <Landmark size={18} /> : <Wallet size={18} />}
          />
          <CadastroModalBody>
            <p className="p-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              {autoIncome.source === 'bank_statement' && autoIncome.description.trim() === OPENING_BALANCE_LABEL
                ? 'Saldo no extrato: '
                : 'Valor projetado: '}
              <span className={`font-semibold ${autoIncome.income ? creditCls : debitCls}`}>
                {autoIncome.income ? formatCurrency(Number(autoIncome.amount)) : debit(Number(autoIncome.amount))}
              </span>
              .{' '}
              {autoIncome.source === 'bank_statement' && autoIncome.description.trim() === OPENING_BALANCE_LABEL ? (
                <>
                  Valor calculado para o dia 1 (não é um lançamento individual no extrato). Atualize com{' '}
                  <strong className="font-medium">Ações → Atualizar com extrato</strong> se o saldo mudar.
                </>
              ) : autoIncome.source === 'bank_statement' ? (
                <>
                  Sem vínculo com o extrato — use <strong className="font-medium">Atualizar com extrato</strong> para
                  sincronizar.
                </>
              ) : (
                <>
                  Gerado pelo lançamento da folha — não dá para alterar data ou valor aqui. Para atualizar, use{' '}
                  <strong className="font-medium">Ações → Receita da folha</strong> de novo, ou exclua esta linha.
                </>
              )}
            </p>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeAutoIncome}
            closeDisabled={busy}
            closeLabel="Fechar"
            hideSave
            leading={
              <button
                type="button"
                onClick={() => void removeAutomatic(autoIncome.id)}
                disabled={deleting}
                className="inline-flex items-center gap-1 text-sm font-medium text-red-600 disabled:opacity-60 dark:text-red-400"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Excluir
              </button>
            }
          />
        </CadastroModalShell>
      )}

      {form && (
        <CadastroModalShell maxWidth="max-w-2xl">
          <CadastroModalHeader
            isEdit={Boolean(form.id)}
            title={form.id ? 'Editar lançamento' : 'Novo lançamento'}
            subtitle="Lançamento esperado do mês"
            onClose={closeForm}
            closeDisabled={busy}
            icon={form.id ? <Pencil size={18} /> : <Plus size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Dados" icon={<CalendarDays size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow cols={3}>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Data</CadastroFieldLabel>
                    <DateField
                      value={form.expected_date}
                      onChange={(value) => setForm({ ...form, expected_date: value })}
                      className={`${cadastroFieldCls} mt-0.5`}
                    />
                  </label>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>
                      Valor {amountNum !== 0 && !isNaN(amountNum) ? (
                        <span className={`font-semibold ${amountColor}`}>
                          ({amountNum > 0 ? 'Receita' : 'Despesa'})
                        </span>
                      ) : null}
                    </CadastroFieldLabel>
                    <div className="relative mt-0.5">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500 dark:text-gray-400">
                        R$
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={form.amount}
                        onChange={(e) => {
                          const value = e.target.value
                          if (value !== '' && !/^-?\d*\.?\d*$/.test(value)) return
                          const n = parseFloat(value)
                          if (!isNaN(n) && Math.abs(n) > 99999999.99) return
                          setForm({ ...form, amount: value })
                        }}
                        onBlur={() => {
                          const n = parseFloat(form.amount)
                          if (!isNaN(n)) setForm({ ...form, amount: n.toFixed(2) })
                        }}
                        placeholder="0.00"
                        className={`${cadastroFieldCls} pl-10 font-semibold ${amountColor}`}
                      />
                    </div>
                  </label>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Tipo</CadastroFieldLabel>
                    <select
                      value={form.kind}
                      onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}
                      disabled={amountNum > 0}
                      className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                    >
                      <option value="fixed">Fixo</option>
                      <option value="variable">Variável</option>
                    </select>
                  </label>
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Descrição</CadastroFieldLabel>
                    <input
                      type="text"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className={`${cadastroFieldCls} mt-0.5`}
                    />
                  </label>
                </CadastroModalFieldsRow>
              </CadastroModalFieldsGrid>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeForm}
            closeDisabled={busy}
            onSave={save}
            saving={saving}
            disabled={saving || !form.description.trim() || !amountNum || isNaN(amountNum)}
            leading={
              form.id ? (
                <button
                  type="button"
                  onClick={remove}
                  disabled={deleting}
                  className="inline-flex items-center gap-1 text-sm font-medium text-red-600 disabled:opacity-60 dark:text-red-400"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Excluir
                </button>
              ) : undefined
            }
          />
        </CadastroModalShell>
      )}

      {chartMax && (
        <CadastroModalShell maxWidth="max-w-6xl">
          <CadastroModalHeader
            isEdit={false}
            title="Próximos meses (mês atual em diante)"
            onClose={closeChartMax}
            icon={<CalendarDays size={18} />}
          />
          <div className="flex items-center justify-end px-6 pt-3">{chartViewToggle}</div>
          <div className="h-[65vh] min-h-0 px-6 pb-4 pt-2">{chartElement}</div>
        </CadastroModalShell>
      )}


      {launchHubOpen && (
        <CadastroModalShell maxWidth="max-w-lg">
          <CadastroModalHeader
            isEdit={false}
            title={hubView === 'clear' ? 'Limpar mês' : 'Ações do mês'}
            subtitle={`${MONTH_NAMES[month - 1]} ${year}`}
            onClose={closeLaunchHub}
            closeDisabled={busy}
            icon={hubView === 'clear' ? <Eraser size={18} /> : <SlidersHorizontal size={18} />}
          />
          <CadastroModalBody>
            {hubView === 'clear' ? (
              <CadastroFormSection title="O que excluir?" icon={<Eraser size={14} />}>
                <div className="flex flex-col gap-2">
                  <button type="button" className={launchOptionBtnCls} onClick={() => void clearMonth('manual')}>
                    <Pencil size={18} className="shrink-0 text-[var(--color-1)]" />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block text-sm font-medium text-gray-900 dark:text-white">Manuais</span>
                      <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                        Só o que foi digitado. Conta, cartão e folha permanecem.
                      </span>
                    </span>
                  </button>
                  <button type="button" className={launchOptionBtnCls} onClick={() => void clearMonth('account')}>
                    <Landmark size={18} className="shrink-0 text-[var(--color-1)]" />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block text-sm font-medium text-gray-900 dark:text-white">Conta</span>
                      <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                        Lançamentos trazidos do extrato.
                      </span>
                    </span>
                  </button>
                  <button type="button" className={launchOptionBtnCls} onClick={() => void clearMonth('card')}>
                    <CreditCard size={18} className="shrink-0 text-[var(--color-1)]" />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block text-sm font-medium text-gray-900 dark:text-white">Cartão</span>
                      <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                        Fatura importada e estimativa de parcelas.
                      </span>
                    </span>
                  </button>
                  <button type="button" className={launchOptionBtnCls} onClick={() => void clearMonth('all')}>
                    <Eraser size={18} className="shrink-0 text-red-600 dark:text-red-400" />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block text-sm font-medium text-gray-900 dark:text-white">Tudo</span>
                      <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                        Manuais, conta, cartão e folha. Não dá para desfazer.
                      </span>
                    </span>
                  </button>
                </div>
              </CadastroFormSection>
            ) : (
              <div>
                <CadastroFormSection title="Incluir ou atualizar" icon={<Plus size={14} />}>
                  <div className="flex flex-col gap-2">
                    <button type="button" className={launchOptionBtnCls} onClick={openManualExpenseLaunch}>
                      <Plus size={18} className="shrink-0 text-[var(--color-1)]" />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block text-sm font-medium text-gray-900 dark:text-white">Despesas manuais</span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                          Data, descrição e valor. Não altera itens automáticos já lançados.
                        </span>
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-gray-400" />
                    </button>
                    <button type="button" className={launchOptionBtnCls} onClick={() => void launchStatements()}>
                      <Landmark size={18} className="shrink-0 text-[var(--color-1)]" />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block text-sm font-medium text-gray-900 dark:text-white">Atualizar com extrato</span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                          Gastos e receitas da conta nos dias do extrato. Substitui só lançamentos da conta.
                        </span>
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-gray-400" />
                    </button>
                    <button type="button" className={launchOptionBtnCls} onClick={() => void openCardLaunch()}>
                      <CreditCard size={18} className="shrink-0 text-[var(--color-1)]" />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block text-sm font-medium text-gray-900 dark:text-white">Cartão de crédito</span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                          Fatura importada ou estimativa por parcelas. Um lançamento por cartão. Valores avulsos: despesas manuais.
                        </span>
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-gray-400" />
                    </button>
                    <button type="button" className={launchOptionBtnCls} onClick={openIncomeLaunch}>
                      <Wallet size={18} className="shrink-0 text-[var(--color-1)]" />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block text-sm font-medium text-gray-900 dark:text-white">Receita da folha</span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                          Adiantamento e salário com base nos holerites. Substitui receitas automáticas do mês.
                        </span>
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-gray-400" />
                    </button>
                  </div>
                </CadastroFormSection>
                <CadastroFormSection title="Organizar o mês" icon={<Copy size={14} />}>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      className={launchOptionBtnCls}
                      onClick={() => {
                        setLaunchHubOpen(false)
                        setCloneCards(true)
                        setCloneMonths('1')
                      }}
                    >
                      <Copy size={18} className="shrink-0 text-[var(--color-1)]" />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block text-sm font-medium text-gray-900 dark:text-white">Clonar</span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                          Copia este mês para os seguintes. O extrato não entra na cópia.
                        </span>
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-gray-400" />
                    </button>
                    <button type="button" className={launchOptionBtnCls} onClick={() => setHubView('clear')}>
                      <Eraser size={18} className="shrink-0 text-[var(--color-1)]" />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block text-sm font-medium text-gray-900 dark:text-white">Limpar</span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                          Manuais, conta, cartão ou o mês inteiro.
                        </span>
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-gray-400" />
                    </button>
                  </div>
                </CadastroFormSection>
              </div>
            )}
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={hubView === 'clear' ? () => setHubView('main') : closeLaunchHub}
            closeDisabled={busy}
            hideSave
            closeLabel={hubView === 'clear' ? 'Voltar' : 'Fechar'}
          />
        </CadastroModalShell>
      )}

      {manualExpenseForm && (
        <CadastroModalShell maxWidth="max-w-3xl">
          <CadastroModalHeader
            isEdit={false}
            title="Despesas manuais"
            subtitle={`${MONTH_NAMES[month - 1]} ${year}`}
            onClose={closeManualExpenseForm}
            closeDisabled={busy}
            icon={<Plus size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection
              title="Linhas de despesa"
              icon={<Plus size={14} />}
              hint="Valores negativos no calendário. Adicione quantas linhas precisar."
            >
              <div className="space-y-2">
                {manualExpenseForm.expenseRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[9rem_1.5fr_7rem_6rem_auto] items-center gap-2">
                    <DateField
                      value={row.expected_date}
                      onChange={(value) => updateExpenseRow(i, { expected_date: value })}
                      className={cadastroFieldCls}
                    />
                    <input
                      type="text"
                      placeholder="Descrição"
                      value={row.description}
                      onChange={(e) => updateExpenseRow(i, { description: e.target.value })}
                      className={cadastroFieldCls}
                    />
                    <MoneyMaskInput
                      value={row.amount}
                      onChange={(amount) => updateExpenseRow(i, { amount })}
                      className={`${cadastroFieldCls} text-right font-semibold ${debitCls}`}
                    />
                    <select
                      value={row.kind}
                      onChange={(e) => updateExpenseRow(i, { kind: e.target.value as Kind })}
                      className={cadastroFieldCls}
                    >
                      <option value="fixed">Fixo</option>
                      <option value="variable">Variável</option>
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setManualExpenseForm((prev) =>
                          prev && { ...prev, expenseRows: prev.expenseRows.filter((_, j) => j !== i) },
                        )
                      }
                      className="rounded p-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-gray-700"
                      aria-label="Remover despesa"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setManualExpenseForm((prev) =>
                      prev && {
                        ...prev,
                        expenseRows: [
                          ...prev.expenseRows,
                          { expected_date: `${yearMonth}-01`, description: '', amount: '', kind: 'fixed' },
                        ],
                      },
                    )
                  }
                  className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-1)]"
                >
                  <Plus className="h-4 w-4" /> Adicionar despesa
                </button>
              </div>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeManualExpenseForm}
            closeDisabled={busy}
            onSave={launchExpenses}
            saving={saving}
            saveLabel="Lançar"
            disabled={
              saving ||
              manualExpenseForm.expenseRows.length === 0 ||
              manualExpenseForm.expenseRows.some(
                (r) => !r.expected_date || !r.description.trim() || !(Math.abs(Number(r.amount)) > 0),
              )
            }
          />
        </CadastroModalShell>
      )}

      {incomeLaunchForm && (
        <CadastroModalShell maxWidth="max-w-lg">
          <CadastroModalHeader
            isEdit={false}
            title="Receita da folha"
            subtitle={`${MONTH_NAMES[month - 1]} ${year}`}
            onClose={closeIncomeLaunchForm}
            closeDisabled={busy}
            icon={<Wallet size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection
              title="Configuração"
              icon={<Wallet size={14} />}
              hint="Usa holerites ativos da conta: valor líquido do mês ou média dos últimos 6 meses sem holerite."
            >
              <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
                <label className={`${cadastroOptionLabelCls} items-start`}>
                  <input
                    type="checkbox"
                    checked={incomeLaunchForm.advanceOnDay15}
                    onChange={(e) =>
                      setIncomeLaunchForm((prev) => prev && { ...prev, advanceOnDay15: e.target.checked })
                    }
                    className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                  />
                  <span>
                    <span className="block font-medium text-gray-900 dark:text-white">Adiantamento sempre no dia 15</span>
                    <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                      Mesmo quando o holerite veio em outro dia (antecipação por fim de semana ou feriado), a projeção
                      posiciona o adiantamento no dia 15 do mês.
                    </span>
                  </span>
                </label>
                <label className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-white">Repetir nos meses seguintes</span>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={incomeLaunchForm.periods}
                    onChange={(e) =>
                      setIncomeLaunchForm((prev) =>
                        prev && {
                          ...prev,
                          periods: Math.min(24, Math.max(1, Number(e.target.value) || 1)),
                        },
                      )
                    }
                    className={`${cadastroFieldCls} w-20`}
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {incomeLaunchForm.periods === 1 ? 'só este mês' : `este mês e mais ${incomeLaunchForm.periods - 1}`}
                  </span>
                </label>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-900 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-100">
                  <p>
                    <span className="font-semibold">Salário de fim de mês:</span> quando o pagamento cai no fim do mês
                    (a partir do dia 25), a projeção coloca a entrada no dia 1 do mês seguinte — alinhado ao fluxo de
                    pagar despesas dos primeiros 15 dias com esse valor.
                  </p>
                  <p className="mt-2">
                    Ao confirmar, remove as receitas automáticas (folha) já lançadas em cada mês e recria com os dados
                    atuais.
                  </p>
                </div>
              </div>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeIncomeLaunchForm}
            closeDisabled={busy}
            onSave={launchIncome}
            saving={saving}
            saveLabel="Lançar"
            disabled={saving}
          />
        </CadastroModalShell>
      )}

      {cardForm && (
        <CadastroModalShell maxWidth="max-w-3xl">
          <CadastroModalHeader
            isEdit={false}
            title="Cartão de crédito"
            subtitle={`${MONTH_NAMES[month - 1]} ${year}`}
            onClose={closeCardForm}
            closeDisabled={busy}
            icon={<CreditCard size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection
              title="Forma de lançar"
              icon={<CreditCard size={14} />}
              hint="Cada cartão vira um lançamento no calendário; ao clicar nele, você vê o detalhamento."
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                {(
                  [
                    {
                      id: 'invoice' as const,
                      label: 'Fatura atual',
                      hint: 'Usa a fatura já importada deste ciclo. Se não existir, o lançamento é bloqueado.',
                    },
                    {
                      id: 'installments' as const,
                      label: 'Estimativa',
                      hint: 'Soma das parcelas em aberto que vencem neste mês (saldo parcelado).',
                    },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={cardForm.launchMode === m.id}
                    className={`${launchHubBtnCls(cardForm.launchMode === m.id)} sm:flex-1`}
                    onClick={() => {
                      setCardForm({ ...cardForm, launchMode: m.id })
                      void fetchCardPreview(m.id, cardForm.sharing, cardOptions.map((c) => c.id))
                    }}
                  >
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block text-sm font-medium text-gray-900 dark:text-white">{m.label}</span>
                      <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{m.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </CadastroFormSection>
            <CadastroFormSection
              title="Valor considerado"
              icon={<Wallet size={14} />}
              hint="Minha parte inclui itens compartilhados; Próprio só itens 100% seus."
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                {(
                  [
                    { id: 'mine' as const, label: 'Minha parte', hint: 'Próprio + compartilhado com participação sua' },
                    { id: 'own' as const, label: 'Próprio', hint: 'Apenas itens com 100% de participação sua' },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={cardForm.sharing === s.id}
                    className={`${launchHubBtnCls(cardForm.sharing === s.id)} sm:flex-1`}
                    onClick={() => {
                      setCardForm({ ...cardForm, sharing: s.id })
                      void fetchCardPreview(cardForm.launchMode, s.id, cardOptions.map((c) => c.id))
                    }}
                  >
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block text-sm font-medium text-gray-900 dark:text-white">{s.label}</span>
                      <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{s.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </CadastroFormSection>
            <CadastroFormSection
              title="Cartões"
              icon={<CreditCard size={14} />}
              hint="Marque os cartões a incluir. A prévia mostra o valor que será lançado por cartão."
            >
              {cardPreviewLoading ? (
                <div className="flex flex-col gap-2" aria-busy aria-label="Carregando cartões">
                  {(launchableCards.length > 0 ? launchableCards : cardOptions).map((c) => (
                    <div
                      key={c.id}
                      className="h-[5.25rem] animate-pulse rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800/80"
                    />
                  ))}
                </div>
              ) : cardOptions.length === 0 ? (
                <p className="text-sm text-gray-500">Nenhum cartão de crédito ativo.</p>
              ) : launchableCards.length === 0 ? null : (
                <div className="flex flex-col gap-2">
                  {launchableCards.map((c) => {
                    const selected = cardForm.cardIds.includes(c.id)
                    const inv = invoicePreview.find((r) => r.card_id === c.id)
                    const parcelas = installmentCountByCard.get(c.id) ?? 0
                    const amount =
                      cardForm.launchMode === 'invoice'
                        ? inv?.my_amount
                        : installmentPreview
                            .filter((p) => p.card_id === c.id)
                            .reduce((s, p) => s + Number(p.my_amount), 0)
                    return (
                      <label
                        key={c.id}
                        className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-3 transition-colors ${
                          selected
                            ? 'border-[var(--color-1)] bg-[var(--color-1)]/5 dark:bg-[var(--color-1)]/10'
                            : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-600 dark:bg-gray-800/80 dark:hover:border-gray-500'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleCardSelected(c.id)}
                          className={`${cadastroAccentControlCls} mt-1 h-4 w-4 shrink-0`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <CreditCard size={16} className="shrink-0 text-[var(--color-1)]" />
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">
                              {c.name || 'Sem nome'} •{c.number}
                            </span>
                            {c.active === false ? (
                              <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600 dark:bg-gray-600 dark:text-gray-200">
                                Inativo
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                            {cardForm.launchMode === 'invoice'
                              ? `Fatura importada (${inv?.invoice_year_month ?? '—'})`
                              : `${parcelas} parcela${parcelas === 1 ? '' : 's'} em aberto neste mês`}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {cardForm.launchMode === 'invoice' ? 'Minha parte' : 'Estimativa'}
                          </span>
                          <span className={`mt-0.5 block text-base font-semibold tabular-nums ${debitCls}`}>
                            {amount != null ? debit(Number(amount)) : '—'}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
              {cardLaunchBlockedReason ? (
                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
                  {cardLaunchBlockedReason}
                </p>
              ) : null}
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeCardForm}
            closeDisabled={busy}
            onSave={launchCards}
            saving={saving}
            saveLabel="Lançar"
            disabled={saving || cardLaunchBlockedReason != null}
          />
        </CadastroModalShell>
      )}

      <ConfirmComponent />
      {exportRunner.overlay}
    </div>
  )
}
