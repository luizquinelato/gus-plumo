import React, { useState, useEffect, useCallback, useRef } from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import '../styles/datepicker-custom.css'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import Toast from '../components/Toast'
import LoadingSpinner from '../components/LoadingSpinner'
import BalanceDetailsModal from '../components/BalanceDetailsModal'
import MonthlyHistoryDetailsModal from '../components/MonthlyHistoryDetailsModal'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import JsonTreeViewer from '../components/JsonTreeViewer'
import { useConfirm } from '../hooks/useConfirm'
import { Scale, Calendar, Building2, TrendingUp, TrendingDown, Minus, CreditCard, Receipt, Archive, Eye, Lock, Unlock, ChevronDown, ChevronUp, Landmark, Gift, FileJson, Braces, Copy, Check, CheckCircle, Clock, Trash2, ChevronRight, AlertTriangle, X, Download, Filter, Search, Banknote, HelpCircle, ArrowUpCircle, ArrowDownCircle, ArrowUp, ArrowDown, UnfoldVertical, FoldVertical, CheckSquare, Square, MinusSquare } from 'lucide-react'
import { exportBalanceClosureToPDF } from '../utils/pdfExport'
import { exportBalanceClosureToExcel } from '../utils/exportToExcel'
import { ExportClosureModal } from '../components/ExportClosureModal'

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

interface AccountInfo {
  id: number
  name: string | null
  description: string | null
  bank_name: string | null
}

interface MonthlyAccountBalance {
  a_receber: number
  a_pagar: number
  net_balance: number
  status: 'receive' | 'pay' | 'even'
}

interface MonthlyBalanceSummary {
  month: string
  main_account_balance: MonthlyAccountBalance
  partner_account_balance: MonthlyAccountBalance
  has_closure: boolean
  is_settled: boolean
}

interface YearSummary {
  total_a_receber: number
  total_a_pagar: number
  net_balance: number
  status: 'receive' | 'pay' | 'even'
}

interface AnnualHistory {
  year: number
  main_account: AccountInfo
  partner_account: AccountInfo
  my_contribution_percentage: number
  months: MonthlyBalanceSummary[]
  main_account_year_summary: YearSummary
  partner_account_year_summary: YearSummary
}

interface Account {
  id: number
  name?: string
  description?: string
  bank?: {
    id: number
    code: string
    name: string
  }
  agency?: string
  account_number?: number
}

interface ExpenseSharing {
  id: number
  account_id: number
  shared_account_id: number
  my_contribution_percentage: number
  description?: string
  closing_day?: number  // Dia fixo de fechamento (1-31)
  active: boolean
  shared_account?: Account
}

interface TransactionItem {
  id: number
  date: string
  description: string
  amount: number
  source_table: string
  tag_name: string | null
  subtag_name: string | null
  my_contribution_percentage: number
  partner_contribution_percentage: number
  year_month?: string
  card_id?: number
  card_name?: string
  card_number?: string  // Número do cartão (últimos 4 dígitos)
  current_installment?: number | null
  total_installments?: number | null
}

interface AccountBalanceCard {
  account_id: number
  account_name: string
  bank_name: string | null
  agency: string | null
  account_number: number | null
  total_expenses: number
  total_revenues: number
  net_amount: number
  contribution_percentage: number
  status: 'to_pay' | 'to_receive' | 'even'
  // Transações de bank_statements
  expense_items: TransactionItem[]
  revenue_items: TransactionItem[]
  // Transações de credit_card_invoices
  credit_card_expense_items: TransactionItem[]
  credit_card_revenue_items: TransactionItem[]
  // Transações de benefit_card_statements
  benefit_card_expense_items: TransactionItem[]
  benefit_card_revenue_items: TransactionItem[]
}

interface BalanceCalculation {
  main_account_card: AccountBalanceCard
  partner_account_card: AccountBalanceCard
  year: number
  month: number
  closing_day: number | null
  start_date: string
  end_date: string
  calculation_date: string
}

interface ClosurePayment {
  id: number
  balance_closure_id: number
  amount: number
  payment_date: string
  notes: string | null
  account_id: number
  created_at: string
}

interface BalanceClosure {
  id: number
  expense_sharing_id: number
  account_id: number
  shared_account_id: number
  period_start_date: string
  closing_date: string
  year: number
  month: number
  closing_day: number | null
  total_to_receive: number
  total_to_pay: number
  net_balance: number
  notes: string | null
  is_settled: boolean
  settled_at: string | null
  settlement_notes: string | null
  closure_data: any
  created_at: string
  tenant_id: number
  created_by: number
  // Campos computados de pagamentos parciais
  total_paid: number
  remaining_balance: number
  closure_payments: ClosurePayment[]
}

interface BalanceClosureItem {
  id: number
  source_table: string
  expense_id: number | null
  amount: number
  date: string
  item_data: any
  created_at: string
}

// ==================== EMPRÉSTIMOS ====================
interface OpenLoanItem {
  id: number
  loan_type: 'lent' | 'borrowed'
  description: string
  loan_date: string
  principal_amount: number
  total_paid: number
  remaining_balance: number
  interest_enabled: boolean
  interest_type: string | null
  interest_rate: number | null
  interest_period: string | null
  counterpart_name: string | null
  counterpart_account_id: number | null
}

interface OpenLoansResponse {
  partner_account_id: number
  partner_account_name: string | null
  loans: OpenLoanItem[]
  total_lent_remaining: number  // Total que tenho a receber (emprestei)
  total_borrowed_remaining: number  // Total que tenho a pagar (peguei emprestado)
  net_loan_balance: number  // lent - borrowed
}

interface LoanPaymentInput {
  loan_id: number
  amount: number
  displayAmount: string  // Valor de texto para exibição no input
  ignore: boolean  // Flag para ignorar no fechamento
  settleInFull: boolean  // Switch para quitar integral
}

// Função para calcular juros (igual a EmprestimosPage)
const calculateInterest = (
  principal: number,
  loanDate: string,
  interestRate: number,
  interestType: 'simple' | 'compound',
  interestPeriod: 'daily' | 'monthly' | 'yearly'
): { correctedAmount: number; interestAmount: number; periods: number; description: string } => {
  const startDate = new Date(loanDate)
  const today = new Date()

  // Calcular diferença em dias
  const diffTime = today.getTime() - startDate.getTime()
  const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)))

  // Garantir que principal e rate são números
  const principalNum = Number(principal)
  const rate = Number(interestRate) / 100

  let correctedAmount: number
  let periods: number
  let description: string

  if (interestPeriod === 'daily') {
    periods = diffDays
    if (interestType === 'compound') {
      correctedAmount = principalNum * Math.pow(1 + rate, periods)
    } else {
      correctedAmount = principalNum * (1 + rate * periods)
    }
    description = `${periods} dias × ${interestRate}% ao dia`
  } else if (interestPeriod === 'monthly') {
    const DAYS_IN_MONTH = 30
    const fullMonths = Math.floor(diffDays / DAYS_IN_MONTH)
    const extraDays = diffDays % DAYS_IN_MONTH

    if (diffDays < DAYS_IN_MONTH) {
      correctedAmount = principalNum
      periods = 0
      description = `Carência: ${diffDays} dias (1º mês)`
    } else {
      if (interestType === 'compound') {
        const totalPeriods = fullMonths + (extraDays / DAYS_IN_MONTH)
        correctedAmount = principalNum * Math.pow(1 + rate, totalPeriods)
        periods = totalPeriods
      } else {
        const totalPeriods = fullMonths + (extraDays / DAYS_IN_MONTH)
        correctedAmount = principalNum * (1 + rate * totalPeriods)
        periods = totalPeriods
      }
      description = `${fullMonths} mês(es) + ${extraDays} dias pro-rata`
    }
  } else {
    const DAYS_IN_YEAR = 365
    const DAYS_IN_MONTH = 30
    const fullYears = Math.floor(diffDays / DAYS_IN_YEAR)
    const remainingDays = diffDays % DAYS_IN_YEAR
    const fullMonthsInRemainder = Math.floor(remainingDays / DAYS_IN_MONTH)
    const extraDays = remainingDays % DAYS_IN_MONTH

    if (diffDays < DAYS_IN_YEAR) {
      correctedAmount = principalNum
      periods = 0
      const monthsElapsed = Math.floor(diffDays / DAYS_IN_MONTH)
      const daysElapsed = diffDays % DAYS_IN_MONTH
      description = `Carência: ${monthsElapsed}m ${daysElapsed}d (1º ano)`
    } else {
      if (interestType === 'compound') {
        const monthlyRate = Math.pow(1 + rate, 1 / 12) - 1
        const fullMonthsTotal = fullYears * 12 + fullMonthsInRemainder
        const totalPeriods = fullMonthsTotal + (extraDays / DAYS_IN_MONTH)
        correctedAmount = principalNum * Math.pow(1 + monthlyRate, totalPeriods)
        periods = fullYears + (remainingDays / DAYS_IN_YEAR)
      } else {
        const totalPeriods = fullYears + (remainingDays / DAYS_IN_YEAR)
        correctedAmount = principalNum * (1 + rate * totalPeriods)
        periods = totalPeriods
      }
      description = `${fullYears} ano(s) + ${fullMonthsInRemainder}m ${extraDays}d pro-rata`
    }
  }

  const interestAmount = correctedAmount - principalNum

  return {
    correctedAmount: Math.round(correctedAmount * 100) / 100,
    interestAmount: Math.round(interestAmount * 100) / 100,
    periods: Math.round(periods * 100) / 100,
    description
  }
}

// Componente Modal de Fechamento
interface ClosureModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  closureNotes: string
  setClosureNotes: (notes: string) => void
  selectedYear: number
  periodStart: string
  periodEnd: string
  lastClosureTimestamp?: string | null
  calculationTimestamp?: string | null
}

