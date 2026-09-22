import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageShell,
} from '../components/CadastroListPageLayout'
import LoadingSpinner from '../components/LoadingSpinner'
import UnifiedImportModal from '../components/UnifiedImportModal'
import ManualTransactionModal from '../components/ManualTransactionModal'
import HomeInvoiceDetailsModal, { HomeInvoiceModalParams } from '../components/HomeInvoiceDetailsModal'
import {
  Upload,
  CreditCard,
  PlusCircle,
  TrendingDown,
  TrendingUp,
  Gift,
  Landmark,
  Clock,
  ArrowRight,
  Scale,
  FileText,
  Receipt,
  ChevronRight,
  Home,
  History,
  Eye,
  EyeOff,
} from 'lucide-react'
import {
  formatCurrencyWithColorSafe,
  formatCurrencySafe,
  formatSignedCurrencySafe,
} from '../utils/currency'
import { formatDateBR } from '../utils/dateUtils'
import { useBalanceVisibility } from '../contexts/BalanceVisibilityContext'

interface MonthSummary {
  year_month: string
  month_label: string
  balance: number
  total_expenses: number
  total_revenue: number
  expenses_count: number
  revenue_count: number
}

interface CardMonthData {
  card_id: number
  card_number: string
  card_name: string
  card_type: string
  total: number
  count: number
}

interface InvoiceMonthSummary {
  year_month: string
  month_label: string
  total: number
  count: number
  cards: CardMonthData[]
}

interface CardRemainingBalance {
  card_id: number
  card_number: string
  card_name: string
  card_type: string
  remaining_total: number
  remaining_count: number
}

interface RemainingInstallmentsSummary {
  total: number
  count: number
  cards: CardRemainingBalance[]
}

interface HomeDashboardData {
  months: MonthSummary[]
  invoice_months: InvoiceMonthSummary[]
  remaining_installments: RemainingInstallmentsSummary
}

interface CurrentBalanceData {
  current_balance: number
  total_credits: number
  total_debits: number
  credits_count: number
  debits_count: number
  last_transaction_date: string | null
}

const MONTH_NAMES_FULL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const MONTH_NAMES_SHORT = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
]

