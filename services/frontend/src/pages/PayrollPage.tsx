import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageShell,
  CadastroListPageTabs,
  cadastroRowIconBtnCls,
  cadastroRowIconDangerCls,
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
} from '../components/CadastroFormLayout'
import Badge from '../components/Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import { badgeToneMap } from '../utils/badgePalettes'
import LoadingSpinner from '../components/LoadingSpinner'
import Toast from '../components/Toast'
import FloatingFooterBar from '../components/FloatingFooterBar'
import {
  PayslipDetailContent,
  type PayslipDetail,
  type PayslipPayment,
} from '../components/PayslipDetailContent'
import { useConfirm } from '../hooks/useConfirm'
import { useEscapeKey } from '../hooks/useEscapeKey'
import {
  ArrowDownCircle,
  ArrowUp,
  ArrowUpCircle,
  Briefcase,
  Building2,
  Calendar,
  CheckSquare,
  Eye,
  FileText,
  Filter,
  MinusSquare,
  Square,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react'

type PayrollTab = 'payslips' | 'income-reports'

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

interface FilterOptions {
  employers: string[]
  years: number[]
  payers: string[]
}

interface Payslip {
  id: number
  employee_name?: string | null
  employee_role?: string | null
  employee_registration?: string | null
  employer_name?: string | null
  reference_label?: string | null
  payslip_kind?: string | null
  year?: number | null
  month?: number | null
  payment_date?: string | null
  gross_earnings?: number | null
  total_deductions?: number | null
  net_amount?: number | null
  payments?: PayslipPayment[]
  created_at: string
}

interface IncomeReport {
  id: number
  report_year?: number | null
  calendar_year?: number | null
  payer_name?: string | null
  beneficiary_name?: string | null
  nature_description?: string | null
  issued_at?: string | null
  created_at: string
}

interface IncomeReportLine {
  id: number
  group_name: string
  item_no?: string | null
  description: string
  amount?: number | null
  line_type_name?: string | null
}

interface IncomeReportDetail extends IncomeReport {
  lines: IncomeReportLine[]
}

const formatCurrency = (value?: number | null) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))

const MONTH_OPTIONS = [
  { value: '01', label: 'Janeiro' },
  { value: '02', label: 'Fevereiro' },
  { value: '03', label: 'Março' },
  { value: '04', label: 'Abril' },
  { value: '05', label: 'Maio' },
  { value: '06', label: 'Junho' },
  { value: '07', label: 'Julho' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Setembro' },
  { value: '10', label: 'Outubro' },
  { value: '11', label: 'Novembro' },
  { value: '12', label: 'Dezembro' },
]

const PAYSLIP_KIND_TONE = badgeToneMap(
  ['advance', 'final', 'regular', 'consolidated', 'profit_share'] as const,
  'brand',
)

const payslipKindTone = (kind?: string | null) => {
  if (kind && kind in PAYSLIP_KIND_TONE) {
    return PAYSLIP_KIND_TONE[kind as keyof typeof PAYSLIP_KIND_TONE]
  }
  return 'brand1' as const
}

const formatEmployeeSubtitle = (payslip: {
  employee_name?: string | null
  employee_role?: string | null
  employee_registration?: string | null
}) =>
  [payslip.employee_name, payslip.employee_role, payslip.employee_registration].filter(Boolean).join(' • ')

const payslipKindFamily = (kind?: string | null) =>
  kind === 'profit_share' ? 'profit_share' : 'salary'

const payslipKindLabel = (kind?: string | null) => {
  if (kind === 'advance') return 'Adiantamento'
  if (kind === 'final') return 'Folha final'
  if (kind === 'regular') return 'Mensal'
  if (kind === 'profit_share') return 'Participação nos lucros'
  if (kind === 'consolidated') return 'Folha'
  return null
}

const formatCnpj = (value?: string | null) => {
  if (!value) return '-'
  const digits = value.replace(/\D/g, '')
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  }
  return value
}

const formatCpf = (value?: string | null) => {
  if (!value) return '-'
  const digits = value.replace(/\D/g, '')
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  }
  return value
}