const ClosureModal = ({ isOpen, onClose, onConfirm, closureNotes, setClosureNotes, selectedYear, periodStart, periodEnd, lastClosureTimestamp, calculationTimestamp }: ClosureModalProps) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onConfirm()
      }
    }

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose, onConfirm])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <Archive size={24} className="text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">Realizar Fechamento</h3>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
            Confirma o fechamento do balanço do período de{' '}
            <strong>
              {lastClosureTimestamp && new Date(periodStart).toDateString() === new Date(lastClosureTimestamp).toDateString()
                ? new Date(lastClosureTimestamp).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })
                : new Date(periodStart).toLocaleDateString('pt-BR')
              }
            </strong>{' '}
            até <strong>{new Date(periodEnd).toLocaleDateString('pt-BR')}</strong>?
          </p>

          {calculationTimestamp && (
            <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-xs text-blue-700 dark:text-blue-300 flex items-center gap-2">
                <Clock size={14} />
                <span>
                  <strong>Data/hora do fechamento:</strong>{' '}
                  {new Date(calculationTimestamp).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </span>
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 ml-5">
                Transações lançadas após este momento não serão incluídas neste fechamento.
              </p>
            </div>
          )}
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Observações (opcional)
          </label>
          <textarea
            value={closureNotes}
            onChange={(e) => setClosureNotes(e.target.value)}
            placeholder="Digite observações sobre este fechamento..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            rows={3}
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg transition-all font-semibold hover:opacity-90"
            style={{ backgroundColor: 'var(--crud-cancel)', color: 'var(--on-crud-cancel)' }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 rounded-lg transition-all font-semibold hover:opacity-90"
            style={{ backgroundColor: 'var(--crud-create)', color: 'var(--on-crud-create)' }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

// Componente para visualizar JSON com collapse/expand
interface JsonViewerModalProps {
  isOpen: boolean
  data: any
  onClose: () => void
  jsonCopied: boolean
  onCopy: () => void
}

const JsonViewerModal = ({ isOpen, data, onClose, jsonCopied, onCopy }: JsonViewerModalProps) => {
  const [viewMode, setViewMode] = useState<'tree' | 'raw'>('tree')
  const [treeKey, setTreeKey] = useState(0) // Usado para forçar re-render
  const [expandDepth, setExpandDepth] = useState(2) // Profundidade inicial: 2 níveis

  if (!isOpen || !data) return null

  const handleExpandAll = () => {
    setExpandDepth(Infinity) // Expande TODOS os níveis
    setTreeKey(prev => prev + 1) // Força re-render
  }

  const handleCollapseAll = () => {
    setExpandDepth(0) // Colapsa tudo
    setTreeKey(prev => prev + 1) // Força re-render
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-4xl w-full mx-4 my-8 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-color-primary-light rounded-lg">
              <FileJson size={24} className="text-color-primary" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                Dados do Fechamento
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                JSON completo com todas as informações
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className="mb-4 flex items-center justify-between gap-4">
          {/* Botões de modo de visualização */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('tree')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'tree'
                  ? 'bg-color-primary text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Árvore
            </button>
            <button
              onClick={() => setViewMode('raw')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'raw'
                  ? 'bg-color-primary text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Raw
            </button>

            {viewMode === 'tree' && (
              <>
                <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-2" />
                <button
                  onClick={handleExpandAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all"
                  title="Expandir tudo"
                >
                  <UnfoldVertical size={14} />
                  Expandir
                </button>
                <button
                  onClick={handleCollapseAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all"
                  title="Colapsar tudo"
                >
                  <FoldVertical size={14} />
                  Colapsar
                </button>
              </>
            )}
          </div>

          {/* Botão de copiar */}
          <button
            onClick={onCopy}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-sm font-medium ${
              jsonCopied
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {jsonCopied ? (
              <>
                <Check size={16} />
                Copiado!
              </>
            ) : (
              <>
                <Copy size={16} />
                Copiar JSON
              </>
            )}
          </button>
        </div>

        {/* Conteúdo */}
        <div className="bg-gray-900 rounded-lg p-4 overflow-auto max-h-[60vh]">
          {viewMode === 'tree' ? (
            <JsonTreeViewer
              key={treeKey}
              data={data}
              expandDepth={expandDepth}
            />
          ) : (
            <pre className="text-sm text-green-400 font-mono whitespace-pre-wrap break-words">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </div>

        {/* Botão fechar */}
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg transition-all font-semibold hover:opacity-90"
            style={{ backgroundColor: 'var(--crud-cancel)', color: 'var(--on-crud-cancel)' }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

const BalancoPage = () => {
  const { showConfirm, ConfirmComponent } = useConfirm()
  const [activeTab, setActiveTab] = useState<'current' | 'history' | 'closures'>('current')
  const [selectedPartnerAccountId, setSelectedPartnerAccountId] = useState<number | null>(null)
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1)
  const [loggedAccountId, setLoggedAccountId] = useState<number | null>(null)

  // Helper: Pegar data local no formato YYYY-MM-DD (sem conversão UTC)
  const getTodayLocalDate = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Helper: Converter Date para YYYY-MM-DD local (sem conversão UTC)
  const dateToLocalString = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Helper: Converter Date para YYYY-MM-DD HH:MM:SS (timestamp completo)
  const dateToTimestampString = (date: Date | string) => {
    // Se já é uma string no formato correto, retorna direto
    if (typeof date === 'string') {
      // Se já está no formato "YYYY-MM-DD HH:MM:SS", retorna direto
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) {
        return date
      }
      // Se está no formato ISO (YYYY-MM-DDTHH:MM:SS), converte para "YYYY-MM-DD HH:MM:SS"
      if (date.includes('T')) {
        return date.replace('T', ' ').substring(0, 19)
      }
    }

    // Caso contrário, converte de Date para string
    const d = typeof date === 'string' ? new Date(date) : date
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    const seconds = String(d.getSeconds()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  }

  // Estados para datas customizadas
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>(getTodayLocalDate()) // ✅ Preenchido com hoje (data local, não UTC)
  const [minStartDate, setMinStartDate] = useState<string | null>(null) // Data mínima permitida (dia após último fechamento)
  const [lastClosureTimestamp, setLastClosureTimestamp] = useState<string | null>(null) // Timestamp completo do último fechamento
  const [calculationTimestamp, setCalculationTimestamp] = useState<string | null>(null) // ✅ Timestamp exato do clique em "Aplicar" (usado como data/hora de fechamento)

  const [partners, setPartners] = useState<ExpenseSharing[]>([])
  const [balanceData, setBalanceData] = useState<BalanceCalculation | null>(null)
  const [annualHistoryData, setAnnualHistoryData] = useState<AnnualHistory | null>(null)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [isFirstLoad, setIsFirstLoad] = useState(true)
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })

  // Estados para fechamentos
  const [closures, setClosures] = useState<BalanceClosure[]>([])
  const [selectedClosure, setSelectedClosure] = useState<BalanceClosure | null>(null)
  const [closureItems, setClosureItems] = useState<BalanceClosureItem[]>([])
  const [closureLoanPayments, setClosureLoanPayments] = useState<any[]>([])  // Pagamentos de empréstimos do fechamento
  const [isClosurePartnerView, setIsClosurePartnerView] = useState(false)  // Se estamos vendo da perspectiva da conta parceira
  const [showClosureModal, setShowClosureModal] = useState(false)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [showSettleModal, setShowSettleModal] = useState(false)
  const [closureNotes, setClosureNotes] = useState('')
  const [settlementNotes, setSettlementNotes] = useState('')
  const [closuresLoading, setClosuresLoading] = useState(false)
  const [selectedClosureIds, setSelectedClosureIds] = useState<Set<number>>(new Set())  // IDs de fechamentos selecionados
  const [bulkActionLoading, setBulkActionLoading] = useState(false)  // Loading para ações em massa
  const [showClosuresBackToTop, setShowClosuresBackToTop] = useState(false)  // Estado para botão Back to Top na aba Fechamentos
  const closuresScrollContainerRef = useRef<HTMLDivElement>(null)  // Ref para scroll container
  const [showExportModal, setShowExportModal] = useState(false)  // Modal de exportação
  const [exportTargetClosure, setExportTargetClosure] = useState<BalanceClosure | null>(null)  // Fechamento a exportar

  // Estados para modal de sugestão de datas
  const [showDateSuggestionModal, setShowDateSuggestionModal] = useState(false)
  const [dateSuggestion, setDateSuggestion] = useState<{
    conflictType: 'start_date' | 'end_date' | 'both'
    message: string
    suggestedStartDate?: string
    suggestedEndDate?: string
  } | null>(null)
  const [showJsonModal, setShowJsonModal] = useState(false)
  const [jsonClosureData, setJsonClosureData] = useState<any>(null)
  const [jsonCopied, setJsonCopied] = useState(false)

  // Estados para modal de Reabrir (remover quitação)
  const [showUnsettleModal, setShowUnsettleModal] = useState(false)
  const [unsettleClosure, setUnsettleClosure] = useState<BalanceClosure | null>(null)
  const [unsettleClearingAll, setUnsettleClearingAll] = useState(false)

  // Estados para pagamentos parciais de fechamentos
  const [expandedClosureIds, setExpandedClosureIds] = useState<Set<number>>(new Set())
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentClosure, setPaymentClosure] = useState<BalanceClosure | null>(null)
  const [paymentAmountCents, setPaymentAmountCents] = useState('') // dígitos brutos (centavos)
  const [paymentDate, setPaymentDate] = useState<Date | null>(null)
  const [paymentNotes, setPaymentNotes] = useState('')
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false)
  // Estados para modal de edição de pagamento
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false)
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null)
  const [editingPaymentClosure, setEditingPaymentClosure] = useState<BalanceClosure | null>(null)
  const [editPaymentCents, setEditPaymentCents] = useState('')
  const [editPaymentDate, setEditPaymentDate] = useState<Date | null>(null)
  const [editPaymentNotes, setEditPaymentNotes] = useState('')
  const [isSavingPaymentEdit, setIsSavingPaymentEdit] = useState(false)

  // Estados para modal de remoção de liquidações de empréstimos
  const [showRemoveLoanPaymentsModal, setShowRemoveLoanPaymentsModal] = useState(false)
  const [removeLoanPaymentsClosure, setRemoveLoanPaymentsClosure] = useState<BalanceClosure | null>(null)
  const [selectedLoanIdsToRemove, setSelectedLoanIdsToRemove] = useState<Set<number>>(new Set())
  const [removingLoanPayments, setRemovingLoanPayments] = useState(false)

  // Estados para modais de detalhes
  interface ModalState {
    isOpen: boolean
    type: 'transactions' | 'credit_card' | 'benefit_card'
    accountColor: 'primary' | 'secondary'
    title: string
    expenseItems: TransactionItem[]
    revenueItems: TransactionItem[]
    isPartnerAccount: boolean
  }

  const [detailsModal, setDetailsModal] = useState<ModalState>({
    isOpen: false,
    type: 'transactions',
    accountColor: 'primary',
    title: '',
    expenseItems: [],
    revenueItems: [],
    isPartnerAccount: false
  })

  // Estados para modal de detalhes mensais do histórico
  const [monthlyDetailsModal, setMonthlyDetailsModal] = useState<{
    isOpen: boolean
    data: any | null
    loading: boolean
  }>({
    isOpen: false,
    data: null,
    loading: false
  })

  // Estados para empréstimos
  const [openLoans, setOpenLoans] = useState<OpenLoansResponse | null>(null)
  const [loansLoading, setLoansLoading] = useState(false)
  const [loansExpanded, setLoansExpanded] = useState(false)
  const [loanPayments, setLoanPayments] = useState<LoanPaymentInput[]>([])

  // Função para buscar o último fechamento e configurar datas
  const loadLastClosureAndSetDates = async (sharingId: number) => {
    try {
      // Busca todos os fechamentos ordenados por data (mais recente primeiro)
      const response = await axios.get('/api/balance/closures', {
        params: {
          expense_sharing_id: sharingId,
          limit: 1 // Apenas o mais recente
        }
      })

      if (response.data.closures && response.data.closures.length > 0) {
        const lastClosure = response.data.closures[0]

        // ✅ Armazena o timestamp completo do fechamento (closing_date)
        setLastClosureTimestamp(lastClosure.closing_date)

        // ✅ Calcula a data/hora inicial: closing_date + 1 segundo
        // Isso garante que o novo período comece APÓS o último fechamento
        const closureDate = new Date(lastClosure.closing_date)
        const nextSecond = new Date(closureDate.getTime() + 1000) // +1 segundo

        // Data mínima para o input (apenas data, sem hora)
        const minDate = dateToLocalString(closureDate)
        setMinStartDate(minDate)

        // ✅ Define a data inicial como o mesmo dia do fechamento
        // O backend vai usar o timestamp do último fechamento + 1 segundo automaticamente
        setStartDate(minDate)
      } else {
        // Sem fechamentos: permite qualquer data
        setMinStartDate(null)
        setLastClosureTimestamp(null)
        // Define uma data padrão (ex: início do ano atual)
        setStartDate(dateToLocalString(new Date(new Date().getFullYear(), 0, 1)))
      }
    } catch (error) {
      console.error('Erro ao buscar último fechamento:', error)
      setMinStartDate(null)
      setLastClosureTimestamp(null)
      setStartDate(dateToLocalString(new Date(new Date().getFullYear(), 0, 1)))
    }
  }

  // Carrega parceiros disponíveis e dados iniciais
  useEffect(() => {
    const loadInitialData = async () => {
      setInitialLoading(true)
      try {
        // Busca account_id do usuário logado
        const verifyResponse = await axios.get('/api/auth/verify')
        setLoggedAccountId(verifyResponse.data.user?.account_id)

        // Carrega parceiros
        const response = await axios.get('/api/expense-sharing/')
        setPartners(response.data)

        // Auto-seleciona o primeiro parceiro (alfabeticamente) se houver
        if (response.data.length > 0) {
          // Ordenar alfabeticamente para selecionar o primeiro
          const sortedPartners = [...response.data].sort((a: any, b: any) => {
            const nameA = getAccountDisplayName(a.shared_account).toLowerCase()
            const nameB = getAccountDisplayName(b.shared_account).toLowerCase()
            return nameA.localeCompare(nameB, 'pt-BR')
          })
          const firstPartner = sortedPartners[0]
          const firstPartnerId = firstPartner.shared_account_id
          setSelectedPartnerAccountId(firstPartnerId)

          // Carrega último fechamento e configura datas
          await loadLastClosureAndSetDates(firstPartner.id)

          // ❌ NÃO carrega balanço automaticamente - usuário deve clicar em "Aplicar"
        }
      } catch (error) {
        console.error('Erro ao carregar parceiros:', error)
      } finally {
        setInitialLoading(false)
        setIsFirstLoad(false)  // Marca que o primeiro carregamento foi concluído
      }
    }
    loadInitialData()
  }, [])

  // Atualiza datas quando muda a conta selecionada
  useEffect(() => {
    if (isFirstLoad) return

    if (selectedPartnerAccountId) {
      const sharing = partners.find(p => p.shared_account_id === selectedPartnerAccountId)
      if (sharing) {
        loadLastClosureAndSetDates(sharing.id)
      }
    }
  }, [selectedPartnerAccountId])

  // Scroll listener para mostrar botão Back to Top na aba Fechamentos
  useEffect(() => {
    const container = closuresScrollContainerRef.current
    if (!container || activeTab !== 'closures') return

    const handleScroll = () => {
      const scrolled = container.scrollTop > 300
      setShowClosuresBackToTop(scrolled)
    }

    // Verifica scroll inicial
    handleScroll()

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [activeTab, closures])

  // Função para voltar ao topo na aba Fechamentos
  const scrollToTopClosures = () => {
    setShowClosuresBackToTop(false)
    closuresScrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ❌ REMOVIDO: Carregamento automático ao mudar de aba
  // O usuário deve clicar em "Aplicar" para carregar os dados
  // useEffect(() => {
  //   if (isFirstLoad) return
  //   if (selectedPartnerAccountId) {
  //     if (activeTab === 'history') {
  //       loadAnnualHistory()
  //     } else if (activeTab === 'closures') {
  //       loadClosures()
  //     }
  //   }
  // }, [activeTab])

  const loadBalanceCalculation = async () => {
    if (!selectedPartnerAccountId) return
    if (!startDate || !endDate) {
      setToast({ show: true, message: 'Por favor, selecione as datas de início e fim', type: 'warning' })
      return
    }

    // Validação: data de fim não pode ser menor que data de início
    if (endDate < startDate) {
      setToast({ show: true, message: 'A data de fim não pode ser anterior à data de início', type: 'warning' })
      return
    }

    // ✅ Determinar timestamp de fechamento baseado na data de fim selecionada
    // Se a data de fim é anterior a hoje → usar endDate + 23:59:59
    // Se a data de fim é hoje ou futura → usar a data/hora atual
    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    let clickTimestamp: string
    if (endDate < todayStr) {
      // Data de fim é no passado - usar 23:59:59 desse dia
      clickTimestamp = `${endDate} 23:59:59`
    } else {
      // Data de fim é hoje ou no futuro - usar hora atual
      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')
      const hours = String(now.getHours()).padStart(2, '0')
      const minutes = String(now.getMinutes()).padStart(2, '0')
      const seconds = String(now.getSeconds()).padStart(2, '0')
      clickTimestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
    }
    setCalculationTimestamp(clickTimestamp)

    setLoading(true)
    try {
      const params: any = {
        partner_account_id: selectedPartnerAccountId,
        year: selectedYear,
        custom_start_date: startDate,
        custom_end_date: endDate
      }

      // Se houver timestamp do último fechamento, enviar para filtrar corretamente
      if (lastClosureTimestamp) {
        params.last_closure_timestamp = lastClosureTimestamp
      }

      const response = await axios.get('/api/balance/calculate', { params })
      setBalanceData(response.data)

      // ✅ Carregar empréstimos abertos junto com o balanço
      await loadOpenLoans()
    } catch (error) {
      console.error('Erro ao calcular balanço:', error)
      setToast({ show: true, message: 'Erro ao calcular balanço', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Função para carregar empréstimos abertos com o parceiro selecionado
  const loadOpenLoans = async () => {
    if (!selectedPartnerAccountId) return

    setLoansLoading(true)
    try {
      const response = await axios.get('/api/balance/open-loans', {
        params: {
          partner_account_id: selectedPartnerAccountId,
          max_date: endDate  // Filtrar apenas empréstimos que existiam até a data final do período
        }
      })
      setOpenLoans(response.data)

      // Inicializar loanPayments com todos os empréstimos e valores zerados
      const initialPayments: LoanPaymentInput[] = response.data.loans.map((loan: OpenLoanItem) => ({
        loan_id: loan.id,
        amount: 0,
        displayAmount: '',
        ignore: false,
        settleInFull: false
      }))
      setLoanPayments(initialPayments)
    } catch (error) {
      console.error('Erro ao carregar empréstimos:', error)
      setOpenLoans(null)
      setLoanPayments([])
    } finally {
      setLoansLoading(false)
    }
  }

  // Função para atualizar o valor de um pagamento de empréstimo
  const updateLoanPayment = (loanId: number, field: 'amount' | 'ignore' | 'displayAmount' | 'settleInFull', value: number | boolean | string) => {
    setLoanPayments(prev => prev.map(lp =>
      lp.loan_id === loanId
        ? { ...lp, [field]: value }
        : lp
    ))
  }

  // Handler para toggle do switch "Quitar Integral"
  const handleSettleInFullToggle = (loanId: number, correctedBalance: number) => {
    const payment = loanPayments.find(lp => lp.loan_id === loanId)
    if (!payment) return

    const newValue = !payment.settleInFull

    if (newValue) {
      // Ativar: preencher com o saldo integral
      const fullAmount = Math.max(0, correctedBalance)
      setLoanPayments(prev => prev.map(lp =>
        lp.loan_id === loanId
          ? { ...lp, settleInFull: true, amount: fullAmount, displayAmount: fullAmount.toFixed(2) }
          : lp
      ))
    } else {
      // Desativar: limpar o valor
      setLoanPayments(prev => prev.map(lp =>
        lp.loan_id === loanId
          ? { ...lp, settleInFull: false, amount: 0, displayAmount: '' }
          : lp
      ))
    }
  }

  // Handler para máscara de valor (igual a EmprestimosPage)
  const handleLoanAmountChange = (loanId: number, value: string) => {
    // Permite apenas números e um ponto decimal
    const regex = /^\d*\.?\d*$/
    if (value === '' || regex.test(value)) {
      const numValue = parseFloat(value)
      if (!isNaN(numValue) && numValue > 99999999.99) {
        return // Não atualiza se exceder o limite
      }
      // Atualiza displayAmount e amount em uma única chamada para evitar race condition
      setLoanPayments(prev => prev.map(lp =>
        lp.loan_id === loanId
          ? { ...lp, displayAmount: value, amount: isNaN(numValue) ? 0 : numValue }
          : lp
      ))
    }
  }

  // Handler para blur do campo de valor (formata com 2 casas decimais)
  const handleLoanAmountBlur = (loanId: number, maxValue: number) => {
    const payment = loanPayments.find(lp => lp.loan_id === loanId)
    if (!payment) return

    const value = payment.displayAmount
    if (value === '') {
      updateLoanPayment(loanId, 'amount', 0)
      return
    }

    const numValue = parseFloat(value)
    if (!isNaN(numValue) && numValue >= 0) {
      const finalValue = Math.min(numValue, maxValue)
      updateLoanPayment(loanId, 'amount', finalValue)
      updateLoanPayment(loanId, 'displayAmount', finalValue.toFixed(2))
    } else {
      updateLoanPayment(loanId, 'amount', 0)
      updateLoanPayment(loanId, 'displayAmount', '')
    }
  }

  // Função para calcular o total dos pagamentos de empréstimos selecionados
  const calculateTotalLoanPayments = () => {
    if (!openLoans) return { totalLent: 0, totalBorrowed: 0, netBalance: 0, hasLentLoans: false, hasBorrowedLoans: false }

    let totalLent = 0 // A receber (empréstimos que eu fiz)
    let totalBorrowed = 0 // A pagar (empréstimos que eu peguei)

    // Verificar se existem empréstimos de cada tipo (independente de valores preenchidos)
    const hasLentLoans = openLoans.loans.some(l => l.loan_type === 'lent')
    const hasBorrowedLoans = openLoans.loans.some(l => l.loan_type === 'borrowed')

    loanPayments
      .filter(lp => !lp.ignore && lp.amount > 0)
      .forEach(lp => {
        const loan = openLoans.loans.find(l => l.id === lp.loan_id)
        if (loan) {
          const amount = Number(lp.amount) || 0
          if (loan.loan_type === 'lent') {
            totalLent += amount
          } else {
            totalBorrowed += amount
          }
        }
      })

    return {
      totalLent,
      totalBorrowed,
      netBalance: totalLent - totalBorrowed,
      hasLentLoans,
      hasBorrowedLoans
    }
  }

  // Função para formatar valores em BRL
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  // Função para validar os valores de empréstimos preenchidos
  const validateLoanPayments = (): { isValid: boolean; errors: string[] } => {
    if (!openLoans || loanPayments.length === 0) {
      return { isValid: true, errors: [] }
    }

    const errors: string[] = []

    loanPayments.forEach(lp => {
      if (lp.ignore) return // Ignorar empréstimos marcados

      const loan = openLoans.loans.find(l => l.id === lp.loan_id)
      if (!loan) return

      // Calcular saldo corrigido com juros (se habilitado)
      let correctedBalance = loan.remaining_balance
      if (loan.interest_enabled && loan.interest_rate && loan.interest_type && loan.interest_period) {
        const interestInfo = calculateInterest(
          loan.principal_amount,
          loan.loan_date,
          loan.interest_rate,
          loan.interest_type as 'simple' | 'compound',
          loan.interest_period as 'daily' | 'monthly' | 'yearly'
        )
        correctedBalance = interestInfo.correctedAmount - loan.total_paid
      }

      if (lp.amount < 0) {
        errors.push(`Empréstimo "${loan.description}": valor não pode ser negativo`)
      }

      if (lp.amount > correctedBalance) {
        errors.push(`Empréstimo "${loan.description}": valor (${formatCurrency(lp.amount)}) excede o saldo aberto (${formatCurrency(correctedBalance)})`)
      }
    })

    return { isValid: errors.length === 0, errors }
  }

  // Verificar se há erros nos empréstimos
  const loanValidation = validateLoanPayments()

  const loadAnnualHistory = async () => {
    if (!selectedPartnerAccountId) return

    setLoading(true)
    try {
      const response = await axios.get('/api/balance/annual-history', {
        params: {
          partner_account_id: selectedPartnerAccountId,
          year: selectedYear
        }
      })
      setAnnualHistoryData(response.data)
    } catch (error) {
      console.error('Erro ao carregar histórico anual:', error)
    } finally {
      setLoading(false)
    }
  }

  // Função para carregar detalhes mensais do histórico
  const loadMonthlyDetails = async (year: number, month: number) => {
    if (!selectedPartnerAccountId) return

    setMonthlyDetailsModal({ isOpen: true, data: null, loading: true })

    try {
      const response = await axios.get('/api/balance/monthly-details', {
        params: {
          partner_account_id: selectedPartnerAccountId,
          year: year,
          month: month
        }
      })
      setMonthlyDetailsModal({ isOpen: true, data: response.data, loading: false })
    } catch (error) {
      console.error('Erro ao carregar detalhes mensais:', error)
      setToast({ show: true, message: 'Erro ao carregar detalhes do mês', type: 'error' })
      setMonthlyDetailsModal({ isOpen: false, data: null, loading: false })
    }
  }

  const loadClosures = async () => {
    setClosuresLoading(true)
    setSelectedClosureIds(new Set())  // Limpar seleção ao carregar novos dados
    try {
      const params: any = {
        year: selectedYear  // ✅ Filtrar por ano selecionado
      }

      if (selectedPartnerAccountId) {
        const sharing = partners.find(p => p.shared_account_id === selectedPartnerAccountId)
        if (sharing) {
          params.expense_sharing_id = sharing.id
        }
      }

      const response = await axios.get('/api/balance/closures', { params })
      setClosures(response.data.closures)
    } catch (error) {
      console.error('Erro ao carregar fechamentos:', error)
    } finally {
      setClosuresLoading(false)
    }
  }

  // ❌ REMOVIDO: checkPeriodClosure - não faz sentido verificar por mês com datas customizadas
  // A verificação de sobreposição de períodos será feita no backend ao criar o fechamento

  const handleCreateClosure = async () => {
    if (!selectedPartnerAccountId || !balanceData) return

    const sharing = partners.find(p => p.shared_account_id === selectedPartnerAccountId)
    if (!sharing) return

    try {
      // ✅ Converter datas para formato YYYY-MM-DD HH:MM:SS (timestamp completo)
      // Isso permite múltiplos fechamentos no mesmo dia em horários diferentes
      const startDateTimestamp = dateToTimestampString(balanceData.start_date)
      const endDateTimestamp = dateToTimestampString(balanceData.end_date)

      // ✅ Filtrar loan_payments válidos (não ignorados e com valor > 0)
      // Inclui corrected_balance para o backend validar contra o mesmo valor que o frontend mostra
      const validLoanPayments = loanPayments
        .filter(lp => !lp.ignore && lp.amount > 0)
        .map(lp => {
          const loan = openLoans?.loans.find(l => l.id === lp.loan_id)
          if (!loan) return null

          // Calcular saldo corrigido com juros (mesma lógica da exibição na tabela)
          // Usa a mesma fórmula exata do render da tabela de empréstimos
          let correctedBalance: number
          if (loan.interest_enabled && loan.interest_rate && loan.interest_type && loan.interest_period) {
            const interestInfo = calculateInterest(
              Number(loan.principal_amount),
              loan.loan_date,
              Number(loan.interest_rate),
              loan.interest_type as 'simple' | 'compound',
              loan.interest_period as 'daily' | 'monthly' | 'yearly'
            )
            // baseAmount = valor corrigido com juros
            // correctedBalance = valor corrigido - já pago = saldo aberto
            correctedBalance = interestInfo.correctedAmount - Number(loan.total_paid)
          } else {
            // Sem juros: saldo = principal - já pago
            correctedBalance = Number(loan.principal_amount) - Number(loan.total_paid)
          }

          return {
            loan_id: lp.loan_id,
            amount: lp.amount,
            corrected_balance: correctedBalance
          }
        })
        .filter((lp): lp is { loan_id: number; amount: number; corrected_balance: number } => lp !== null)

      // ✅ Calcular totais de empréstimos para incluir no closure_data
      const loanTotals = calculateTotalLoanPayments()

      // ✅ Calcular net_amount_before_loans com sinal correto
      // Positivo = a receber, Negativo = a pagar
      // total_expenses = despesas que EU paguei = tenho a receber do parceiro (POSITIVO)
      // total_revenues = despesas do PARCEIRO que eu devo = tenho a pagar (NEGATIVO)
      const mainNetBeforeLoans = Math.abs(balanceData.main_account_card.total_expenses || 0) - Math.abs(balanceData.main_account_card.total_revenues || 0)
      const partnerNetBeforeLoans = Math.abs(balanceData.partner_account_card.total_expenses || 0) - Math.abs(balanceData.partner_account_card.total_revenues || 0)

      // ✅ Empréstimos com sinais corretos:
      // loan_to_receive = POSITIVO (eu emprestei = tenho a receber)
      // loan_to_pay = NEGATIVO (eu peguei = tenho a pagar)
      const mainLoanToReceive = loanTotals.totalLent   // Positivo
      const mainLoanToPay = -loanTotals.totalBorrowed  // Negativo
      const partnerLoanToReceive = loanTotals.totalBorrowed  // Invertido: parceiro recebe o que eu peguei
      const partnerLoanToPay = -loanTotals.totalLent         // Invertido: parceiro paga o que eu emprestei

      // ✅ Atualizar os totais no closure_data para incluir empréstimos
      // Assim o JSON salvo já terá os valores corretos
      // Ordem lógica das chaves: Info da Conta → Transações → Totais Base → Empréstimos → Saldos Finais
      const mainCard = balanceData.main_account_card
      const partnerCard = balanceData.partner_account_card

      // ✅ Estrutura JSON organizada com valores numéricos
      // contribution_percentage removido do nível da conta (cada item já tem sua própria %)
      // Campos renomeados para semântica clara:
      //   - total_to_receive: despesas que EU paguei = tenho a receber (POSITIVO)
      //   - total_to_pay: despesas do PARCEIRO que eu devo = tenho a pagar (NEGATIVO)
      const updatedBalanceData = {
        ...balanceData,
        main_account_card: {
          // 1. Info da Conta
          account_id: mainCard.account_id,
          account_name: mainCard.account_name,
          account_number: mainCard.account_number,
          bank_name: mainCard.bank_name,
          agency: mainCard.agency,
          // 2. Status
          status: mainCard.status,
          // 3. Totais Base (apenas transações) - com sinais corretos
          total_to_receive: Math.abs(parseFloat(String(mainCard.total_expenses)) || 0),  // Positivo
          total_to_pay: -(Math.abs(parseFloat(String(mainCard.total_revenues)) || 0)),   // Negativo
          // 4. Saldo Antes de Empréstimos
          net_amount_before_loans: mainNetBeforeLoans,
          // 5. Empréstimos (com sinais corretos)
          loan_to_receive: mainLoanToReceive,  // Positivo
          loan_to_pay: mainLoanToPay,          // Negativo
          // 6. Saldo Final
          net_amount: mainNetBeforeLoans + mainLoanToReceive + mainLoanToPay,
          // 7. Itens de Transações (cada item tem my_contribution_percentage e partner_contribution_percentage)
          expense_items: mainCard.expense_items,
          revenue_items: mainCard.revenue_items,
          credit_card_expense_items: mainCard.credit_card_expense_items,
          credit_card_revenue_items: mainCard.credit_card_revenue_items,
          benefit_card_expense_items: mainCard.benefit_card_expense_items,
          benefit_card_revenue_items: mainCard.benefit_card_revenue_items
        },
        partner_account_card: {
          // 1. Info da Conta
          account_id: partnerCard.account_id,
          account_name: partnerCard.account_name,
          account_number: partnerCard.account_number,
          bank_name: partnerCard.bank_name,
          agency: partnerCard.agency,
          // 2. Status
          status: partnerCard.status,
          // 3. Totais Base (apenas transações) - com sinais corretos
          total_to_receive: Math.abs(parseFloat(String(partnerCard.total_expenses)) || 0),  // Positivo
          total_to_pay: -(Math.abs(parseFloat(String(partnerCard.total_revenues)) || 0)),   // Negativo
          // 4. Saldo Antes de Empréstimos
          net_amount_before_loans: partnerNetBeforeLoans,
          // 5. Empréstimos (com sinais corretos, invertidos para o parceiro)
          loan_to_receive: partnerLoanToReceive,  // Positivo
          loan_to_pay: partnerLoanToPay,          // Negativo
          // 6. Saldo Final
          net_amount: partnerNetBeforeLoans + partnerLoanToReceive + partnerLoanToPay,
          // 7. Itens de Transações (cada item tem my_contribution_percentage e partner_contribution_percentage)
          expense_items: partnerCard.expense_items,
          revenue_items: partnerCard.revenue_items,
          credit_card_expense_items: partnerCard.credit_card_expense_items,
          credit_card_revenue_items: partnerCard.credit_card_revenue_items,
          benefit_card_expense_items: partnerCard.benefit_card_expense_items,
          benefit_card_revenue_items: partnerCard.benefit_card_revenue_items
        }
      }

      const payload = {
        expense_sharing_id: sharing.id,
        year: selectedYear,
        month: selectedMonth,
        period_start_date: startDateTimestamp,  // ✅ Timestamp completo (YYYY-MM-DD HH:MM:SS)
        period_end_date: endDateTimestamp,      // ✅ Timestamp completo (YYYY-MM-DD HH:MM:SS)
        closure_data: updatedBalanceData,       // ✅ Snapshot com totais incluindo empréstimos
        notes: closureNotes || null,
        closing_date: calculationTimestamp,     // ✅ Data/hora exata do clique em "Aplicar"
        loan_payments: validLoanPayments.length > 0 ? validLoanPayments : null  // ✅ Pagamentos de empréstimos
      }

      await axios.post('/api/balance/closures', payload)

      setShowClosureModal(false)
      setClosureNotes('')
      setToast({ show: true, message: 'Fechamento realizado com sucesso!', type: 'success' })

      // ✅ Limpar campos de data e dados calculados para resetar a tela
      setEndDate(getTodayLocalDate())
      setCalculationTimestamp(null)
      setBalanceData(null)

      // ✅ Limpar dados de empréstimos
      setOpenLoans(null)
      setLoanPayments([])
      setLoansExpanded(false)

      // Recarregar lista de fechamentos
      if (activeTab === 'closures') {
        loadClosures()
      }

      // Recarregar último fechamento para atualizar datas mínimas
      // (reutiliza a variável 'sharing' já declarada no início da função)
      await loadLastClosureAndSetDates(sharing.id)
    } catch (error: any) {
      console.error('Erro ao criar fechamento:', error)

      // Verificar se é um erro com sugestão de data
      const errorDetail = error.response?.data?.detail

      if (typeof errorDetail === 'object' && errorDetail.conflict_type) {
        // Erro com sugestão de data
        setDateSuggestion({
          conflictType: errorDetail.conflict_type,
          message: errorDetail.message,
          suggestedStartDate: errorDetail.suggested_start_date,
          suggestedEndDate: errorDetail.suggested_end_date
        })
        setShowDateSuggestionModal(true)
        setShowClosureModal(false)
      } else {
        // Erro simples (ambas as datas dentro do mesmo período)
        setToast({ show: true, message: typeof errorDetail === 'string' ? errorDetail : 'Erro ao criar fechamento', type: 'error' })
      }
    }
  }

  const handleAcceptDateSuggestion = async () => {
    if (!dateSuggestion) return

    // Atualizar as datas conforme sugestão
    if (dateSuggestion.suggestedStartDate) {
      const dateOnly = dateSuggestion.suggestedStartDate.split(' ')[0]
      setStartDate(dateOnly)
    }

    if (dateSuggestion.suggestedEndDate) {
      const dateOnly = dateSuggestion.suggestedEndDate.split(' ')[0]
      setEndDate(dateOnly)
    }

    // Fechar modal de sugestão
    setShowDateSuggestionModal(false)
    setDateSuggestion(null)

    // Aguardar um pouco para garantir que os estados foram atualizados
    setTimeout(async () => {
      // Recalcular automaticamente (mesma lógica do botão "Aplicar")
      await loadBalanceCalculation()
    }, 100)
  }

  const handleViewClosureDetails = async (closure: BalanceClosure) => {
    try {
      const response = await axios.get(`/api/balance/closures/${closure.id}`)
      setSelectedClosure(response.data.closure)

      // Extrair todos os itens do JSON closure_data
      const closureData = response.data.closure.closure_data
      const allItems: any[] = []

      // Informações das contas
      const mainAccount = closureData.main_account_card
      const partnerAccount = closureData.partner_account_card

      // Obter account_id do usuário logado
      const verifyResponse = await axios.get('/api/auth/verify')
      const loggedAccountId = verifyResponse.data.user?.account_id

      // Determinar se estamos vendo da perspectiva da conta parceira
      // Se o account_id logado for igual ao partner_account_card.account_id, então isPartnerView = true
      const isPartnerView = loggedAccountId === partnerAccount?.account_id

      // Função helper para adicionar fonte e conta contraparte aos itens
      const addSourceToItems = (items: any[], source: string, ownerAccount: any, counterpartAccount: any, isFromPartner: boolean) => {
        return items.map(item => ({
          ...item,
          source_type: source,
          owner_account: {
            name: ownerAccount.account_name,
            number: ownerAccount.account_number,
            bank: ownerAccount.bank_name,
            agency: ownerAccount.agency
          },
          counterpart_account: {
            name: counterpartAccount.account_name,
            number: counterpartAccount.account_number,
            bank: counterpartAccount.bank_name,
            agency: counterpartAccount.agency
          },
          // Marca se este item precisa ter o sinal invertido na visualização
          should_invert: isPartnerView !== isFromPartner
        }))
      }

      // Extrair itens da conta principal (isFromPartner = false)
      if (mainAccount) {
        allItems.push(...addSourceToItems(mainAccount.expense_items || [], 'Conta Bancária', mainAccount, partnerAccount, false))
        allItems.push(...addSourceToItems(mainAccount.revenue_items || [], 'Conta Bancária', mainAccount, partnerAccount, false))
        allItems.push(...addSourceToItems(mainAccount.credit_card_expense_items || [], 'Cartão de Crédito', mainAccount, partnerAccount, false))
        allItems.push(...addSourceToItems(mainAccount.credit_card_revenue_items || [], 'Cartão de Crédito', mainAccount, partnerAccount, false))
        allItems.push(...addSourceToItems(mainAccount.benefit_card_expense_items || [], 'Cartão Benefício', mainAccount, partnerAccount, false))
        allItems.push(...addSourceToItems(mainAccount.benefit_card_revenue_items || [], 'Cartão Benefício', mainAccount, partnerAccount, false))
      }

      // Extrair itens da conta parceira (isFromPartner = true)
      if (partnerAccount) {
        allItems.push(...addSourceToItems(partnerAccount.expense_items || [], 'Conta Bancária', partnerAccount, mainAccount, true))
        allItems.push(...addSourceToItems(partnerAccount.revenue_items || [], 'Conta Bancária', partnerAccount, mainAccount, true))
        allItems.push(...addSourceToItems(partnerAccount.credit_card_expense_items || [], 'Cartão de Crédito', partnerAccount, mainAccount, true))
        allItems.push(...addSourceToItems(partnerAccount.credit_card_revenue_items || [], 'Cartão de Crédito', partnerAccount, mainAccount, true))
        allItems.push(...addSourceToItems(partnerAccount.benefit_card_expense_items || [], 'Cartão Benefício', partnerAccount, mainAccount, true))
        allItems.push(...addSourceToItems(partnerAccount.benefit_card_revenue_items || [], 'Cartão Benefício', partnerAccount, mainAccount, true))
      }

      setClosureItems(allItems)
      setIsClosurePartnerView(isPartnerView)  // Salvar perspectiva para uso nos totais

      // Extrair pagamentos de empréstimos do closure_data (se existirem)
      const loanPaymentsFromClosure = closureData.loan_payments || []
      setClosureLoanPayments(loanPaymentsFromClosure)

      setShowDetailsModal(true)
    } catch (error) {
      console.error('Erro ao carregar detalhes do fechamento:', error)
      setToast({ show: true, message: 'Erro ao carregar detalhes do fechamento', type: 'error' })
    }
  }

  const handleSettleClosure = async () => {
    if (!selectedClosure) return

    try {
      await axios.put(`/api/balance/closures/${selectedClosure.id}/settle`, {
        settlement_notes: settlementNotes || null
      })

      setShowSettleModal(false)
      setShowDetailsModal(false)
      setSettlementNotes('')
      setClosureLoanPayments([])
      setToast({ show: true, message: 'Fechamento marcado como quitado!', type: 'success' })

      loadClosures()
    } catch (error: any) {
      console.error('Erro ao quitar fechamento:', error)
      setToast({ show: true, message: error.response?.data?.detail || 'Erro ao quitar fechamento', type: 'error' })
    }
  }

  const handleUnsettleClosure = (closure: BalanceClosure) => {
    setUnsettleClosure(closure)
    setShowUnsettleModal(true)
  }

  const handleConfirmUnsettle = async (clearPayments: boolean) => {
    if (!unsettleClosure) return
    setUnsettleClearingAll(true)
    try {
      if (clearPayments) {
        await axios.delete(`/api/balance/closures/${unsettleClosure.id}/payments`)
      }
      await axios.delete(`/api/balance/closures/${unsettleClosure.id}/settle`)
      setToast({ show: true, message: 'Quitação removida com sucesso!', type: 'success' })
      setShowUnsettleModal(false)
      setUnsettleClosure(null)
      loadClosures()
    } catch (error: any) {
      console.error('Erro ao remover quitação:', error)
      setToast({ show: true, message: error.response?.data?.detail || 'Erro ao remover quitação', type: 'error' })
    } finally {
      setUnsettleClearingAll(false)
    }
  }

  const handleReopenClosure = (closure: BalanceClosure) => {
    if (closure.is_settled) {
      setToast({ show: true, message: 'Não é possível reabrir um fechamento já quitado. Remova a quitação primeiro.', type: 'warning' })
      return
    }

    showConfirm(
      'Reabrir Fechamento',
      `Deseja realmente reabrir o fechamento de ${String(closure.month).padStart(2, '0')}/${closure.year}? Isso permitirá criar um novo fechamento para o mesmo período.`,
      async () => {
        try {
          await axios.delete(`/api/balance/closures/${closure.id}`)
          setToast({ show: true, message: 'Fechamento reaberto com sucesso!', type: 'success' })

          // ✅ Limpar campos de data e dados calculados
          setEndDate(getTodayLocalDate())
          setCalculationTimestamp(null)
          setBalanceData(null)

          // Recarregar dados
          loadClosures()

          // Recarregar último fechamento para atualizar datas mínimas
          const sharing = partners.find(p => p.shared_account_id === selectedPartnerAccountId)
          if (sharing) {
            await loadLastClosureAndSetDates(sharing.id)
          }
        } catch (error: any) {
          console.error('Erro ao reabrir fechamento:', error)
          setToast({ show: true, message: error.response?.data?.detail || 'Erro ao reabrir fechamento', type: 'error' })
        }
      },
      'Reabrir',
      'Cancelar'
    )
  }

  // Handler para abrir modal de remoção de liquidações de empréstimos
  const handleOpenRemoveLoanPaymentsModal = (closure: BalanceClosure) => {
    if (closure.is_settled) {
      setToast({ show: true, message: 'Não é possível remover liquidações de um fechamento quitado. Remova a quitação primeiro.', type: 'warning' })
      return
    }

    setRemoveLoanPaymentsClosure(closure)
    setSelectedLoanIdsToRemove(new Set())
    setShowRemoveLoanPaymentsModal(true)
  }

  // Extrair loan_payments do closure_data
  const getClosureLoanPaymentsList = (closure: BalanceClosure): any[] => {
    if (!closure.closure_data) return []

    const mainPayments = closure.closure_data.main_account_card?.loan_payments || []
    const partnerPayments = closure.closure_data.partner_account_card?.loan_payments || []
    const rootPayments = closure.closure_data.loan_payments || []

    // Combinar e remover duplicatas por loan_id
    const allPayments = [...mainPayments, ...partnerPayments, ...rootPayments]
    const uniquePayments = allPayments.reduce((acc: any[], payment: any) => {
      if (!acc.find((p: any) => p.loan_id === payment.loan_id)) {
        acc.push(payment)
      }
      return acc
    }, [])

    return uniquePayments
  }

  // Toggle seleção de um loan para remoção
  const toggleLoanSelection = (loanId: number) => {
    setSelectedLoanIdsToRemove(prev => {
      const newSet = new Set(prev)
      if (newSet.has(loanId)) {
        newSet.delete(loanId)
      } else {
        newSet.add(loanId)
      }
      return newSet
    })
  }

  // Selecionar/Deselecionar todos os loans
  const toggleSelectAllLoans = (loanPayments: any[]) => {
    if (selectedLoanIdsToRemove.size === loanPayments.length) {
      setSelectedLoanIdsToRemove(new Set())
    } else {
      setSelectedLoanIdsToRemove(new Set(loanPayments.map((lp: any) => lp.loan_id)))
    }
  }

  // Executar remoção das liquidações selecionadas
  const handleConfirmRemoveLoanPayments = async () => {
    if (!removeLoanPaymentsClosure || selectedLoanIdsToRemove.size === 0) return

    setRemovingLoanPayments(true)
    try {
      const response = await axios.delete(
        `/api/balance/closures/${removeLoanPaymentsClosure.id}/loan-payments`,
        { data: { loan_ids: Array.from(selectedLoanIdsToRemove) } }
      )

      setToast({
        show: true,
        message: response.data?.message || 'Liquidações de empréstimos removidas com sucesso!',
        type: 'success'
      })

      // Fechar modal e recarregar dados
      setShowRemoveLoanPaymentsModal(false)
      setRemoveLoanPaymentsClosure(null)
      setSelectedLoanIdsToRemove(new Set())
      loadClosures()

      // Recarregar empréstimos abertos
      if (selectedPartnerAccountId) {
        loadOpenLoans(selectedPartnerAccountId)
      }
    } catch (error: any) {
      console.error('Erro ao remover liquidações de empréstimos:', error)
      setToast({ show: true, message: error.response?.data?.detail || 'Erro ao remover liquidações de empréstimos', type: 'error' })
    } finally {
      setRemovingLoanPayments(false)
    }
  }

  // ==================== PAGAMENTOS PARCIAIS ====================

  const toggleClosureExpansion = (closureId: number) => {
    setExpandedClosureIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(closureId)) {
        newSet.delete(closureId)
      } else {
        newSet.add(closureId)
      }
      return newSet
    })
  }

  const openPaymentModal = (closure: BalanceClosure) => {
    setPaymentClosure(closure)
    setPaymentAmountCents('')
    setPaymentDate(new Date())
    setPaymentNotes('')
    setShowPaymentModal(true)
  }

  // Máscara BRL: dígitos brutos → "1.234,56"
  const formatAmountMask = (cents: string): string => {
    const num = parseInt(cents || '0', 10)
    return (num / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const handlePaymentAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '')
    setPaymentAmountCents(digits)
  }

  const handleAddPayment = async () => {
    const amountValue = parseInt(paymentAmountCents || '0', 10) / 100
    if (!paymentClosure || !amountValue || !paymentDate) return
    setIsSubmittingPayment(true)
    const dateStr = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}-${String(paymentDate.getDate()).padStart(2, '0')}`
    try {
      const response = await axios.post(
        `/api/balance/closures/${paymentClosure.id}/payments`,
        { amount: amountValue, payment_date: dateStr, notes: paymentNotes || null }
      )
      // Atualizar o fechamento na lista com os dados enriquecidos
      setClosures(prev => prev.map(c => c.id === paymentClosure.id ? { ...c, ...response.data } : c))
      setToast({ show: true, message: 'Pagamento registrado com sucesso!', type: 'success' })
      setShowPaymentModal(false)
      setPaymentClosure(null)
      // Expandir a linha para mostrar o histórico
      setExpandedClosureIds(prev => new Set([...prev, paymentClosure.id]))
    } catch (error: any) {
      setToast({ show: true, message: error.response?.data?.detail || 'Erro ao registrar pagamento', type: 'error' })
    } finally {
      setIsSubmittingPayment(false)
    }
  }

  const handleDeletePayment = async (closure: BalanceClosure, paymentId: number) => {
    try {
      const response = await axios.delete(`/api/balance/closures/${closure.id}/payments/${paymentId}`)
      setClosures(prev => prev.map(c => c.id === closure.id ? { ...c, ...response.data } : c))
      setToast({ show: true, message: 'Pagamento removido com sucesso!', type: 'success' })
    } catch (error: any) {
      setToast({ show: true, message: error.response?.data?.detail || 'Erro ao remover pagamento', type: 'error' })
    }
  }

  const openEditPayment = (payment: ClosurePayment, closure: BalanceClosure) => {
    setEditingPaymentId(payment.id)
    setEditingPaymentClosure(closure)
    const cents = Math.round(parseFloat(String(payment.amount)) * 100)
    setEditPaymentCents(String(cents))
    setEditPaymentDate(new Date(payment.payment_date))
    setEditPaymentNotes(payment.notes || '')
    setShowEditPaymentModal(true)
  }

  const closeEditPaymentModal = () => {
    setShowEditPaymentModal(false)
    setEditingPaymentId(null)
    setEditingPaymentClosure(null)
    setEditPaymentCents('')
    setEditPaymentDate(null)
    setEditPaymentNotes('')
  }

  const handleSavePaymentEdit = async () => {
    if (!editingPaymentId || !editingPaymentClosure) return
    const amountValue = parseInt(editPaymentCents || '0', 10) / 100
    if (!amountValue || !editPaymentDate) return
    setIsSavingPaymentEdit(true)
    const dateStr = `${editPaymentDate.getFullYear()}-${String(editPaymentDate.getMonth() + 1).padStart(2, '0')}-${String(editPaymentDate.getDate()).padStart(2, '0')}`
    try {
      const response = await axios.put(
        `/api/balance/closures/${editingPaymentClosure.id}/payments/${editingPaymentId}`,
        { amount: amountValue, payment_date: dateStr, notes: editPaymentNotes || null }
      )
      setClosures(prev => prev.map(c => c.id === editingPaymentClosure.id ? { ...c, ...response.data } : c))
      setToast({ show: true, message: 'Pagamento atualizado com sucesso!', type: 'success' })
      closeEditPaymentModal()
    } catch (error: any) {
      setToast({ show: true, message: error.response?.data?.detail || 'Erro ao editar pagamento', type: 'error' })
    } finally {
      setIsSavingPaymentEdit(false)
    }
  }

  // ==================== AÇÕES EM MASSA ====================

  // Toggle seleção de um fechamento
  const toggleClosureSelection = (closureId: number) => {
    setSelectedClosureIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(closureId)) {
        newSet.delete(closureId)
      } else {
        newSet.add(closureId)
      }
      return newSet
    })
  }

  // Selecionar/desselecionar todos
  const toggleSelectAll = () => {
    if (selectedClosureIds.size === closures.length) {
      setSelectedClosureIds(new Set())
    } else {
      setSelectedClosureIds(new Set(closures.map(c => c.id)))
    }
  }

  // Reabrir fechamentos selecionados (deletar)
  const handleBulkReopen = () => {
    const selectedCount = selectedClosureIds.size
    if (selectedCount === 0) return

    // Verificar se algum fechamento está quitado
    const settledClosures = closures.filter(c => selectedClosureIds.has(c.id) && c.is_settled)
    if (settledClosures.length > 0) {
      setToast({
        show: true,
        message: `${settledClosures.length} fechamento(s) selecionado(s) estão quitados. Remova a quitação primeiro.`,
        type: 'warning'
      })
      return
    }

    showConfirm(
      'Reabrir Fechamentos em Massa',
      `Deseja realmente reabrir ${selectedCount} fechamento(s)? Esta ação não pode ser desfeita.`,
      async () => {
        setBulkActionLoading(true)
        try {
          let successCount = 0
          let errorCount = 0

          for (const closureId of selectedClosureIds) {
            try {
              await axios.delete(`/api/balance/closures/${closureId}`)
              successCount++
            } catch {
              errorCount++
            }
          }

          if (errorCount === 0) {
            setToast({ show: true, message: `${successCount} fechamento(s) reaberto(s) com sucesso!`, type: 'success' })
          } else {
            setToast({ show: true, message: `${successCount} reaberto(s), ${errorCount} erro(s)`, type: 'warning' })
          }

          setSelectedClosureIds(new Set())
          loadClosures()

          // Recarregar último fechamento para atualizar datas mínimas
          const sharing = partners.find(p => p.shared_account_id === selectedPartnerAccountId)
          if (sharing) {
            await loadLastClosureAndSetDates(sharing.id)
          }
        } catch (error: any) {
          setToast({ show: true, message: 'Erro ao reabrir fechamentos', type: 'error' })
        } finally {
          setBulkActionLoading(false)
        }
      },
      'Reabrir Todos',
      'Cancelar'
    )
  }

  // Remover quitação dos fechamentos selecionados (abrir quitados)
  const handleBulkUnsettle = () => {
    const selectedCount = selectedClosureIds.size
    if (selectedCount === 0) return

    // Filtrar apenas os quitados
    const settledClosures = closures.filter(c => selectedClosureIds.has(c.id) && c.is_settled)
    if (settledClosures.length === 0) {
      setToast({ show: true, message: 'Nenhum fechamento quitado selecionado.', type: 'warning' })
      return
    }

    showConfirm(
      'Remover Quitação em Massa',
      `Deseja realmente remover a quitação de ${settledClosures.length} fechamento(s)?`,
      async () => {
        setBulkActionLoading(true)
        try {
          let successCount = 0
          let errorCount = 0

          for (const closure of settledClosures) {
            try {
              await axios.delete(`/api/balance/closures/${closure.id}/settle`)
              successCount++
            } catch {
              errorCount++
            }
          }

          if (errorCount === 0) {
            setToast({ show: true, message: `Quitação removida de ${successCount} fechamento(s)!`, type: 'success' })
          } else {
            setToast({ show: true, message: `${successCount} removido(s), ${errorCount} erro(s)`, type: 'warning' })
          }

          setSelectedClosureIds(new Set())
          loadClosures()
        } catch (error: any) {
          setToast({ show: true, message: 'Erro ao remover quitações', type: 'error' })
        } finally {
          setBulkActionLoading(false)
        }
      },
      'Remover Quitações',
      'Cancelar'
    )
  }

  // Quitar fechamentos selecionados em massa
  const handleBulkSettle = () => {
    const selectedCount = selectedClosureIds.size
    if (selectedCount === 0) return

    // Filtrar apenas os NÃO quitados
    const unsettledClosures = closures.filter(c => selectedClosureIds.has(c.id) && !c.is_settled)
    if (unsettledClosures.length === 0) {
      setToast({ show: true, message: 'Nenhum fechamento não-quitado selecionado.', type: 'warning' })
      return
    }

    showConfirm(
      'Quitar Fechamentos em Massa',
      `Deseja realmente marcar ${unsettledClosures.length} fechamento(s) como quitado(s)?`,
      async () => {
        setBulkActionLoading(true)
        try {
          let successCount = 0
          let errorCount = 0

          for (const closure of unsettledClosures) {
            try {
              await axios.put(`/api/balance/closures/${closure.id}/settle`, {
                settlement_notes: null
              })
              successCount++
            } catch {
              errorCount++
            }
          }

          if (errorCount === 0) {
            setToast({ show: true, message: `${successCount} fechamento(s) quitado(s) com sucesso!`, type: 'success' })
          } else {
            setToast({ show: true, message: `${successCount} quitado(s), ${errorCount} erro(s)`, type: 'warning' })
          }

          setSelectedClosureIds(new Set())
          loadClosures()
        } catch (error: any) {
          setToast({ show: true, message: 'Erro ao quitar fechamentos', type: 'error' })
        } finally {
          setBulkActionLoading(false)
        }
      },
      'Quitar',
      'Cancelar'
    )
  }

  // Atalhos de teclado para modais (ESC para fechar/cancelar, Enter/Space para confirmar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isTextarea = target.tagName === 'TEXTAREA'

      if (e.key === 'Escape') {
        // Fechar modais na ordem de prioridade (mais recente primeiro)
        if (showJsonModal) {
          setShowJsonModal(false)
          setJsonClosureData(null)
          setJsonCopied(false)
        } else if (showSettleModal) {
          setShowSettleModal(false)
          setSettlementNotes('')
        } else if (showDetailsModal) {
          setShowDetailsModal(false)
          setSelectedClosure(null)
          setClosureItems([])
          setClosureLoanPayments([])
          setIsClosurePartnerView(false)
        }
      } else if ((e.key === 'Enter' || e.key === ' ') && !e.shiftKey && !isTextarea) {
        // Enter/Space confirma ou fecha o modal ativo (exceto em textarea)
        e.preventDefault()
        if (showJsonModal) {
          setShowJsonModal(false)
          setJsonClosureData(null)
          setJsonCopied(false)
        } else if (showSettleModal) {
          // Confirmar quitação
          handleSettleClosure()
        } else if (showDetailsModal) {
          setShowDetailsModal(false)
          setSelectedClosure(null)
          setClosureItems([])
          setClosureLoanPayments([])
          setIsClosurePartnerView(false)
        }
      }
    }

    if (showDetailsModal || showJsonModal || showSettleModal) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showDetailsModal, showJsonModal, showSettleModal, handleSettleClosure])

  const formatMonth = (monthStr: string) => {
    const [year, month] = monthStr.split('-')
    const date = new Date(parseInt(year), parseInt(month) - 1)
    // Retorna apenas o nome do mês com primeira letra maiúscula
    const monthName = date.toLocaleDateString('pt-BR', { month: 'long' })
    return monthName.charAt(0).toUpperCase() + monthName.slice(1)
  }

  const getAccountDisplayName = (account: Account | undefined) => {
    if (!account) return 'Sem nome'
    return account.name || account.description || 'Sem nome'
  }

  const openDetailsModal = (
    type: 'transactions' | 'credit_card' | 'benefit_card',
    accountColor: 'primary' | 'secondary',
    accountName: string,
    expenseItems: TransactionItem[],
    revenueItems: TransactionItem[],
    isPartnerAccount: boolean = false
  ) => {
    const titles = {
      transactions: 'Transações',
      credit_card: 'Fatura de Cartão',
      benefit_card: 'Cartão de Benefícios'
    }

    setDetailsModal({
      isOpen: true,
      type,
      accountColor,
      title: `${titles[type]} - ${accountName}`,
      expenseItems,
      revenueItems,
      isPartnerAccount
    })
  }

  const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i)
  const months = [
    { value: 1, label: 'Janeiro' },
    { value: 2, label: 'Fevereiro' },
    { value: 3, label: 'Março' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Maio' },
    { value: 6, label: 'Junho' },
    { value: 7, label: 'Julho' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Setembro' },
    { value: 10, label: 'Outubro' },
    { value: 11, label: 'Novembro' },
    { value: 12, label: 'Dezembro' }
  ]

  // Loading inicial - mostra enquanto carrega dados iniciais
  if (initialLoading) {
    return (
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <LoadingSpinner fullScreen message="Carregando..." />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <div ref={closuresScrollContainerRef} className="flex-1 overflow-auto">
        <div className="p-8">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <Scale className="w-8 h-8" />
              Balanço Compartilhado
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Acompanhe o balanço de despesas compartilhadas entre contas
            </p>
          </div>

          {/* Filtros */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-6 p-4 transition-all hover:border-color-primary hover:shadow-md">
            {/* Aba: Balanço Calculado */}
            {activeTab === 'current' && (
              <div className="flex flex-col md:flex-row gap-4">
                {/* Conta Compartilhada */}
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                    <Building2 size={14} className="inline mr-1 text-color-primary" />
                    Conta Compartilhada
                  </label>
                  <select
                    value={selectedPartnerAccountId || ''}
                    onChange={(e) => setSelectedPartnerAccountId(e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-color-primary focus:border-color-primary transition-all shadow-sm"
                  >
                    <option value="">Selecione...</option>
                    {[...partners]
                      .sort((a, b) => {
                        const nameA = getAccountDisplayName(a.shared_account).toLowerCase()
                        const nameB = getAccountDisplayName(b.shared_account).toLowerCase()
                        return nameA.localeCompare(nameB, 'pt-BR')
                      })
                      .map(partner => {
                        const acc = partner.shared_account
                        const bankName = acc?.bank?.name || 'Sem banco'
                        const agencyInfo = acc?.agency ? `Ag: ${acc.agency}` : ''
                        const accountInfo = acc?.account_number ? `Conta: ${acc.account_number}` : ''
                        const details = [bankName, agencyInfo, accountInfo].filter(Boolean).join(' • ')
                        return (
                          <option key={partner.id} value={partner.shared_account_id}>
                            {getAccountDisplayName(acc)} • {details}
                          </option>
                        )
                      })}
                  </select>
                </div>

                {/* Data de Início */}
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                    <Calendar size={14} className="inline mr-1 text-color-primary" />
                    Data de Início
                  </label>
                  <div className="relative">
                    <input
                      ref={(el) => {
                        if (el) {
                          (el as any)._openPicker = () => {
                            try {
                              if ('showPicker' in el) {
                                (el as any).showPicker()
                              }
                            } catch (error) {
                              // Silently fail
                            }
                          }
                        }
                      }}
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      min={minStartDate || undefined}
                      max={endDate || undefined}
                      style={{
                        colorScheme: 'light dark'
                      }}
                      className="w-full px-3 py-2 pr-10 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-color-primary focus:border-color-primary transition-all shadow-sm"
                      title={minStartDate ? `Data mínima: ${new Date(minStartDate).toLocaleDateString('pt-BR')} (mesmo dia ou após o último fechamento)` : undefined}
                      placeholder="dd/mm/aaaa"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        const input = e.currentTarget.previousElementSibling as any
                        if (input && input._openPicker) {
                          input._openPicker()
                        }
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-color-primary transition-colors"
                      title="Abrir calendário"
                    >
                      <Calendar size={18} />
                    </button>
                  </div>
                  {lastClosureTimestamp && (
                    <div className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                      <Clock size={12} className="text-color-primary" />
                      <span>
                        Último fechamento: {new Date(lastClosureTimestamp).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })}
                      </span>
                    </div>
                  )}
                </div>

                {/* Data de Fim */}
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                    <Calendar size={14} className="inline mr-1 text-color-primary" />
                    Data de Fim
                  </label>
                  <div className="relative">
                    <input
                      ref={(el) => {
                        if (el) {
                          (el as any)._openPicker = () => {
                            try {
                              if ('showPicker' in el) {
                                (el as any).showPicker()
                              }
                            } catch (error) {
                              // Silently fail
                            }
                          }
                        }
                      }}
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      min={startDate || undefined}
                      max={getTodayLocalDate()}
                      style={{
                        colorScheme: 'light dark'
                      }}
                      className="w-full px-3 py-2 pr-10 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-color-primary focus:border-color-primary transition-all shadow-sm"
                      placeholder="dd/mm/aaaa"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        const input = e.currentTarget.previousElementSibling as any
                        if (input && input._openPicker) {
                          input._openPicker()
                        }
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-color-primary transition-colors"
                      title="Abrir calendário"
                    >
                      <Calendar size={18} />
                    </button>
                  </div>
                  {calculationTimestamp && (
                    <div className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                      <Clock size={12} className="text-color-primary" />
                      <span>
                        Fechamento: {new Date(calculationTimestamp.replace(' ', 'T')).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })}
                      </span>
                    </div>
                  )}
                </div>

                {/* Botão Aplicar - Alinhado com os campos */}
                <div className="flex flex-col">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5 opacity-0 pointer-events-none">
                    &nbsp;
                  </label>
                  <button
                    onClick={loadBalanceCalculation}
                    disabled={!selectedPartnerAccountId || !startDate || !endDate}
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-all font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md hover:opacity-90 whitespace-nowrap"
                    style={{ minWidth: '110px', height: '38px', backgroundColor: 'var(--crud-create)', color: 'var(--on-crud-create)' }}
                  >
                    <Filter size={16} />
                    Aplicar
                  </button>
                </div>
              </div>
            )}

            {/* Abas: Histórico Anual e Fechamentos */}
            {(activeTab === 'history' || activeTab === 'closures') && (
              <div className="flex flex-col md:flex-row gap-4">
                {/* Conta Compartilhada */}
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                    <Building2 size={14} className="inline mr-1 text-color-primary" />
                    Conta Compartilhada
                  </label>
                  <select
                    value={selectedPartnerAccountId || ''}
                    onChange={(e) => setSelectedPartnerAccountId(e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-color-primary focus:border-color-primary transition-all shadow-sm"
                  >
                    <option value="">Selecione...</option>
                    {[...partners]
                      .sort((a, b) => {
                        const nameA = getAccountDisplayName(a.shared_account).toLowerCase()
                        const nameB = getAccountDisplayName(b.shared_account).toLowerCase()
                        return nameA.localeCompare(nameB, 'pt-BR')
                      })
                      .map(partner => {
                        const acc = partner.shared_account
                        const bankName = acc?.bank?.name || 'Sem banco'
                        const agencyInfo = acc?.agency ? `Ag: ${acc.agency}` : ''
                        const accountInfo = acc?.account_number ? `Conta: ${acc.account_number}` : ''
                        const details = [bankName, agencyInfo, accountInfo].filter(Boolean).join(' • ')
                        return (
                          <option key={partner.id} value={partner.shared_account_id}>
                            {getAccountDisplayName(acc)} • {details}
                          </option>
                        )
                      })}
                  </select>
                </div>

                {/* Ano */}
                <div className="w-full md:w-32">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                    <Calendar size={14} className="inline mr-1 text-color-primary" />
                    Ano
                  </label>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-color-primary focus:border-color-primary transition-all shadow-sm"
                  >
                    {years.map(year => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>

                {/* Botão Aplicar */}
                <div className="flex flex-col">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5 opacity-0 pointer-events-none">
                    &nbsp;
                  </label>
                  <button
                    onClick={() => {
                      if (activeTab === 'history') {
                        loadAnnualHistory()
                      } else if (activeTab === 'closures') {
                        loadClosures()
                      }
                    }}
                    disabled={!selectedPartnerAccountId || loading || closuresLoading}
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-all font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md hover:opacity-90 whitespace-nowrap"
                    style={{ minWidth: '110px', height: '38px', backgroundColor: 'var(--crud-create)', color: 'var(--on-crud-create)' }}
                  >
                    <Filter size={16} />
                    Aplicar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setActiveTab('current')}
                className={`flex-1 px-6 py-4 text-sm font-semibold transition-all ${
                  activeTab === 'current'
                    ? 'text-color-primary border-b-2 border-color-primary bg-gray-50 dark:bg-gray-700/50'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-700/30'
                }`}
              >
                📊 Balanço Calculado
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`flex-1 px-6 py-4 text-sm font-semibold transition-all ${
                  activeTab === 'history'
                    ? 'text-color-primary border-b-2 border-color-primary bg-gray-50 dark:bg-gray-700/50'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-700/30'
                }`}
              >
                📅 Histórico Anual
              </button>
              <button
                onClick={() => setActiveTab('closures')}
                className={`flex-1 px-6 py-4 text-sm font-semibold transition-all ${
                  activeTab === 'closures'
                    ? 'text-color-primary border-b-2 border-color-primary bg-gray-50 dark:bg-gray-700/50'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-700/30'
                }`}
              >
                <Archive size={16} className="inline mr-1" />
                Fechamentos
              </button>
            </div>

            {/* Loading */}
            {loading && (
              <div className="p-12 text-center">
                <LoadingSpinner message="Carregando dados..." />
              </div>
            )}

            {/* Tab Content: Balanço Calculado */}
            {!loading && activeTab === 'current' && (
              <div className="p-6">
                {/* Estado: Aguardando Aplicação de Filtros */}
                {!balanceData && selectedPartnerAccountId && (
                  <div className="text-center py-12">
                    <div className="flex flex-col items-center gap-4">
                      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-full">
                        <Scale className="h-12 w-12 text-color-primary" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Pronto para calcular</h3>
                        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                          Ajuste as datas conforme necessário e clique em <strong>"Aplicar"</strong> para visualizar o balanço.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Conteúdo do Balanço */}
                {balanceData && (
                  <div>
                {/* Informações do Período + Botões de Fechamento */}
                <div className="mb-6 flex items-center justify-between gap-4">
                  {/* Informações do Período */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <Calendar size={16} className="text-color-primary" />
                      <span className="font-semibold">
                        Período: {new Date(balanceData.start_date).toLocaleDateString('pt-BR')} até {new Date(balanceData.end_date).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 ml-6">
                      {new Date(balanceData.start_date).getDate() === 1 && new Date(balanceData.start_date).getMonth() === 0
                        ? `Calculado desde o início do ano ${selectedYear} (sem fechamentos anteriores)`
                        : 'Calculado desde o último fechamento até hoje'}
                    </p>
                  </div>

                  {/* Botões de Fechamento */}
                  <div className="flex items-center gap-3">
                    {/* Alerta de validação de empréstimos */}
                    {!loanValidation.isValid && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-red-100 dark:bg-red-900/30 rounded-lg border border-red-300 dark:border-red-700">
                        <AlertTriangle size={14} className="text-red-600 dark:text-red-400" />
                        <span className="text-xs font-medium text-red-700 dark:text-red-300">
                          Corrija os valores de empréstimo
                        </span>
                      </div>
                    )}
                    <button
                      onClick={() => setShowClosureModal(true)}
                      disabled={!loanValidation.isValid}
                      className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-2 ${
                        !loanValidation.isValid
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:opacity-90'
                      }`}
                      style={{ backgroundColor: 'var(--crud-create)', color: 'var(--on-crud-create)' }}
                      title={!loanValidation.isValid ? loanValidation.errors.join('\n') : undefined}
                    >
                      <Archive size={16} />
                      Realizar Fechamento
                    </button>
                  </div>
                </div>

                {/* Layout Principal - 2 Colunas com Header Único por Conta */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

                  {/* ========== COLUNA: CONTA PRINCIPAL (LOGADA) ========== */}
                  <div className="space-y-4">
                    {/* Header da Conta Principal */}
                    <div className="bg-color-primary rounded-lg px-4 py-3 border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Building2 size={18} className="text-on-color-1" />
                        <h3 className="text-base font-bold text-on-color-1">
                          {balanceData.main_account_card.account_name}
                        </h3>
                        {balanceData.main_account_card.bank_name && (
                          <span className="text-sm text-on-color-1 opacity-80 flex items-center gap-1">
                            <span className="opacity-60">•</span>
                            <Landmark size={14} />
                            {balanceData.main_account_card.bank_name}
                            {balanceData.main_account_card.agency && ` Ag: ${balanceData.main_account_card.agency}`}
                            {balanceData.main_account_card.account_number && ` C: ${balanceData.main_account_card.account_number}`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Card de Balanço - Conta Principal */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-4 transition-all hover:border-color-primary hover:shadow-md">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 pb-2 mb-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
                        <Scale size={16} className="text-color-primary" />
                        Balanço
                      </h4>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center py-1.5">
                          <span className="text-sm text-gray-600 dark:text-gray-400">A Receber</span>
                          <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                            {formatCurrency(Math.abs(balanceData.main_account_card.total_expenses))}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-1.5">
                          <span className="text-sm text-gray-600 dark:text-gray-400">A Pagar</span>
                          <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                            {formatCurrency(Math.abs(balanceData.main_account_card.total_revenues))}
                          </span>
                        </div>
                        {/* Linha de Empréstimo - Conta Principal */}
                        {(() => {
                          const loanTotals = calculateTotalLoanPayments()
                          // Para a conta principal: totalLent = a receber, totalBorrowed = a pagar
                          // Mostra as linhas se existirem empréstimos do tipo, mesmo que valor seja 0
                          if (loanTotals.hasLentLoans || loanTotals.hasBorrowedLoans) {
                            return (
                              <>
                                {loanTotals.hasLentLoans && (
                                  <div className="flex justify-between items-center py-1.5">
                                    <span className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                      <Banknote size={14} />
                                      Empréstimo a Receber
                                    </span>
                                    <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                                      {formatCurrency(loanTotals.totalLent)}
                                    </span>
                                  </div>
                                )}
                                {loanTotals.hasBorrowedLoans && (
                                  <div className="flex justify-between items-center py-1.5">
                                    <span className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                      <Banknote size={14} />
                                      Empréstimo a Pagar
                                    </span>
                                    <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                                      {formatCurrency(loanTotals.totalBorrowed)}
                                    </span>
                                  </div>
                                )}
                              </>
                            )
                          }
                          return null
                        })()}
                        <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-700">
                          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Saldo Líquido</span>
                          {(() => {
                            const loanTotals = calculateTotalLoanPayments()
                            // Conta principal: calcula net a partir dos valores exibidos
                            // A Receber (total_expenses) + Empréstimo a Receber (totalLent - eu emprestei, tenho a receber)
                            // A Pagar (total_revenues) + Empréstimo a Pagar (totalBorrowed - eu peguei, tenho a pagar)
                            // Net = Total A Receber - Total A Pagar
                            const totalAReceber = Math.abs(balanceData.main_account_card.total_expenses || 0) + (loanTotals.totalLent || 0)
                            const totalAPagar = Math.abs(balanceData.main_account_card.total_revenues || 0) + (loanTotals.totalBorrowed || 0)
                            const netWithLoans = totalAReceber - totalAPagar
                            return (
                              <span className={`text-lg font-bold ${
                                netWithLoans > 0
                                  ? 'text-green-600 dark:text-green-400'
                                  : netWithLoans < 0
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-gray-600 dark:text-gray-400'
                              }`}>
                                {formatCurrency(Math.abs(netWithLoans))}
                              </span>
                            )
                          })()}
                        </div>
                      </div>
                      {/* Status Badge */}
                      {(() => {
                        const loanTotals = calculateTotalLoanPayments()
                        // Mesma lógica: Net = Total A Receber - Total A Pagar
                        const totalAReceber = Math.abs(balanceData.main_account_card.total_expenses || 0) + (loanTotals.totalLent || 0)
                        const totalAPagar = Math.abs(balanceData.main_account_card.total_revenues || 0) + (loanTotals.totalBorrowed || 0)
                        const totalWithLoans = totalAReceber - totalAPagar
                        return (
                          <div className={`mt-3 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium ${
                            totalWithLoans > 0
                              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                              : totalWithLoans < 0
                              ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                              : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600'
                          }`}>
                            {totalWithLoans > 0 ? (
                              <><TrendingUp size={16} /> A Receber</>
                            ) : totalWithLoans < 0 ? (
                              <><TrendingDown size={16} /> A Pagar</>
                            ) : (
                              <><Minus size={16} /> Zerado</>
                            )}
                          </div>
                        )
                      })()}
                    </div>

                    {/* Card de Detalhes - Transações - Conta Principal */}
                    {(balanceData.main_account_card.expense_items.length > 0 || balanceData.main_account_card.revenue_items.length > 0) && (
                      <button
                        onClick={() => openDetailsModal(
                          'transactions',
                          'primary',
                          balanceData.main_account_card.account_name,
                          balanceData.main_account_card.expense_items,
                          balanceData.main_account_card.revenue_items
                        )}
                        className="w-full bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm px-4 py-3 transition-all hover:border-color-primary hover:shadow-md text-left group flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <Receipt size={18} className="text-color-primary" />
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">Transações</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            ({balanceData.main_account_card.expense_items.length + balanceData.main_account_card.revenue_items.length})
                          </span>
                        </div>
                        <Eye size={16} className="text-gray-400 group-hover:text-color-primary transition-colors" />
                      </button>
                    )}

                    {/* Card de Detalhes - Fatura de Cartão - Conta Principal */}
                    {(balanceData.main_account_card.credit_card_expense_items?.length > 0 || balanceData.main_account_card.credit_card_revenue_items?.length > 0) && (
                      <button
                        onClick={() => openDetailsModal(
                          'credit_card',
                          'primary',
                          balanceData.main_account_card.account_name,
                          balanceData.main_account_card.credit_card_expense_items || [],
                          balanceData.main_account_card.credit_card_revenue_items || []
                        )}
                        className="w-full bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm px-4 py-3 transition-all hover:border-color-primary hover:shadow-md text-left group flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <CreditCard size={18} className="text-color-primary" />
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">Fatura de Cartão</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            ({(balanceData.main_account_card.credit_card_expense_items?.length || 0) + (balanceData.main_account_card.credit_card_revenue_items?.length || 0)})
                          </span>
                        </div>
                        <Eye size={16} className="text-gray-400 group-hover:text-color-primary transition-colors" />
                      </button>
                    )}

                    {/* Card de Detalhes - Cartão de Benefícios - Conta Principal */}
                    {(balanceData.main_account_card.benefit_card_expense_items?.length > 0 || balanceData.main_account_card.benefit_card_revenue_items?.length > 0) && (
                      <button
                        onClick={() => openDetailsModal(
                          'benefit_card',
                          'primary',
                          balanceData.main_account_card.account_name,
                          balanceData.main_account_card.benefit_card_expense_items || [],
                          balanceData.main_account_card.benefit_card_revenue_items || []
                        )}
                        className="w-full bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm px-4 py-3 transition-all hover:border-color-primary hover:shadow-md text-left group flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <Gift size={18} className="text-color-primary" />
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">Cartão de Benefícios</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            ({(balanceData.main_account_card.benefit_card_expense_items?.length || 0) + (balanceData.main_account_card.benefit_card_revenue_items?.length || 0)})
                          </span>
                        </div>
                        <Eye size={16} className="text-gray-400 group-hover:text-color-primary transition-colors" />
                      </button>
                    )}
                  </div>

                  {/* ========== COLUNA: CONTA COMPARTILHADA ========== */}
                  <div className="space-y-4">
                    {/* Header da Conta Compartilhada */}
                    <div className="bg-color-secondary rounded-lg px-4 py-3 border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Building2 size={18} className="text-on-color-2" />
                        <h3 className="text-base font-bold text-on-color-2">
                          {balanceData.partner_account_card.account_name}
                        </h3>
                        {balanceData.partner_account_card.bank_name && (
                          <span className="text-sm text-on-color-2 opacity-80 flex items-center gap-1">
                            <span className="opacity-60">•</span>
                            <Landmark size={14} />
                            {balanceData.partner_account_card.bank_name}
                            {balanceData.partner_account_card.agency && ` Ag: ${balanceData.partner_account_card.agency}`}
                            {balanceData.partner_account_card.account_number && ` C: ${balanceData.partner_account_card.account_number}`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Card de Balanço - Conta Compartilhada */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-4 transition-all hover:border-color-primary hover:shadow-md">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 pb-2 mb-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
                        <Scale size={16} className="text-color-secondary" />
                        Balanço
                      </h4>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center py-1.5">
                          <span className="text-sm text-gray-600 dark:text-gray-400">A Receber</span>
                          <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                            {formatCurrency(Math.abs(balanceData.partner_account_card.total_expenses))}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-1.5">
                          <span className="text-sm text-gray-600 dark:text-gray-400">A Pagar</span>
                          <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                            {formatCurrency(Math.abs(balanceData.partner_account_card.total_revenues))}
                          </span>
                        </div>
                        {/* Linha de Empréstimo - Conta Parceira (invertido) */}
                        {(() => {
                          const loanTotals = calculateTotalLoanPayments()
                          // Para a conta parceira: totalLent (eu emprestei) = parceiro tem a pagar
                          // totalBorrowed (eu peguei) = parceiro tem a receber
                          // Mostra as linhas se existirem empréstimos do tipo (invertido para o parceiro)
                          if (loanTotals.hasLentLoans || loanTotals.hasBorrowedLoans) {
                            return (
                              <>
                                {loanTotals.hasBorrowedLoans && (
                                  <div className="flex justify-between items-center py-1.5">
                                    <span className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                      <Banknote size={14} />
                                      Empréstimo a Receber
                                    </span>
                                    <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                                      {formatCurrency(loanTotals.totalBorrowed)}
                                    </span>
                                  </div>
                                )}
                                {loanTotals.hasLentLoans && (
                                  <div className="flex justify-between items-center py-1.5">
                                    <span className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                      <Banknote size={14} />
                                      Empréstimo a Pagar
                                    </span>
                                    <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                                      {formatCurrency(loanTotals.totalLent)}
                                    </span>
                                  </div>
                                )}
                              </>
                            )
                          }
                          return null
                        })()}
                        <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-700">
                          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Saldo Líquido</span>
                          {(() => {
                            const loanTotals = calculateTotalLoanPayments()
                            // Conta parceira: calcula net a partir dos valores exibidos
                            // A Receber (total_expenses) + Empréstimo a Receber (totalBorrowed)
                            // A Pagar (total_revenues) + Empréstimo a Pagar (totalLent)
                            // Net = Total A Receber - Total A Pagar
                            const totalAReceber = Math.abs(balanceData.partner_account_card.total_expenses || 0) + (loanTotals.totalBorrowed || 0)
                            const totalAPagar = Math.abs(balanceData.partner_account_card.total_revenues || 0) + (loanTotals.totalLent || 0)
                            const netWithLoans = totalAReceber - totalAPagar
                            return (
                              <span className={`text-lg font-bold ${
                                netWithLoans > 0
                                  ? 'text-green-600 dark:text-green-400'
                                  : netWithLoans < 0
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-gray-600 dark:text-gray-400'
                              }`}>
                                {formatCurrency(Math.abs(netWithLoans))}
                              </span>
                            )
                          })()}
                        </div>
                      </div>
                      {/* Status Badge */}
                      {(() => {
                        const loanTotals = calculateTotalLoanPayments()
                        // Mesma lógica: Net = Total A Receber - Total A Pagar
                        const totalAReceber = Math.abs(balanceData.partner_account_card.total_expenses || 0) + (loanTotals.totalBorrowed || 0)
                        const totalAPagar = Math.abs(balanceData.partner_account_card.total_revenues || 0) + (loanTotals.totalLent || 0)
                        const totalWithLoans = totalAReceber - totalAPagar
                        return (
                          <div className={`mt-3 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium ${
                            totalWithLoans > 0
                              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                              : totalWithLoans < 0
                              ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                              : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600'
                          }`}>
                            {totalWithLoans > 0 ? (
                              <><TrendingUp size={16} /> A Receber</>
                            ) : totalWithLoans < 0 ? (
                              <><TrendingDown size={16} /> A Pagar</>
                            ) : (
                              <><Minus size={16} /> Zerado</>
                            )}
                          </div>
                        )
                      })()}
                    </div>

                    {/* Card de Detalhes - Transações - Conta Compartilhada */}
                    {(balanceData.partner_account_card.expense_items.length > 0 || balanceData.partner_account_card.revenue_items.length > 0) && (
                      <button
                        onClick={() => openDetailsModal(
                          'transactions',
                          'secondary',
                          balanceData.partner_account_card.account_name,
                          balanceData.partner_account_card.expense_items,
                          balanceData.partner_account_card.revenue_items,
                          true
                        )}
                        className="w-full bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm px-4 py-3 transition-all hover:border-color-secondary hover:shadow-md text-left group flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <Receipt size={18} className="text-color-secondary" />
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">Transações</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            ({balanceData.partner_account_card.expense_items.length + balanceData.partner_account_card.revenue_items.length})
                          </span>
                        </div>
                        <Eye size={16} className="text-gray-400 group-hover:text-color-secondary transition-colors" />
                      </button>
                    )}

                    {/* Card de Detalhes - Fatura de Cartão - Conta Compartilhada */}
                    {(balanceData.partner_account_card.credit_card_expense_items?.length > 0 || balanceData.partner_account_card.credit_card_revenue_items?.length > 0) && (
                      <button
                        onClick={() => openDetailsModal(
                          'credit_card',
                          'secondary',
                          balanceData.partner_account_card.account_name,
                          balanceData.partner_account_card.credit_card_expense_items || [],
                          balanceData.partner_account_card.credit_card_revenue_items || [],
                          true
                        )}
                        className="w-full bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm px-4 py-3 transition-all hover:border-color-secondary hover:shadow-md text-left group flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <CreditCard size={18} className="text-color-secondary" />
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">Fatura de Cartão</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            ({(balanceData.partner_account_card.credit_card_expense_items?.length || 0) + (balanceData.partner_account_card.credit_card_revenue_items?.length || 0)})
                          </span>
                        </div>
                        <Eye size={16} className="text-gray-400 group-hover:text-color-secondary transition-colors" />
                      </button>
                    )}

                    {/* Card de Detalhes - Cartão de Benefícios - Conta Compartilhada */}
                    {(balanceData.partner_account_card.benefit_card_expense_items?.length > 0 || balanceData.partner_account_card.benefit_card_revenue_items?.length > 0) && (
                      <button
                        onClick={() => openDetailsModal(
                          'benefit_card',
                          'secondary',
                          balanceData.partner_account_card.account_name,
                          balanceData.partner_account_card.benefit_card_expense_items || [],
                          balanceData.partner_account_card.benefit_card_revenue_items || [],
                          true
                        )}
                        className="w-full bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm px-4 py-3 transition-all hover:border-color-secondary hover:shadow-md text-left group flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <Gift size={18} className="text-color-secondary" />
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">Cartão de Benefícios</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            ({(balanceData.partner_account_card.benefit_card_expense_items?.length || 0) + (balanceData.partner_account_card.benefit_card_revenue_items?.length || 0)})
                          </span>
                        </div>
                        <Eye size={16} className="text-gray-400 group-hover:text-color-secondary transition-colors" />
                      </button>
                    )}
                  </div>
                </div>

                {/* ========== CARD DE EMPRÉSTIMOS ========== */}
                {openLoans && openLoans.loans.length > 0 && (
                  <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                    {/* Header do Card */}
                    <button
                      onClick={() => setLoansExpanded(!loansExpanded)}
                      className="w-full px-6 py-4 flex items-center justify-between bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-b border-amber-200 dark:border-amber-800 hover:from-amber-100 hover:to-orange-100 dark:hover:from-amber-900/30 dark:hover:to-orange-900/30 transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded-lg">
                          <Banknote size={20} className="text-amber-600 dark:text-amber-400" />
                        </div>
                        <div className="text-left">
                          <h3 className="text-base font-bold text-gray-900 dark:text-white">
                            Empréstimos
                          </h3>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {openLoans.loans.length} empréstimo(s) aberto(s) com {openLoans.partner_account_name}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {/* Resumo dos Valores - Calculados com juros e sinais corretos */}
                        {(() => {
                          // Calcular totais com sinais (igual a EmprestimosPage)
                          // Emprestei: principal negativo (saiu), corrigido negativo, saldo positivo (a receber)
                          // Peguei: principal positivo (entrou), corrigido positivo, saldo negativo (a pagar)
                          let totalPrincipalDisplay = 0
                          let totalCorrectedDisplay = 0
                          let totalBalanceDisplay = 0
                          let hasInterest = false

                          openLoans.loans.forEach(loan => {
                            const isLent = loan.loan_type === 'lent'
                            const principal = Number(loan.principal_amount) || 0
                            const totalPaid = Number(loan.total_paid) || 0

                            // Principal com sinal
                            const principalWithSign = isLent ? -principal : principal
                            totalPrincipalDisplay += principalWithSign

                            // Corrigido com sinal
                            let correctedAmount = principal
                            if (loan.interest_enabled && loan.interest_rate && loan.interest_type && loan.interest_period) {
                              const interestInfo = calculateInterest(
                                principal,
                                loan.loan_date,
                                Number(loan.interest_rate),
                                loan.interest_type as 'simple' | 'compound',
                                loan.interest_period as 'daily' | 'monthly' | 'yearly'
                              )
                              correctedAmount = interestInfo.correctedAmount
                              hasInterest = true
                            }
                            const correctedWithSign = isLent ? -correctedAmount : correctedAmount
                            totalCorrectedDisplay += correctedWithSign

                            // Saldo com sinal (oposto do principal)
                            const balance = correctedAmount - totalPaid
                            const balanceWithSign = isLent ? balance : -balance
                            totalBalanceDisplay += balanceWithSign
                          })

                          return (
                            <div className="hidden sm:flex items-center gap-4 text-sm">
                              <div className="text-right">
                                <span className="text-xs text-gray-500 dark:text-gray-400">Principal</span>
                                <p className={`font-bold ${
                                  totalPrincipalDisplay < 0
                                    ? 'text-red-600 dark:text-red-400'
                                    : totalPrincipalDisplay > 0
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-gray-600 dark:text-gray-400'
                                }`}>
                                  {formatCurrency(totalPrincipalDisplay)}
                                </p>
                              </div>
                              {hasInterest && (
                                <div className="text-right">
                                  <span className="text-xs text-gray-500 dark:text-gray-400">Corrigido</span>
                                  <p className={`font-bold ${
                                    totalCorrectedDisplay === 0
                                      ? 'text-gray-900 dark:text-gray-100'
                                      : totalCorrectedDisplay > 0
                                        ? 'text-green-600 dark:text-green-400'
                                        : 'text-red-600 dark:text-red-400'
                                  }`}>
                                    {formatCurrency(totalCorrectedDisplay)}
                                  </p>
                                </div>
                              )}
                              <div className="text-right">
                                <span className="text-xs text-gray-500 dark:text-gray-400">Saldo Aberto</span>
                                <p className={`font-bold ${
                                  totalBalanceDisplay > 0
                                    ? 'text-green-600 dark:text-green-400'
                                    : totalBalanceDisplay < 0
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-gray-600 dark:text-gray-400'
                                }`}>
                                  {formatCurrency(totalBalanceDisplay)}
                                </p>
                              </div>
                            </div>
                          )
                        })()}
                        {loansExpanded ? (
                          <ChevronUp size={20} className="text-gray-400" />
                        ) : (
                          <ChevronDown size={20} className="text-gray-400" />
                        )}
                      </div>
                    </button>

                    {/* Conteúdo Expandível - Tabela de Empréstimos */}
                    {loansExpanded && (
                      <div className="p-4">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Saldo</th>
                                <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Descrição</th>
                                <th className="px-3 py-2 text-right text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Principal</th>
                                <th className="px-3 py-2 text-right text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Saldo Corrigido</th>
                                <th className="px-3 py-2 text-right text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Já Pago</th>
                                <th className="px-3 py-2 text-right text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Saldo Aberto</th>
                                <th className="px-3 py-2 text-center text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Quitar Integral</th>
                                <th className="px-3 py-2 text-center text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Valor a Quitar</th>
                                <th className="px-3 py-2 text-center text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Ignorar</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                              {openLoans.loans.map((loan) => {
                                const payment = loanPayments.find(lp => lp.loan_id === loan.id)
                                const isLent = loan.loan_type === 'lent'

                                // Calcular valor corrigido com juros (se habilitado)
                                let interestInfo: { correctedAmount: number; interestAmount: number; periods: number; description: string } | null = null
                                if (loan.interest_enabled && loan.interest_rate && loan.interest_type && loan.interest_period) {
                                  interestInfo = calculateInterest(
                                    Number(loan.principal_amount),
                                    loan.loan_date,
                                    Number(loan.interest_rate),
                                    loan.interest_type as 'simple' | 'compound',
                                    loan.interest_period as 'daily' | 'monthly' | 'yearly'
                                  )
                                }

                                // Saldo aberto baseado no valor corrigido
                                const baseAmount = interestInfo ? interestInfo.correctedAmount : Number(loan.principal_amount)
                                const correctedBalance = baseAmount - Number(loan.total_paid)

                                // TODOS OS VALORES SEMPRE POSITIVOS - badge indica a direção
                                const principalDisplay = Math.abs(Number(loan.principal_amount))
                                const correctedDisplay = interestInfo ? Math.abs(interestInfo.correctedAmount) : principalDisplay
                                const balanceDisplay = Math.abs(correctedBalance)

                                // Cor do saldo baseada na direção
                                const balanceColor = correctedBalance <= 0.01
                                  ? 'text-gray-900 dark:text-gray-100'
                                  : isLent
                                    ? 'text-green-600 dark:text-green-400'  // A receber
                                    : 'text-red-600 dark:text-red-400'       // A pagar

                                // Labels dinâmicos
                                const balanceLabel = isLent ? 'A ser Quitado' : 'A Quitar'
                                const BalanceIcon = isLent ? ArrowUpCircle : ArrowDownCircle
                                const balanceIconColor = isLent ? 'text-green-500' : 'text-red-500'

                                return (
                                  <tr
                                    key={loan.id}
                                    className={`border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all ${payment?.ignore ? 'opacity-50' : ''}`}
                                    onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = 'var(--color-1)' }}
                                    onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = '' }}
                                  >
                                    <td className="px-3 py-3">
                                      <span
                                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium w-[100px] justify-center text-white ${
                                          isLent ? 'bg-green-600' : 'bg-red-600'
                                        }`}
                                      >
                                        {isLent ? (
                                          <><ArrowUpCircle size={12} /> A Receber</>
                                        ) : (
                                          <><ArrowDownCircle size={12} /> A Pagar</>
                                        )}
                                      </span>
                                    </td>
                                    <td className="px-3 py-3 text-gray-900 dark:text-white">
                                      <div className="font-medium">{loan.description}</div>
                                      <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {new Date(loan.loan_date).toLocaleDateString('pt-BR')}
                                      </div>
                                    </td>
                                    <td className="px-3 py-3 text-right font-bold text-gray-900 dark:text-gray-100">
                                      {formatCurrency(principalDisplay)}
                                    </td>
                                    <td className="px-3 py-3 text-right">
                                      {interestInfo ? (
                                        <div>
                                          <div className="flex items-center justify-end gap-1">
                                            <span className={`font-bold ${balanceColor}`}>
                                              {formatCurrency(correctedDisplay)}
                                            </span>
                                            <span className="relative group cursor-help">
                                              <HelpCircle size={14} className="text-amber-500 dark:text-amber-400" />
                                              <span className="absolute bottom-full right-0 mb-1 w-48 p-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                                                <strong>{loan.interest_type === 'compound' ? 'Juros Compostos' : 'Juros Simples'}</strong><br />
                                                {loan.interest_rate}% {loan.interest_period === 'daily' ? 'ao dia' : loan.interest_period === 'monthly' ? 'ao mês' : 'ao ano'}<br />
                                                <span className="text-gray-300">{interestInfo.description}</span>
                                              </span>
                                            </span>
                                          </div>
                                          <div className="text-xs text-gray-500 dark:text-gray-400">
                                            +{formatCurrency(Math.abs(interestInfo.interestAmount))}
                                          </div>
                                        </div>
                                      ) : (
                                        <span className="text-gray-400 dark:text-gray-500">-</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-3 text-right text-gray-600 dark:text-gray-400">
                                      {formatCurrency(loan.total_paid)}
                                    </td>
                                    <td className="px-3 py-3">
                                      <div className={`flex items-center justify-end gap-1 font-bold ${balanceColor}`}>
                                        {formatCurrency(balanceDisplay)}
                                      </div>
                                    </td>
                                    {/* Switch Quitar Integral */}
                                    <td className="px-3 py-3">
                                      <div className="flex items-center justify-center">
                                        <button
                                          onClick={() => handleSettleInFullToggle(loan.id, correctedBalance)}
                                          disabled={payment?.ignore || correctedBalance <= 0.01}
                                          className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-color-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                                            !payment?.settleInFull ? 'bg-gray-200 dark:bg-gray-600' : ''
                                          }`}
                                          style={payment?.settleInFull ? { backgroundColor: 'var(--color-1)' } : undefined}
                                          role="switch"
                                          aria-checked={payment?.settleInFull || false}
                                          title={payment?.settleInFull ? 'Desativar quitação integral' : 'Quitar valor integral'}
                                        >
                                          <span
                                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                              payment?.settleInFull ? 'translate-x-4' : 'translate-x-0'
                                            }`}
                                          />
                                        </button>
                                      </div>
                                    </td>
                                    <td className="px-3 py-3">
                                      <div className="flex items-center justify-center">
                                        <div className="relative">
                                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 text-sm">
                                            R$
                                          </span>
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            value={payment?.displayAmount || ''}
                                            onChange={(e) => {
                                              // Se está digitando manualmente, desativar o switch
                                              if (payment?.settleInFull) {
                                                updateLoanPayment(loan.id, 'settleInFull', false)
                                              }
                                              handleLoanAmountChange(loan.id, e.target.value)
                                            }}
                                            onBlur={() => handleLoanAmountBlur(loan.id, correctedBalance)}
                                            disabled={payment?.ignore || payment?.settleInFull}
                                            className="w-28 pl-8 pr-2 py-1.5 text-sm text-right border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                            placeholder="0.00"
                                          />
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-3 py-3 text-center">
                                      <input
                                        type="checkbox"
                                        checked={payment?.ignore || false}
                                        onChange={(e) => {
                                          // Apenas atualiza a flag - não limpa o valor
                                          // O fechamento ignora essa linha independente do valor preenchido
                                          updateLoanPayment(loan.id, 'ignore', e.target.checked)
                                          // Se marcou ignorar e tinha quitar integral, desativa
                                          if (e.target.checked && payment?.settleInFull) {
                                            updateLoanPayment(loan.id, 'settleInFull', false)
                                          }
                                        }}
                                        className="w-4 h-4 text-amber-600 border-gray-300 dark:border-gray-600 rounded focus:ring-amber-500"
                                      />
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>


                      </div>
                    )}
                  </div>
                )}

                  </div>
                )}
              </div>
            )}

            {/* Tab Content: Histórico Anual */}
            {!loading && activeTab === 'history' && !annualHistoryData && (
              <div className="p-6">
                <div className="text-center py-12">
                  <Calendar className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">Selecione os filtros</h3>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Escolha uma conta compartilhada e o ano, depois clique em "Aplicar" para visualizar o histórico
                  </p>
                </div>
              </div>
            )}

            {!loading && activeTab === 'history' && annualHistoryData && (
              <div className="p-6">
                {/* Indicador de Conta e Ano */}
                <div className="mb-6 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 transition-all hover:border-color-primary">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Building2 size={16} className="text-color-primary" />
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Conta:
                      </span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {annualHistoryData.partner_account.name || 'Conta Parceira'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar size={16} className="text-color-primary" />
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Ano:
                      </span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {selectedYear}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Grid com 2 tabelas */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Tabela: Conta Principal */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="bg-color-primary px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                      <h3 className="text-base font-bold text-on-color-1 flex items-center gap-2">
                        <Building2 size={18} className="text-on-color-1" />
                        {annualHistoryData.main_account.name || 'Conta Principal'}
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-100 dark:bg-gray-700">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Mês</th>
                            <th className="px-3 py-2 text-right text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">A Receber</th>
                            <th className="px-3 py-2 text-right text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">A Pagar</th>
                            <th className="px-3 py-2 text-right text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Saldo</th>
                            <th className="px-2 py-2 text-center text-xs font-bold text-gray-700 dark:text-gray-300 uppercase w-20" title="Fechado / Quitado">
                              Status
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-bold text-gray-700 dark:text-gray-300 uppercase w-16">
                              Detalhes
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {annualHistoryData.months.map((monthData, index) => {
                            const balance = monthData.main_account_balance
                            return (
                              <tr
                                key={monthData.month}
                                className="border-l-4 border-l-gray-300 dark:border-l-gray-600 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.borderLeftColor = ''
                                }}
                              >
                                <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">
                                  {formatMonth(monthData.month)}
                                </td>
                                <td className="px-3 py-2 text-sm text-right text-green-600 dark:text-green-400 font-semibold">
                                  {formatCurrency(balance.a_receber || 0)}
                                </td>
                                <td className="px-3 py-2 text-sm text-right text-red-600 dark:text-red-400 font-semibold">
                                  {formatCurrency(-(balance.a_pagar || 0))}
                                </td>
                                <td className={`px-3 py-2 text-sm text-right font-semibold ${
                                  (balance.net_balance || 0) > 0
                                    ? 'text-green-600 dark:text-green-400'
                                    : (balance.net_balance || 0) < 0
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-gray-700 dark:text-gray-400'
                                }`}>
                                  {formatCurrency(balance.net_balance || 0)}
                                </td>
                                <td className="px-2 py-2 text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <span title={monthData.has_closure ? 'Fechado' : 'Aberto'}>
                                      {monthData.has_closure ? (
                                        <Lock size={14} className="text-green-600 dark:text-green-400" />
                                      ) : (
                                        <Unlock size={14} className="text-gray-400 dark:text-gray-500" />
                                      )}
                                    </span>
                                    <span title={monthData.is_settled ? 'Quitado' : 'Pendente de Quitação'}>
                                      {monthData.is_settled ? (
                                        <CheckCircle size={14} className="text-green-600 dark:text-green-400" />
                                      ) : (
                                        <Clock size={14} className="text-gray-400 dark:text-gray-500" />
                                      )}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-center">
                                  <button
                                    onClick={() => {
                                      const [year, month] = monthData.month.split('-')
                                      loadMonthlyDetails(parseInt(year), parseInt(month))
                                    }}
                                    className="p-1.5 text-color-primary hover:bg-color-primary-light rounded-lg transition-all"
                                    title="Ver detalhes do mês"
                                  >
                                    <Search size={16} />
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot className="bg-gray-100 dark:bg-gray-700 border-t-2 border-gray-300 dark:border-gray-600">
                          <tr>
                            <td className="px-3 py-3 text-sm font-bold text-gray-900 dark:text-white">
                              TOTAL
                            </td>
                            <td className="px-3 py-3 text-sm text-right text-green-600 dark:text-green-400 font-bold">
                              <span className="inline-flex items-center justify-end gap-1">
                                {formatCurrency(annualHistoryData.main_account_year_summary.total_a_receber || 0)}
                                <TrendingUp size={14} className="text-green-600 dark:text-green-400" />
                              </span>
                            </td>
                            <td className="px-3 py-3 text-sm text-right text-red-600 dark:text-red-400 font-bold">
                              <span className="inline-flex items-center justify-end gap-1">
                                {formatCurrency(-(annualHistoryData.main_account_year_summary.total_a_pagar || 0))}
                                <TrendingDown size={14} className="text-red-600 dark:text-red-400" />
                              </span>
                            </td>
                            <td className={`px-3 py-3 text-sm text-right font-bold ${
                              (annualHistoryData.main_account_year_summary.net_balance || 0) > 0
                                ? 'text-green-600 dark:text-green-400'
                                : (annualHistoryData.main_account_year_summary.net_balance || 0) < 0
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-gray-700 dark:text-gray-400'
                            }`}>
                              <span className="inline-flex items-center justify-end gap-1">
                                {formatCurrency(annualHistoryData.main_account_year_summary.net_balance || 0)}
                                {(annualHistoryData.main_account_year_summary.net_balance || 0) > 0 ? (
                                  <TrendingUp size={14} className="text-green-600 dark:text-green-400" />
                                ) : (annualHistoryData.main_account_year_summary.net_balance || 0) < 0 ? (
                                  <TrendingDown size={14} className="text-red-600 dark:text-red-400" />
                                ) : null}
                              </span>
                            </td>
                            <td className="px-2 py-3"></td>
                            <td className="px-2 py-3"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* Tabela: Conta Compartilhada */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="bg-color-secondary px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                      <h3 className="text-base font-bold text-on-color-2 flex items-center gap-2">
                        <Building2 size={18} className="text-on-color-2" />
                        {annualHistoryData.partner_account.name || 'Conta Compartilhada'}
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-100 dark:bg-gray-700">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Mês</th>
                            <th className="px-3 py-2 text-right text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">A Receber</th>
                            <th className="px-3 py-2 text-right text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">A Pagar</th>
                            <th className="px-3 py-2 text-right text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Saldo</th>
                            <th className="px-2 py-2 text-center text-xs font-bold text-gray-700 dark:text-gray-300 uppercase w-20" title="Fechado / Quitado">
                              Status
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-bold text-gray-700 dark:text-gray-300 uppercase w-16">
                              Detalhes
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {annualHistoryData.months.map((monthData, index) => {
                            const balance = monthData.partner_account_balance
                            return (
                              <tr
                                key={monthData.month}
                                className="border-l-4 border-l-gray-300 dark:border-l-gray-600 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.borderLeftColor = ''
                                }}
                              >
                                <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">
                                  {formatMonth(monthData.month)}
                                </td>
                                <td className="px-3 py-2 text-sm text-right text-green-600 dark:text-green-400 font-semibold">
                                  {formatCurrency(balance.a_receber || 0)}
                                </td>
                                <td className="px-3 py-2 text-sm text-right text-red-600 dark:text-red-400 font-semibold">
                                  {formatCurrency(-(balance.a_pagar || 0))}
                                </td>
                                <td className={`px-3 py-2 text-sm text-right font-semibold ${
                                  (balance.net_balance || 0) > 0
                                    ? 'text-green-600 dark:text-green-400'
                                    : (balance.net_balance || 0) < 0
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-gray-700 dark:text-gray-400'
                                }`}>
                                  {formatCurrency(balance.net_balance || 0)}
                                </td>
                                <td className="px-2 py-2 text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <span title={monthData.has_closure ? 'Fechado' : 'Aberto'}>
                                      {monthData.has_closure ? (
                                        <Lock size={14} className="text-green-600 dark:text-green-400" />
                                      ) : (
                                        <Unlock size={14} className="text-gray-400 dark:text-gray-500" />
                                      )}
                                    </span>
                                    <span title={monthData.is_settled ? 'Quitado' : 'Pendente de Quitação'}>
                                      {monthData.is_settled ? (
                                        <CheckCircle size={14} className="text-green-600 dark:text-green-400" />
                                      ) : (
                                        <Clock size={14} className="text-gray-400 dark:text-gray-500" />
                                      )}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-center">
                                  <button
                                    onClick={() => {
                                      const [year, month] = monthData.month.split('-')
                                      loadMonthlyDetails(parseInt(year), parseInt(month))
                                    }}
                                    className="p-1.5 text-color-primary hover:bg-color-primary-light rounded-lg transition-all"
                                    title="Ver detalhes do mês"
                                  >
                                    <Search size={16} />
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot className="bg-gray-100 dark:bg-gray-700 border-t-2 border-gray-300 dark:border-gray-600">
                          <tr>
                            <td className="px-3 py-3 text-sm font-bold text-gray-900 dark:text-white">
                              TOTAL
                            </td>
                            <td className="px-3 py-3 text-sm text-right text-green-600 dark:text-green-400 font-bold">
                              <span className="inline-flex items-center justify-end gap-1">
                                {formatCurrency(annualHistoryData.partner_account_year_summary.total_a_receber || 0)}
                                <TrendingUp size={14} className="text-green-600 dark:text-green-400" />
                              </span>
                            </td>
                            <td className="px-3 py-3 text-sm text-right text-red-600 dark:text-red-400 font-bold">
                              <span className="inline-flex items-center justify-end gap-1">
                                {formatCurrency(-(annualHistoryData.partner_account_year_summary.total_a_pagar || 0))}
                                <TrendingDown size={14} className="text-red-600 dark:text-red-400" />
                              </span>
                            </td>
                            <td className={`px-3 py-3 text-sm text-right font-bold ${
                              (annualHistoryData.partner_account_year_summary.net_balance || 0) > 0
                                ? 'text-green-600 dark:text-green-400'
                                : (annualHistoryData.partner_account_year_summary.net_balance || 0) < 0
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-gray-700 dark:text-gray-400'
                            }`}>
                              <span className="inline-flex items-center justify-end gap-1">
                                {formatCurrency(annualHistoryData.partner_account_year_summary.net_balance || 0)}
                                {(annualHistoryData.partner_account_year_summary.net_balance || 0) > 0 ? (
                                  <TrendingUp size={14} className="text-green-600 dark:text-green-400" />
                                ) : (annualHistoryData.partner_account_year_summary.net_balance || 0) < 0 ? (
                                  <TrendingDown size={14} className="text-red-600 dark:text-red-400" />
                                ) : null}
                              </span>
                            </td>
                            <td className="px-2 py-3"></td>
                            <td className="px-2 py-3"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab Content: Fechamentos */}
            {!closuresLoading && activeTab === 'closures' && (
              <div className="p-6">
                {/* Indicador de Conta e Ano */}
                {selectedPartnerAccountId && (
                  <div className="mb-6 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 transition-all hover:border-color-primary">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Building2 size={16} className="text-color-primary" />
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          Conta:
                        </span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {partners.find(p => p.shared_account_id === selectedPartnerAccountId)?.shared_account?.name || 'Conta Parceira'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar size={16} className="text-color-primary" />
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          Ano:
                        </span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {selectedYear}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {closures.length === 0 ? (
                  <div className="text-center py-12">
                    <Archive className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">Nenhum fechamento encontrado</h3>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                      Realize o primeiro fechamento na aba "Mês Atual"
                    </p>
                  </div>
                ) : (
                  <div className={`bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto ${selectedClosureIds.size > 0 || showClosuresBackToTop ? 'pb-20' : ''}`}>
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                          {/* Coluna expand/colapso */}
                          <th className="px-1 py-3 w-8"></th>
                          <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                            <button
                              onClick={toggleSelectAll}
                              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                              title={selectedClosureIds.size === closures.length ? 'Desselecionar todos' : 'Selecionar todos'}
                            >
                              {selectedClosureIds.size === 0 && <Square size={18} className="text-gray-400" />}
                              {selectedClosureIds.size > 0 && selectedClosureIds.size < closures.length && <MinusSquare size={18} className="text-blue-600" />}
                              {selectedClosureIds.size === closures.length && closures.length > 0 && <CheckSquare size={18} className="text-blue-600" />}
                            </button>
                          </th>
                          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">#</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">Início</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">Fim</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">Conta Principal</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">Contraparte</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">A Receber</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">A Pagar</th>
                          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap" title="Possui liquidações de empréstimos">Empréstimos</th>
                          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap" title="Pagamentos parciais realizados">Pagamentos</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">Saldo</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">Status</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {closures.map((closure, index) => {
                          // Os valores são calculados a partir do closure_data JSON
                          // Cada card (main e partner) tem seus próprios valores de A Receber/A Pagar
                          // A conta logada deve ver os valores do SEU card
                          const mainCard = closure.closure_data?.main_account_card || {}
                          const partnerCard = closure.closure_data?.partner_account_card || {}

                          // Identificar a conta principal do fechamento (converter para number para comparação segura)
                          const closureMainAccountId = Number(mainCard.account_id || closure.account_id)

                          // Verificar se a conta logada é a principal ou a contraparte
                          const isCounterpart = Number(loggedAccountId) !== closureMainAccountId

                          // Selecionar o card correto baseado na conta logada
                          const viewerCard = isCounterpart ? partnerCard : mainCard

                          // Valores do card da conta logada
                          const totalToReceive = parseFloat(viewerCard.total_to_receive ?? 0)
                          const totalToPay = parseFloat(viewerCard.total_to_pay ?? 0)
                          const loanToReceive = parseFloat(viewerCard.loan_to_receive ?? 0)
                          const loanToPay = parseFloat(viewerCard.loan_to_pay ?? 0)

                          // A Receber = total_to_receive + loan_to_receive (ambos positivos)
                          const displayToReceive = totalToReceive + loanToReceive
                          // A Pagar = |total_to_pay| + |loan_to_pay| (ambos negativos no JSON, exibimos positivo)
                          const displayToPay = Math.abs(totalToPay) + Math.abs(loanToPay)

                          // Saldo = A Receber - A Pagar
                          const displayNetBalance = displayToReceive - displayToPay

                          // Verificar se possui liquidações de empréstimos (de qualquer card)
                          const mainLoanToReceive = parseFloat(mainCard.loan_to_receive ?? 0)
                          const mainLoanToPay = parseFloat(mainCard.loan_to_pay ?? 0)
                          const rootLoanPayments = closure.closure_data?.loan_payments || []
                          const hasLoanPayments = (mainLoanToReceive !== 0 || mainLoanToPay !== 0 ||
                                                   (mainCard.loan_payments && mainCard.loan_payments.length > 0) ||
                                                   (partnerCard.loan_payments && partnerCard.loan_payments.length > 0) ||
                                                   rootLoanPayments.length > 0)

                          return (
                          <React.Fragment key={closure.id}>
                          <tr
                            className={`border-l-4 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all ${
                              selectedClosureIds.has(closure.id)
                                ? 'border-l-blue-600 bg-blue-50 dark:bg-blue-900/20'
                                : 'border-l-gray-300 dark:border-l-gray-600'
                            }`}
                            onMouseEnter={(e) => {
                              if (!selectedClosureIds.has(closure.id)) {
                                e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!selectedClosureIds.has(closure.id)) {
                                e.currentTarget.style.borderLeftColor = ''
                              }
                            }}
                          >
                            {/* Coluna expand/colapso */}
                            <td className="px-1 py-3 text-center w-8">
                              {(closure.closure_payments || []).length > 0 ? (
                                <button
                                  onClick={() => toggleClosureExpansion(closure.id)}
                                  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors text-color-primary"
                                  title={expandedClosureIds.has(closure.id) ? 'Colapsar pagamentos' : 'Expandir pagamentos'}
                                >
                                  {expandedClosureIds.has(closure.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </button>
                              ) : (
                                <span className="w-6 inline-block" />
                              )}
                            </td>
                            <td className="px-2 py-3 text-center whitespace-nowrap">
                              <button
                                onClick={() => toggleClosureSelection(closure.id)}
                                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                                title={selectedClosureIds.has(closure.id) ? 'Remover seleção' : 'Selecionar'}
                              >
                                {selectedClosureIds.has(closure.id) ? (
                                  <CheckSquare size={18} className="text-blue-600" />
                                ) : (
                                  <Square size={18} className="text-gray-400" />
                                )}
                              </button>
                            </td>
                            <td className="px-3 py-3 text-center text-sm text-gray-500 dark:text-gray-400">
                              {index + 1}
                            </td>
                            {/* Coluna Início */}
                            <td className="px-3 py-3">
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-sm text-gray-900 dark:text-white whitespace-nowrap">
                                  {new Date(closure.period_start_date).toLocaleDateString('pt-BR')}
                                </span>
                                <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                                  {new Date(closure.period_start_date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </td>
                            {/* Coluna Fim */}
                            <td className="px-3 py-3">
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-sm text-gray-900 dark:text-white whitespace-nowrap">
                                    {new Date(closure.closing_date).toLocaleDateString('pt-BR')}
                                  </span>
                                  <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                                    {new Date(closure.closing_date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                {closure.notes && (
                                  <span className="text-xs text-gray-600 dark:text-gray-400">• {closure.notes}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              {/* Conta Principal: exibe viewerCard (conta logada) */}
                              {viewerCard?.account_id ? (
                                <SharedAccountDisplay
                                  account={{
                                    id: viewerCard.account_id || 0,
                                    name: viewerCard.account_name,
                                    bank: {
                                      code: viewerCard.bank_code || '',
                                      name: viewerCard.bank_name || ''
                                    },
                                    agency: viewerCard.agency,
                                    account_number: viewerCard.account_number
                                  }}
                                />
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              {/* Contraparte: exibe otherCard (outra conta) */}
                              {(() => {
                                const otherCard = isCounterpart ? mainCard : partnerCard
                                return otherCard?.account_id ? (
                                  <SharedAccountDisplay
                                    account={{
                                      id: otherCard.account_id || 0,
                                      name: otherCard.account_name,
                                      bank: {
                                        code: otherCard.bank_code || '',
                                        name: otherCard.bank_name || ''
                                      },
                                      agency: otherCard.agency,
                                      account_number: otherCard.account_number
                                    }}
                                  />
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )
                              })()}
                            </td>
                            <td className="px-3 py-3 text-left whitespace-nowrap text-green-600 dark:text-green-400">
                              {formatCurrency(displayToReceive)}
                            </td>
                            <td className="px-3 py-3 text-left whitespace-nowrap text-red-600 dark:text-red-400">
                              {formatCurrency(-displayToPay)}
                            </td>
                            <td className="px-3 py-3 text-center">
                              {hasLoanPayments ? (
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-600" title="Possui liquidações de empréstimos">
                                  <Check size={14} className="text-white" />
                                </span>
                              ) : (
                                <span className="text-gray-400 dark:text-gray-500">-</span>
                              )}
                            </td>
                            {/* Coluna Pagamentos (antes do Saldo) */}
                            <td className="px-3 py-3 text-center whitespace-nowrap">
                              {(() => {
                                const totalPaid = parseFloat(String(closure.total_paid ?? 0))
                                const paymentsCount = (closure.closure_payments || []).length
                                return paymentsCount > 0 ? (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                                      <CreditCard size={11} />
                                      {paymentsCount}
                                    </span>
                                    <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">{formatCurrency(totalPaid)}</span>
                                  </div>
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-600">—</span>
                                )
                              })()}
                            </td>
                            {/* Coluna Saldo — mostra saldo restante (o que falta pagar) */}
                            {(() => {
                              const totalPaid = parseFloat(String(closure.total_paid ?? 0))
                              const remaining = closure.is_settled ? 0 : (parseFloat(String(closure.remaining_balance ?? Math.abs(displayNetBalance))) - 0)
                              const displayBalance = totalPaid > 0 ? remaining : displayNetBalance
                              const isRemainingView = totalPaid > 0
                              return (
                                <td className={`px-3 py-3 text-left whitespace-nowrap ${
                                  displayBalance > 0
                                    ? 'text-green-600 dark:text-green-400'
                                    : displayBalance < 0
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-gray-600 dark:text-gray-400'
                                }`}>
                                  <div className="flex flex-col">
                                    <span>{formatCurrency(displayBalance)}</span>
                                    {isRemainingView && (
                                      <span className="text-[10px] text-gray-400 dark:text-gray-500">restante</span>
                                    )}
                                  </div>
                                </td>
                              )
                            })()}
                            <td className="px-3 py-3 text-left">
                              {closure.is_settled ? (
                                <span
                                  className="inline-block px-3 py-1 text-xs font-medium rounded text-center"
                                  style={{
                                    backgroundColor: 'var(--status-success)',
                                    color: '#FFFFFF'
                                  }}
                                >
                                  Quitado
                                </span>
                              ) : (
                                <span
                                  className="inline-block px-3 py-1 text-xs font-medium rounded text-center"
                                  style={{
                                    backgroundColor: 'var(--status-warning)',
                                    color: '#FFFFFF'
                                  }}
                                >
                                  Pendente
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-left">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleViewClosureDetails(closure)}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all"
                                  title="Ver detalhes do fechamento"
                                >
                                  <Eye size={15} />
                                </button>
                                <button
                                  onClick={() => { setExportTargetClosure(closure as any); setShowExportModal(true) }}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all"
                                  title="Exportar fechamento"
                                >
                                  <Download size={15} />
                                </button>
                                <button
                                  onClick={() => {
                                    setJsonClosureData(closure.closure_data)
                                    setShowJsonModal(true)
                                    setJsonCopied(false)
                                  }}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all"
                                  title="Ver JSON completo"
                                >
                                  <Braces size={15} />
                                </button>
                                {/* Botão Adicionar Pagamento Parcial */}
                                {!closure.is_settled && (() => {
                                  const noBalance = parseFloat(String(closure.remaining_balance ?? Math.abs(parseFloat(String(closure.net_balance ?? 0))))) <= 0.01
                                  return (
                                    <button
                                      onClick={() => !noBalance && openPaymentModal(closure)}
                                      disabled={noBalance}
                                      className={`p-1.5 rounded-lg transition-all ${noBalance ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'}`}
                                      title={noBalance ? 'Saldo zerado' : 'Registrar pagamento parcial'}
                                    >
                                      <CreditCard size={15} />
                                    </button>
                                  )
                                })()}
                                {!closure.is_settled ? (
                                  <button
                                    onClick={() => {
                                      setSelectedClosure(closure)
                                      setShowSettleModal(true)
                                    }}
                                    className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-all"
                                    title="Marcar como quitado"
                                  >
                                    <CheckCircle size={15} />
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleUnsettleClosure(closure)}
                                    className="p-1.5 text-green-600 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-all"
                                    title="Remover quitação"
                                  >
                                    <CheckCircle size={15} />
                                  </button>
                                )}
                                {/* Botão Remover Liquidações de Empréstimos - sempre visível, desabilitado se não tiver empréstimos ou estiver quitado */}
                                <button
                                  onClick={() => hasLoanPayments && !closure.is_settled && handleOpenRemoveLoanPaymentsModal(closure)}
                                  disabled={!hasLoanPayments || closure.is_settled}
                                  className={`p-1.5 rounded-lg transition-all ${
                                    hasLoanPayments && !closure.is_settled
                                      ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 cursor-pointer'
                                      : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                  }`}
                                  title={
                                    closure.is_settled
                                      ? "Remova a quitação para poder remover liquidações de empréstimos"
                                      : hasLoanPayments
                                        ? "Remover liquidações de empréstimos deste fechamento"
                                        : "Este fechamento não possui liquidações de empréstimos"
                                  }
                                >
                                  <Banknote size={15} />
                                </button>
                                {/* Botão Excluir Fechamento - só aparece para fechamentos não quitados */}
                                {!closure.is_settled && (
                                  <button
                                    onClick={() => handleReopenClosure(closure)}
                                    className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                                    title="Excluir fechamento"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {/* Sub-linha expansível: histórico de pagamentos parciais */}
                          {expandedClosureIds.has(closure.id) && (closure.closure_payments || []).length > 0 && (
                            <tr className="bg-indigo-50 dark:bg-indigo-900/10">
                              <td colSpan={14} className="px-6 py-3">
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center gap-2 mb-1">
                                    <CreditCard size={14} className="text-indigo-600 dark:text-indigo-400" />
                                    <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">
                                      Histórico de Pagamentos Parciais
                                    </span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
                                      Total pago: <span className="font-semibold text-green-600 dark:text-green-400">{formatCurrency(parseFloat(String(closure.total_paid ?? 0)))}</span>
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-1 gap-1">
                                    {(closure.closure_payments || []).map((payment) => (
                                      <div key={payment.id} className="flex items-center gap-3 text-xs bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-indigo-100 dark:border-indigo-800">
                                        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                          {new Date(payment.payment_date).toLocaleDateString('pt-BR')}
                                        </span>
                                        <span className="font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">
                                          {formatCurrency(parseFloat(String(payment.amount)))}
                                        </span>
                                        {payment.notes && (
                                          <span className="text-gray-600 dark:text-gray-400 truncate flex-1">
                                            {payment.notes}
                                          </span>
                                        )}
                                        {!closure.is_settled && (
                                          <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                                            <button
                                              onClick={() => openEditPayment(payment, closure)}
                                              className="p-1 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded transition-all"
                                              title="Editar pagamento"
                                            >
                                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                            </button>
                                            <button
                                              onClick={() => handleDeletePayment(closure, payment.id)}
                                              className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-all"
                                              title="Remover pagamento"
                                            >
                                              <Trash2 size={12} />
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                          </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Loading Closures */}
            {closuresLoading && activeTab === 'closures' && (
              <div className="p-12 text-center">
                <LoadingSpinner message="Carregando fechamentos..." />
              </div>
            )}

            {/* Empty State */}
            {!loading && !selectedPartnerAccountId && (
              <div className="p-12 text-center">
                <div className="flex flex-col items-center gap-4">
                  <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-full">
                    <Scale className="h-12 w-12 text-gray-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Selecione uma conta compartilhada</h3>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                      Escolha uma conta compartilhada nos filtros acima para visualizar o balanço.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Barra Flutuante de Ações em Lote - Fixed no rodapé, respeita o sidebar */}
        {activeTab === 'closures' && selectedClosureIds.size > 0 && (() => {
          const hasSettledSelected = closures.some(c => selectedClosureIds.has(c.id) && c.is_settled)
          const hasUnsettledSelected = closures.some(c => selectedClosureIds.has(c.id) && !c.is_settled)
          return (
            <div className="fixed bottom-0 left-64 right-0 z-50 bg-white dark:bg-gray-800 border-t-2 border-color-primary shadow-[0_-4px_12px_rgba(0,0,0,0.15)] px-6 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="font-medium text-color-primary">
                    {selectedClosureIds.size} fechamento(s) selecionado(s)
                  </span>
                  <button
                    onClick={() => setSelectedClosureIds(new Set())}
                    className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex items-center gap-1"
                  >
                    <X size={14} />
                    Limpar seleção
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleBulkSettle}
                    disabled={bulkActionLoading || !hasUnsettledSelected}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg transition-all font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md hover:opacity-90 whitespace-nowrap text-white bg-green-600 hover:bg-green-700"
                    title={hasUnsettledSelected ? 'Quitar os fechamentos não-quitados selecionados' : 'Nenhum fechamento não-quitado selecionado'}
                  >
                    <Lock size={14} />
                    Quitar
                  </button>
                  <button
                    onClick={handleBulkUnsettle}
                    disabled={bulkActionLoading || !hasSettledSelected}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg transition-all font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md hover:opacity-90 whitespace-nowrap text-white"
                    style={{ backgroundColor: 'var(--crud-edit)' }}
                    title={hasSettledSelected ? 'Remover quitação dos fechamentos quitados selecionados' : 'Nenhum fechamento quitado selecionado'}
                  >
                    <Unlock size={14} />
                    Abrir Quitados
                  </button>
                  <button
                    onClick={handleBulkReopen}
                    disabled={bulkActionLoading}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg transition-all font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md hover:opacity-90 whitespace-nowrap text-white"
                    style={{ backgroundColor: 'var(--crud-delete)' }}
                    title="Excluir todos os fechamentos selecionados"
                  >
                    <Trash2 size={14} />
                    Excluir
                  </button>
                  {/* Botão Back to Top dentro da barra de ações */}
                  {showClosuresBackToTop && (
                    <button
                      onClick={scrollToTopClosures}
                      className="px-3 py-1.5 bg-color-primary text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold"
                      title="Voltar ao topo"
                    >
                      <ArrowUp size={14} />
                      Topo
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Barra Flutuante Back to Top - Aparece só quando não há seleção */}
        {activeTab === 'closures' && showClosuresBackToTop && selectedClosureIds.size === 0 && (
          <div className="fixed bottom-0 left-64 right-0 z-50 bg-white dark:bg-gray-800 border-t-2 border-color-primary shadow-[0_-4px_12px_rgba(0,0,0,0.15)] px-6 py-3">
            <div className="flex items-center justify-end">
              <button
                onClick={scrollToTopClosures}
                className="px-3 py-1.5 bg-color-primary text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold"
                title="Voltar ao topo"
              >
                <ArrowUp size={14} />
                Voltar ao Topo
              </button>
            </div>
          </div>
        )}

        {/* Modals */}
        {/* Modal: Confirmar Fechamento */}
        {showClosureModal && balanceData && (
          <ClosureModal
            isOpen={showClosureModal}
            onClose={() => {
              setShowClosureModal(false)
              setClosureNotes('')
            }}
            onConfirm={handleCreateClosure}
            closureNotes={closureNotes}
            setClosureNotes={setClosureNotes}
            selectedYear={selectedYear}
            periodStart={balanceData.start_date}
            periodEnd={balanceData.end_date}
            lastClosureTimestamp={lastClosureTimestamp}
            calculationTimestamp={calculationTimestamp}
          />
        )}

        {/* Modal: Sugestão de Datas */}
        {showDateSuggestionModal && dateSuggestion && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                    <AlertTriangle size={24} className="text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Conflito de Período</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Ajuste necessário nas datas</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowDateSuggestionModal(false)
                    setDateSuggestion(null)
                  }}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <X size={20} className="text-gray-500" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-6">
                {/* Mensagem de erro */}
                <div className="p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                  <p className="text-sm text-orange-800 dark:text-orange-200">
                    {dateSuggestion.message}
                  </p>
                </div>

                {/* Comparação de datas */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Data Atual */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Datas Atuais</h3>
                    {dateSuggestion.conflictType === 'start_date' || dateSuggestion.conflictType === 'both' ? (
                      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Data Inicial</p>
                        <p className="text-sm font-medium text-red-700 dark:text-red-300">
                          {balanceData ? new Date(balanceData.start_date).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          }) : startDate}
                        </p>
                      </div>
                    ) : null}
                    {dateSuggestion.conflictType === 'end_date' || dateSuggestion.conflictType === 'both' ? (
                      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Data Final</p>
                        <p className="text-sm font-medium text-red-700 dark:text-red-300">
                          {balanceData ? new Date(balanceData.end_date).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          }) : endDate}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {/* Data Sugerida */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Datas Sugeridas</h3>
                    {dateSuggestion.suggestedStartDate && (
                      <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Data Inicial</p>
                        <p className="text-sm font-medium text-green-700 dark:text-green-300">
                          {new Date(dateSuggestion.suggestedStartDate.replace(' ', 'T')).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </p>
                      </div>
                    )}
                    {dateSuggestion.suggestedEndDate && (
                      <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Data Final</p>
                        <p className="text-sm font-medium text-green-700 dark:text-green-300">
                          {new Date(dateSuggestion.suggestedEndDate.replace(' ', 'T')).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Aviso */}
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-xs text-blue-800 dark:text-blue-200">
                    <strong>Nota:</strong> Ao aceitar, as datas serão atualizadas automaticamente e o balanço será recalculado.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => {
                    setShowDateSuggestionModal(false)
                    setDateSuggestion(null)
                  }}
                  className="px-4 py-2 text-sm font-medium rounded-lg transition-all hover:opacity-90"
                  style={{ backgroundColor: 'var(--crud-cancel)', color: 'var(--on-crud-cancel)' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAcceptDateSuggestion}
                  className="px-4 py-2 text-sm font-medium text-white bg-color-primary hover:opacity-90 rounded-lg transition-all flex items-center gap-2"
                >
                  <CheckCircle size={16} />
                  Aceitar e Recalcular
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Detalhes do Fechamento - Itens */}
        {showDetailsModal && selectedClosure && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-[95vw] h-[90vh] flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-color-primary-light rounded-lg">
                    <Receipt size={24} className="text-color-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                      Itens do Fechamento - {String(selectedClosure.month).padStart(2, '0')}/{selectedClosure.year}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {closureItems.length} itens • {new Date(selectedClosure.period_start_date).toLocaleDateString('pt-BR')} a {new Date(selectedClosure.closing_date).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowDetailsModal(false)
                    setSelectedClosure(null)
                    setClosureItems([])
                    setClosureLoanPayments([])
                    setIsClosurePartnerView(false)
                  }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  ✕
                </button>
              </div>

              {/* Tabela de Itens - Scrollable */}
              <div className="flex-1 overflow-auto px-6 pb-4">
                <table className="w-full text-sm min-w-[1200px]">
                  <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10 shadow-sm">
                    <tr className="border-l-4 border-l-gray-300 dark:border-l-gray-600 border-b border-gray-300 dark:border-gray-600">
                      <th className="text-center p-3 font-semibold text-gray-700 dark:text-gray-300 w-12">#</th>
                      <th className="text-center p-3 font-semibold text-gray-700 dark:text-gray-300 w-12">Fonte</th>
                      <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-300">Data</th>
                      <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-300">Descrição</th>
                      <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-300">Cartão</th>
                      <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-300">Tag/Subtag</th>
                      <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-300">Conta Contraparte</th>
                      <th className="text-right p-3 font-semibold text-gray-700 dark:text-gray-300">Valor Total</th>
                      <th className="text-center p-3 font-semibold text-gray-700 dark:text-gray-300">%</th>
                      <th className="text-right p-3 font-semibold text-gray-700 dark:text-gray-300">Minha Parte</th>
                      <th className="text-right p-3 font-semibold text-gray-700 dark:text-gray-300">Contraparte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closureItems.map((item, index) => {
                      // Porcentagens originais do JSON (perspectiva de quem criou o fechamento)
                      const originalMyPercentage = parseFloat(item.my_contribution_percentage || '0')
                      const originalPartnerPercentage = parseFloat(item.partner_contribution_percentage || '0')

                      // Se should_invert = true, a conta logada é a contraparte, então inverte as porcentagens
                      const myPercentage = item.should_invert ? originalPartnerPercentage : originalMyPercentage
                      const partnerPercentage = item.should_invert ? originalMyPercentage : originalPartnerPercentage

                      // Valor total com sinal original
                      const rawAmount = parseFloat(item.amount)
                      const totalAmount = Math.abs(rawAmount)

                      // Valores com sinal para determinar cor (negativo = vermelho, positivo = verde)
                      const myValueSigned = rawAmount * (myPercentage / 100)
                      const partnerValueSigned = rawAmount * (partnerPercentage / 100)

                      // Valores absolutos para exibição
                      const myValue = Math.abs(myValueSigned)
                      const partnerValue = Math.abs(partnerValueSigned)

                      // Determinar se é negativo (despesa) ou positivo (receita)
                      const isNegative = rawAmount < 0

                      return (
                        <tr
                          key={`${item.id}-${index}`}
                          className="border-l-4 border-l-gray-300 dark:border-l-gray-600 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderLeftColor = ''
                          }}
                        >
                          <td className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">
                            {index + 1}
                          </td>
                          <td className="p-3 text-center">
                            {item.source_type === 'Conta Bancária' && <Landmark size={16} className="inline text-blue-600 dark:text-blue-400" />}
                            {item.source_type === 'Cartão de Crédito' && <CreditCard size={16} className="inline text-color-primary" />}
                            {item.source_type === 'Cartão Benefício' && <Gift size={16} className="inline text-green-600 dark:text-green-400" />}
                          </td>
                          <td className="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                            {item.date.includes('T')
                              ? new Date(item.date).toLocaleString('pt-BR', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })
                              : new Date(item.date).toLocaleDateString('pt-BR')
                            }
                          </td>
                          <td className="p-3 text-gray-900 dark:text-white font-medium">
                            {item.description || 'Sem descrição'}{item.current_installment && item.total_installments && item.total_installments > 1 ? ` ${item.current_installment}/${item.total_installments}` : ''}
                          </td>
                          <td className="p-3 text-gray-900 dark:text-white text-xs">
                            {item.card_name ? (
                              <div>
                                <span className="font-medium">{item.card_name}</span>
                                <span className="text-gray-500 dark:text-gray-400 text-[10px] ml-1">•••• {item.card_number}</span>
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="p-3 text-gray-500 dark:text-gray-400">
                            {item.tag_name ? (
                              <>{item.tag_name}{item.subtag_name && ` > ${item.subtag_name}`}</>
                            ) : '-'}
                          </td>
                          <td className="p-3 text-left">
                            <SharedAccountDisplay
                              account={item.counterpart_account ? {
                                id: 0,
                                name: item.counterpart_account.name,
                                bank: item.counterpart_account.bank ? { name: item.counterpart_account.bank } : null,
                                agency: item.counterpart_account.agency,
                                account_number: item.counterpart_account.number
                              } : null}
                              ownershipPercentage={item.should_invert
                                ? parseFloat(item.my_contribution_percentage || '0')
                                : parseFloat(item.partner_contribution_percentage || '0')}
                            />
                          </td>
                          <td className={`p-3 text-right whitespace-nowrap ${
                            totalAmount === 0 ? 'text-gray-900 dark:text-gray-100' : isNegative ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                          }`}>
                            {totalAmount === 0 ? '' : isNegative ? '-' : ''}{formatCurrency(totalAmount)}
                          </td>
                          <td className="p-3 text-center text-gray-700 dark:text-gray-300 font-medium">
                            {myPercentage.toFixed(0)}%
                          </td>
                          <td className={`p-3 text-right whitespace-nowrap ${
                            myValue === 0 ? 'text-gray-900 dark:text-gray-100' : myValueSigned < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                          }`}>
                            {myValue === 0 ? '' : myValueSigned < 0 ? '-' : ''}{formatCurrency(myValue)}
                          </td>
                          <td className={`p-3 text-right whitespace-nowrap ${
                            partnerValue === 0 ? 'text-gray-900 dark:text-gray-100' : partnerValueSigned < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                          }`}>
                            {partnerValue === 0 ? '' : partnerValueSigned < 0 ? '-' : ''}{formatCurrency(partnerValue)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {/* Seção de Empréstimos Liquidados (se houver) */}
                {closureLoanPayments.length > 0 && (
                  <div className="mt-6 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 flex items-center gap-2 border-b border-gray-200 dark:border-gray-700">
                      <Banknote size={18} className="text-color-primary" />
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                        Empréstimos Liquidados ({closureLoanPayments.length})
                      </h4>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr className="border-l-4 border-l-gray-300 dark:border-l-gray-600 border-b border-gray-200 dark:border-gray-700">
                          <th className="text-center p-3 font-semibold text-gray-600 dark:text-gray-400 w-12">#</th>
                          <th className="text-left p-3 font-semibold text-gray-600 dark:text-gray-400">Tipo</th>
                          <th className="text-left p-3 font-semibold text-gray-600 dark:text-gray-400">Descrição</th>
                          <th className="text-right p-3 font-semibold text-gray-600 dark:text-gray-400">Principal</th>
                          <th className="text-right p-3 font-semibold text-gray-600 dark:text-gray-400">Saldo Corrigido</th>
                          <th className="text-right p-3 font-semibold text-gray-600 dark:text-gray-400">Valor Quitado</th>
                          <th className="text-right p-3 font-semibold text-gray-600 dark:text-gray-400">Saldo Restante</th>
                          <th className="text-center p-3 font-semibold text-gray-600 dark:text-gray-400">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {closureLoanPayments.map((payment, index) => {
                          // Tipo original do empréstimo (perspectiva de quem criou o fechamento)
                          const originalIsLent = payment.loan_type === 'lent'
                          // Inverter perspectiva se estamos vendo como contraparte
                          const isLent = isClosurePartnerView ? !originalIsLent : originalIsLent

                          // TODOS OS VALORES SEMPRE POSITIVOS - badge indica a direção
                          const originalDisplay = Math.abs(payment.original_amount || 0)
                          const beforeDisplay = Math.abs(payment.remaining_before || 0)
                          const paidDisplay = Math.abs(payment.amount_paid || 0)
                          const afterDisplay = Math.abs(payment.remaining_after || 0)

                          // Cores baseadas na direção (não no sinal)
                          const valueColor = isLent
                            ? 'text-green-600 dark:text-green-400'  // A receber
                            : 'text-red-600 dark:text-red-400'       // A pagar

                          // Saldo restante: cinza se zero, senão cor baseada na direção
                          const remainingColor = afterDisplay < 0.01
                            ? 'text-gray-500 dark:text-gray-400'
                            : valueColor

                          // Status: Quitado se saldo restante for zero, senão Aberto
                          const isSettled = afterDisplay < 0.01

                          return (
                            <tr
                              key={index}
                              className="border-l-4 border-l-gray-300 dark:border-l-gray-600 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                              onMouseEnter={(e) => {
                                e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderLeftColor = ''
                              }}
                            >
                              <td className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">
                                {index + 1}
                              </td>
                              <td className="p-3">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium w-[100px] justify-center text-white ${
                                    isLent ? 'bg-green-600' : 'bg-red-600'
                                  }`}
                                >
                                  {isLent ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                                  {isLent ? 'A Receber' : 'A Pagar'}
                                </span>
                              </td>
                              <td className="p-3 text-gray-900 dark:text-white">
                                {payment.description || 'Empréstimo'}
                              </td>
                              <td className="p-3 text-right text-gray-900 dark:text-gray-100">
                                {formatCurrency(originalDisplay)}
                              </td>
                              <td className={`p-3 text-right ${valueColor}`}>
                                {formatCurrency(beforeDisplay)}
                              </td>
                              <td className={`p-3 text-right ${valueColor}`}>
                                {formatCurrency(paidDisplay)}
                              </td>
                              <td className={`p-3 text-right ${remainingColor}`}>
                                {formatCurrency(afterDisplay)}
                              </td>
                              <td className="p-3 text-center">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium w-[100px] justify-center text-white ${
                                    isSettled ? 'bg-green-600' : 'bg-blue-600'
                                  }`}
                                >
                                  <span className="text-sm font-bold">{isSettled ? '✓' : '○'}</span>
                                  {isSettled ? 'Quitado' : 'Aberto'}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Footer com Totais e Botão Fechar */}
              <div className="border-t border-gray-200 dark:border-gray-700 p-6 bg-gray-50 dark:bg-gray-700 flex-shrink-0">
                <div className="flex items-center justify-between mb-4">
                  {/* Legenda */}
                  <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
                    <div className="flex items-center gap-1.5">
                      <Landmark size={14} className="text-blue-600 dark:text-blue-400" />
                      <span>Conta Bancária</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CreditCard size={14} className="text-color-primary" />
                      <span>Cartão de Crédito</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Gift size={14} className="text-green-600 dark:text-green-400" />
                      <span>Cartão Benefício</span>
                    </div>
                    {closureLoanPayments.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Banknote size={14} className="text-amber-600 dark:text-amber-400" />
                        <span>Empréstimo</span>
                      </div>
                    )}
                  </div>

                  {/* Totais */}
                  {(() => {
                    // Cada card (main e partner) tem seus próprios valores de A Receber/A Pagar
                    // A conta logada deve ver os valores do SEU card
                    const closureData = selectedClosure?.closure_data || {}
                    const mainCard = closureData.main_account_card || {}
                    const partnerCard = closureData.partner_account_card || {}

                    // Selecionar o card correto baseado na conta logada
                    const viewerCard = isClosurePartnerView ? partnerCard : mainCard

                    // Valores do card da conta logada
                    const totalToReceive = parseFloat(viewerCard.total_to_receive ?? 0)
                    const totalToPay = Math.abs(parseFloat(viewerCard.total_to_pay ?? 0))
                    const loanToReceive = parseFloat(viewerCard.loan_to_receive ?? 0)
                    const loanToPay = Math.abs(parseFloat(viewerCard.loan_to_pay ?? 0))

                    // A Receber = total_to_receive + loan_to_receive
                    const displayToReceive = totalToReceive + loanToReceive
                    // A Pagar = |total_to_pay| + |loan_to_pay|
                    const displayToPay = totalToPay + loanToPay

                    // Saldo = A Receber - A Pagar
                    const displayBalance = displayToReceive - displayToPay

                    return (
                      <div className="flex items-center gap-6">
                        {/* Saldo primeiro */}
                        <div className="text-right">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Saldo ({closureItems.length} {closureItems.length === 1 ? 'item' : 'itens'}
                            {closureLoanPayments.length > 0 && ` + ${closureLoanPayments.length} empréstimo${closureLoanPayments.length > 1 ? 's' : ''}`})
                          </div>
                          <span className={`text-lg font-bold ${
                            displayBalance === 0 ? 'text-gray-900 dark:text-gray-100' : displayBalance > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                          }`}>
                            {displayBalance < 0 ? '-' : ''}{formatCurrency(Math.abs(displayBalance))}
                          </span>
                        </div>

                        {/* Divisor vertical */}
                        <div className="h-10 w-px bg-gray-300 dark:bg-gray-600"></div>

                        {/* Total a Receber */}
                        <div className="text-right">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total a Receber</div>
                          <span className={`text-lg font-bold ${
                            displayToReceive === 0 ? 'text-gray-900 dark:text-gray-100' : 'text-green-600 dark:text-green-400'
                          }`}>
                            {formatCurrency(displayToReceive)}
                          </span>
                        </div>

                        {/* Divisor horizontal */}
                        <div className="h-10 w-px bg-gray-300 dark:bg-gray-600"></div>

                        {/* Total a Pagar */}
                        <div className="text-right">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total a Pagar</div>
                          <span className={`text-lg font-bold ${
                            displayToPay === 0 ? 'text-gray-900 dark:text-gray-100' : 'text-red-600 dark:text-red-400'
                          }`}>
                            -{formatCurrency(displayToPay)}
                          </span>
                        </div>
                      </div>
                    )
                  })()}
                </div>

                {/* Botão Fechar */}
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setShowDetailsModal(false)
                      setSelectedClosure(null)
                      setClosureItems([])
                      setClosureLoanPayments([])
                      setIsClosurePartnerView(false)
                    }}
                    className="px-4 py-2 rounded-lg transition-all font-semibold hover:opacity-90"
                    style={{ backgroundColor: 'var(--crud-cancel)', color: 'var(--on-crud-cancel)' }}
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Reabrir (Remover Quitação) */}
        {showUnsettleModal && unsettleClosure && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md">
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <Unlock size={20} className="text-amber-500" />
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Remover Quitação</h2>
                </div>
                <button
                  onClick={() => { setShowUnsettleModal(false); setUnsettleClosure(null) }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >✕</button>
              </div>

              <div className="p-5">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Fechamento <strong>{String(unsettleClosure.month).padStart(2, '0')}/{unsettleClosure.year}</strong> será reaberto.
                </p>

                {/* Lista de pagamentos existentes */}
                {(unsettleClosure.closure_payments || []).filter(p => p.active !== false).length > 0 ? (
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Pagamentos registrados</p>
                    <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 max-h-48 overflow-y-auto">
                      {(unsettleClosure.closure_payments || []).filter(p => p.active !== false).map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                          <span className="text-gray-600 dark:text-gray-400">
                            {p.payment_date ? new Date(p.payment_date).toLocaleDateString('pt-BR') : '—'}
                            {p.notes && <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">({p.notes})</span>}
                          </span>
                          <span className="font-semibold text-green-600 dark:text-green-400">
                            {formatCurrency(parseFloat(String(p.amount ?? 0)))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic mb-4">Nenhum pagamento registrado.</p>
                )}

                {/* Botões de ação */}
                <div className="flex flex-col gap-2">
                  {(unsettleClosure.closure_payments || []).filter(p => p.active !== false).length > 0 && (
                    <button
                      onClick={() => handleConfirmUnsettle(true)}
                      disabled={unsettleClearingAll}
                      className="w-full px-4 py-2 rounded-lg font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                      style={{ backgroundColor: 'var(--crud-delete)', color: 'var(--on-crud-delete)' }}
                    >
                      <Trash2 size={15} />
                      {unsettleClearingAll ? 'Removendo...' : 'Reabrir e limpar todos os pagamentos'}
                    </button>
                  )}
                  <button
                    onClick={() => handleConfirmUnsettle(false)}
                    disabled={unsettleClearingAll}
                    className="w-full px-4 py-2 rounded-lg font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ backgroundColor: 'var(--crud-edit)', color: 'var(--on-crud-edit)' }}
                  >
                    <Unlock size={15} />
                    Reabrir sem alterar pagamentos
                  </button>
                  <button
                    onClick={() => { setShowUnsettleModal(false); setUnsettleClosure(null) }}
                    disabled={unsettleClearingAll}
                    className="w-full px-4 py-2 rounded-lg font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: 'var(--crud-cancel)', color: 'var(--on-crud-cancel)' }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Marcar como Quitado */}
        {showSettleModal && selectedClosure && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--status-success) 15%, transparent)' }}>
                    <CheckCircle size={24} style={{ color: 'var(--status-success)' }} />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">Marcar como Quitado</h3>
                </div>
                <button
                  onClick={() => {
                    setShowSettleModal(false)
                    setSettlementNotes('')
                  }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  ✕
                </button>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Confirma a quitação do fechamento de <strong>{String(selectedClosure.month).padStart(2, '0')}/{selectedClosure.year}</strong>?
              </p>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Observações da quitação (opcional)
                </label>
                <textarea
                  value={settlementNotes}
                  onChange={(e) => setSettlementNotes(e.target.value)}
                  placeholder="Ex: Pago via PIX, Transferência bancária, etc."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  rows={3}
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowSettleModal(false)
                    setSettlementNotes('')
                  }}
                  className="flex-1 px-4 py-2 rounded-lg hover:opacity-90 transition-all font-semibold"
                  style={{ backgroundColor: 'var(--crud-cancel)', color: 'var(--on-crud-cancel)' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSettleClosure}
                  className="flex-1 px-4 py-2 rounded-lg hover:opacity-90 transition-all font-semibold"
                  style={{ backgroundColor: 'var(--crud-create)', color: 'var(--on-crud-create)' }}
                >
                  Confirmar Quitação
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Registrar Pagamento Parcial */}
        {showPaymentModal && paymentClosure && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <CreditCard size={20} className="text-color-primary" />
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Registrar Pagamento Parcial</h2>
                </div>
                <button
                  onClick={() => { setShowPaymentModal(false); setPaymentClosure(null) }}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                {(() => {
                  const remaining = parseFloat(String(paymentClosure.remaining_balance ?? Math.abs(paymentClosure.net_balance ?? 0)))
                  const isFullyPaid = remaining <= 0
                  return (
                    <div className={`p-3 rounded-lg text-sm border ${isFullyPaid ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'}`}>
                      <p className="text-gray-600 dark:text-gray-400 text-xs mb-1">Saldo devedor restante</p>
                      <p className={`font-bold text-lg ${isFullyPaid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {isFullyPaid ? formatCurrency(0) : `- ${formatCurrency(remaining)}`}
                      </p>
                    </div>
                  )
                })()}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Valor do Pagamento *</label>
                  <div className="relative">
                    <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold ${parseInt(paymentAmountCents || '0') > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}`}>R$</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatAmountMask(paymentAmountCents)}
                      onChange={handlePaymentAmountChange}
                      className={`w-full pl-9 pr-3 py-2 border rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 ring-color-primary ${
                        parseInt(paymentAmountCents || '0') > 0
                          ? 'border-green-400 dark:border-green-600 text-green-700 dark:text-green-300 font-semibold'
                          : 'border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white'
                      }`}
                      placeholder="0,00"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Data do Pagamento *</label>
                  <DatePicker
                    selected={paymentDate}
                    onChange={(date: Date | null) => setPaymentDate(date)}
                    dateFormat="dd/MM/yyyy"
                    placeholderText="Selecione a data..."
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 ring-color-primary"
                    maxDate={new Date()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Observações</label>
                  <input
                    type="text"
                    value={paymentNotes}
                    onChange={e => setPaymentNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 ring-color-primary"
                    placeholder="Ex: Transferência PIX..."
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => { setShowPaymentModal(false); setPaymentClosure(null) }}
                  className="px-4 py-2 rounded-lg font-semibold transition-all hover:opacity-90"
                  style={{ backgroundColor: 'var(--crud-cancel)', color: 'var(--on-crud-cancel)' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddPayment}
                  disabled={!paymentAmountCents || parseInt(paymentAmountCents) === 0 || !paymentDate || isSubmittingPayment}
                  className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 transition-all ${
                    !paymentAmountCents || parseInt(paymentAmountCents) === 0 || !paymentDate || isSubmittingPayment
                      ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                      : 'text-white hover:opacity-90'
                  }`}
                  style={paymentAmountCents && parseInt(paymentAmountCents) > 0 && paymentDate && !isSubmittingPayment ? { backgroundColor: 'var(--crud-create)' } : undefined}
                >
                  {isSubmittingPayment ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Salvando...</> : <><Check size={16} />Registrar Pagamento</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Editar Pagamento */}
        {showEditPaymentModal && editingPaymentClosure && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <CreditCard size={20} className="text-color-primary" />
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Editar Pagamento</h2>
                </div>
                <button onClick={closeEditPaymentModal} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                {/* Valor */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor</label>
                  <div className="relative">
                    <span className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold text-sm ${parseInt(editPaymentCents || '0') > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>R$</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatAmountMask(editPaymentCents)}
                      onChange={e => setEditPaymentCents(e.target.value.replace(/\D/g, ''))}
                      className={`w-full pl-10 pr-3 py-2.5 border rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 ring-color-primary transition-all ${parseInt(editPaymentCents || '0') > 0 ? 'border-green-400 text-green-700 dark:text-green-300 font-semibold' : 'border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white'}`}
                      placeholder="0,00"
                    />
                  </div>
                </div>
                {/* Data */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data</label>
                  <DatePicker
                    selected={editPaymentDate}
                    onChange={(date: Date | null) => setEditPaymentDate(date)}
                    dateFormat="dd/MM/yyyy"
                    className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 ring-color-primary"
                    maxDate={new Date()}
                    placeholderText="Selecione a data"
                  />
                </div>
                {/* Observações */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Observações <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <input
                    type="text"
                    value={editPaymentNotes}
                    onChange={e => setEditPaymentNotes(e.target.value)}
                    placeholder="Ex: Pago via PIX, Transferência bancária..."
                    className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 ring-color-primary"
                  />
                </div>
              </div>
              <div className="flex gap-3 px-5 pb-5">
                <button
                  onClick={closeEditPaymentModal}
                  className="flex-1 px-4 py-2 rounded-lg font-semibold transition-all hover:opacity-90"
                  style={{ backgroundColor: 'var(--crud-cancel)', color: 'var(--on-crud-cancel)' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSavePaymentEdit}
                  disabled={!editPaymentCents || parseInt(editPaymentCents) === 0 || !editPaymentDate || isSavingPaymentEdit}
                  className="flex-1 px-4 py-2 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white"
                  style={{ backgroundColor: 'var(--crud-create)' }}
                >
                  {isSavingPaymentEdit ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Salvando...</> : <><Check size={16} />Salvar</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Remover Liquidações de Empréstimos */}
        {showRemoveLoanPaymentsModal && removeLoanPaymentsClosure && (() => {
          const loanPayments = getClosureLoanPaymentsList(removeLoanPaymentsClosure)
          const allSelected = selectedLoanIdsToRemove.size === loanPayments.length && loanPayments.length > 0
          const someSelected = selectedLoanIdsToRemove.size > 0 && selectedLoanIdsToRemove.size < loanPayments.length

          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      <Banknote size={20} className="text-amber-600" />
                      Remover Liquidações de Empréstimos
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 flex items-end gap-1 flex-wrap">
                      <span>Período:</span>
                      <span>{new Date(removeLoanPaymentsClosure.period_start_date).toLocaleDateString('pt-BR')}</span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">{new Date(removeLoanPaymentsClosure.period_start_date).toLocaleTimeString('pt-BR')}</span>
                      <span className="mx-0.5">-</span>
                      <span>{new Date(removeLoanPaymentsClosure.closing_date).toLocaleDateString('pt-BR')}</span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">{new Date(removeLoanPaymentsClosure.closing_date).toLocaleTimeString('pt-BR')}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowRemoveLoanPaymentsModal(false)
                      setRemoveLoanPaymentsClosure(null)
                      setSelectedLoanIdsToRemove(new Set())
                    }}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <X size={20} className="text-gray-500" />
                  </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-6">
                  {loanPayments.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      Nenhuma liquidação de empréstimo encontrada neste fechamento.
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Selecione as liquidações que deseja remover. Os empréstimos correspondentes serão reabertos.
                      </p>

                      <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 dark:bg-gray-700/50">
                            <tr>
                              <th className="px-3 py-2 text-left w-10">
                                <button
                                  onClick={() => toggleSelectAllLoans(loanPayments)}
                                  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                                  title={allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                                >
                                  {allSelected ? (
                                    <CheckSquare size={18} className="text-blue-600" />
                                  ) : someSelected ? (
                                    <MinusSquare size={18} className="text-blue-600" />
                                  ) : (
                                    <Square size={18} className="text-gray-400" />
                                  )}
                                </button>
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                                Tipo
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                                Descrição
                              </th>
                              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                                Valor Original
                              </th>
                              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                                Pago
                              </th>
                              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                                Saldo
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {loanPayments.map((payment: any) => {
                              const isSelected = selectedLoanIdsToRemove.has(payment.loan_id)
                              const isLent = payment.loan_type === 'lent'

                              return (
                                <tr
                                  key={payment.loan_id}
                                  className={`border-l-4 transition-all cursor-pointer ${
                                    isSelected
                                      ? 'border-l-blue-600 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                                      : 'border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                                  }`}
                                  onClick={() => toggleLoanSelection(payment.loan_id)}
                                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderLeftColor = 'var(--color-1)' }}
                                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderLeftColor = '' }}
                                >
                                  <td className="px-3 py-2">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        toggleLoanSelection(payment.loan_id)
                                      }}
                                      className="p-1"
                                    >
                                      {isSelected ? (
                                        <CheckSquare size={18} className="text-blue-600" />
                                      ) : (
                                        <Square size={18} className="text-gray-400" />
                                      )}
                                    </button>
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium w-[100px] justify-center text-white ${
                                      isLent ? 'bg-green-600' : 'bg-red-600'
                                    }`}>
                                      {isLent ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                                      {isLent ? 'A Receber' : 'A Pagar'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-gray-900 dark:text-white">
                                    {payment.description}
                                  </td>
                                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">
                                    {formatCurrency(Math.abs(payment.original_amount || 0))}
                                  </td>
                                  <td className={`px-3 py-2 text-right font-medium ${
                                    isLent ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                                  }`}>
                                    {formatCurrency(Math.abs(payment.amount_paid || 0))}
                                  </td>
                                  <td className={`px-3 py-2 text-right ${
                                    Math.abs(payment.remaining_after || 0) < 0.01
                                      ? 'text-gray-400 dark:text-gray-500'
                                      : isLent ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                                  }`}>
                                    {formatCurrency(Math.abs(payment.remaining_after || 0))}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      {selectedLoanIdsToRemove.size > 0 && (
                        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
                          <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                            <AlertTriangle size={16} />
                            <span className="text-sm font-medium">
                              {selectedLoanIdsToRemove.size} liquidação(ões) selecionada(s) para remoção
                            </span>
                          </div>
                          <p className="text-xs text-blue-600 dark:text-blue-500 mt-1 ml-6">
                            Os empréstimos correspondentes serão reabertos e os valores serão recalculados no fechamento.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setShowRemoveLoanPaymentsModal(false)
                      setRemoveLoanPaymentsClosure(null)
                      setSelectedLoanIdsToRemove(new Set())
                    }}
                    className="px-4 py-2 rounded-lg transition-all font-semibold hover:opacity-90"
                    style={{ backgroundColor: 'var(--crud-cancel)', color: 'var(--on-crud-cancel)' }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleConfirmRemoveLoanPayments}
                    disabled={selectedLoanIdsToRemove.size === 0 || removingLoanPayments}
                    className={`px-4 py-2 rounded-lg transition-all font-semibold flex items-center gap-2 ${
                      selectedLoanIdsToRemove.size === 0 || removingLoanPayments
                        ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                        : 'text-white hover:opacity-90'
                    }`}
                    style={selectedLoanIdsToRemove.size > 0 && !removingLoanPayments ? { backgroundColor: 'var(--crud-delete)' } : undefined}
                  >
                    {removingLoanPayments ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Removendo...
                      </>
                    ) : (
                      <>
                        <Trash2 size={16} />
                        Remover Selecionados
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Modal: Ver JSON Completo */}
        {showJsonModal && jsonClosureData && (
          <JsonViewerModal
            isOpen={showJsonModal}
            data={jsonClosureData}
            onClose={() => {
              setShowJsonModal(false)
              setJsonClosureData(null)
              setJsonCopied(false)
            }}
            jsonCopied={jsonCopied}
            onCopy={() => {
              navigator.clipboard.writeText(JSON.stringify(jsonClosureData, null, 2))
              setJsonCopied(true)
              setTimeout(() => setJsonCopied(false), 2000)
            }}
          />
        )}

        {/* Modal de Detalhes de Transações */}
        <BalanceDetailsModal
          isOpen={detailsModal.isOpen}
          onClose={() => setDetailsModal({ ...detailsModal, isOpen: false })}
          title={detailsModal.title}
          type={detailsModal.type}
          accountColor={detailsModal.accountColor}
          expenseItems={detailsModal.expenseItems}
          revenueItems={detailsModal.revenueItems}
          isPartnerAccount={detailsModal.isPartnerAccount}
        />

        {/* Modal de Detalhes Mensais do Histórico */}
        <MonthlyHistoryDetailsModal
          isOpen={monthlyDetailsModal.isOpen}
          onClose={() => setMonthlyDetailsModal({ isOpen: false, data: null, loading: false })}
          data={monthlyDetailsModal.data}
          loading={monthlyDetailsModal.loading}
        />

        {/* Toast de notificações */}
        {toast.show && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast({ ...toast, show: false })}
          />
        )}

        {/* Modal de exportação de fechamento */}
        <ExportClosureModal
          isOpen={showExportModal}
          onClose={() => { setShowExportModal(false); setExportTargetClosure(null) }}
          onExport={(format, absoluteValues) => {
            if (!exportTargetClosure) return
            const closureData = exportTargetClosure.closure_data as any
            const mainCard = closureData?.main_account_card
            const closureMainAccountId = Number(mainCard?.account_id || exportTargetClosure.account_id)
            const isCounterpart = Number(loggedAccountId) !== closureMainAccountId
            if (format === 'pdf') {
              exportBalanceClosureToPDF(exportTargetClosure as any, isCounterpart, absoluteValues)
            } else {
              exportBalanceClosureToExcel(exportTargetClosure as any, absoluteValues, isCounterpart)
            }
          }}
        />

        <ConfirmComponent />
      </div>
    </div>
  )
}

export default BalancoPage

