import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import LoadingSpinner from '../components/LoadingSpinner'
import UnifiedImportModal from '../components/UnifiedImportModal'
import ManualTransactionModal from '../components/ManualTransactionModal'
import { Upload, CreditCard, PlusCircle, Home, FileText, TrendingDown, TrendingUp, Calendar, Gift, Landmark } from 'lucide-react'
import { formatCurrencyWithColor, formatCurrency } from '../utils/currency'

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

interface HomeDashboardData {
  months: MonthSummary[]
  invoice_months: InvoiceMonthSummary[]
}

interface CurrentBalanceData {
  current_balance: number
  total_credits: number
  total_debits: number
  credits_count: number
  debits_count: number
  last_transaction_date: string | null
}

const HomePage = () => {
  const navigate = useNavigate()
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [isManualTransactionModalOpen, setIsManualTransactionModalOpen] = useState(false)
  const [dashboardData, setDashboardData] = useState<HomeDashboardData | null>(null)
  const [currentBalance, setCurrentBalance] = useState<CurrentBalanceData | null>(null)
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true)

  // Obtém mês/ano atual
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonthNum = now.getMonth() // 0-indexed

  // Calcula datas do mês atual para filtros
  const getMonthDateRange = (yearMonth?: string) => {
    let year = currentYear
    let month = currentMonthNum

    if (yearMonth) {
      const parts = yearMonth.split('-')
      year = parseInt(parts[0])
      month = parseInt(parts[1]) - 1 // 0-indexed
    }

    // Usar horário local para evitar problemas de timezone
    const startDate = new Date(year, month, 1, 0, 0, 0, 0)
    const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999) // Último dia do mês
    return { startDate, endDate }
  }

  // Converte Date para string ISO preservando o horário local
  const toLocalISOString = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
  }

  // Navega para Extrato com filtros do mês especificado
  const navigateToExtrato = (yearMonth?: string) => {
    const { startDate, endDate } = getMonthDateRange(yearMonth)
    navigate('/relatorios/extrato', {
      state: {
        startDate: toLocalISOString(startDate),
        endDate: toLocalISOString(endDate),
        sources: ['bank', 'card', 'benefit']
      }
    })
  }

  // Navega para Faturas com filtros do mês especificado
  const navigateToFaturas = (yearMonth?: string) => {
    const ym = yearMonth || `${currentYear}-${String(currentMonthNum + 1).padStart(2, '0')}`
    navigate('/relatorios/faturas', {
      state: {
        yearMonth: ym,
        selectAllCards: true
      }
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

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="w-full">
          {/* Header - Compacto como outras páginas */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <Home className="w-8 h-8" />
              Plumo
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Finanças leves, vida plena. Assuma a direção. Sinta a leveza.
            </p>
          </div>

          {isLoadingDashboard ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner message="Carregando dados..." />
            </div>
          ) : (
            <>
              {/* ==================== SEÇÃO 1: RESUMO DOS ÚLTIMOS 3 MESES ==================== */}
              <div className="mb-6">
                {/* Header da seção */}
                <div className="flex items-center gap-2 mb-4">
                  <Landmark size={20} className="text-color-primary" />
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                    Conta Corrente
                  </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {/* Card de Saldo Atual */}
                  <div
                    onClick={() => navigate('/relatorios/extrato')}
                    className="bg-gradient-to-br from-[var(--color-1)] to-[var(--color-2)] rounded-lg p-4 shadow-lg cursor-pointer hover:shadow-xl transition-all"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-white/80">
                        Saldo Atual
                      </span>
                      <Landmark size={16} className="text-white/60" />
                    </div>
                    <p className="text-2xl font-bold text-white mb-2">
                      {currentBalance ? formatCurrency(currentBalance.current_balance) : 'R$ 0,00'}
                    </p>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1">
                        <TrendingDown size={12} className="text-red-300" />
                        <span className="text-red-200 font-medium">
                          {currentBalance ? formatCurrency(currentBalance.total_debits) : 'R$ 0,00'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <TrendingUp size={12} className="text-green-300" />
                        <span className="text-green-200 font-medium">
                          {currentBalance ? formatCurrency(currentBalance.total_credits) : 'R$ 0,00'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Cards dos 3 meses */}
                  {[...(dashboardData?.months || [])].reverse().map((month, index) => (
                    <div
                      key={month.year_month}
                      onClick={() => navigateToExtrato(month.year_month)}
                      className={`bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 hover:border-[var(--color-1)] transition-all shadow-sm cursor-pointer ${
                        index === 0 ? 'ring-2 ring-[var(--color-1)] ring-opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                          {month.month_label}
                        </span>
                        {index === 0 && (
                          <span className="text-[10px] font-medium text-white bg-[var(--color-1)] px-1.5 py-0.5 rounded">
                            ATUAL
                          </span>
                        )}
                      </div>
                      <p className="text-2xl font-bold mb-2">
                        {formatCurrencyWithColor(month.balance, true)}
                      </p>
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1">
                          <TrendingDown size={12} className="text-red-500" />
                          <span className="text-red-600 dark:text-red-400 font-medium">
                            {formatCurrency(-month.total_expenses)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <TrendingUp size={12} className="text-green-500" />
                          <span className="text-green-600 dark:text-green-400 font-medium">
                            {formatCurrency(month.total_revenue)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ==================== SEÇÃO 2: FATURAS DOS ÚLTIMOS 3 MESES ==================== */}
              {dashboardData && dashboardData.invoice_months && dashboardData.invoice_months.length > 0 && (
                <div className="mb-8">
                  {/* Header da seção */}
                  <div className="flex items-center gap-2 mb-4">
                    <CreditCard size={20} className="text-color-primary" />
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                      Faturas de Cartões
                    </h2>
                  </div>

                  {/* 3 cards de meses (mês atual à esquerda) */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    {[...dashboardData.invoice_months].reverse().map((month, index) => (
                      <div
                        key={month.year_month}
                        onClick={() => navigateToFaturas(month.year_month)}
                        className={`bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 hover:border-[var(--color-1)] transition-all shadow-sm cursor-pointer ${
                          index === 0 ? 'ring-2 ring-[var(--color-1)] ring-opacity-50' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                            {month.month_label}
                          </span>
                          {index === 0 && (
                            <span className="text-[10px] font-medium text-white bg-[var(--color-1)] px-1.5 py-0.5 rounded">
                              ATUAL
                            </span>
                          )}
                        </div>
                        <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                          {month.total !== 0 ? `-${formatCurrency(Math.abs(month.total))}` : formatCurrency(0)}
                        </p>
                        <div className="flex items-center justify-between text-xs mt-2">
                          <span className="text-gray-500 dark:text-gray-400">
                            {month.count} {month.count === 1 ? 'transação' : 'transações'}
                          </span>
                          <span className="text-gray-500 dark:text-gray-400">
                            {month.cards.length} {month.cards.length === 1 ? 'cartão' : 'cartões'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Breakdown por cartão - apenas mês atual ou anterior (sem somar) */}
                  {(() => {
                    // Pega os meses invertidos (atual primeiro)
                    const reversedMonths = [...dashboardData.invoice_months].reverse()
                    const currentMonthIdx = reversedMonths.findIndex(m => m.cards.length > 0)

                    if (currentMonthIdx === -1) return null

                    const currentMonth = reversedMonths[currentMonthIdx]
                    const previousMonth = reversedMonths[currentMonthIdx + 1] // mês anterior ao atual com dados

                    // Cria mapa do mês anterior para comparação
                    const previousMonthMap = new Map<number, number>()
                    if (previousMonth) {
                      previousMonth.cards.forEach(card => {
                        previousMonthMap.set(card.card_id, Number(card.total))
                      })
                    }

                    return (
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                        {currentMonth.cards.map((card) => {
                          const currentTotal = Math.abs(Number(card.total))
                          const previousTotal = Math.abs(previousMonthMap.get(card.card_id) || 0)
                          const trend = previousTotal === 0 ? 'neutral' : currentTotal > previousTotal ? 'up' : currentTotal < previousTotal ? 'down' : 'neutral'

                          return (
                            <div
                              key={card.card_id}
                              className="bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700 hover:border-[var(--color-1)] transition-all shadow-sm"
                            >
                              <div className="flex items-center gap-1 justify-between">
                                {card.card_type === 'beneficios' ? (
                                  <Gift size={10} className="text-color-primary flex-shrink-0" />
                                ) : (
                                  <CreditCard size={10} className="text-color-primary flex-shrink-0" />
                                )}
                                <span className="text-[11px] font-semibold text-gray-800 dark:text-gray-200 truncate flex-1" title={card.card_name}>
                                  {card.card_name}
                                </span>
                                <span className="text-[9px] text-gray-400">
                                  •••• {card.card_number}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 mt-1">
                                <span className="text-sm font-bold text-red-600 dark:text-red-400">
                                  -{formatCurrency(currentTotal)}
                                </span>
                                {trend === 'up' && <TrendingUp size={12} className="text-red-500" title="Aumentou vs mês anterior" />}
                                {trend === 'down' && <TrendingDown size={12} className="text-green-500" title="Diminuiu vs mês anterior" />}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* ==================== SEÇÃO 3: IMPORTAÇÃO E PRIMEIROS PASSOS ==================== */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Card de Importação */}
                <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-850 rounded-lg p-8 border border-gray-200 dark:border-gray-700 hover:border-[var(--color-1)] transition-all shadow-lg hover:shadow-xl">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-gradient-to-br from-[var(--color-1)] to-[var(--color-2)] rounded-lg">
                      <Upload className="w-6 h-6 text-white" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
                      Importar Dados
                    </h2>
                  </div>

                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    Importe seus extratos bancários e faturas de cartão de crédito para começar a gerenciar suas despesas.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Botão Importar */}
                    <button
                      onClick={() => setIsImportModalOpen(true)}
                      className="w-full group relative overflow-hidden bg-gradient-to-r from-[var(--color-1)] to-[var(--color-2)] text-white rounded-lg p-6 hover:shadow-lg transition-all duration-300 hover:scale-[1.02]"
                    >
                      <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
                      <div className="relative flex flex-col items-center gap-3">
                        <Upload className="w-8 h-8" />
                        <span className="text-lg font-bold">Importar Arquivos</span>
                        <span className="text-xs opacity-90">
                          PDF, XLSX • Detecção automática
                        </span>
                      </div>
                    </button>

                    {/* Botão Lançamento Manual */}
                    <button
                      onClick={() => setIsManualTransactionModalOpen(true)}
                      className="w-full group relative overflow-hidden text-white rounded-lg p-6 hover:shadow-lg transition-all duration-300 hover:scale-[1.02]"
                      style={{ background: 'var(--gradient-3-4)' }}
                    >
                      <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
                      <div className="relative flex flex-col items-center gap-3">
                        <PlusCircle className="w-8 h-8" />
                        <span className="text-lg font-bold">Novo Lançamento</span>
                        <span className="text-xs opacity-90">
                          Criar transação manualmente
                        </span>
                      </div>
                    </button>
                  </div>

                  <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div>
                      <span>Extratos XLSX</span>
                    </div>
                    <span>•</span>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                      <span>Faturas PDF</span>
                    </div>
                    <span>•</span>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                      <span>Excel Processado</span>
                    </div>
                  </div>
                </div>

                {/* Card de Primeiros Passos */}
                <div className="bg-white dark:bg-gray-800 rounded-lg p-8 border border-gray-200 dark:border-gray-700 hover:border-[var(--color-1)] transition-all shadow-lg">
                  <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-6">
                    Primeiros Passos
                  </h2>
                  <ul className="space-y-4">
                    <li className="flex items-start gap-3 group">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-[var(--color-1)] to-[var(--color-2)] flex items-center justify-center text-white text-xs font-bold">
                        1
                      </div>
                      <div>
                        <p className="text-gray-800 dark:text-gray-200 font-medium">Importe seus dados</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Extratos bancários e faturas de cartão</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3 group">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-[var(--color-1)] to-[var(--color-2)] flex items-center justify-center text-white text-xs font-bold">
                        2
                      </div>
                      <div>
                        <p className="text-gray-800 dark:text-gray-200 font-medium">Revise as transações</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Categorize e organize seus gastos</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3 group">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-[var(--color-1)] to-[var(--color-2)] flex items-center justify-center text-white text-xs font-bold">
                        3
                      </div>
                      <div>
                        <p className="text-gray-800 dark:text-gray-200 font-medium">Acompanhe padrões</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Visualize seus hábitos financeiros</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3 group">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-[var(--color-1)] to-[var(--color-2)] flex items-center justify-center text-white text-xs font-bold">
                        4
                      </div>
                      <div>
                        <p className="text-gray-800 dark:text-gray-200 font-medium">Gere relatórios</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Obtenha insights sobre suas finanças</p>
                      </div>
                    </li>
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Modal de Importação Unificado */}
      <UnifiedImportModal
        isOpen={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false)
          loadDashboardData() // ← Recarrega os dados após fechar o modal
        }}
      />

      {/* Modal de Lançamento Manual */}
      <ManualTransactionModal
        isOpen={isManualTransactionModalOpen}
        onClose={() => setIsManualTransactionModalOpen(false)}
        onSuccess={loadDashboardData}
      />
    </div>
  )
}

export default HomePage

