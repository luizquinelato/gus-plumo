import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import BrazilianDatePicker, { BrazilianDatePickerHandle } from '../components/BrazilianDatePicker'
import { formatDateBR, parseLocalDate, dateToLocalString, getTodayLocalDate } from '../utils/dateUtils'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageShell,
  CadastroListPageTabs,
  listPageTableRowHoverCls,
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
} from '../components/CadastroFormLayout'
import FloatingFooterBar from '../components/FloatingFooterBar'
import Toast from '../components/Toast'
import LoadingSpinner from '../components/LoadingSpinner'
import BalanceDetailsModal from '../components/BalanceDetailsModal'
import MonthlyHistoryDetailsModal from '../components/MonthlyHistoryDetailsModal'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import JsonTreeViewer from '../components/JsonTreeViewer'
import {
  filterRegularLoanPayments,
  getSettlementCreditEntries,
  getSettlementCreditForPayment,
  getSettlementCreditSignedForViewer,
  getSettlementCreditTotal,
  signedLoanFieldValue,
} from '../utils/closureCreditUtils'
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
  credit_loan_id?: number | null
  credit_loan_amount?: number | null
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
    <CadastroModalShell maxWidth="max-w-md" onBackdropClick={onClose} zClass="z-50">
      <CadastroModalHeader
        isEdit={false}
        title="Realizar Fechamento"
        subtitle={`Confirma o fechamento do balanço do período de ${
          lastClosureTimestamp && new Date(periodStart).toDateString() === new Date(lastClosureTimestamp).toDateString()
            ? new Date(lastClosureTimestamp).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })
            : new Date(periodStart).toLocaleDateString('pt-BR')
        } até ${new Date(periodEnd).toLocaleDateString('pt-BR')}?`}
        onClose={onClose}
        icon={<Archive size={18} />}
      />
      <CadastroModalBody>
        <CadastroFormSection title="Fechamento" icon={<Archive size={14} />}>
          <CadastroModalFieldsGrid>
            {calculationTimestamp && (
              <CadastroModalFieldsRow>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                  <p className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300">
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
                  <p className="ml-5 mt-1 text-xs text-blue-600 dark:text-blue-400">
                    Transações lançadas após este momento não serão incluídas neste fechamento.
                  </p>
                </div>
              </CadastroModalFieldsRow>
            )}
            <CadastroModalFieldsRow>
              <label className="block min-w-0">
                <CadastroFieldLabel>Observações</CadastroFieldLabel>
                <textarea
                  value={closureNotes}
                  onChange={(e) => setClosureNotes(e.target.value)}
                  placeholder="Digite observações sobre este fechamento..."
                  className={`${cadastroFieldCls} mt-0.5`}
                  rows={3}
                />
              </label>
            </CadastroModalFieldsRow>
          </CadastroModalFieldsGrid>
        </CadastroFormSection>
      </CadastroModalBody>
      <CadastroModalFooter
        onClose={onClose}
        onSave={onConfirm}
        saveLabel="Confirmar"
      />
    </CadastroModalShell>
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
    <CadastroModalShell maxWidth="max-w-4xl" onBackdropClick={onClose} zClass="z-50">
      <CadastroModalHeader
        isEdit={false}
        title="Dados do Fechamento"
        subtitle="JSON completo com todas as informações"
        onClose={onClose}
        icon={<FileJson size={18} />}
      />
      <CadastroModalBody
        chrome={
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewMode('tree')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                  viewMode === 'tree'
                    ? 'bg-color-primary text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                Árvore
              </button>
              <button
                type="button"
                onClick={() => setViewMode('raw')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                  viewMode === 'raw'
                    ? 'bg-color-primary text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                Raw
              </button>
              {viewMode === 'tree' && (
                <>
                  <div className="mx-2 h-6 w-px bg-gray-300 dark:bg-gray-600" />
                  <button
                    type="button"
                    onClick={handleExpandAll}
                    className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600 transition-all hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                    title="Expandir tudo"
                  >
                    <UnfoldVertical size={14} />
                    Expandir
                  </button>
                  <button
                    type="button"
                    onClick={handleCollapseAll}
                    className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600 transition-all hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                    title="Colapsar tudo"
                  >
                    <FoldVertical size={14} />
                    Colapsar
                  </button>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={onCopy}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                jsonCopied
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
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
        }
      >
        <CadastroFormSection title="JSON" icon={<Braces size={14} />} bodyClassName="p-0">
          <div className="overflow-auto bg-gray-900 p-4">
            {viewMode === 'tree' ? (
              <JsonTreeViewer
                key={treeKey}
                data={data}
                expandDepth={expandDepth}
              />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-sm text-green-400">
                {JSON.stringify(data, null, 2)}
              </pre>
            )}
          </div>
        </CadastroFormSection>
      </CadastroModalBody>
      <CadastroModalFooter onClose={onClose} hideSave closeLabel="Fechar" />
    </CadastroModalShell>
  )
}

type BalancoTab = 'current' | 'history' | 'closures'

function tabFromPath(pathname: string): BalancoTab {
  if (pathname.endsWith('/historico')) return 'history'
  if (pathname.endsWith('/lista')) return 'closures'
  return 'current'
}

function pathForTab(tab: BalancoTab): string {
  if (tab === 'history') return '/fechamentos/compartilhado/historico'
  if (tab === 'closures') return '/fechamentos/compartilhado/lista'
  return '/fechamentos/compartilhado'
}

const closureTableHeadCls =
  'bg-gray-100 dark:bg-gray-800/80 [&_th]:border-b-2 [&_th]:border-gray-200 dark:[&_th]:border-gray-600'
const closureTableThLeftCls =
  'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
const closureTableThRightCls =
  'px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
const closureTableThCenterCls =
  'px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
const closureTableTdCls = 'border-b border-gray-200 px-3 py-2 dark:border-gray-600'
const closureTableFootCls =
  'border-t-2 border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/50'

function closureItemShareValues(item: {
  amount: number | string
  my_contribution_percentage?: string | number
  partner_contribution_percentage?: string | number
  should_invert?: boolean
}) {
  const originalMyPercentage = parseFloat(String(item.my_contribution_percentage || '0'))
  const originalPartnerPercentage = parseFloat(String(item.partner_contribution_percentage || '0'))
  const myPercentage = item.should_invert ? originalPartnerPercentage : originalMyPercentage
  const partnerPercentage = item.should_invert ? originalMyPercentage : originalPartnerPercentage
  const rawAmount = parseFloat(String(item.amount))
  return {
    myPercentage,
    partnerPercentage,
    rawAmount,
    myValueSigned: rawAmount * (myPercentage / 100),
    partnerValueSigned: rawAmount * (partnerPercentage / 100),
  }
}

function signedMoneyCls(value: number) {
  if (Math.abs(value) < 0.01) return 'text-gray-900 dark:text-gray-100'
  return value < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
}

const BalancoPage = () => {
  const { showConfirm, ConfirmComponent } = useConfirm()
  const location = useLocation()
  const navigate = useNavigate()
  const activeTab = tabFromPath(location.pathname)
  const [selectedPartnerAccountId, setSelectedPartnerAccountId] = useState<number | null>(null)
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1)
  const [loggedAccountId, setLoggedAccountId] = useState<number | null>(null)
  const startDatePickerRef = useRef<BrazilianDatePickerHandle>(null)
  const endDatePickerRef = useRef<BrazilianDatePickerHandle>(null)

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
  const [unsettleClearError, setUnsettleClearError] = useState<{
    message: string
    loans: { id: number; description: string }[]
  } | null>(null)
  const [paymentDeleteError, setPaymentDeleteError] = useState<{
    message: string
    loans: { id: number; description: string }[]
  } | null>(null)

  // Estados para pagamentos parciais de fechamentos
  const [expandedClosureIds, setExpandedClosureIds] = useState<Set<number>>(new Set())
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentClosure, setPaymentClosure] = useState<BalanceClosure | null>(null)
  const [paymentAmountCents, setPaymentAmountCents] = useState('') // dígitos brutos (centavos)
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false)
  // Estados para modal de edição de pagamento
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false)
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null)
  const [editingPaymentClosure, setEditingPaymentClosure] = useState<BalanceClosure | null>(null)
  const [editPaymentCents, setEditPaymentCents] = useState('')
  const [editPaymentDate, setEditPaymentDate] = useState('')
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

        // Usa apenas a parte da data (YYYY-MM-DD) — evita shift de timezone
        const closureDateOnly = dateToLocalString(lastClosure.closing_date)
        setMinStartDate(closureDateOnly)
        setStartDate(closureDateOnly)
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

  const loadBalanceCalculation = async (overrides?: { startDate?: string; endDate?: string }) => {
    const effectiveStartDate = overrides?.startDate ?? startDate
    const effectiveEndDate = overrides?.endDate ?? endDate

    if (!selectedPartnerAccountId) return
    if (!effectiveStartDate || !effectiveEndDate) {
      setToast({ show: true, message: 'Por favor, selecione as datas de início e fim', type: 'warning' })
      return
    }

    // Validação: data de fim não pode ser menor que data de início
    if (effectiveEndDate < effectiveStartDate) {
      setToast({ show: true, message: 'A data de fim não pode ser anterior à data de início', type: 'warning' })
      return
    }

    // ✅ Determinar timestamp de fechamento baseado na data de fim selecionada
    // Se a data de fim é anterior a hoje → usar endDate + 23:59:59
    // Se a data de fim é hoje ou futura → usar a data/hora atual
    const now = new Date()
    const todayStr = getTodayLocalDate()

    let clickTimestamp: string
    if (effectiveEndDate < todayStr) {
      // Data de fim é no passado - usar 23:59:59 desse dia
      clickTimestamp = `${effectiveEndDate} 23:59:59`
    } else {
      // Data de fim é hoje ou no futuro - usar hora atual
      clickTimestamp = dateToTimestampString(now)
    }
    setCalculationTimestamp(clickTimestamp)

    if (effectiveStartDate !== startDate) setStartDate(effectiveStartDate)
    if (effectiveEndDate !== endDate) setEndDate(effectiveEndDate)

    setLoading(true)
    try {
      const params: any = {
        partner_account_id: selectedPartnerAccountId,
        year: selectedYear,
        custom_start_date: effectiveStartDate,
        custom_end_date: effectiveEndDate
      }

      // Se houver timestamp do último fechamento, enviar para filtrar corretamente
      if (lastClosureTimestamp) {
        params.last_closure_timestamp = lastClosureTimestamp
      }

      const response = await axios.get('/api/balance/calculate', { params })
      setBalanceData(response.data)

      // ✅ Carregar empréstimos abertos junto com o balanço
      await loadOpenLoans(effectiveEndDate)
    } catch (error) {
      console.error('Erro ao calcular balanço:', error)
      setToast({ show: true, message: 'Erro ao calcular balanço', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleApplyBalance = () => {
    const committedStart = startDatePickerRef.current?.commitPending() ?? startDate
    const committedEnd = endDatePickerRef.current?.commitPending() ?? endDate
    loadBalanceCalculation({ startDate: committedStart, endDate: committedEnd })
  }

  // Função para carregar empréstimos abertos com o parceiro selecionado
  const loadOpenLoans = async (maxDateOverride?: string) => {
    if (!selectedPartnerAccountId) return

    setLoansLoading(true)
    try {
      const response = await axios.get('/api/balance/open-loans', {
        params: {
          partner_account_id: selectedPartnerAccountId,
          max_date: maxDateOverride ?? endDate  // Filtrar apenas empréstimos que existiam até a data final do período
        }
      })
      setOpenLoans(response.data)

      // Inicializar loanPayments com todos os empréstimos e valores zerados
      const initialPayments: LoanPaymentInput[] = response.data.loans.map((loan: OpenLoanItem) => ({
        loan_id: loan.id,
        amount: 0,
        displayAmount: '',
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
  const updateLoanPayment = (loanId: number, field: 'amount' | 'displayAmount' | 'settleInFull', value: number | boolean | string) => {
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
      // Ativar: preencher com o saldo integral (em centavos)
      const fullAmount = Math.max(0, correctedBalance)
      const cents = Math.round(fullAmount * 100).toString()
      setLoanPayments(prev => prev.map(lp =>
        lp.loan_id === loanId
          ? { ...lp, settleInFull: true, amount: fullAmount, displayAmount: cents }
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

  // Handler para máscara de moeda (direita→esquerda, centavos como dígitos brutos)
  const handleLoanAmountChange = (loanId: number, value: string) => {
    const cents = value.replace(/\D/g, '')
    const numValue = parseInt(cents || '0', 10) / 100
    if (numValue > 99999999.99) return
    setLoanPayments(prev => prev.map(lp =>
      lp.loan_id === loanId
        ? { ...lp, displayAmount: cents, amount: numValue }
        : lp
    ))
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
      .filter(lp => lp.amount > 0)
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

  const formatSignedCurrency = (signed: number) => {
    if (Math.abs(signed) < 0.0001) return formatCurrency(0)
    const prefix = signed < 0 ? '-' : ''
    return `${prefix}${formatCurrency(Math.abs(signed))}`
  }

  // Função para validar os valores de empréstimos preenchidos
  const validateLoanPayments = (): { isValid: boolean; errors: string[] } => {
    if (!openLoans || loanPayments.length === 0) {
      return { isValid: true, errors: [] }
    }

    const errors: string[] = []

    loanPayments.forEach(lp => {
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
        .filter(lp => lp.amount > 0)
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
    setUnsettleClearError(null)
    setShowUnsettleModal(true)
  }

  const handleConfirmUnsettle = async (clearPayments: boolean) => {
    if (!unsettleClosure) return
    setUnsettleClearingAll(true)
    setUnsettleClearError(null)
    try {
      if (clearPayments) {
        await axios.delete(`/api/balance/closures/${unsettleClosure.id}/payments`)
      }
      await axios.delete(`/api/balance/closures/${unsettleClosure.id}/settle`)
      setToast({ show: true, message: 'Quitação removida com sucesso!', type: 'success' })
      setShowUnsettleModal(false)
      setUnsettleClosure(null)
      setUnsettleClearError(null)
      loadClosures()
    } catch (error: any) {
      console.error('Erro ao remover quitação:', error)
      const detail = error.response?.data?.detail
      if (
        clearPayments &&
        detail &&
        typeof detail === 'object' &&
        detail.code === 'credit_loans_blocked'
      ) {
        setUnsettleClearError({
          message: detail.message || 'Não é possível apagar os pagamentos parciais.',
          loans: Array.isArray(detail.loans) ? detail.loans : [],
        })
      } else {
        setToast({
          show: true,
          message: typeof detail === 'string' ? detail : (detail?.message || 'Erro ao remover quitação'),
          type: 'error',
        })
      }
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

  const closuresScorecards = useMemo(() => {
    let openAmount = 0
    let totalPaid = 0
    let totalLoanPaid = 0
    let pendingCount = 0
    let paymentsCount = 0
    let loanPaymentsCount = 0

    closures.forEach(closure => {
      const mainCard = closure.closure_data?.main_account_card || {}
      const partnerCard = closure.closure_data?.partner_account_card || {}
      const closureMainAccountId = Number(mainCard.account_id || closure.account_id)
      const isCounterpart = Number(loggedAccountId) !== closureMainAccountId
      const viewerCard = isCounterpart ? partnerCard : mainCard

      const totalToReceive = parseFloat(viewerCard.total_to_receive ?? 0)
      const totalToPay = parseFloat(viewerCard.total_to_pay ?? 0)
      const loanToReceive = parseFloat(viewerCard.loan_to_receive ?? 0)
      const loanToPay = parseFloat(viewerCard.loan_to_pay ?? 0)
      const displayNetBalance = (totalToReceive + loanToReceive) - (Math.abs(totalToPay) + Math.abs(loanToPay))

      const paid = parseFloat(String(closure.total_paid ?? 0))
      totalPaid += paid
      paymentsCount += (closure.closure_payments || []).length

      if (!closure.is_settled) {
        pendingCount += 1
        const remainingAbs = parseFloat(String(closure.remaining_balance ?? Math.abs(displayNetBalance)))
        if (remainingAbs > 0.01) {
          openAmount += displayNetBalance >= 0 ? remainingAbs : -remainingAbs
        }
      }

      const loanPayments = filterRegularLoanPayments(getClosureLoanPaymentsList(closure))
      loanPayments.forEach(payment => {
        const originalIsLent = payment.loan_type === 'lent'
        const isLent = isCounterpart ? !originalIsLent : originalIsLent
        totalLoanPaid += signedLoanFieldValue(payment.amount_paid || 0, isLent, 'paid')
        loanPaymentsCount += 1
      })
    })

    return { openAmount, totalPaid, totalLoanPaid, pendingCount, paymentsCount, loanPaymentsCount }
  }, [closures, loggedAccountId])

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
    setPaymentDate(getTodayLocalDate())
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
    const dateStr = paymentDate
    try {
      const response = await axios.post(
        `/api/balance/closures/${paymentClosure.id}/payments`,
        { amount: amountValue, payment_date: dateStr, notes: paymentNotes || null }
      )
      // Atualizar o fechamento na lista com os dados enriquecidos
      setClosures(prev => prev.map(c => c.id === paymentClosure.id ? { ...c, ...response.data } : c))
      const creditLoanId = response.data?.credit_loan_id
      const creditLoanAmount = parseFloat(String(response.data?.credit_loan_amount ?? 0))
      if (creditLoanId && creditLoanAmount > 0) {
        setToast({
          show: true,
          message: `Pagamento registrado e fechamento quitado. Crédito de ${formatCurrency(creditLoanAmount)} gerou empréstimo a pagar #${creditLoanId}.`,
          type: 'success'
        })
      } else {
        setToast({ show: true, message: 'Pagamento registrado com sucesso!', type: 'success' })
      }
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

  const handleDeletePayment = (closure: BalanceClosure, paymentId: number) => {
    const creditEntry = getSettlementCreditForPayment(closure, paymentId)
    const confirmMessage = creditEntry
      ? 'Este pagamento gerou saldo a pagar (empréstimo). O empréstimo vinculado também será removido se estiver aberto e sem liquidações. Deseja continuar?'
      : 'Deseja remover este pagamento parcial?'

    showConfirm(
      'Remover Pagamento',
      confirmMessage,
      async () => {
        setPaymentDeleteError(null)
        try {
          const response = await axios.delete(`/api/balance/closures/${closure.id}/payments/${paymentId}`)
          const updated = response.data as BalanceClosure
          const mergedClosure: BalanceClosure = {
            ...closure,
            ...updated,
            closure_data: updated.closure_data
              ? JSON.parse(JSON.stringify(updated.closure_data))
              : closure.closure_data,
            closure_payments: updated.closure_payments ?? [],
          }
          setClosures(prev => prev.map(c => c.id === closure.id ? mergedClosure : c))
          if (selectedClosure?.id === closure.id) {
            setSelectedClosure(mergedClosure)
          }
          if (!(mergedClosure.closure_payments?.length)) {
            setExpandedClosureIds(prev => {
              const next = new Set(prev)
              next.delete(closure.id)
              return next
            })
          }
          if (creditEntry) {
            await loadOpenLoans()
          }
          setToast({ show: true, message: 'Pagamento removido com sucesso!', type: 'success' })
        } catch (error: any) {
          const detail = error.response?.data?.detail
          if (detail && typeof detail === 'object' && detail.code === 'credit_loans_blocked') {
            setPaymentDeleteError({
              message: detail.message || 'Não é possível remover este pagamento.',
              loans: Array.isArray(detail.loans) ? detail.loans : [],
            })
          } else {
            setToast({
              show: true,
              message: typeof detail === 'string' ? detail : (detail?.message || 'Erro ao remover pagamento'),
              type: 'error',
            })
          }
        }
      },
      'Remover',
      'Cancelar'
    )
  }

  const openEditPayment = (payment: ClosurePayment, closure: BalanceClosure) => {
    setEditingPaymentId(payment.id)
    setEditingPaymentClosure(closure)
    const cents = Math.round(parseFloat(String(payment.amount)) * 100)
    setEditPaymentCents(String(cents))
    setEditPaymentDate(dateToLocalString(payment.payment_date))
    setEditPaymentNotes(payment.notes || '')
    setShowEditPaymentModal(true)
  }

  const closeEditPaymentModal = () => {
    setShowEditPaymentModal(false)
    setEditingPaymentId(null)
    setEditingPaymentClosure(null)
    setEditPaymentCents('')
    setEditPaymentDate('')
    setEditPaymentNotes('')
  }

  const handleSavePaymentEdit = async () => {
    if (!editingPaymentId || !editingPaymentClosure) return
    const amountValue = parseInt(editPaymentCents || '0', 10) / 100
    if (!amountValue || !editPaymentDate) return
    setIsSavingPaymentEdit(true)
    const dateStr = editPaymentDate
    try {
      const response = await axios.put(
        `/api/balance/closures/${editingPaymentClosure.id}/payments/${editingPaymentId}`,
        { amount: amountValue, payment_date: dateStr, notes: editPaymentNotes || null }
      )
      setClosures(prev => prev.map(c => c.id === editingPaymentClosure.id ? { ...c, ...response.data } : c))
      const creditLoanId = response.data?.credit_loan_id
      const creditLoanAmount = parseFloat(String(response.data?.credit_loan_amount ?? 0))
      if (creditLoanId && creditLoanAmount > 0) {
        setToast({
          show: true,
          message: `Pagamento atualizado e fechamento quitado. Crédito de ${formatCurrency(creditLoanAmount)} no empréstimo a pagar #${creditLoanId}.`,
          type: 'success'
        })
      } else {
        setToast({ show: true, message: 'Pagamento atualizado com sucesso!', type: 'success' })
      }
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
      <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <CadastroListPageShell>
          <LoadingSpinner fullScreen message="Carregando..." />
        </CadastroListPageShell>
      </div>
    )
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <CadastroListPageShell>
        <CadastroListPageBody
          scrollRef={closuresScrollContainerRef}
          header={
            <CadastroListPageHero
              icon={<Scale className="w-8 h-8" />}
              title="Balanço Compartilhado"
              subtitle="Acompanhe o balanço de despesas compartilhadas entre contas"
            />
          }
          tabs={
            <div className="space-y-4">
          {/* Filtros */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 transition-all hover:border-color-primary hover:shadow-md">
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
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Calendar size={14} className="inline mr-1 text-color-primary" />
                    Data de Início
                  </label>
                  <BrazilianDatePicker
                    ref={startDatePickerRef}
                    value={startDate}
                    onChange={setStartDate}
                    minDate={minStartDate ? parseLocalDate(minStartDate) ?? undefined : undefined}
                    maxDate={endDate ? parseLocalDate(endDate) ?? undefined : undefined}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-color-primary focus:border-color-primary transition-all shadow-sm"
                    title={minStartDate ? `Data mínima: ${formatDateBR(minStartDate)} (mesmo dia ou após o último fechamento)` : undefined}
                  />
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
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Calendar size={14} className="inline mr-1 text-color-primary" />
                    Data de Fim
                  </label>
                  <BrazilianDatePicker
                    ref={endDatePickerRef}
                    value={endDate}
                    onChange={setEndDate}
                    minDate={startDate ? parseLocalDate(startDate) ?? undefined : undefined}
                    maxDate={new Date()}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-color-primary focus:border-color-primary transition-all shadow-sm"
                  />
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
                    onClick={handleApplyBalance}
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
              <div className="flex flex-col md:flex-row gap-2 md:items-end">
                {/* Conta Compartilhada */}
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
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
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
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

          <CadastroListPageTabs
            tabs={[
              { key: 'current', label: 'Balanço Calculado' },
              { key: 'history', label: 'Histórico Anual' },
              { key: 'closures', label: 'Fechamentos', icon: <Archive size={16} /> },
            ]}
            active={activeTab}
            onChange={(tab) => navigate(pathForTab(tab))}
          />
            </div>
          }
        >
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
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
                          <table className="w-full text-sm table-fixed">
                            <thead className="border-b border-gray-200 dark:border-gray-700">
                              <tr>
                                <th className="w-[11%] px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Saldo</th>
                                <th className="w-[23%] px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Descrição</th>
                                <th className="w-[11%] px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Principal</th>
                                <th className="w-[13%] px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Saldo Corrigido</th>
                                <th className="w-[11%] px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Já Pago</th>
                                <th className="w-[11%] px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Saldo Aberto</th>
                                <th className="w-[13%] px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Valor a Quitar</th>
                                <th className="w-[7%] px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Integral</th>
                              </tr>
                            </thead>
                            <tbody>
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
                                    className="border-t border-t-gray-200 dark:border-t-gray-700 border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
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
                                    <td className="px-3 py-3 text-left font-bold text-gray-900 dark:text-gray-100">
                                      {formatCurrency(principalDisplay)}
                                    </td>
                                    <td className="px-3 py-3 text-left">
                                      {interestInfo ? (
                                        <div>
                                          <div className="flex items-center justify-start gap-1">
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
                                    <td className="px-3 py-3 text-left text-gray-600 dark:text-gray-400">
                                      {formatCurrency(loan.total_paid)}
                                    </td>
                                    <td className="px-3 py-3">
                                      <div className={`flex items-center justify-start gap-1 font-bold ${balanceColor}`}>
                                        {formatCurrency(balanceDisplay)}
                                      </div>
                                    </td>
                                    {/* Valor a Quitar */}
                                    <td className="px-3 py-3">
                                      <div className="flex items-center justify-start">
                                        <div className="relative">
                                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 text-sm">
                                            R$
                                          </span>
                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            value={formatAmountMask(payment?.displayAmount || '')}
                                            onChange={(e) => {
                                              if (payment?.settleInFull) {
                                                updateLoanPayment(loan.id, 'settleInFull', false)
                                              }
                                              handleLoanAmountChange(loan.id, e.target.value)
                                            }}
                                            disabled={payment?.settleInFull}
                                            className="w-28 pl-8 pr-2 py-1.5 text-sm text-right border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                            placeholder="0,00"
                                          />
                                        </div>
                                      </div>
                                    </td>
                                    {/* Switch Quitar Integral */}
                                    <td className="px-3 py-3">
                                      <div className="flex items-center justify-start">
                                        <button
                                          onClick={() => handleSettleInFullToggle(loan.id, correctedBalance)}
                                          disabled={correctedBalance <= 0.01}
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
                        <thead className="border-b border-gray-200 dark:border-gray-700">
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
                        <tbody>
                          {annualHistoryData.months.map((monthData, index) => {
                            const balance = monthData.main_account_balance
                            return (
                              <tr
                                key={monthData.month}
                                className="border-t border-t-gray-200 dark:border-t-gray-700 border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
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
                        <thead className="border-b border-gray-200 dark:border-gray-700">
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
                        <tbody>
                          {annualHistoryData.months.map((monthData, index) => {
                            const balance = monthData.partner_account_balance
                            return (
                              <tr
                                key={monthData.month}
                                className="border-t border-t-gray-200 dark:border-t-gray-700 border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
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
                  <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Unlock className={`w-5 h-5 ${
                            closuresScorecards.openAmount > 0
                              ? 'text-green-600 dark:text-green-400'
                              : closuresScorecards.openAmount < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-gray-400'
                          }`} />
                          <div>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Aberto</p>
                            <p className={`text-lg font-bold ${
                              closuresScorecards.openAmount > 0
                                ? 'text-green-600 dark:text-green-400'
                                : closuresScorecards.openAmount < 0
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-gray-600 dark:text-gray-400'
                            }`}>
                              {formatSignedCurrency(closuresScorecards.openAmount)}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-500">
                          {closuresScorecards.pendingCount} pend.
                        </span>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <CreditCard className="w-5 h-5 text-green-600 dark:text-green-400" />
                          <div>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Pago</p>
                            <p className="text-lg font-bold text-green-600 dark:text-green-400">
                              {formatCurrency(closuresScorecards.totalPaid)}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-500">
                          {closuresScorecards.paymentsCount} pag.
                        </span>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Banknote className={`w-5 h-5 ${
                            closuresScorecards.totalLoanPaid > 0
                              ? 'text-green-600 dark:text-green-400'
                              : closuresScorecards.totalLoanPaid < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`} />
                          <div>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Total Empréstimo Pago</p>
                            <p className={`text-lg font-bold ${
                              closuresScorecards.totalLoanPaid > 0
                                ? 'text-green-600 dark:text-green-400'
                                : closuresScorecards.totalLoanPaid < 0
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-gray-600 dark:text-gray-400'
                            }`}>
                              {formatSignedCurrency(closuresScorecards.totalLoanPaid)}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-500">
                          {closuresScorecards.loanPaymentsCount} liq.
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className={`bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto ${selectedClosureIds.size > 0 || showClosuresBackToTop ? 'pb-20' : ''}`}>
                    <table className="min-w-[980px] w-full table-fixed">
                      <thead className="border-b border-gray-200 dark:border-gray-700">
                        <tr>
                          {/* Coluna expand/colapso */}
                          <th className="px-1 py-3 w-6"></th>
                          <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-8">
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
                          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-10">#</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Período</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Conta Principal</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Contraparte</th>
                          <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Valores</th>
                          <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider" title="Pagamentos parciais realizados">Pagamentos</th>
                          <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Saldo</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                          <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap w-[240px] sticky right-0 bg-white dark:bg-gray-800 z-10 border-l border-gray-200 dark:border-gray-700">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800">
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
                          const hasRemovableLoanLiquidations = [
                            ...(mainCard.loan_payments || []),
                            ...(partnerCard.loan_payments || []),
                            ...rootLoanPayments,
                          ].some((lp: any) => lp && !lp.generated_on_settlement)

                          return (
                          <React.Fragment key={closure.id}>
                          <tr
                            className={`group border-t border-t-gray-200 dark:border-t-gray-700 border-l-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all ${
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
                            {/* Coluna Período — Início + Fim mesclados */}
                            <td className="px-3 py-3">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 w-5 shrink-0">De</span>
                                  <span className="text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                    {new Date(closure.period_start_date).toLocaleDateString('pt-BR')}
                                  </span>
                                  <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                                    {new Date(closure.period_start_date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 w-5 shrink-0">Até</span>
                                  <span className="text-xs font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                                    {new Date(closure.closing_date).toLocaleDateString('pt-BR')}
                                  </span>
                                  <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                                    {new Date(closure.closing_date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                {closure.notes && (
                                  <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-[130px]">• {closure.notes}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-3 max-w-[150px]">
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
                            <td className="px-3 py-3 max-w-[150px]">
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
                            {/* Coluna Valores — A Receber e A Pagar empilhados */}
                            <td className="px-3 py-3">
                              <div className="flex flex-col gap-0.5 items-end">
                                <span className="text-xs font-medium text-green-600 dark:text-green-400 whitespace-nowrap">
                                  ↑ {formatCurrency(displayToReceive)}
                                </span>
                                <span className="text-xs font-medium text-red-600 dark:text-red-400 whitespace-nowrap">
                                  ↓ {formatCurrency(displayToPay)}
                                </span>
                              </div>
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
                            {/* Coluna Saldo — saldo restante ou crédito da quitação */}
                            {(() => {
                              const settlementCreditSigned = getSettlementCreditSignedForViewer(closure, !isCounterpart)
                              const settlementCreditTotal = getSettlementCreditTotal(closure)

                              if (closure.is_settled && settlementCreditTotal > 0.01) {
                                return (
                                  <td className={`px-3 py-3 text-right whitespace-nowrap ${
                                    settlementCreditSigned > 0
                                      ? 'text-green-600 dark:text-green-400'
                                      : settlementCreditSigned < 0
                                      ? 'text-red-600 dark:text-red-400'
                                      : 'text-gray-600 dark:text-gray-400'
                                  }`}>
                                    <div className="flex flex-col items-end">
                                      <span className="font-medium">{formatSignedCurrency(settlementCreditSigned)}</span>
                                      <span className="text-[10px] text-amber-600 dark:text-amber-400">crédito quitação</span>
                                    </div>
                                  </td>
                                )
                              }

                              const totalPaid = parseFloat(String(closure.total_paid ?? 0))
                              const remaining = closure.is_settled ? 0 : (parseFloat(String(closure.remaining_balance ?? Math.abs(displayNetBalance))) - 0)
                              const displayBalance = totalPaid > 0 ? remaining : displayNetBalance
                              const isRemainingView = totalPaid > 0
                              return (
                                <td className={`px-3 py-3 text-right whitespace-nowrap ${
                                  displayBalance > 0
                                    ? 'text-green-600 dark:text-green-400'
                                    : displayBalance < 0
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-gray-600 dark:text-gray-400'
                                }`}>
                                  <div className="flex flex-col items-end">
                                    <span className="font-medium">{formatSignedCurrency(displayBalance)}</span>
                                    {isRemainingView && (
                                      <span className="text-[10px] text-gray-400 dark:text-gray-500">restante</span>
                                    )}
                                  </div>
                                </td>
                              )
                            })()}
                            <td className="px-3 py-3">
                              <div className="flex flex-col items-start gap-1">
                                {closure.is_settled ? (
                                  <span
                                    className="inline-block px-2.5 py-0.5 text-xs font-medium rounded text-white"
                                    style={{ backgroundColor: 'var(--status-success)' }}
                                  >
                                    Quitado
                                  </span>
                                ) : (
                                  <span
                                    className="inline-block px-2.5 py-0.5 text-xs font-medium rounded text-white"
                                    style={{ backgroundColor: 'var(--status-warning)' }}
                                  >
                                    Pendente
                                  </span>
                                )}
                                {hasLoanPayments && (
                                  <span
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 whitespace-nowrap"
                                    title="Possui liquidações de empréstimos"
                                  >
                                    <Banknote size={9} /> Empr.
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className={`px-3 py-3 text-left overflow-hidden sticky right-0 z-10 border-l border-gray-200 dark:border-gray-700 ${
                              selectedClosureIds.has(closure.id)
                                ? 'bg-blue-50 dark:bg-blue-900/20'
                                : 'bg-white dark:bg-gray-800 group-hover:bg-gray-50 dark:group-hover:bg-gray-700/50'
                            }`}>
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
                                  onClick={() => hasRemovableLoanLiquidations && !closure.is_settled && handleOpenRemoveLoanPaymentsModal(closure)}
                                  disabled={!hasRemovableLoanLiquidations || closure.is_settled}
                                  className={`p-1.5 rounded-lg transition-all ${
                                    hasRemovableLoanLiquidations && !closure.is_settled
                                      ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 cursor-pointer'
                                      : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                  }`}
                                  title={
                                    closure.is_settled
                                      ? "Remova a quitação para poder remover liquidações de empréstimos"
                                      : hasRemovableLoanLiquidations
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
                          {/* Sub-linhas expansíveis: histórico de pagamentos */}
                          {expandedClosureIds.has(closure.id) && (closure.closure_payments || []).length > 0 && (
                            <React.Fragment>
                              {/* Barra de título da seção */}
                              <tr className="bg-indigo-50 dark:bg-indigo-900/15 border-t border-indigo-200 dark:border-indigo-800">
                                <td colSpan={10} className="pl-10 pr-4 py-2">
                                  <div className="flex items-center gap-2">
                                    <div className="w-1 h-4 rounded-full bg-indigo-500 dark:bg-indigo-400 shrink-0" />
                                    <CreditCard size={13} className="text-indigo-600 dark:text-indigo-400" />
                                    <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">
                                      Pagamentos Parciais
                                    </span>
                                    <span className="text-xs text-indigo-400 dark:text-indigo-500">
                                      ({(closure.closure_payments || []).length})
                                    </span>
                                    <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                      Total pago: <span className="font-semibold text-green-600 dark:text-green-400">{formatCurrency(parseFloat(String(closure.total_paid ?? 0)))}</span>
                                    </span>
                                  </div>
                                </td>
                                <td className="sticky right-0 z-10 bg-indigo-50 dark:bg-indigo-900/15 border-l border-gray-200 dark:border-gray-700 py-2 px-3" />
                              </tr>
                              {/* Cabeçalho das colunas — alinhado com as colunas da tabela pai */}
                              <tr className="bg-gray-50 dark:bg-gray-700/40 border-t border-gray-200 dark:border-gray-700 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                <td className="px-1 py-1.5 w-6" />
                                <td className="px-2 py-1.5 w-8 text-center">#</td>
                                <td className="px-3 py-1.5 w-10" />
                                <td className="px-3 py-1.5">Data</td>
                                <td className="px-3 py-1.5 text-right">Valor pago</td>
                                <td className="px-3 py-1.5" colSpan={5}>Observação</td>
                                <td className="sticky right-0 z-10 bg-gray-50 dark:bg-gray-700/40 border-l border-gray-200 dark:border-gray-700 px-3 py-1.5 w-[175px]">Ações</td>
                              </tr>
                              {/* Uma linha por pagamento — células alinhadas às colunas da tabela */}
                              {(closure.closure_payments || []).map((payment, payIdx) => {
                                const rowBg = payIdx % 2 === 0
                                  ? 'bg-white dark:bg-gray-800'
                                  : 'bg-gray-50/70 dark:bg-gray-700/20'
                                return (
                                <tr
                                  key={payment.id}
                                  className={`border-t border-gray-100 dark:border-gray-700/60 hover:bg-indigo-50/60 dark:hover:bg-indigo-900/20 transition-colors ${rowBg}`}
                                >
                                  {/* expand — vazio */}
                                  <td className="px-1 py-2 w-6" />
                                  {/* select — índice do pagamento */}
                                  <td className="px-2 py-2 w-8 text-center text-xs text-gray-400 dark:text-gray-500 font-medium">
                                    {payIdx + 1}
                                  </td>
                                  {/* # — vazio */}
                                  <td className="px-3 py-2 w-10" />
                                  {/* Período → data do pagamento */}
                                  <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                    {new Date(payment.payment_date).toLocaleDateString('pt-BR')}
                                  </td>
                                  {/* Conta Principal → valor pago (alinhado à direita) */}
                                  <td className="px-3 py-2 text-right text-xs font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">
                                    {formatCurrency(parseFloat(String(payment.amount)))}
                                  </td>
                                  {/* Contraparte + Valores + Pagamentos + Saldo + Status → observação (colSpan=5) */}
                                  <td colSpan={5} className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 truncate overflow-hidden">
                                    {payment.notes || <span className="italic text-gray-300 dark:text-gray-600">—</span>}
                                  </td>
                                  {/* Ações — sticky */}
                                  <td className={`sticky right-0 z-10 border-l border-gray-200 dark:border-gray-700 py-2 px-3 ${rowBg} hover:bg-indigo-50/60 dark:hover:bg-indigo-900/20`}>
                                    <div className="flex items-center gap-1">
                                      {!closure.is_settled && (
                                        <button
                                          onClick={() => openEditPayment(payment, closure)}
                                          className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 rounded transition-all"
                                          title="Editar pagamento"
                                        >
                                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                        </button>
                                      )}
                                      <button
                                        onClick={() => handleDeletePayment(closure, payment.id)}
                                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-all"
                                        title="Remover pagamento"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                )
                              })}
                              {(() => {
                                const settlementCredits = getSettlementCreditEntries(closure)
                                if (settlementCredits.length === 0) return null
                                const signedTotal = getSettlementCreditSignedForViewer(closure, !isCounterpart)
                                return (
                                  <>
                                    <tr className="bg-amber-50 dark:bg-amber-900/15 border-t border-amber-200 dark:border-amber-800">
                                      <td colSpan={10} className="pl-10 pr-4 py-2">
                                        <div className="flex items-center gap-2">
                                          <div className="w-1 h-4 rounded-full bg-amber-500 shrink-0" />
                                          <Banknote size={13} className="text-amber-600 dark:text-amber-400" />
                                          <span className="text-xs font-semibold text-amber-800 dark:text-amber-200 uppercase tracking-wide">
                                            Saldo gerado no pagamento a maior
                                          </span>
                                          <span className="ml-auto text-xs font-bold whitespace-nowrap">
                                            <span className={signedTotal < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>
                                              {formatSignedCurrency(signedTotal)}
                                            </span>
                                          </span>
                                        </div>
                                      </td>
                                      <td className="sticky right-0 z-10 bg-amber-50 dark:bg-amber-900/15 border-l border-gray-200 dark:border-gray-700 py-2 px-3" />
                                    </tr>
                                    {settlementCredits.map((credit, ci) => (
                                      <tr key={`credit-${credit.loan_id ?? ci}`} className="border-t border-amber-100 dark:border-amber-900/30 bg-amber-50/50 dark:bg-amber-900/10">
                                        <td className="px-1 py-2 w-6" />
                                        <td className="px-2 py-2 w-8 text-center text-xs text-amber-600 dark:text-amber-400">{ci + 1}</td>
                                        <td className="px-3 py-2 w-10" />
                                        <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400" colSpan={2}>
                                          {credit.description || 'Crédito da quitação'}
                                        </td>
                                        <td colSpan={5} className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                                          Empréstimo a pagar · #{credit.loan_id}
                                        </td>
                                        <td className="sticky right-0 z-10 border-l border-gray-200 dark:border-gray-700 py-2 px-3 bg-amber-50/50 dark:bg-amber-900/10 text-right text-xs font-semibold text-red-600 dark:text-red-400">
                                          {formatSignedCurrency(
                                            signedLoanFieldValue(credit.original_amount || 0, isCounterpart, 'remaining')
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </>
                                )
                              })()}
                              {/* Fechamento visual da seção */}
                              <tr className="border-t border-indigo-200 dark:border-indigo-800/60">
                                <td colSpan={10} className="pb-0"></td>
                                <td className="sticky right-0 z-10 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 pb-0"></td>
                              </tr>
                            </React.Fragment>
                          )}
                          </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  </>
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
        </CadastroListPageBody>
      </CadastroListPageShell>

        {/* Barra Flutuante de Ações em Lote - Fixed no rodapé, respeita o sidebar */}
        {activeTab === 'closures' && selectedClosureIds.size > 0 && (() => {
          const hasSettledSelected = closures.some(c => selectedClosureIds.has(c.id) && c.is_settled)
          const hasUnsettledSelected = closures.some(c => selectedClosureIds.has(c.id) && !c.is_settled)
          return (
            <FloatingFooterBar>
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
            </FloatingFooterBar>
          )
        })()}

        {/* Barra Flutuante Back to Top - Aparece só quando não há seleção */}
        {activeTab === 'closures' && showClosuresBackToTop && selectedClosureIds.size === 0 && (
          <FloatingFooterBar>
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
          </FloatingFooterBar>
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
          <CadastroModalShell
            maxWidth="max-w-2xl"
            onBackdropClick={() => {
              setShowDateSuggestionModal(false)
              setDateSuggestion(null)
            }}
            zClass="z-50"
          >
            <CadastroModalHeader
              isEdit={false}
              title="Conflito de Período"
              subtitle="Ajuste necessário nas datas"
              onClose={() => {
                setShowDateSuggestionModal(false)
                setDateSuggestion(null)
              }}
              icon={<AlertTriangle size={18} />}
            />
            <CadastroModalBody>
              <CadastroFormSection title="Datas" icon={<AlertTriangle size={14} />}>
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
              </CadastroFormSection>
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={() => {
                setShowDateSuggestionModal(false)
                setDateSuggestion(null)
              }}
              onSave={handleAcceptDateSuggestion}
              saveLabel="Aceitar e Recalcular"
              saveIcon={<CheckCircle size={15} />}
            />
          </CadastroModalShell>
        )}

        {/* Modal: Detalhes do Fechamento - Itens */}
        {showDetailsModal && selectedClosure && (
          <CadastroModalShell
            maxWidth="max-w-[95vw]"
            maxHeight="max-h-[90vh]"
            onBackdropClick={() => {
              setShowDetailsModal(false)
              setSelectedClosure(null)
              setClosureItems([])
              setClosureLoanPayments([])
              setIsClosurePartnerView(false)
            }}
            zClass="z-50"
          >
            <CadastroModalHeader
              isEdit={false}
              title={`Itens do Fechamento - ${String(selectedClosure.month).padStart(2, '0')}/${selectedClosure.year}`}
              subtitle={`${closureItems.length} itens • ${new Date(selectedClosure.period_start_date).toLocaleDateString('pt-BR')} a ${new Date(selectedClosure.closing_date).toLocaleDateString('pt-BR')}`}
              onClose={() => {
                setShowDetailsModal(false)
                setSelectedClosure(null)
                setClosureItems([])
                setClosureLoanPayments([])
                setIsClosurePartnerView(false)
              }}
              icon={<Receipt size={18} />}
            />
            <CadastroModalBody>
              <CadastroFormSection title="Lançamentos" icon={<Receipt size={14} />} bodyClassName="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1200px] text-sm">
                    <thead className={closureTableHeadCls}>
                      <tr>
                        <th className={`${closureTableThCenterCls} w-12`}>#</th>
                        <th className={`${closureTableThCenterCls} w-12`}>Fonte</th>
                        <th className={closureTableThLeftCls}>Data</th>
                        <th className={closureTableThLeftCls}>Descrição</th>
                        <th className={closureTableThLeftCls}>Cartão</th>
                        <th className={closureTableThLeftCls}>Tag/Subtag</th>
                        <th className={closureTableThLeftCls}>Conta Contraparte</th>
                        <th className={closureTableThRightCls}>Valor Total</th>
                        <th className={closureTableThCenterCls}>%</th>
                        <th className={closureTableThRightCls}>Minha Parte</th>
                        <th className={closureTableThRightCls}>Contraparte</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closureItems.map((item, index) => {
                        const {
                          myPercentage,
                          rawAmount,
                          myValueSigned,
                          partnerValueSigned,
                        } = closureItemShareValues(item)
                        const totalAmount = Math.abs(rawAmount)
                        const myValue = Math.abs(myValueSigned)
                        const partnerValue = Math.abs(partnerValueSigned)
                        const isNegative = rawAmount < 0

                        return (
                          <tr key={`${item.id}-${index}`} className={listPageTableRowHoverCls}>
                            <td className={`${closureTableTdCls} text-center text-sm text-gray-500 dark:text-gray-400`}>
                              {index + 1}
                            </td>
                            <td className={`${closureTableTdCls} text-center`}>
                              {item.source_type === 'Conta Bancária' && <Landmark size={16} className="inline text-blue-600 dark:text-blue-400" />}
                              {item.source_type === 'Cartão de Crédito' && <CreditCard size={16} className="inline text-color-primary" />}
                              {item.source_type === 'Cartão Benefício' && <Gift size={16} className="inline text-green-600 dark:text-green-400" />}
                            </td>
                            <td className={`${closureTableTdCls} whitespace-nowrap text-gray-600 dark:text-gray-400`}>
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
                            <td className={`${closureTableTdCls} font-medium text-gray-900 dark:text-white`}>
                              {item.description || 'Sem descrição'}
                              {item.current_installment && item.total_installments && item.total_installments > 1 && (
                                <span className="ml-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                                  ({item.current_installment}/{item.total_installments})
                                </span>
                              )}
                            </td>
                            <td className={`${closureTableTdCls} text-xs text-gray-900 dark:text-white`}>
                              {item.card_name ? (
                                <div>
                                  <span className="font-medium">{item.card_name}</span>
                                  <span className="ml-1 text-[10px] text-gray-500 dark:text-gray-400">•••• {item.card_number}</span>
                                </div>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                            <td className={`${closureTableTdCls} text-gray-500 dark:text-gray-400`}>
                              {item.tag_name ? (
                                <>{item.tag_name}{item.subtag_name && ` > ${item.subtag_name}`}</>
                              ) : '-'}
                            </td>
                            <td className={closureTableTdCls}>
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
                            <td className={`${closureTableTdCls} whitespace-nowrap text-right tabular-nums ${
                              totalAmount === 0 ? 'text-gray-900 dark:text-gray-100' : isNegative ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                            }`}>
                              {totalAmount === 0 ? '' : isNegative ? '-' : ''}{formatCurrency(totalAmount)}
                            </td>
                            <td className={`${closureTableTdCls} text-center font-medium text-gray-700 dark:text-gray-300`}>
                              {myPercentage.toFixed(0)}%
                            </td>
                            <td className={`${closureTableTdCls} whitespace-nowrap text-right tabular-nums ${
                              myValue === 0 ? 'text-gray-900 dark:text-gray-100' : myValueSigned < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                            }`}>
                              {myValue === 0 ? '' : myValueSigned < 0 ? '-' : ''}{formatCurrency(myValue)}
                            </td>
                            <td className={`${closureTableTdCls} whitespace-nowrap text-right tabular-nums ${
                              partnerValue === 0 ? 'text-gray-900 dark:text-gray-100' : partnerValueSigned < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                            }`}>
                              {partnerValue === 0 ? '' : partnerValueSigned < 0 ? '-' : ''}{formatCurrency(partnerValue)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    {(() => {
                      const totals = closureItems.reduce(
                        (acc, item) => {
                          const share = closureItemShareValues(item)
                          acc.raw += share.rawAmount
                          acc.mine += share.myValueSigned
                          acc.partner += share.partnerValueSigned
                          return acc
                        },
                        { raw: 0, mine: 0, partner: 0 },
                      )
                      return (
                        <tfoot className={closureTableFootCls}>
                          <tr>
                            <td colSpan={7} className="px-3 py-2.5 font-semibold text-gray-800 dark:text-gray-100">
                              Total
                            </td>
                            <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${signedMoneyCls(totals.raw)}`}>
                              {formatSignedCurrency(totals.raw)}
                            </td>
                            <td className="px-3 py-2.5 text-center text-gray-500 dark:text-gray-400">—</td>
                            <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${signedMoneyCls(totals.mine)}`}>
                              {formatSignedCurrency(totals.mine)}
                            </td>
                            <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${signedMoneyCls(totals.partner)}`}>
                              {formatSignedCurrency(totals.partner)}
                            </td>
                          </tr>
                        </tfoot>
                      )
                    })()}
                  </table>
                </div>
              </CadastroFormSection>

              {filterRegularLoanPayments(closureLoanPayments).length > 0 && (
                <CadastroFormSection title="Empréstimos" icon={<Banknote size={14} />} bodyClassName="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className={closureTableHeadCls}>
                        <tr>
                          <th className={`${closureTableThCenterCls} w-12`}>#</th>
                          <th className={closureTableThLeftCls}>Tipo</th>
                          <th className={closureTableThLeftCls}>Descrição</th>
                          <th className={closureTableThRightCls}>Principal</th>
                          <th className={closureTableThRightCls}>Saldo Corrigido</th>
                          <th className={closureTableThRightCls}>Valor Quitado</th>
                          <th className={closureTableThRightCls}>Saldo Restante</th>
                          <th className={closureTableThCenterCls}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filterRegularLoanPayments(closureLoanPayments).map((payment, index) => {
                          const originalIsLent = payment.loan_type === 'lent'
                          const isLent = isClosurePartnerView ? !originalIsLent : originalIsLent

                          const principalSigned = signedLoanFieldValue(payment.original_amount || 0, isLent, 'principal')
                          const beforeSigned = signedLoanFieldValue(payment.remaining_before || 0, isLent, 'corrected')
                          const paidSigned = signedLoanFieldValue(payment.amount_paid || 0, isLent, 'paid')
                          const afterSigned = signedLoanFieldValue(payment.remaining_after || 0, isLent, 'remaining')

                          const valueColor = isLent
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-red-600 dark:text-red-400'

                          const afterAbs = Math.abs(afterSigned)
                          const remainingColor = afterAbs < 0.01
                            ? 'text-gray-500 dark:text-gray-400'
                            : valueColor

                          const isSettled = afterAbs < 0.01

                          return (
                            <tr key={index} className={listPageTableRowHoverCls}>
                              <td className={`${closureTableTdCls} text-center text-sm text-gray-500 dark:text-gray-400`}>
                                {index + 1}
                              </td>
                              <td className={closureTableTdCls}>
                                <span
                                  className={`inline-flex w-[100px] items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-white ${
                                    isLent ? 'bg-green-600' : 'bg-red-600'
                                  }`}
                                >
                                  {isLent ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                                  {isLent ? 'A Receber' : 'A Pagar'}
                                </span>
                              </td>
                              <td className={`${closureTableTdCls} text-gray-900 dark:text-white`}>
                                {payment.description || 'Empréstimo'}
                              </td>
                              <td className={`${closureTableTdCls} text-right tabular-nums ${Math.abs(principalSigned) < 0.01 ? 'text-gray-900 dark:text-gray-100' : valueColor}`}>
                                {formatSignedCurrency(principalSigned)}
                              </td>
                              <td className={`${closureTableTdCls} text-right tabular-nums ${valueColor}`}>
                                {formatSignedCurrency(beforeSigned)}
                              </td>
                              <td className={`${closureTableTdCls} text-right tabular-nums ${valueColor}`}>
                                {formatSignedCurrency(paidSigned)}
                              </td>
                              <td className={`${closureTableTdCls} text-right tabular-nums ${remainingColor}`}>
                                {formatSignedCurrency(afterSigned)}
                              </td>
                              <td className={`${closureTableTdCls} text-center`}>
                                <span
                                  className={`inline-flex w-[100px] items-center justify-center gap-1.5 rounded px-3 py-1 text-xs font-medium text-white ${
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
                      {(() => {
                        const rows = filterRegularLoanPayments(closureLoanPayments)
                        const totals = rows.reduce(
                          (acc, payment) => {
                            const originalIsLent = payment.loan_type === 'lent'
                            const isLent = isClosurePartnerView ? !originalIsLent : originalIsLent
                            acc.principal += signedLoanFieldValue(payment.original_amount || 0, isLent, 'principal')
                            acc.before += signedLoanFieldValue(payment.remaining_before || 0, isLent, 'corrected')
                            acc.paid += signedLoanFieldValue(payment.amount_paid || 0, isLent, 'paid')
                            acc.after += signedLoanFieldValue(payment.remaining_after || 0, isLent, 'remaining')
                            return acc
                          },
                          { principal: 0, before: 0, paid: 0, after: 0 },
                        )
                        return (
                          <tfoot className={closureTableFootCls}>
                            <tr>
                              <td colSpan={3} className="px-3 py-2.5 font-semibold text-gray-800 dark:text-gray-100">
                                Total
                              </td>
                              <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${signedMoneyCls(totals.principal)}`}>
                                {formatSignedCurrency(totals.principal)}
                              </td>
                              <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${signedMoneyCls(totals.before)}`}>
                                {formatSignedCurrency(totals.before)}
                              </td>
                              <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${signedMoneyCls(totals.paid)}`}>
                                {formatSignedCurrency(totals.paid)}
                              </td>
                              <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${signedMoneyCls(totals.after)}`}>
                                {formatSignedCurrency(totals.after)}
                              </td>
                              <td className="px-3 py-2.5" />
                            </tr>
                          </tfoot>
                        )
                      })()}
                    </table>
                  </div>
                </CadastroFormSection>
              )}
            </CadastroModalBody>
            <CadastroModalFooter
              hideSave
              closeLabel="Fechar"
              onClose={() => {
                setShowDetailsModal(false)
                setSelectedClosure(null)
                setClosureItems([])
                setClosureLoanPayments([])
                setIsClosurePartnerView(false)
              }}
              leading={
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-4">
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
                    {filterRegularLoanPayments(closureLoanPayments).length > 0 && (
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

                    // Saldo = A Receber - A Pagar (+ crédito da quitação, se houver)
                    const settlementCreditSigned = selectedClosure
                      ? getSettlementCreditSignedForViewer(selectedClosure, !isClosurePartnerView)
                      : 0
                    const displayBalance = displayToReceive - displayToPay + settlementCreditSigned
                    const regularLoanCount = filterRegularLoanPayments(closureLoanPayments).length
                    const settlementCreditTotal = selectedClosure ? getSettlementCreditTotal(selectedClosure) : 0

                    return (
                      <div className="flex items-center gap-6">
                        {/* Saldo primeiro */}
                        <div className="text-right">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Saldo ({closureItems.length} {closureItems.length === 1 ? 'item' : 'itens'}
                            {regularLoanCount > 0 && ` + ${regularLoanCount} empréstimo${regularLoanCount > 1 ? 's' : ''}`}
                            {settlementCreditTotal > 0.01 && ', crédito quitação'})
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
                }
              />
            </CadastroModalShell>
          )}

        {/* Modal: Erro ao remover pagamento (empréstimo de crédito bloqueado) */}
        {paymentDeleteError && (
          <CadastroModalShell maxWidth="max-w-md" onBackdropClick={() => setPaymentDeleteError(null)} zClass="z-50">
            <CadastroModalHeader
              isEdit={false}
              title="Não foi possível remover"
              onClose={() => setPaymentDeleteError(null)}
              icon={<Trash2 size={18} />}
              iconStyle={{ backgroundColor: 'var(--color-delete)', color: 'var(--on-color-delete)' }}
            />
            <CadastroModalBody>
              <CadastroFormSection title="Empréstimos bloqueados" icon={<Trash2 size={14} />}>
                <p className="text-sm text-gray-600 dark:text-gray-400">{paymentDeleteError.message}</p>
                {paymentDeleteError.loans.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-100">
                    {paymentDeleteError.loans.map(loan => (
                      <li key={loan.id}>
                        <span className="font-medium">{loan.description}</span>
                        <span className="text-xs text-amber-700 dark:text-amber-300"> (#{loan.id})</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  Ajuste ou exclua esses empréstimos em Empréstimos e tente novamente.
                </p>
              </CadastroFormSection>
            </CadastroModalBody>
            <CadastroModalFooter onClose={() => setPaymentDeleteError(null)} hideSave closeLabel="Fechar" />
          </CadastroModalShell>
        )}

        {/* Modal: Reabrir (Remover Quitação) */}
        {showUnsettleModal && unsettleClosure && (
          <CadastroModalShell
            maxWidth="max-w-3xl"
            onBackdropClick={() => { setShowUnsettleModal(false); setUnsettleClosure(null); setUnsettleClearError(null) }}
            zClass="z-50"
          >
            <CadastroModalHeader
              isEdit={true}
              title="Remover Quitação"
              subtitle={`Fechamento ${String(unsettleClosure.month).padStart(2, '0')}/${unsettleClosure.year} será reaberto.`}
              onClose={() => { setShowUnsettleModal(false); setUnsettleClosure(null); setUnsettleClearError(null) }}
              icon={<Unlock size={18} />}
            />
            <CadastroModalBody>
              <CadastroFormSection title="Pagamentos registrados" icon={<Unlock size={14} />} bodyClassName="p-0">
                {(unsettleClosure.closure_payments || []).filter(p => p.active !== false).length > 0 ? (
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
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
                ) : (
                  <p className="px-3 py-3 text-sm italic text-gray-500 dark:text-gray-400">Nenhum pagamento registrado.</p>
                )}
              </CadastroFormSection>
              {unsettleClearError && (
                <CadastroFormSection title="Não é possível limpar os pagamentos" icon={<AlertTriangle size={14} />}>
                  <p className="text-sm text-amber-800 dark:text-amber-200">{unsettleClearError.message}</p>
                  {unsettleClearError.loans.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-100">
                      {unsettleClearError.loans.map(loan => (
                        <li key={loan.id}>
                          <span className="font-medium">{loan.description}</span>
                          <span className="text-xs text-amber-700 dark:text-amber-300"> (#{loan.id})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    Ajuste ou exclua esses empréstimos em Empréstimos e tente novamente.
                  </p>
                </CadastroFormSection>
              )}
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={() => { setShowUnsettleModal(false); setUnsettleClosure(null); setUnsettleClearError(null) }}
              saving={unsettleClearingAll}
              onSave={() => handleConfirmUnsettle((unsettleClosure.closure_payments || []).filter(p => p.active !== false).length > 0)}
              saveLabel={(unsettleClosure.closure_payments || []).filter(p => p.active !== false).length > 0
                ? 'Reabrir e limpar todos os pagamentos'
                : 'Reabrir sem alterar pagamentos'}
              saveTone={(unsettleClosure.closure_payments || []).filter(p => p.active !== false).length > 0 ? 'danger' : 'default'}
              saveIcon={(unsettleClosure.closure_payments || []).filter(p => p.active !== false).length > 0 ? <Trash2 size={15} /> : <Unlock size={15} />}
              secondaryActions={
                (unsettleClosure.closure_payments || []).filter(p => p.active !== false).length > 0 ? (
                  <button
                    type="button"
                    onClick={() => handleConfirmUnsettle(false)}
                    disabled={unsettleClearingAll}
                    className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ background: 'var(--color-edit)', color: 'var(--on-color-edit)' }}
                  >
                    <Unlock size={15} />
                    Reabrir sem alterar pagamentos
                  </button>
                ) : null
              }
            />
          </CadastroModalShell>
        )}
        {/* Modal: Marcar como Quitado */}
        {showSettleModal && selectedClosure && (
          <CadastroModalShell
            maxWidth="max-w-md"
            onBackdropClick={() => {
              setShowSettleModal(false)
              setSettlementNotes('')
            }}
            zClass="z-50"
          >
            <CadastroModalHeader
              isEdit={false}
              title="Marcar como Quitado"
              subtitle={`Confirma a quitação do fechamento de ${String(selectedClosure.month).padStart(2, '0')}/${selectedClosure.year}?`}
              onClose={() => {
                setShowSettleModal(false)
                setSettlementNotes('')
              }}
              icon={<CheckCircle size={18} />}
              iconStyle={{ backgroundColor: 'var(--color-success)', color: 'var(--on-color-success)' }}
            />
            <CadastroModalBody>
              <CadastroFormSection title="Quitação" icon={<CheckCircle size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel>Observações da quitação</CadastroFieldLabel>
                      <textarea
                        value={settlementNotes}
                        onChange={(e) => setSettlementNotes(e.target.value)}
                        placeholder="Ex: Pago via PIX, Transferência bancária, etc."
                        className={`${cadastroFieldCls} mt-0.5`}
                        rows={3}
                      />
                    </label>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={() => {
                setShowSettleModal(false)
                setSettlementNotes('')
              }}
              onSave={handleSettleClosure}
              saveLabel="Confirmar Quitação"
              saveTone="success"
            />
          </CadastroModalShell>
        )}

        {/* Modal: Registrar Pagamento Parcial */}
        {showPaymentModal && paymentClosure && (
          <CadastroModalShell
            maxWidth="max-w-md"
            zClass="z-50"
          >
            <CadastroModalHeader
              isEdit={false}
              title="Registrar Pagamento Parcial"
              onClose={() => { setShowPaymentModal(false); setPaymentClosure(null) }}
              icon={<CreditCard size={18} />}
            />
            <CadastroModalBody>
              <CadastroFormSection title="Pagamento" icon={<CreditCard size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow>
                    {(() => {
                      const remaining = parseFloat(String(paymentClosure.remaining_balance ?? Math.abs(paymentClosure.net_balance ?? 0)))
                      const isFullyPaid = remaining <= 0
                      const amountValue = parseInt(paymentAmountCents || '0', 10) / 100
                      const mandanteAReceber = parseFloat(String(paymentClosure.net_balance ?? 0)) > 0
                      const creditPreview = mandanteAReceber && amountValue > remaining + 0.01
                        ? amountValue - Math.max(remaining, 0)
                        : 0
                      const appliedPreview = creditPreview > 0 ? Math.max(remaining, 0) : amountValue
                      return (
                        <>
                          <div className={`rounded-lg border p-3 text-sm ${isFullyPaid ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20' : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'}`}>
                            <p className="mb-1 text-xs text-gray-600 dark:text-gray-400">Saldo devedor restante</p>
                            <p className={`text-lg font-bold ${isFullyPaid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                              {isFullyPaid ? formatCurrency(0) : `- ${formatCurrency(remaining)}`}
                            </p>
                          </div>
                          {creditPreview > 0.01 && (
                            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20">
                              <p className="mb-1 text-xs font-medium text-amber-800 dark:text-amber-200">Pagamento a maior</p>
                              <p className="text-sm text-amber-900 dark:text-amber-100">
                                {formatCurrency(appliedPreview)} quita o fechamento automaticamente.
                                {' '}{formatCurrency(creditPreview)} vira empréstimo <span className="font-semibold">a pagar</span> (crédito para o próximo mês).
                              </p>
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Valor do Pagamento</CadastroFieldLabel>
                      <div className="relative mt-0.5">
                        <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold ${parseInt(paymentAmountCents || '0') > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}`}>R$</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatAmountMask(paymentAmountCents)}
                          onChange={handlePaymentAmountChange}
                          className={`${cadastroFieldCls} pl-9 ${
                            parseInt(paymentAmountCents || '0') > 0
                              ? 'border-green-400 font-semibold text-green-700 dark:border-green-600 dark:text-green-300'
                              : ''
                          }`}
                          placeholder="0,00"
                        />
                      </div>
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Data do Pagamento</CadastroFieldLabel>
                      <BrazilianDatePicker
                        value={paymentDate}
                        onChange={setPaymentDate}
                        maxDate={new Date()}
                        className={`${cadastroFieldCls} mt-0.5`}
                      />
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel>Observações</CadastroFieldLabel>
                      <input
                        type="text"
                        value={paymentNotes}
                        onChange={e => setPaymentNotes(e.target.value)}
                        className={`${cadastroFieldCls} mt-0.5`}
                        placeholder="Ex: Transferência PIX..."
                      />
                    </label>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={() => { setShowPaymentModal(false); setPaymentClosure(null) }}
              onSave={handleAddPayment}
              saving={isSubmittingPayment}
              disabled={!paymentAmountCents || parseInt(paymentAmountCents) === 0 || !paymentDate}
              saveLabel="Registrar Pagamento"
              saveIcon={<Check size={15} />}
            />
          </CadastroModalShell>
        )}
        {/* Modal: Editar Pagamento */}
        {showEditPaymentModal && editingPaymentClosure && (
          <CadastroModalShell maxWidth="max-w-md" zClass="z-50">
            <CadastroModalHeader
              isEdit={true}
              title="Editar Pagamento"
              onClose={closeEditPaymentModal}
              icon={<CreditCard size={18} />}
            />
            <CadastroModalBody>
              <CadastroFormSection title="Pagamento" icon={<CreditCard size={14} />}>
                <CadastroModalFieldsGrid>
                  {(() => {
                    const otherPaid = (editingPaymentClosure.closure_payments || [])
                      .filter(p => p.id !== editingPaymentId)
                      .reduce((sum, p) => sum + parseFloat(String(p.amount ?? 0)), 0)
                    const debt = Math.abs(parseFloat(String(editingPaymentClosure.net_balance ?? 0)))
                    const remaining = Math.max(0, debt - otherPaid)
                    const amountValue = parseInt(editPaymentCents || '0', 10) / 100
                    const mandanteAReceber = parseFloat(String(editingPaymentClosure.net_balance ?? 0)) > 0
                    const creditPreview = mandanteAReceber && amountValue > remaining + 0.01
                      ? amountValue - remaining
                      : 0
                    if (creditPreview <= 0.01) return null
                    return (
                      <CadastroModalFieldsRow>
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20">
                          <p className="mb-1 text-xs font-medium text-amber-800 dark:text-amber-200">Pagamento a maior</p>
                          <p className="text-sm text-amber-900 dark:text-amber-100">
                            {formatCurrency(remaining)} quita o fechamento automaticamente.
                            {' '}{formatCurrency(creditPreview)} vira empréstimo <span className="font-semibold">a pagar</span> (crédito para o próximo mês).
                          </p>
                        </div>
                      </CadastroModalFieldsRow>
                    )
                  })()}
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel>Valor</CadastroFieldLabel>
                      <div className="relative mt-0.5">
                        <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold ${parseInt(editPaymentCents || '0') > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>R$</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatAmountMask(editPaymentCents)}
                          onChange={e => setEditPaymentCents(e.target.value.replace(/\D/g, ''))}
                          className={`${cadastroFieldCls} pl-10 ${parseInt(editPaymentCents || '0') > 0 ? 'border-green-400 font-semibold text-green-700 dark:text-green-300' : ''}`}
                          placeholder="0,00"
                        />
                      </div>
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel>Data</CadastroFieldLabel>
                      <BrazilianDatePicker
                        value={editPaymentDate}
                        onChange={setEditPaymentDate}
                        maxDate={new Date()}
                        className={`${cadastroFieldCls} mt-0.5`}
                      />
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel>Observações</CadastroFieldLabel>
                      <input
                        type="text"
                        value={editPaymentNotes}
                        onChange={e => setEditPaymentNotes(e.target.value)}
                        placeholder="Ex: Pago via PIX, Transferência bancária..."
                        className={`${cadastroFieldCls} mt-0.5`}
                      />
                    </label>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={closeEditPaymentModal}
              onSave={handleSavePaymentEdit}
              saving={isSavingPaymentEdit}
              disabled={!editPaymentCents || parseInt(editPaymentCents) === 0 || !editPaymentDate}
              saveLabel="Salvar"
              saveIcon={<Check size={15} />}
            />
          </CadastroModalShell>
        )}

        {/* Modal: Remover Liquidações de Empréstimos */}
        {showRemoveLoanPaymentsModal && removeLoanPaymentsClosure && (() => {
          const loanPayments = getClosureLoanPaymentsList(removeLoanPaymentsClosure)
            .filter((lp: any) => !lp.generated_on_settlement)
          const allSelected = selectedLoanIdsToRemove.size === loanPayments.length && loanPayments.length > 0
          const someSelected = selectedLoanIdsToRemove.size > 0 && selectedLoanIdsToRemove.size < loanPayments.length

          return (
            <CadastroModalShell
              maxWidth="max-w-5xl"
              maxHeight="max-h-[90vh]"
              onBackdropClick={() => {
                setShowRemoveLoanPaymentsModal(false)
                setRemoveLoanPaymentsClosure(null)
                setSelectedLoanIdsToRemove(new Set())
              }}
              zClass="z-50"
            >
              <CadastroModalHeader
                isEdit={true}
                title="Remover Liquidações de Empréstimos"
                subtitle={`${new Date(removeLoanPaymentsClosure.period_start_date).toLocaleDateString('pt-BR')} ${new Date(removeLoanPaymentsClosure.period_start_date).toLocaleTimeString('pt-BR')} — ${new Date(removeLoanPaymentsClosure.closing_date).toLocaleDateString('pt-BR')} ${new Date(removeLoanPaymentsClosure.closing_date).toLocaleTimeString('pt-BR')}`}
                onClose={() => {
                  setShowRemoveLoanPaymentsModal(false)
                  setRemoveLoanPaymentsClosure(null)
                  setSelectedLoanIdsToRemove(new Set())
                }}
                icon={<Banknote size={18} />}
              />
              <CadastroModalBody>
                <CadastroFormSection title="Liquidações" icon={<Banknote size={14} />} bodyClassName="p-0">
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
                          <thead className="border-b border-gray-200 dark:border-gray-700">
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
                          <tbody>
                            {loanPayments.map((payment: any) => {
                              const isSelected = selectedLoanIdsToRemove.has(payment.loan_id)
                              const isLent = payment.loan_type === 'lent'

                              return (
                                <tr
                                  key={payment.loan_id}
                                  className={`border-t border-t-gray-200 dark:border-t-gray-700 border-l-4 transition-all cursor-pointer ${
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
                </CadastroFormSection>
              </CadastroModalBody>
              <CadastroModalFooter
                onClose={() => {
                  setShowRemoveLoanPaymentsModal(false)
                  setRemoveLoanPaymentsClosure(null)
                  setSelectedLoanIdsToRemove(new Set())
                }}
                onSave={handleConfirmRemoveLoanPayments}
                saving={removingLoanPayments}
                disabled={selectedLoanIdsToRemove.size === 0}
                saveLabel="Remover Selecionados"
                saveTone="danger"
                saveIcon={<Trash2 size={15} />}
              />
            </CadastroModalShell>
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
  )
}

export default BalancoPage