const groupIncomeReportLines = (lines: IncomeReportLine[]) => {
  const groups: Array<{ groupName: string; lines: IncomeReportLine[] }> = []
  const indexByGroup = new Map<string, number>()

  for (const line of lines) {
    const existing = indexByGroup.get(line.group_name)
    if (existing === undefined) {
      indexByGroup.set(line.group_name, groups.length)
      groups.push({ groupName: line.group_name, lines: [line] })
    } else {
      groups[existing].lines.push(line)
    }
  }

  return groups
}

const formatIncomeReportTitle = (report: IncomeReport) => {
  if (report.report_year && report.calendar_year) {
    return `Exercício ${report.report_year} • Ano-calendário ${report.calendar_year}`
  }
  if (report.report_year) return `Exercício ${report.report_year}`
  if (report.calendar_year) return `Ano-calendário ${report.calendar_year}`
  return 'Informe de Rendimentos'
}

const getPayslipSelectionKey = (payslip: Payslip) => `payslip:${payslip.id}`
const getIncomeSelectionKey = (report: IncomeReport) => `income:${report.id}`

const META_LABEL_CLS = 'text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500'

const PayrollPage = () => {
  const [activeTab, setActiveTab] = useState<PayrollTab>('payslips')
  const [loading, setLoading] = useState(false)
  const [filtersLoading, setFiltersLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtersApplied, setFiltersApplied] = useState(false)
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ employers: [], years: [], payers: [] })

  const [selectedYear, setSelectedYear] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedEmployer, setSelectedEmployer] = useState('')

  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [incomeReports, setIncomeReports] = useState<IncomeReport[]>([])
  const [selectedPayslip, setSelectedPayslip] = useState<PayslipDetail | null>(null)
  const [selectedIncomeReport, setSelectedIncomeReport] = useState<IncomeReportDetail | null>(null)
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { showConfirm, ConfirmComponent, isConfirmOpen } = useConfirm()

  const currentYear = new Date().getFullYear()
  const defaultYearOptions = Array.from({ length: 10 }, (_, i) => (currentYear - i).toString())
  const yearOptions = useMemo(() => {
    const fromApi = filterOptions.years.map(String)
    return Array.from(new Set([...fromApi, ...defaultYearOptions])).sort((a, b) => Number(b) - Number(a))
  }, [filterOptions.years, defaultYearOptions])

  const employerOptions = activeTab === 'payslips' ? filterOptions.employers : filterOptions.payers

  const tabCounts = useMemo(
    () => ({
      payslips: payslips.length,
      income: incomeReports.length,
    }),
    [payslips.length, incomeReports.length],
  )

  const payslipSummaryTotals = useMemo(
    () =>
      payslips.reduce(
        (acc, payslip) => ({
          gross: acc.gross + Number(payslip.gross_earnings || 0),
          deductions: acc.deductions + Number(payslip.total_deductions || 0),
          net: acc.net + Number(payslip.net_amount || 0),
        }),
        { gross: 0, deductions: 0, net: 0 },
      ),
    [payslips],
  )

  const hasActiveFilters = selectedYear !== '' || selectedMonth !== '' || selectedEmployer !== ''

  const currentTabItems = useMemo(() => {
    if (activeTab === 'payslips') {
      return payslips.map((payslip) => ({
        key: getPayslipSelectionKey(payslip),
        payslip,
      }))
    }
    return incomeReports.map((report) => ({
      key: getIncomeSelectionKey(report),
      report,
    }))
  }, [activeTab, payslips, incomeReports])

  const entityLabel = activeTab === 'payslips' ? 'holerite' : 'informe'
  const entityLabelPlural = activeTab === 'payslips' ? 'holerites' : 'informes'

  const selectAllState = useMemo(() => {
    if (currentTabItems.length === 0) return 'none' as const
    const selectedCount = currentTabItems.filter((item) => selectedItems.has(item.key)).length
    if (selectedCount === 0) return 'none' as const
    if (selectedCount === currentTabItems.length) return 'all' as const
    return 'partial' as const
  }, [currentTabItems, selectedItems])

  const clearSelection = () => setSelectedItems(new Set())

  const toggleItemSelection = (key: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectAllState === 'all') {
      clearSelection()
      return
    }
    setSelectedItems(new Set(currentTabItems.map((item) => item.key)))
  }

  const scrollToTop = () => {
    setShowBackToTop(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const refreshFiltersAfterMutation = () => {
    void loadFilterOptions({ silent: true })
  }

  const handleDeletePayslip = async (payslip: Payslip) => {
    const label = payslip.reference_label || `${payslip.month}/${payslip.year}` || 'este holerite'
    const confirmed = await showConfirm({
      title: 'Excluir holerite',
      message: `Tem certeza que deseja excluir ${label}? Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir',
      type: 'danger',
    })
    if (!confirmed) return

    setDeleting(true)
    try {
      await axios.delete(`/api/payroll/payslips/${payslip.id}`)
      setPayslips((prev) => prev.filter((p) => p.id !== payslip.id))
      setSelectedPayslip((prev) => (prev?.id === payslip.id ? null : prev))
      clearSelection()
      setToast({ show: true, message: 'Holerite excluído com sucesso.', type: 'success' })
      refreshFiltersAfterMutation()
    } catch (err: any) {
      setToast({
        show: true,
        message: err.response?.data?.detail || 'Erro ao excluir holerite',
        type: 'error',
      })
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteIncomeReport = async (report: IncomeReport) => {
    const label = formatIncomeReportTitle(report)
    const confirmed = await showConfirm({
      title: 'Excluir informe',
      message: `Tem certeza que deseja excluir ${label}? Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir',
      type: 'danger',
    })
    if (!confirmed) return

    setDeleting(true)
    try {
      await axios.delete(`/api/payroll/income-reports/${report.id}`)
      setIncomeReports((prev) => prev.filter((r) => r.id !== report.id))
      setSelectedIncomeReport((prev) => (prev?.id === report.id ? null : prev))
      clearSelection()
      setToast({ show: true, message: 'Informe excluído com sucesso.', type: 'success' })
      refreshFiltersAfterMutation()
    } catch (err: any) {
      setToast({
        show: true,
        message: err.response?.data?.detail || 'Erro ao excluir informe',
        type: 'error',
      })
    } finally {
      setDeleting(false)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return

    const confirmed = await showConfirm({
      title: 'Excluir selecionados',
      message: `Tem certeza que deseja excluir ${selectedItems.size} ${selectedItems.size === 1 ? entityLabel : entityLabelPlural}? Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir',
      type: 'danger',
    })
    if (!confirmed) return

    const payslipIds = payslips.filter((p) => selectedItems.has(getPayslipSelectionKey(p))).map((p) => p.id)
    const incomeReportIds = incomeReports
      .filter((r) => selectedItems.has(getIncomeSelectionKey(r)))
      .map((r) => r.id)
    const removedCount = selectedItems.size

    setDeleting(true)
    try {
      await axios.post('/api/payroll/bulk-delete', {
        payslip_ids: payslipIds,
        income_report_ids: incomeReportIds,
      })
      if (payslipIds.length > 0) {
        const removed = new Set(payslipIds)
        setPayslips((prev) => prev.filter((p) => !removed.has(p.id)))
        setSelectedPayslip((prev) => (prev && removed.has(prev.id) ? null : prev))
      }
      if (incomeReportIds.length > 0) {
        const removed = new Set(incomeReportIds)
        setIncomeReports((prev) => prev.filter((r) => !removed.has(r.id)))
        setSelectedIncomeReport((prev) => (prev && removed.has(prev.id) ? null : prev))
      }
      clearSelection()
      setToast({
        show: true,
        message: `${removedCount} ${removedCount === 1 ? entityLabel : entityLabelPlural} excluído(s) com sucesso.`,
        type: 'success',
      })
      refreshFiltersAfterMutation()
    } catch (err: any) {
      setToast({
        show: true,
        message: err.response?.data?.detail || 'Erro ao excluir itens selecionados',
        type: 'error',
      })
    } finally {
      setDeleting(false)
    }
  }

  const loadFilterOptions = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setFiltersLoading(true)
    }
    try {
      const res = await axios.get<FilterOptions>('/api/payroll/filter-options')
      setFilterOptions(res.data || { employers: [], years: [], payers: [] })
    } catch (err: any) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Erro ao carregar opções de filtro')
    } finally {
      if (!opts?.silent) {
        setFiltersLoading(false)
      }
    }
  }

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const payslipParams: Record<string, string | number> = {}
      const incomeParams: Record<string, string | number> = {}

      if (selectedYear) {
        payslipParams.year = Number(selectedYear)
        incomeParams.year = Number(selectedYear)
      }
      if (selectedMonth) {
        payslipParams.month = Number(selectedMonth)
      }
      if (selectedEmployer) {
        payslipParams.employer_name = selectedEmployer
        incomeParams.payer_name = selectedEmployer
      }

      const [payslipRes, incomeRes] = await Promise.all([
        axios.get('/api/payroll/payslips', { params: payslipParams }),
        axios.get('/api/payroll/income-reports', { params: incomeParams }),
      ])
      setPayslips(payslipRes.data || [])
      setIncomeReports(incomeRes.data || [])
      setFiltersApplied(true)
    } catch (err: any) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Erro ao carregar dados de holerites/informes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadFilterOptions()
  }, [])

  useEffect(() => {
    clearSelection()
  }, [activeTab])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      setShowBackToTop(container.scrollTop > 300)
    }

    handleScroll()
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [filtersApplied, activeTab, payslips.length, incomeReports.length])

  const clearFilters = () => {
    setSelectedYear('')
    setSelectedMonth('')
    setSelectedEmployer('')
    setError(null)
    clearSelection()
    void loadData()
  }

  const openPayslip = async (payslip: Payslip) => {
    try {
      const url =
        payslip.year && payslip.month
          ? `/api/payroll/payslips/period/${payslip.year}/${payslip.month}`
          : `/api/payroll/payslips/${payslip.id}`
      const res = await axios.get(url, {
        params:
          payslip.year && payslip.month
            ? { family: payslipKindFamily(payslip.payslip_kind) }
            : undefined,
      })
      setSelectedPayslip(res.data)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erro ao abrir holerite')
    }
  }

  const openIncomeReport = async (id: number) => {
    try {
      const res = await axios.get(`/api/payroll/income-reports/${id}`)
      setSelectedIncomeReport(res.data)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erro ao abrir informe')
    }
  }

  const incomeReportSections = selectedIncomeReport ? groupIncomeReportLines(selectedIncomeReport.lines) : []

  const closeDetailModal = useCallback(() => {
    setSelectedPayslip(null)
    setSelectedIncomeReport(null)
  }, [])

  const isDetailModalOpen = !!(selectedPayslip || selectedIncomeReport)
  useEscapeKey(closeDetailModal, isDetailModalOpen && !isConfirmOpen)

  if (filtersLoading) {
    return (
      <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <CadastroListPageShell>
          <LoadingSpinner fullScreen message="Carregando filtros..." />
        </CadastroListPageShell>
      </div>
    )
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <CadastroListPageShell>
        <CadastroListPageBody
          scrollRef={scrollContainerRef}
          header={
            <CadastroListPageHero
              icon={<Briefcase className="w-8 h-8" />}
              title="Informes"
              subtitle="Consulte holerites e informes de rendimento importados pela Home."
            />
          }
          tabs={
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-color-primary hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-base font-bold text-gray-800 dark:text-gray-200">
                  <Filter size={18} className="text-color-primary" />
                  Filtros
                </h3>
                <button
                  onClick={clearFilters}
                  className={`flex items-center gap-1.5 text-sm font-semibold transition-all ${hasActiveFilters ? 'opacity-100 hover:opacity-80' : 'opacity-0 pointer-events-none'}`}
                  style={{ color: 'var(--color-1)' }}
                >
                  <X size={14} />
                  Limpar filtros
                </button>
              </div>

              <div className="flex flex-col gap-3 lg:flex-row">
                <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                      <Calendar size={12} className="mr-1 inline text-color-primary" />
                      Ano
                    </label>
                    <select
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 transition-all focus:border-color-primary focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    >
                      <option value="">Todos</option>
                      {yearOptions.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                      <Calendar size={12} className="mr-1 inline text-color-primary" />
                      Mês
                    </label>
                    <select
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(e.target.value)}
                      disabled={activeTab === 'income-reports'}
                      className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 transition-all focus:border-color-primary focus:outline-none disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    >
                      <option value="">Todos</option>
                      {MONTH_OPTIONS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                      <Building2 size={12} className="mr-1 inline text-color-primary" />
                      {activeTab === 'payslips' ? 'Empregador' : 'Fonte pagadora'}
                    </label>
                    <select
                      value={selectedEmployer}
                      onChange={(e) => setSelectedEmployer(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 transition-all focus:border-color-primary focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    >
                      <option value="">Todos</option>
                      {employerOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-shrink-0 items-end">
                  <button
                    onClick={loadData}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all hover:opacity-90"
                    style={{ backgroundColor: 'var(--crud-create)', color: 'var(--on-crud-create)' }}
                  >
                    <Filter size={14} />
                    Aplicar
                  </button>
                </div>
              </div>
            </div>
          }
        >
          {loading && (
            <div className="flex justify-center items-center py-12">
              <LoadingSpinner message="Carregando holerites e informes..." />
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {!loading && !error && !filtersApplied && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
              <Filter size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Selecione os filtros</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Escolha ano, mês e empregador (ou deixe Todos) e clique em Aplicar para carregar holerites e informes.
              </p>
            </div>
          )}

          {!loading && filtersApplied && (
            <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden ${selectedItems.size > 0 || showBackToTop ? 'mb-20' : ''}`}>
              <div className="px-4 pt-3">
                <CadastroListPageTabs
                  tabs={[
                    { key: 'payslips', label: 'Holerites', icon: <Briefcase size={16} />, count: tabCounts.payslips },
                    { key: 'income-reports', label: 'Informes de rendimento', icon: <FileText size={16} />, count: tabCounts.income },
                  ]}
                  active={activeTab}
                  onChange={setActiveTab}
                />
              </div>

              <div className="p-4">
                {activeTab === 'payslips' && payslips.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                    <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <ArrowDownCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                          <div>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Vencimentos</p>
                            <p className="text-lg font-bold text-green-600 dark:text-green-400">
                              {formatCurrency(payslipSummaryTotals.gross)}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-500">
                          {payslips.length} {payslips.length === 1 ? 'holerite' : 'holerites'}
                        </span>
                      </div>
                    </div>

                    <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <ArrowUpCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                          <div>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Descontos</p>
                            <p className="text-lg font-bold text-red-600 dark:text-red-400">
                              {formatCurrency(payslipSummaryTotals.deductions)}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-500">
                          {payslips.length} {payslips.length === 1 ? 'holerite' : 'holerites'}
                        </span>
                      </div>
                    </div>

                    <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <TrendingUp className="w-5 h-5 text-color-primary" />
                          <div>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Líquido</p>
                            <p className="text-lg font-bold text-green-600 dark:text-green-400">
                              {formatCurrency(payslipSummaryTotals.net)}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-500">
                          {payslips.length} {payslips.length === 1 ? 'holerite' : 'holerites'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {currentTabItems.length > 0 && (
                  <div className="flex items-center justify-between gap-3 mb-4 px-1">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={toggleSelectAll}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                        title={selectAllState === 'all' ? 'Limpar seleção' : 'Selecionar todos'}
                      >
                        {selectAllState === 'none' && <Square size={18} className="text-gray-400" />}
                        {selectAllState === 'partial' && <MinusSquare size={18} className="text-[var(--color-1)]" />}
                        {selectAllState === 'all' && <CheckSquare size={18} className="text-[var(--color-1)]" />}
                      </button>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        Selecionar todos ({currentTabItems.length} {currentTabItems.length === 1 ? entityLabel : entityLabelPlural})
                      </span>
                    </div>
                  </div>
                )}

                {activeTab === 'payslips' ? (
                  payslips.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">Nenhum holerite encontrado para os filtros selecionados.</p>
                  ) : (
                    <div className="space-y-3">
                      {payslips.map((p, index) => {
                        const itemKey = getPayslipSelectionKey(p)
                        const selected = selectedItems.has(itemKey)
                        const kindLabel = payslipKindLabel(p.payslip_kind)
                        return (
                          <article
                            key={itemKey}
                            className={`rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 border-l-[var(--color-1)] bg-white dark:bg-gray-800 transition-all ${
                              selected ? 'ring-2 ring-[var(--color-1)]/40' : 'hover:border-color-primary'
                            }`}
                          >
                            <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-stretch">
                              <div className="flex min-w-0 flex-1 items-stretch gap-3">
                                <div className="flex flex-shrink-0 items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleItemSelection(itemKey)}
                                    className="rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                                    title={selected ? 'Desmarcar' : 'Selecionar'}
                                  >
                                    {selected ? (
                                      <CheckSquare size={18} className="text-[var(--color-1)]" />
                                    ) : (
                                      <Square size={18} className="text-gray-400" />
                                    )}
                                  </button>
                                  <span className="w-7 text-center text-xs font-semibold text-gray-400">{index + 1}</span>
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-semibold text-gray-900 dark:text-white">
                                      {p.reference_label || `${p.month}/${p.year}` || 'Sem referência'}
                                    </p>
                                    {kindLabel && (
                                      <Badge
                                        variant={badgeVariantForColumnRole('classificationPrimary')}
                                        tone={payslipKindTone(p.payslip_kind)}
                                        label={kindLabel}
                                      />
                                    )}
                                  </div>
                                  {formatEmployeeSubtitle(p) && (
                                    <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
                                      {formatEmployeeSubtitle(p)}
                                    </p>
                                  )}
                                  {p.employer_name && (
                                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                      <span className="inline-flex items-center gap-1">
                                        <span className={META_LABEL_CLS}>Empregador</span>
                                        <span className="text-gray-700 dark:text-gray-300">{p.employer_name}</span>
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex shrink-0 flex-col gap-3 lg:items-end lg:justify-between">
                                <div className="grid grid-cols-3 gap-3 lg:text-right">
                                  <div>
                                    <p className={META_LABEL_CLS}>Vencimentos</p>
                                    <p className="text-sm font-semibold tabular-nums text-[var(--color-success)]">
                                      {formatCurrency(p.gross_earnings)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className={META_LABEL_CLS}>Descontos</p>
                                    <p className="text-sm font-semibold tabular-nums text-[var(--color-danger)]">
                                      {formatCurrency(p.total_deductions)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className={META_LABEL_CLS}>Líquido</p>
                                    <p className="text-sm font-bold tabular-nums text-[var(--color-success)]">
                                      {formatCurrency(p.net_amount)}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 lg:justify-end">
                                  <button
                                    type="button"
                                    onClick={() => openPayslip(p)}
                                    disabled={selectedItems.size > 0}
                                    className={`${cadastroRowIconBtnCls} ${
                                      selectedItems.size > 0 ? 'cursor-not-allowed opacity-40' : ''
                                    }`}
                                    title={selectedItems.size > 0 ? 'Limpe a seleção para visualizar' : 'Visualizar holerite'}
                                  >
                                    <Eye size={16} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePayslip(p)}
                                    disabled={deleting}
                                    className={cadastroRowIconDangerCls}
                                    title="Excluir holerite"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )
                ) : incomeReports.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">Nenhum informe encontrado para os filtros selecionados.</p>
                ) : (
                  <div className="space-y-3">
                    {incomeReports.map((r, index) => {
                      const itemKey = getIncomeSelectionKey(r)
                      const selected = selectedItems.has(itemKey)
                      return (
                        <article
                          key={itemKey}
                          className={`rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 border-l-emerald-500 bg-white dark:bg-gray-800 transition-all ${
                            selected ? 'ring-2 ring-[var(--color-1)]/40' : 'hover:border-color-primary'
                          }`}
                        >
                          <div className="flex items-stretch gap-3 p-4">
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                onClick={() => toggleItemSelection(itemKey)}
                                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                title={selected ? 'Desmarcar' : 'Selecionar'}
                              >
                                {selected ? (
                                  <CheckSquare size={18} className="text-[var(--color-1)]" />
                                ) : (
                                  <Square size={18} className="text-gray-400" />
                                )}
                              </button>
                              <span className="w-7 text-center text-xs font-semibold text-gray-400">{index + 1}</span>
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900 dark:text-white">{formatIncomeReportTitle(r)}</p>
                              <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{r.beneficiary_name || 'Beneficiário'}</p>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-sm">
                                <span className="inline-flex items-center gap-1">
                                  <span className={META_LABEL_CLS}>Fonte pagadora</span>
                                  <span className="text-gray-700 dark:text-gray-300">{r.payer_name || '-'}</span>
                                </span>
                                {r.nature_code && (
                                  <span className="inline-flex items-center gap-1">
                                    <span className={META_LABEL_CLS}>Natureza</span>
                                    <span className="text-gray-700 dark:text-gray-300">{r.nature_code}</span>
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-end gap-1 flex-shrink-0">
                              <button
                                onClick={() => openIncomeReport(r.id)}
                                disabled={selectedItems.size > 0}
                                className={`p-2 rounded-lg transition-colors ${
                                  selectedItems.size > 0
                                    ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                    : 'text-[var(--color-1)] hover:bg-gray-100 dark:hover:bg-gray-700'
                                }`}
                                title={selectedItems.size > 0 ? 'Limpe a seleção para visualizar' : 'Visualizar informe'}
                              >
                                <Eye size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteIncomeReport(r)}
                                disabled={deleting}
                                className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                                title="Excluir informe"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </CadastroListPageBody>
      </CadastroListPageShell>

      {(selectedPayslip || selectedIncomeReport) && (
        <CadastroModalShell maxWidth="max-w-5xl" onBackdropClick={closeDetailModal}>
          <CadastroModalHeader
            isEdit={false}
            title={
              selectedPayslip
                ? selectedPayslip.reference_label || 'Detalhes do Holerite'
                : selectedIncomeReport
                  ? formatIncomeReportTitle(selectedIncomeReport)
                  : 'Detalhes do Informe'
            }
            subtitle={
              selectedPayslip ? (
                <span className="flex flex-wrap items-center gap-2">
                  {formatEmployeeSubtitle(selectedPayslip) || selectedPayslip.employer_name}
                  {payslipKindLabel(selectedPayslip.payslip_kind) && (
                    <Badge
                      variant={badgeVariantForColumnRole('classificationPrimary')}
                      tone={payslipKindTone(selectedPayslip.payslip_kind)}
                      label={payslipKindLabel(selectedPayslip.payslip_kind) || ''}
                    />
                  )}
                </span>
              ) : selectedIncomeReport ? (
                [
                  selectedIncomeReport.beneficiary_name || 'Beneficiário',
                  selectedIncomeReport.nature_description,
                ]
                  .filter(Boolean)
                  .join(' • ')
              ) : null
            }
            icon={selectedPayslip ? <Briefcase size={18} /> : <FileText size={18} />}
            iconStyle={{ backgroundColor: 'var(--color-1)', color: 'var(--on-color-1)' }}
            onClose={closeDetailModal}
          />
          <CadastroModalBody>
              {selectedPayslip && <PayslipDetailContent payslip={selectedPayslip} />}

              {selectedIncomeReport && (
                <>
                  <CadastroFormSection title="Fonte pagadora" icon={<Building2 size={14} />}>
                    <CadastroModalFieldsGrid>
                      <CadastroModalFieldsRow cols={2}>
                        <div>
                          <CadastroFieldLabel>CNPJ</CadastroFieldLabel>
                          <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-white">{formatCnpj(selectedIncomeReport.payer_cnpj)}</p>
                        </div>
                        <div>
                          <CadastroFieldLabel>Nome empresarial</CadastroFieldLabel>
                          <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-white">{selectedIncomeReport.payer_name || '-'}</p>
                        </div>
                      </CadastroModalFieldsRow>
                    </CadastroModalFieldsGrid>
                  </CadastroFormSection>
                  <CadastroFormSection title="Beneficiário" icon={<Briefcase size={14} />}>
                    <CadastroModalFieldsGrid>
                      <CadastroModalFieldsRow cols={2}>
                        <div>
                          <CadastroFieldLabel>CPF</CadastroFieldLabel>
                          <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-white">{formatCpf(selectedIncomeReport.beneficiary_cpf)}</p>
                        </div>
                        <div>
                          <CadastroFieldLabel>Nome completo</CadastroFieldLabel>
                          <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-white">{selectedIncomeReport.beneficiary_name || '-'}</p>
                        </div>
                      </CadastroModalFieldsRow>
                      {(selectedIncomeReport.nature_code || selectedIncomeReport.nature_description) ? (
                        <CadastroModalFieldsRow>
                          <div>
                            <CadastroFieldLabel>Natureza do rendimento</CadastroFieldLabel>
                            <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-white">
                              {[selectedIncomeReport.nature_code, selectedIncomeReport.nature_description].filter(Boolean).join(' - ')}
                            </p>
                          </div>
                        </CadastroModalFieldsRow>
                      ) : null}
                    </CadastroModalFieldsGrid>
                  </CadastroFormSection>
                  {incomeReportSections.map((section) => (
                    <CadastroFormSection key={section.groupName} title={section.groupName} bodyClassName="p-0">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-700/70 border-b border-gray-200 dark:border-gray-700">
                          <tr>
                            <th className="px-3 py-2 text-left w-16">Item</th>
                            <th className="px-3 py-2 text-left">Descrição</th>
                            <th className="px-3 py-2 text-right w-36">Valor (R$)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.lines.map((line) => (
                            <tr key={line.id} className="border-t border-gray-200 dark:border-gray-700">
                              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                                {line.item_no ? `${line.item_no}.` : '-'}
                              </td>
                              <td className="px-3 py-2">{line.line_type_name || line.description}</td>
                              <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-white">
                                {line.amount != null ? formatCurrency(line.amount) : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CadastroFormSection>
                  ))}
                </>
              )}
          </CadastroModalBody>
          <CadastroModalFooter onClose={closeDetailModal} hideSave closeLabel="Fechar" />
        </CadastroModalShell>
      )}

      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.type === 'success' ? 5000 : 4000}
          onClose={() => setToast((prev) => ({ ...prev, show: false }))}
        />
      )}

      {selectedItems.size > 0 && (
        <FloatingFooterBar>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-medium text-color-primary">
                {selectedItems.size} {selectedItems.size === 1 ? entityLabel : entityLabelPlural} selecionado(s)
              </span>
              <button
                onClick={clearSelection}
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex items-center gap-1"
              >
                <X size={14} />
                Limpar
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkDelete}
                disabled={deleting}
                className="px-3 py-1.5 text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: 'var(--crud-delete)' }}
              >
                <Trash2 size={14} />
                Excluir
              </button>
              {showBackToTop && (
                <button
                  onClick={scrollToTop}
                  className="px-3 py-1.5 bg-color-primary text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold"
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

      {showBackToTop && selectedItems.size === 0 && (
        <FloatingFooterBar>
          <div className="flex items-center justify-end">
            <button
              onClick={scrollToTop}
              className="px-3 py-1.5 bg-color-primary text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold"
              title="Voltar ao topo"
            >
              <ArrowUp size={14} />
              Voltar ao Topo
            </button>
          </div>
        </FloatingFooterBar>
      )}

      <ConfirmComponent />
    </div>
  )
}

export default PayrollPage