const HomePage = () => {
  const navigate = useNavigate()
  const { hideBalanceValues, toggleBalanceVisibility } = useBalanceVisibility()
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [isManualTransactionModalOpen, setIsManualTransactionModalOpen] = useState(false)
  const [invoiceModalParams, setInvoiceModalParams] = useState<HomeInvoiceModalParams | null>(null)
  const [dashboardData, setDashboardData] = useState<HomeDashboardData | null>(null)
  const [currentBalance, setCurrentBalance] = useState<CurrentBalanceData | null>(null)
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true)

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonthNum = now.getMonth()
  const currentMonthLabel = `${MONTH_NAMES_FULL[currentMonthNum]} ${currentYear}`

  const getMonthDateRange = (yearMonth?: string) => {
    let year = currentYear
    let month = currentMonthNum

    if (yearMonth) {
      const parts = yearMonth.split('-')
      year = parseInt(parts[0])
      month = parseInt(parts[1]) - 1
    }

    const startDate = new Date(year, month, 1, 0, 0, 0, 0)
    const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999)
    return { startDate, endDate }
  }

  const toLocalISOString = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
  }

  const navigateToExtrato = (yearMonth?: string) => {
    const { startDate, endDate } = getMonthDateRange(yearMonth)
    navigate('/relatorios/extrato', {
      state: {
        startDate: toLocalISOString(startDate),
        endDate: toLocalISOString(endDate),
        sources: ['bank', 'card', 'benefit'],
      },
    })
  }

  useEffect(() => {
    loadDashboardData()
    loadCurrentBalance()
  }, [])

  const loadDashboardData = async () => {
    try {
      setIsLoadingDashboard(true)
      const response = await axios.get('/api/dashboard/home')
      setDashboardData(response.data)
    } catch (error) {
      console.error('Erro ao carregar dados do dashboard:', error)
    } finally {
      setIsLoadingDashboard(false)
    }
  }

  const loadCurrentBalance = async () => {
    try {
      const response = await axios.get('/api/dashboard/current-balance')
      setCurrentBalance(response.data)
    } catch (error) {
      console.error('Erro ao carregar saldo atual:', error)
    }
  }

  const currentMonth = dashboardData?.months?.[0] ?? null
  const currentInvoiceMonth = dashboardData?.invoice_months?.[0] ?? null
  const remainingInstallments = dashboardData?.remaining_installments
  const hasRemainingDebt = (remainingInstallments?.total ?? 0) > 0
  const hasInvoiceData =
    (currentInvoiceMonth?.count ?? 0) > 0 || hasRemainingDebt

  const prevMonthDate = new Date(currentYear, currentMonthNum - 1, 1)
  const previousMonthLabel = `${MONTH_NAMES_SHORT[prevMonthDate.getMonth()]}/${prevMonthDate.getFullYear()}`
  const previousYearMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`

  const monthNetBalance = currentMonth?.balance ?? 0
  const accountBalance = currentBalance?.current_balance ?? 0
  const previousMonthBalance = accountBalance - monthNetBalance

  const remainingByCard = new Map<number, CardRemainingBalance>()
  remainingInstallments?.cards?.forEach((card) => {
    remainingByCard.set(card.card_id, card)
  })

  const quickLinks = [
    { label: 'Extrato', icon: Receipt, path: '/relatorios/extrato' },
    { label: 'Faturas', icon: CreditCard, path: '/relatorios/faturas' },
    { label: 'Balanço', icon: Scale, path: '/fechamentos/compartilhado' },
    { label: 'Curadoria', icon: FileText, path: '/curadoria' },
  ]

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <CadastroListPageShell>
        <CadastroListPageBody
          header={
            <CadastroListPageHero
              icon={<Home className="w-8 h-8" />}
              title="Plumo"
              subtitle={`Finanças leves, vida plena. · ${currentMonthLabel}`}
              actions={
                <>
                  <button
                    onClick={() => setIsManualTransactionModalOpen(true)}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:border-color-primary hover:text-color-primary dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  >
                    <PlusCircle size={16} />
                    Novo lançamento
                  </button>
                  <button
                    onClick={() => setIsImportModalOpen(true)}
                    className="inline-flex items-center gap-2 rounded-lg bg-color-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:opacity-90"
                  >
                    <Upload size={16} />
                    Importar
                  </button>
                </>
              }
            />
          }
        >
        <div className="space-y-6">

          {/* Acesso rápido */}
          <section>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {quickLinks.map(({ label, icon: Icon, path }) => (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-color-primary transition-all shadow-sm text-left group"
                >
                  <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 group-hover:bg-color-primary-light transition-colors">
                    <Icon size={16} className="text-gray-500 dark:text-gray-400 group-hover:text-color-primary transition-colors" />
                  </div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {isLoadingDashboard ? (
            <div className="flex items-center justify-center py-24">
              <LoadingSpinner message="Carregando dados..." />
            </div>
          ) : (
            <>
              {/* Hero — Saldo atual */}
              <section
                onClick={() => navigate('/relatorios/extrato')}
                className="relative overflow-hidden rounded-2xl p-6 sm:p-8 cursor-pointer group shadow-lg hover:shadow-xl transition-all"
                style={{ background: 'var(--gradient-1-2)' }}
              >
                <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 transition-colors" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Landmark size={18} className="text-white/70" />
                      <span className="text-sm font-medium text-white/80 uppercase tracking-wide">
                        Saldo em conta
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleBalanceVisibility()
                        }}
                        className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-all"
                        title={hideBalanceValues ? 'Exibir valores' : 'Ocultar valores'}
                        aria-label={hideBalanceValues ? 'Exibir valores' : 'Ocultar valores'}
                      >
                        {hideBalanceValues ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                      <ArrowRight size={18} className="text-white/50 group-hover:text-white/80 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                  <p className="text-4xl sm:text-5xl font-bold text-white mb-6 tracking-tight">
                    {formatCurrencySafe(currentBalance?.current_balance ?? 0, hideBalanceValues)}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div className="bg-white/10 rounded-xl px-4 py-3 backdrop-blur-sm">
                      <div className="flex items-center gap-1.5 mb-1">
                        <TrendingUp size={13} className="text-green-300" />
                        <span className="text-xs text-white/70">Entradas</span>
                      </div>
                      <p className="text-sm font-semibold text-white">
                        {formatCurrencySafe(currentBalance?.total_credits ?? 0, hideBalanceValues)}
                      </p>
                      <p className="text-[11px] text-white/50 mt-0.5">
                        {currentBalance?.credits_count ?? 0} lançamentos
                      </p>
                    </div>
                    <div className="bg-white/10 rounded-xl px-4 py-3 backdrop-blur-sm">
                      <div className="flex items-center gap-1.5 mb-1">
                        <TrendingDown size={13} className="text-red-300" />
                        <span className="text-xs text-white/70">Saídas</span>
                      </div>
                      <p className="text-sm font-semibold text-white">
                        {formatCurrencySafe(currentBalance?.total_debits ?? 0, hideBalanceValues)}
                      </p>
                      <p className="text-[11px] text-white/50 mt-0.5">
                        {currentBalance?.debits_count ?? 0} lançamentos
                      </p>
                    </div>
                    {currentBalance?.last_transaction_date && (
                      <div className="bg-white/10 rounded-xl px-4 py-3 backdrop-blur-sm col-span-2 sm:col-span-1">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Clock size={13} className="text-white/60" />
                          <span className="text-xs text-white/70">Última movimentação</span>
                        </div>
                        <p className="text-sm font-semibold text-white">
                          {formatDateBR(currentBalance.last_transaction_date)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Conta corrente — mês atual */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Landmark size={18} className="text-color-primary" />
                    <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                      Conta corrente
                    </h2>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {currentMonth?.month_label ?? currentMonthLabel}
                    </span>
                  </div>
                  <button
                    onClick={() => navigateToExtrato(currentMonth?.year_month)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-color-primary hover:opacity-80 transition-opacity"
                  >
                    Ver extrato
                    <ChevronRight size={14} />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Saldo mês anterior */}
                  <button
                    onClick={() => navigateToExtrato(previousYearMonth)}
                    className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:border-color-primary transition-all shadow-sm text-left group"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700/50">
                        <History size={14} className="text-gray-500 dark:text-gray-400" />
                      </div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Saldo mês anterior
                      </span>
                    </div>
                    <p className="text-2xl font-bold">
                      {formatCurrencyWithColorSafe(previousMonthBalance, hideBalanceValues, true)}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      carryover de {previousMonthLabel}
                    </p>
                  </button>

                  <button
                    onClick={() => navigateToExtrato(currentMonth?.year_month)}
                    className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:border-color-primary transition-all shadow-sm text-left group"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="p-1.5 rounded-lg bg-green-50 dark:bg-green-900/20">
                        <TrendingUp size={14} className="text-green-600 dark:text-green-400" />
                      </div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Receitas
                      </span>
                    </div>
                    <p className={`text-2xl font-bold ${hideBalanceValues ? 'text-gray-400 dark:text-gray-500 tracking-widest' : 'text-green-600 dark:text-green-400'}`}>
                      {formatCurrencySafe(currentMonth?.total_revenue ?? 0, hideBalanceValues)}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {currentMonth?.revenue_count ?? 0} lançamentos
                    </p>
                  </button>

                  <button
                    onClick={() => navigateToExtrato(currentMonth?.year_month)}
                    className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:border-color-primary transition-all shadow-sm text-left group"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="p-1.5 rounded-lg bg-red-50 dark:bg-red-900/20">
                        <TrendingDown size={14} className="text-red-600 dark:text-red-400" />
                      </div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Despesas
                      </span>
                    </div>
                    <p className={`text-2xl font-bold ${hideBalanceValues ? 'text-gray-400 dark:text-gray-500 tracking-widest' : 'text-red-600 dark:text-red-400'}`}>
                      {formatCurrencySafe(-(currentMonth?.total_expenses ?? 0), hideBalanceValues)}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {currentMonth?.expenses_count ?? 0} lançamentos
                    </p>
                  </button>
                </div>
              </section>

              {/* Cartões */}
              {hasInvoiceData && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <CreditCard size={18} className="text-color-primary" />
                      <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                        Cartões
                      </h2>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {currentInvoiceMonth?.month_label}
                      </span>
                    </div>
                    <button
                      onClick={() => navigate('/relatorios/faturas')}
                      className="inline-flex items-center gap-1 text-xs font-medium text-color-primary hover:opacity-80 transition-opacity"
                    >
                      Ver faturas
                      <ChevronRight size={14} />
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 mb-4 w-full">
                    {/* Fatura do mês */}
                    <button
                      onClick={() =>
                        currentInvoiceMonth &&
                        setInvoiceModalParams({ view: 'month', year_month: currentInvoiceMonth.year_month })
                      }
                      className="flex-1 bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:border-color-primary transition-all shadow-sm text-left"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                          Fatura do mês
                        </span>
                        <CreditCard size={14} className="text-color-primary" />
                      </div>
                      <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                        {formatSignedCurrencySafe(
                          currentInvoiceMonth?.total ?? 0,
                          hideBalanceValues,
                          { forceNegative: (currentInvoiceMonth?.total ?? 0) !== 0 }
                        )}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {currentInvoiceMonth?.count ?? 0}{' '}
                        {(currentInvoiceMonth?.count ?? 0) === 1 ? 'transação' : 'transações'}
                        {' · '}
                        {currentInvoiceMonth?.cards.length ?? 0}{' '}
                        {(currentInvoiceMonth?.cards.length ?? 0) === 1 ? 'cartão' : 'cartões'}
                      </p>
                    </button>

                    {/* Saldo devedor parcelado */}
                    {hasRemainingDebt && (
                      <button
                        onClick={() => setInvoiceModalParams({ view: 'remaining' })}
                        className="flex-1 bg-red-50 dark:bg-red-950/20 rounded-xl p-5 border border-red-200 dark:border-red-800/60 hover:border-red-400 dark:hover:border-red-600 transition-all shadow-sm text-left"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-red-700 dark:text-red-400 uppercase tracking-wide">
                            Saldo devedor
                          </span>
                          <Clock size={14} className="text-red-500 dark:text-red-400" />
                        </div>
                        <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                          {formatSignedCurrencySafe(
                            Number(remainingInstallments?.total ?? 0),
                            hideBalanceValues,
                            { forceNegative: (remainingInstallments?.total ?? 0) !== 0 }
                          )}
                        </p>
                        <p className="text-xs text-red-500/70 dark:text-red-400/60 mt-1">
                          {remainingInstallments?.count ?? 0}{' '}
                          {(remainingInstallments?.count ?? 0) === 1 ? 'compra parcelada' : 'compras parceladas'}
                        </p>
                      </button>
                    )}
                  </div>

                  {/* Lista de cartões */}
                  {(currentInvoiceMonth?.cards.length ?? 0) > 0 && (
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                      <div className="divide-y divide-gray-100 dark:divide-gray-700">
                        {currentInvoiceMonth!.cards.map((card) => {
                          const cardTotal = Math.abs(Number(card.total))
                          const remaining = remainingByCard.get(card.card_id)

                          return (
                            <button
                              key={card.card_id}
                              onClick={() =>
                                setInvoiceModalParams({
                                  view: 'card',
                                  card_id: card.card_id,
                                  year_month: currentInvoiceMonth!.year_month,
                                })
                              }
                              className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors text-left group"
                            >
                              <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-color-primary-light flex items-center justify-center">
                                {card.card_type === 'beneficios' ? (
                                  <Gift size={16} className="text-color-primary" />
                                ) : (
                                  <CreditCard size={16} className="text-color-primary" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                                    {card.card_name}
                                  </span>
                                  <span className="text-xs text-gray-400 flex-shrink-0">
                                    •••• {card.card_number}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {card.count} {card.count === 1 ? 'transação' : 'transações'}
                                  {remaining && remaining.remaining_total > 0 && (
                                    <span className="text-red-500 dark:text-red-400 ml-2">
                                      · Parcelado:{' '}
                                      {formatSignedCurrencySafe(
                                        Number(remaining.remaining_total),
                                        hideBalanceValues,
                                        { forceNegative: true }
                                      )}
                                    </span>
                                  )}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {formatSignedCurrencySafe(cardTotal, hideBalanceValues, { forceNegative: true })}
                                <ChevronRight
                                  size={16}
                                  className="text-gray-300 dark:text-gray-600 group-hover:text-color-primary transition-colors"
                                />
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
        </CadastroListPageBody>
      </CadastroListPageShell>

      <UnifiedImportModal
        isOpen={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false)
          loadDashboardData()
          loadCurrentBalance()
        }}
      />

      <HomeInvoiceDetailsModal
        isOpen={invoiceModalParams !== null}
        onClose={() => setInvoiceModalParams(null)}
        params={invoiceModalParams}
      />

      <ManualTransactionModal
        isOpen={isManualTransactionModalOpen}
        onClose={() => setIsManualTransactionModalOpen(false)}
        onSuccess={() => {
          loadDashboardData()
          loadCurrentBalance()
        }}
      />
    </div>
  )
}

export default HomePage
