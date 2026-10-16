import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsRight, Copy, CreditCard, Eraser, FileSpreadsheet, FileText, Loader2, Maximize2, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import { CadastroListHeaderActions } from '../components/CadastroExcelMenu'
import { DateField } from '../components/date'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageShell,
  CadastroListPrimaryButton,
  listPageTableRowHoverCls,
} from '../components/CadastroListPageLayout'
import { ListPageNestedTable } from '../components/ListPageTable'
import {
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableStaticHeader,
} from '../components/ListTableSelectColumns'
import {
  CadastroFieldLabel,
  CadastroFormSection,
  CadastroModalFieldsGrid,
  CadastroModalFieldsRow,
  cadastroFieldCls,
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
import { formatCurrency } from '../utils/currency'

type Kind = 'fixed' | 'variable'

interface BreakdownItem {
  card_id: number
  card_name: string
  card_number: string
  amount: string
  my_amount: string
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
  source: 'manual' | 'clone' | 'card_invoice' | 'card_item' | 'payroll'
  breakdown?: BreakdownItem[] | null
  editable?: boolean
  is_actual?: boolean
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
}

interface CardOption {
  id: number
  name: string
  number: string
  type: string
  active?: boolean
}

interface CardItemForm {
  card_id: number
  description: string
  amount: string
  kind: Kind
}

interface ExpenseRowForm {
  expected_date: string
  description: string
  amount: string
  kind: Kind
}

interface CardFormState {
  cardIds: number[]
  target: 'expense' | 'card' | 'income'
  expenseRows: ExpenseRowForm[]
  historyMonths: number
  mode: 'auto' | 'manual'
  method: 'current' | 'average' | 'installments'
  sharing: 'own' | 'mine' | 'all'
  items: CardItemForm[]
}

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

const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const SOURCE_LABELS: Record<Expense['source'], string> = {
  manual: 'Manual',
  clone: 'Clonado',
  card_invoice: 'Fatura do cartão',
  card_item: 'Item de cartão',
  payroll: 'Folha',
}

const EXPORT_COLUMNS = ['Data', 'Descrição', 'Tipo', 'Origem', 'Valor', 'Minha parte']

const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const monthTitle = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]}/${y}`
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
    origin: '',
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

export default function ProjecaoMensalPage() {
  const { showConfirm, ConfirmComponent } = useConfirm()
  const [yearMonth, setYearMonth] = useState(currentYearMonth())
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
  const [autoIncome, setAutoIncome] = useState<Income | null>(null)
  const closeAutoIncome = useCallback(() => setAutoIncome(null), [])
  useEscapeKey(closeAutoIncome, autoIncome != null && !busy)
  const [cardForm, setCardForm] = useState<CardFormState | null>(null)
  const [cardOptions, setCardOptions] = useState<CardOption[]>([])
  const [installmentPreview, setInstallmentPreview] = useState<InstallmentPreview[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const previewActive = cardForm?.mode === 'auto' && cardForm.method === 'installments'
  const previewCardKey = cardForm ? cardForm.cardIds.join(',') : ''
  useEffect(() => {
    if (!previewActive || !previewCardKey) {
      setInstallmentPreview([])
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    axios
      .get<InstallmentPreview[]>('/api/monthly-projections/installments-preview', {
        params: { year_month: yearMonth, card_ids: previewCardKey },
      })
      .then((res) => !cancelled && setInstallmentPreview(res.data))
      .catch((err) => {
        console.error('Erro ao carregar parcelas do mês:', err)
        if (!cancelled) setInstallmentPreview([])
      })
      .finally(() => !cancelled && setPreviewLoading(false))
    return () => {
      cancelled = true
    }
  }, [previewActive, previewCardKey, yearMonth])
  const closeCardForm = useCallback(() => setCardForm(null), [])
  useEscapeKey(closeCardForm, cardForm != null && !busy)

  const [overview, setOverview] = useState<OverviewMonth[]>([])
  const [chartView, setChartView] = useState<'month' | 'half'>('month')
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

  const cells = useMemo(() => {
    const [y, m] = yearMonth.split('-').map(Number)
    const offset = new Date(y, m - 1, 1).getDay()
    const days = new Date(y, m, 0).getDate()
    return [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)] as (number | null)[]
  }, [yearMonth])

  const amountNum = form ? parseFloat(form.amount) : NaN
  const amountColor = amountNum > 0 ? creditCls : amountNum < 0 ? debitCls : 'text-gray-600 dark:text-gray-400'

  const openNew = (day: number) =>
    setForm({ expected_date: `${yearMonth}-${String(day).padStart(2, '0')}`, description: '', amount: '', kind: 'fixed' })

  const openEdit = (e: Expense) =>
    e.source === 'card_invoice'
      ? setDetail(e)
      : e.editable !== false &&
        setForm({ id: e.id, expected_date: e.expected_date, description: e.description, amount: `-${e.amount}`, kind: e.kind })

  const [dragOverDay, setDragOverDay] = useState<number | null>(null)

  const canDragExpense = (e: Expense) => e.editable !== false && e.source !== 'card_invoice'

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
    try {
      await axios.post('/api/monthly-projections/launch-income', { year_month: yearMonth })
      await load()
      setCardForm(null)
    } catch (err) {
      console.error('Erro ao lançar projeção de receitas:', err)
      setError('Não foi possível lançar a projeção de receitas.')
    }
  }

  const openCardForm = async () => {
    try {
      const res = await axios.get<CardOption[]>('/api/cartoes/', { params: { incluir_inativos: true } })
      const allCredit = res.data.filter((c) => c.type === 'credito')
      const credit = allCredit.filter((c) => c.active !== false)
      setCardOptions(credit)
      setCardForm({ cardIds: allCredit.map((c) => c.id), historyMonths: 6, target: 'expense', expenseRows: [], mode: 'auto', method: 'current', sharing: 'mine', items: [] })
    } catch (err) {
      console.error('Erro ao carregar cartões:', err)
      setError('Não foi possível carregar os cartões.')
    }
  }

  const updateCardItem = (index: number, patch: Partial<CardItemForm>) =>
    setCardForm((prev) => prev && { ...prev, items: prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) })

  const updateExpenseRow = (index: number, patch: Partial<ExpenseRowForm>) =>
    setCardForm((prev) => prev && { ...prev, expenseRows: prev.expenseRows.map((r, i) => (i === index ? { ...r, ...patch } : r)) })

  const launchExpenses = async () => {
    if (!cardForm) return
    setSaving(true)
    try {
      for (const r of cardForm.expenseRows) {
        await axios.post('/api/monthly-projections', {
          expected_date: r.expected_date,
          description: r.description.trim(),
          amount: -Math.abs(Number(r.amount)),
          kind: r.kind,
        })
      }
      await load()
      setCardForm(null)
    } catch (err) {
      console.error('Erro ao lançar despesas:', err)
      setError('Não foi possível lançar as despesas.')
    } finally {
      setSaving(false)
    }
  }

  const launchCards = async () => {
    if (!cardForm) return
    const auto = cardForm.mode === 'auto'
    setSaving(true)
    try {
      await axios.post('/api/monthly-projections/launch-cards', {
        year_month: yearMonth,
        card_ids: auto ? cardForm.cardIds : cardOptions.map((c) => c.id),
        history_months: cardForm.historyMonths,
        include_average: auto && cardForm.method !== 'installments',
        basis: cardForm.method === 'current' ? 'current' : 'average',
        include_installments: auto && cardForm.method === 'installments',
        sharing: cardForm.sharing,
        items: auto ? [] : cardForm.items.map((it) => ({ ...it, amount: Number(it.amount) })),
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

  const clearMonth = async () => {
    const label = `${MONTH_NAMES[Number(yearMonth.slice(5, 7)) - 1]} ${yearMonth.slice(0, 4)}`
    const confirmed = await showConfirm({
      title: 'Limpar mês',
      message: `Excluir definitivamente todos os itens de ${label}? Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      type: 'danger',
    })
    if (!confirmed) return
    try {
      await axios.delete('/api/monthly-projections', { params: { year_month: yearMonth } })
      await load()
    } catch (err) {
      console.error('Erro ao limpar mês:', err)
      setError('Não foi possível limpar o mês.')
    }
  }

  const [year, month] = yearMonth.split('-').map(Number)
  const totals = data?.totals
  const result = Number(data?.income_total ?? 0) - Number(totals?.total ?? 0)

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

  const chartElement = (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={overviewChart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af55" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} width={70} tickFormatter={(v: number) => formatCurrency(v)} />
        <Tooltip formatter={(v) => formatCurrency(Number(v))} />
        <Legend />
        <ReferenceLine y={0} stroke="#6b7280" />
        {chartView === 'month' ? (
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
        )}
        <Line type="linear" dataKey="Tendência do resultado" stroke="#2563eb" strokeWidth={2} strokeDasharray="6 4" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )


  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <CadastroListPageShell>
        <CadastroListPageBody
          scroll={false}
          header={
            <CadastroListPageHero
              icon={<CalendarDays className="w-8 h-8" />}
              title="Projeção Mensal"
              subtitle="Planejamento mensal de entradas e gastos fixos e variáveis"
              actions={
                <CadastroListHeaderActions
                  menu={{
                    menuTitle: 'Mais ações',
                    extraItems: [
                      { id: 'clone', label: 'Clonar', icon: <Copy size={16} />, onClick: () => { setCloneCards(true); setCloneMonths('1') } },
                      { id: 'excel', label: 'Exportar Excel', icon: <FileSpreadsheet size={16} />, onClick: () => setExportOpt({ kind: 'excel', mode: 'current', from: yearMonth, to: yearMonth }) },
                      { id: 'pdf', label: 'Exportar PDF', icon: <FileText size={16} />, onClick: () => setExportOpt({ kind: 'pdf', mode: 'current', from: yearMonth, to: yearMonth }) },
                      { id: 'clear', label: 'Limpar mês', icon: <Eraser size={16} />, onClick: clearMonth },
                    ],
                  }}
                >
                  <CadastroListPrimaryButton
                    label="Lançar"
                    icon={<CalendarDays size={18} />}
                    onClick={openCardForm}
                  />
                </CadastroListHeaderActions>
              }
            />
          }
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scroll-slim">
            {overviewChart.length > 0 && (
              <div className="shrink-0 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Próximos meses (mês atual em diante)
                  </p>
                  <div className="flex items-center gap-2">
                    {chartViewToggle}
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
                </div>
                <div className="h-56">{chartElement}</div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setYearMonth(shiftMonth(yearMonth, -1))} className="rounded-lg border border-gray-300 p-2 dark:border-gray-600" aria-label="Mês anterior">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPicker({ year, view: 'month' })}
                title="Escolher mês e ano"
                className="min-w-[10rem] rounded-lg px-2 py-1 text-center text-lg font-semibold text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700"
              >
                {MONTH_NAMES[month - 1]} {year}
              </button>
              <button type="button" onClick={() => setYearMonth(shiftMonth(yearMonth, 1))} className="rounded-lg border border-gray-300 p-2 dark:border-gray-600" aria-label="Próximo mês">
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setYearMonth(currentYearMonth())}
                disabled={yearMonth === currentYearMonth()}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200"
              >
                Mês atual
              </button>
              <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                <span className="h-[3px] w-5 rounded-full bg-[var(--color-1)]" />
                Divisor entre os dias 14 e 15
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                <p className="text-xs text-gray-500">Entradas</p>
                <p className={`text-lg font-semibold ${creditCls}`}>{formatCurrency(Number(data?.income_total ?? 0))}</p>
              </div>
              {[
                ['Gastos Fixos', Number(totals?.fixed ?? 0)],
                ['Gastos Variáveis', Number(totals?.variable ?? 0)],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className={`text-lg font-semibold ${debitCls}`}>{debit(value as number)}</p>
                </div>
              ))}
              <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                <p className="text-xs text-gray-500">Resultado</p>
                <p className={`text-lg font-semibold ${result >= 0 ? creditCls : debitCls}`}>{formatCurrency(result)}</p>
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {loading ? (
              <LoadingSpinner />
            ) : (
              <div
                className="grid flex-[1_0_auto] grid-cols-7 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 dark:border-gray-700 dark:bg-gray-700"
                style={{ gridTemplateRows: `auto repeat(${Math.ceil(cells.length / 7)}, minmax(96px, 1fr))` }}
              >
                {WEEKDAYS.map((d) => (
                  <div key={d} className="bg-gray-100 p-2 text-center text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">{d}</div>
                ))}
                {cells.map((day, i) => {
                  const items = day ? byDay.get(day) ?? [] : []
                  const dayTotal = items.reduce((s, e) => s + valueOf(e), 0)
                  // Divisor entre os dias 14 e 15: borda inferior nos dias 8–14 (acima da 2ª metade)
                  // e borda direita no dia 14 quando o 15 está na mesma linha.
                  const shadows: string[] = []
                  if (day !== null && day >= 8 && day <= 14) shadows.push('inset 0 -3px 0 0 var(--color-1)')
                  if (day === 14 && i % 7 < 6) shadows.push('inset -3px 0 0 0 var(--color-1)')
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
                      className={`group relative min-h-[96px] p-1.5 ${
                        day === null
                          ? 'bg-gray-50 dark:bg-gray-950'
                          : dragOverDay === day
                            ? 'bg-blue-50 dark:bg-blue-950'
                            : 'bg-white dark:bg-gray-900'
                      }`}
                    >
                      {day === 15 && (
                        <span
                          title="Segunda metade do mês (dia 15 em diante)"
                          className={`pointer-events-none absolute top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--color-1)] text-white shadow ${
                            i % 7 === 0 ? 'left-1' : 'left-0 -translate-x-1/2'
                          }`}
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
                          <div className="mt-1 space-y-1">
                            {(incomeByDay.get(day) ?? []).map((inc) => (
                              <button
                                key={inc.id}
                                type="button"
                                draggable={inc.editable}
                                onDragStart={(ev) => ev.dataTransfer.setData('text/plain', JSON.stringify({ id: inc.id, income: true }))}
                                onClick={() => (inc.editable ? openEditIncome(inc) : setAutoIncome(inc))}
                                title={inc.editable ? 'Receita lançada' : 'Projeção automática: clique para excluir ou lance novamente para atualizar'}
                                className="flex w-full items-center justify-between gap-1 rounded bg-green-50 px-1.5 py-1 text-left text-[11px] text-green-900 dark:bg-green-900/30 dark:text-green-100"
                              >
                                <span className="truncate">{inc.description}</span>
                                <span className={`shrink-0 font-semibold ${creditCls}`}>{formatCurrency(Number(inc.amount))}</span>
                              </button>
                            ))}
                            {items.map((e) => (
                              <button key={e.id} type="button" draggable={canDragExpense(e)} onDragStart={(ev) => ev.dataTransfer.setData('text/plain', JSON.stringify({ id: e.id, income: false }))} onClick={() => openEdit(e)} className={`flex w-full items-center justify-between gap-1 rounded px-1.5 py-1 text-left text-[11px] ${e.kind === 'fixed' ? 'bg-red-50 text-red-900 dark:bg-red-900/30 dark:text-red-100' : 'bg-orange-50 text-orange-900 dark:bg-orange-900/30 dark:text-orange-100'}`}>
                                <span className="truncate">{e.description}</span>
                                <span className={`shrink-0 font-semibold ${debitCls}`}>{debit(valueOf(e))}</span>
                              </button>
                            ))}
                          </div>
                          {items.length > 1 && <p className={`mt-1 text-right text-[10px] font-semibold ${debitCls}`}>{debit(dayTotal)}</p>}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </CadastroListPageBody>
      </CadastroListPageShell>

      {detail && (
        <CadastroModalShell maxWidth="max-w-2xl">
          <CadastroModalHeader
            isEdit={false}
            title={detail.description}
            titleAddon={
              <span
                className={`inline-flex w-[88px] items-center justify-center rounded px-3 py-1 text-xs font-semibold text-white ${
                  detail.is_actual ? 'bg-green-600' : 'bg-amber-600'
                }`}
              >
                {detail.is_actual ? 'Fatura real' : 'Estimativa'}
              </span>
            }
            subtitle={`${detail.is_actual ? 'Valor da fatura' : 'Média dos últimos 6 meses'} • vencimento ${detail.expected_date.split('-').reverse().join('/')}`}
            onClose={() => setDetail(null)}
            closeDisabled={busy}
            icon={<CreditCard size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Cartões" icon={<CreditCard size={14} />} bodyClassName="p-0">
              <ListPageNestedTable
                alignWithListLeading
                leadingMode="index-only"
                colsRest={
                  <>
                    <ListTableSpacerCol />
                    <col />
                    <col style={{ width: 160 }} />
                  </>
                }
                head={
                  <tr>
                    <ListTableIndexHeader />
                    <ListTableSpacerHeader />
                    <ListTableStaticHeader label="Cartão" className="px-3 py-2" />
                    <ListTableStaticHeader label="Valor" className="px-3 py-2 text-right" />
                  </tr>
                }
              >
                {(detail.breakdown?.length ? detail.breakdown : [{ card_id: 0, card_name: detail.description, card_number: '', amount: detail.amount, my_amount: detail.my_amount }]).map((b, i) => (
                  <tr key={b.card_id} className={listPageTableRowHoverCls}>
                    <ListTableIndexCell index={i + 1} />
                    <ListTableSpacerCell />
                    <td className="px-3 py-2">{b.card_name}{b.card_number ? ` •${b.card_number}` : ''}
                      {b.inactive && (
                        <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-600 dark:text-gray-100">Inativo</span>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right ${debitCls}`}>{debit(Number(b.amount))}</td>
                  </tr>
                ))}
              </ListPageNestedTable>
              <p className="border-t border-gray-200 px-3 py-2 text-right text-sm font-semibold text-gray-800 dark:border-gray-700 dark:text-gray-100">
                Total <span className={debitCls}>{debit(valueOf(detail))}</span>
              </p>
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(e) => e.target === e.currentTarget && closePicker()}
        >
          <div className="w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-800">
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
            <div className="grid grid-cols-3 gap-2">
              {picker.view === 'month'
                ? MONTH_NAMES.map((name, i) => {
                    const selected = picker.year === year && i + 1 === month
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => pickMonth(i + 1)}
                        className={`rounded-lg px-2 py-2 text-sm ${selected ? 'bg-[var(--color-primary)] text-white' : 'text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700'}`}
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
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={cloneCards} onChange={(e) => setCloneCards(e.target.checked)} />
                Replicar gastos de cartão de crédito
              </label>
              <p>
                Copia todas as receitas e despesas de {MONTH_NAMES[month - 1]} {year} para os próximos{' '}
                {Math.min(24, Math.max(1, Math.floor(Number(cloneMonths) || 1)))} mês(es). Itens iguais (mesma descrição, mesmo dia do mês e mesma direção: receita ou despesa) que já
                existirem nos meses de destino são atualizados; os novos são adicionados.
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
            subtitle={`Projeção automática • ${autoIncome.expected_date.split('-').reverse().join('/')}`}
            onClose={closeAutoIncome}
            closeDisabled={busy}
            icon={<Wallet size={18} />}
          />
          <CadastroModalBody>
            <p className="p-4 text-sm text-gray-700 dark:text-gray-300">
              Valor <span className={`font-semibold ${creditCls}`}>{formatCurrency(Number(autoIncome.amount))}</span>.
              Projeções automáticas não são editáveis: exclua ou lance a projeção de receitas novamente.
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


      {cardForm && (
        <CadastroModalShell maxWidth="max-w-3xl">
          <CadastroModalHeader
            isEdit={false}
            title="Lançar"
            subtitle={
              cardForm.target === 'expense'
                ? `${MONTH_NAMES[month - 1]} ${year} • lançamentos manuais de despesa`
                : `${MONTH_NAMES[month - 1]} ${year} • substitui as projeções automáticas já lançadas no mês`
            }
            onClose={closeCardForm}
            closeDisabled={busy}
            icon={cardForm.target === 'income' ? <Wallet size={18} /> : cardForm.target === 'card' ? <CreditCard size={18} /> : <Plus size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Tipo" icon={<CalendarDays size={14} />}>
              <div role="radiogroup" className="grid grid-cols-[16rem_16rem_auto] items-center gap-x-4 text-sm text-gray-800 dark:text-gray-100">
                {(['expense', 'card', 'income'] as const).map((t) => (
                  <label key={t} className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="launch-target"
                      checked={cardForm.target === t}
                      onChange={() => setCardForm({ ...cardForm, target: t })}
                    />
                    {t === 'expense' ? 'Despesa' : t === 'card' ? 'Cartão de crédito' : 'Receita'}
                  </label>
                ))}
              </div>
            </CadastroFormSection>
            {cardForm.target === 'expense' && (
              <CadastroFormSection title="Despesas (várias de uma vez)" icon={<Plus size={14} />}>
                <div className="space-y-2">
                  {cardForm.expenseRows.map((row, i) => (
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
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={row.amount}
                        onChange={(e) => /^-?\d*\.?\d*$/.test(e.target.value) && updateExpenseRow(i, { amount: e.target.value })}
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
                        onClick={() => setCardForm({ ...cardForm, expenseRows: cardForm.expenseRows.filter((_, j) => j !== i) })}
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
                      setCardForm({
                        ...cardForm,
                        expenseRows: [
                          ...cardForm.expenseRows,
                          { expected_date: `${yearMonth}-01`, description: '', amount: '', kind: 'fixed' },
                        ],
                      })
                    }
                    className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-1)]"
                  >
                    <Plus className="h-4 w-4" /> Adicionar despesa
                  </button>
                </div>
              </CadastroFormSection>
            )}
            {cardForm.target === 'card' && (
              <>
            <CadastroFormSection title="Modo" icon={<CreditCard size={14} />}>
              <div role="radiogroup" className="grid grid-cols-[16rem_auto] items-center gap-x-4 text-sm text-gray-800 dark:text-gray-100">
                {(['auto', 'manual'] as const).map((m) => (
                  <label key={m} className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="launch-mode"
                      checked={cardForm.mode === m}
                      onChange={() => setCardForm({ ...cardForm, mode: m })}
                    />
                    {m === 'auto' ? 'Automático' : 'Manual'}
                  </label>
                ))}
              </div>
            </CadastroFormSection>
            {cardForm.mode === 'auto' && (
            <CadastroFormSection title="Cálculo da projeção" icon={<CreditCard size={14} />}>
              <CadastroModalFieldsGrid className="mb-3">
                {cardForm.mode === 'auto' && (
                  <>
                    <CadastroModalFieldsRow>
                    <div className="grid grid-cols-[16rem_12rem_auto] items-center gap-x-4 text-sm text-gray-800 dark:text-gray-100">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="card-sharing"
                          checked={cardForm.sharing === 'mine'}
                          onChange={() => setCardForm({ ...cardForm, sharing: 'mine' })}
                        />
                        <span className="flex flex-col">
                          <span>Minha Parte</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">(próprio + compartilhado)</span>
                        </span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="card-sharing"
                          checked={cardForm.sharing === 'own'}
                          onChange={() => setCardForm({ ...cardForm, sharing: 'own' })}
                        />
                        <span className="flex flex-col">
                          <span>Próprio</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">(100% meu)</span>
                        </span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="card-sharing"
                          checked={cardForm.sharing === 'all'}
                          onChange={() => setCardForm({ ...cardForm, sharing: 'all' })}
                        />
                        <span className="flex flex-col">
                          <span>Todos</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">(valor total)</span>
                        </span>
                      </label>
                    </div>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow>
                    <div className="grid grid-cols-[16rem_12rem_auto] items-center gap-x-4 text-sm text-gray-800 dark:text-gray-100">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="card-method"
                          checked={cardForm.method === 'current'}
                          onChange={() => setCardForm({ ...cardForm, method: 'current' })}
                        />
                        Fatura atual
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="card-method"
                          checked={cardForm.method === 'installments'}
                          onChange={() => setCardForm({ ...cardForm, method: 'installments' })}
                        />
                        Saldo parcelado
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="card-method"
                          checked={cardForm.method === 'average'}
                          onChange={() => setCardForm({ ...cardForm, method: 'average' })}
                        />
                        Média das faturas
                      </label>
                    </div>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow>
                    <label className="flex w-1/2 items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                      Período
                      <input
                        type="number"
                        min={1}
                        max={24}
                        value={cardForm.historyMonths}
                        disabled={cardForm.method !== 'average'}
                        onChange={(e) => setCardForm({ ...cardForm, historyMonths: Math.min(24, Math.max(1, Number(e.target.value) || 1)) })}
                        className={`${cadastroFieldCls} w-20 disabled:opacity-50`}
                      />
                      (meses)
                    </label>
                    </CadastroModalFieldsRow>
                  </>
                )}
              </CadastroModalFieldsGrid>
            </CadastroFormSection>
            )}
            {previewActive && (
              <CadastroFormSection title={`Parcelas de ${MONTH_NAMES[month - 1]}`} icon={<CreditCard size={14} />}>
                {previewLoading ? (
                  <p className="text-sm text-gray-500">Carregando…</p>
                ) : installmentPreview.length === 0 ? (
                  <p className="text-sm text-gray-500">Nenhuma parcela em aberto neste mês para os cartões selecionados.</p>
                ) : (
                  <>
                    <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
                      {installmentPreview.map((p, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 py-1.5">
                          <span className="min-w-0 truncate text-gray-800 dark:text-gray-100">
                            {p.description} ({p.installment}/{p.total_installments})
                            <span className="ml-2 text-xs text-gray-500">{p.card_name} •{p.card_number}</span>
                          </span>
                          <span className={`shrink-0 tabular-nums font-semibold ${debitCls}`}>{formatCurrency(Number(p.amount))}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-right text-sm font-semibold text-gray-800 dark:text-gray-100">
                      Total: {formatCurrency(installmentPreview.reduce((s, p) => s + Number(p.amount), 0))}
                    </p>
                  </>
                )}
              </CadastroFormSection>
            )}
            {cardForm.mode === 'manual' && (
            <CadastroFormSection title="Itens individuais (editáveis)" icon={<Plus size={14} />}>
              <div className="space-y-2">
                {cardForm.items.map((item, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1.5fr_7rem_6rem_auto] items-center gap-2">
                    <select
                      value={item.card_id}
                      onChange={(e) => updateCardItem(i, { card_id: Number(e.target.value) })}
                      className={cadastroFieldCls}
                    >
                      {cardOptions.map((c) => (
                        <option key={c.id} value={c.id}>{c.name || 'Sem nome'} •{c.number}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Descrição"
                      value={item.description}
                      onChange={(e) => updateCardItem(i, { description: e.target.value })}
                      className={cadastroFieldCls}
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={item.amount}
                      onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && updateCardItem(i, { amount: e.target.value })}
                      className={`${cadastroFieldCls} text-right font-semibold ${debitCls}`}
                    />
                    <select
                      value={item.kind}
                      onChange={(e) => updateCardItem(i, { kind: e.target.value as Kind })}
                      className={cadastroFieldCls}
                    >
                      <option value="fixed">Fixo</option>
                      <option value="variable">Variável</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setCardForm({ ...cardForm, items: cardForm.items.filter((_, j) => j !== i) })}
                      className="rounded p-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-gray-700"
                      aria-label="Remover item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={cardOptions.length === 0}
                  onClick={() =>
                    setCardForm({
                      ...cardForm,
                      items: [...cardForm.items, { card_id: cardOptions[0].id, description: '', amount: '', kind: 'fixed' }],
                    })
                  }
                  className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-1)] disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" /> Adicionar item
                </button>
              </div>
            </CadastroFormSection>
            )}
              </>
            )}
            {cardForm.target === 'income' && (
              <p className="p-4 text-sm text-gray-700 dark:text-gray-300">
                Refaz as receitas do mês a partir dos holerites (valor real ou média dos últimos 6 meses). Substitui as receitas automáticas já lançadas.
                <span className="mt-2 block rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-900 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-100">
                  <strong>Nota:</strong> o holerite de final de mês (pago no fim do mês) entra no primeiro dia do mês seguinte,
                  pois é ele que paga as despesas dos primeiros 15 dias.
                </span>
              </p>
            )}
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeCardForm}
            closeDisabled={busy}
            onSave={cardForm.target === 'income' ? launchIncome : cardForm.target === 'expense' ? launchExpenses : launchCards}
            saving={saving}
            saveLabel="Lançar"
            disabled={
              saving ||
              (cardForm.target === 'expense' &&
                (cardForm.expenseRows.length === 0 ||
                  cardForm.expenseRows.some((r) => !r.expected_date || !r.description.trim() || !(Math.abs(Number(r.amount)) > 0)))) ||
              (cardForm.target === 'card' && cardForm.mode === 'auto' && cardForm.cardIds.length === 0) ||
              (cardForm.target === 'card' && cardForm.mode === 'manual' &&
                (cardForm.items.length === 0 ||
                  cardForm.items.some((it) => !it.description.trim() || !(Number(it.amount) > 0))))
            }
          />
        </CadastroModalShell>
      )}

      <ConfirmComponent />
      {exportRunner.overlay}
    </div>
  )
}
