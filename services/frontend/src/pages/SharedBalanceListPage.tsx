import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { DateField } from '../components/date'
import { formatDateBR, parseLocalDate, dateToLocalString, getTodayLocalDate } from '../utils/dateUtils'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageEmptyCard,
  CadastroListPageHero,
  CadastroListPageLoading,
  CadastroListPageShell,
  CadastroListPageFilterCard,
  CadastroListPrimaryButton,
  CadastroFilterField,
  cadastroFilterFieldCls,
  cadastroRowIconBtnCls,
  cadastroRowIconDangerCls,
  reportRowActionBtnClass,
  listPageTableRowHoverCls,
  listPageTableStickyActionsCellCls,
  listPageTableStickyActionsHeaderCls,
  listPageTableTdCls,
} from '../components/CadastroListPageLayout'
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
import { selectionHeaderState } from '../utils/listTableSelection'
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
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import SharedClosureItemsModal from '../components/SharedClosureItemsModal'
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

const REALIZAR_PATH = '/fechamentos/compartilhado/realizar'

function getAccountDisplayName(account: Account | undefined) {
  if (!account) return 'Sem nome'
  return account.name || account.description || 'Sem nome'
}

function closureReferenceLabel(closure: BalanceClosure): string {
  const { month, year } = closure
  if (!month || !year) return '—'
  const monthName = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long' })
  return `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)}/${year}`
}

function closurePeriodEndRaw(closure: BalanceClosure): string {
  const data = closure.closure_data || {}
  return data.end_date || data.period?.end_date || closure.closing_date
}

function parseClosureDateTime(raw: string): Date {
  const normalized = String(raw).includes('T') ? raw : String(raw).replace(' ', 'T')
  return new Date(normalized)
}

const SharedBalanceListPage = () => {
  const { showConfirm, ConfirmComponent } = useConfirm()
  const navigate = useNavigate()
  const [selectedPartnerAccountId, setSelectedPartnerAccountId] = useState<number | null>(null)
  const [draftYear, setDraftYear] = useState('')
  const [appliedYear, setAppliedYear] = useState<number | 'all' | null>(null)
  const [filtersApplied, setFiltersApplied] = useState(false)
  const [loggedAccountId, setLoggedAccountId] = useState<number | null>(null)

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

  const closureReferenceFromPeriodEnd = (periodEnd: string) => {
    const raw = String(periodEnd)
    const iso = raw.includes('T') ? raw : `${raw.slice(0, 10)}T12:00:00`
    const d = new Date(iso)
    const year = d.getFullYear()
    const month = d.getMonth() + 1
    const monthName = d.toLocaleDateString('pt-BR', { month: 'long' })
    const label = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)}/${year}`
    return { year, month, label }
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
  const [settlementDate, setSettlementDate] = useState('')
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

        const response = await axios.get('/api/expense-sharing/')
        setPartners(response.data)
      } catch (error) {
        console.error('Erro ao carregar parceiros:', error)
      } finally {
        setInitialLoading(false)
        setIsFirstLoad(false)  // Marca que o primeiro carregamento foi concluído
      }
    }
    loadInitialData()
  }, [])

  useEffect(() => {
    if (isFirstLoad) return
    setFiltersApplied(false)
    setClosures([])
  }, [selectedPartnerAccountId, isFirstLoad])

  useEffect(() => {
    const container = closuresScrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const scrolled = container.scrollTop > 300
      setShowClosuresBackToTop(scrolled)
    }

    // Verifica scroll inicial
    handleScroll()

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [closures])

  const scrollToTopClosures = () => {
    setShowClosuresBackToTop(false)
    closuresScrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

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

  const loadClosures = async (yearFilter: number | 'all') => {
    if (!selectedPartnerAccountId) return
    setClosuresLoading(true)
    setSelectedClosureIds(new Set())
    try {
      const params: Record<string, number> = {}
      if (yearFilter !== 'all') {
        params.year = yearFilter
      }
      const sharing = partners.find((p) => p.shared_account_id === selectedPartnerAccountId)
      if (sharing) {
        params.expense_sharing_id = sharing.id
      }
      const response = await axios.get('/api/balance/closures', { params })
      setClosures(response.data.closures)
    } catch (error) {
      console.error('Erro ao carregar fechamentos:', error)
      setClosures([])
    } finally {
      setClosuresLoading(false)
    }
  }

  const applyListFilters = () => {
    if (!selectedPartnerAccountId) return
    const yearFilter = draftYear === '' ? 'all' : Number(draftYear)
    setAppliedYear(yearFilter)
    setFiltersApplied(true)
    void loadClosures(yearFilter)
  }

  const clearListFilters = () => {
    setSelectedPartnerAccountId(null)
    setDraftYear('')
    setAppliedYear(null)
    setFiltersApplied(false)
    setClosures([])
    setSelectedClosureIds(new Set())
  }

  const hasActiveListFilters =
    Boolean(selectedPartnerAccountId) || filtersApplied || draftYear !== ''

  const closureSelectHeaderState = useMemo(
    () => selectionHeaderState(
      closures.map((c) => c.id),
      selectedClosureIds,
    ),
    [closures, selectedClosureIds],
  )

  const filterResultHint = useMemo(() => {
    if (!filtersApplied) return undefined
    const yearLabel = appliedYear === 'all' ? 'Todos' : String(appliedYear)
    return `${closures.length} fechamento${closures.length === 1 ? '' : 's'} · ${yearLabel}`
  }, [filtersApplied, appliedYear, closures.length])

  const sortedPartners = useMemo(
    () =>
      [...partners].sort((a, b) =>
        getAccountDisplayName(a.shared_account).localeCompare(getAccountDisplayName(b.shared_account), 'pt-BR'),
      ),
    [partners],
  )

  const partnerSelectOptions = sortedPartners.map((partner) => {
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
  })

  const handleViewClosureDetails = async (closure: BalanceClosure) => {
    try {
      const response = await axios.get(`/api/balance/closures/${closure.id}`)
      setSelectedClosure(response.data.closure)

      const closureData = response.data.closure.closure_data
      const allItems: any[] = []
      const mainAccount = closureData.main_account_card
      const partnerAccount = closureData.partner_account_card

      const verifyResponse = await axios.get('/api/auth/verify')
      const viewerAccountId = verifyResponse.data.user?.account_id
      const isPartnerView = viewerAccountId === partnerAccount?.account_id

      const addSourceToItems = (items: any[], source: string, ownerAccount: any, counterpartAccount: any, isFromPartner: boolean) => {
        return items.map((item) => ({
          ...item,
          source_type: source,
          owner_account: {
            name: ownerAccount.account_name,
            number: ownerAccount.account_number,
            bank: ownerAccount.bank_name,
            agency: ownerAccount.agency,
          },
          counterpart_account: {
            name: counterpartAccount.account_name,
            number: counterpartAccount.account_number,
            bank: counterpartAccount.bank_name,
            agency: counterpartAccount.agency,
          },
          should_invert: isPartnerView !== isFromPartner,
        }))
      }

      if (mainAccount) {
        allItems.push(...addSourceToItems(mainAccount.expense_items || [], 'Conta Bancária', mainAccount, partnerAccount, false))
        allItems.push(...addSourceToItems(mainAccount.revenue_items || [], 'Conta Bancária', mainAccount, partnerAccount, false))
        allItems.push(...addSourceToItems(mainAccount.credit_card_expense_items || [], 'Cartão de Crédito', mainAccount, partnerAccount, false))
        allItems.push(...addSourceToItems(mainAccount.credit_card_revenue_items || [], 'Cartão de Crédito', mainAccount, partnerAccount, false))
        allItems.push(...addSourceToItems(mainAccount.benefit_card_expense_items || [], 'Cartão Benefício', mainAccount, partnerAccount, false))
        allItems.push(...addSourceToItems(mainAccount.benefit_card_revenue_items || [], 'Cartão Benefício', mainAccount, partnerAccount, false))
      }

      if (partnerAccount) {
        allItems.push(...addSourceToItems(partnerAccount.expense_items || [], 'Conta Bancária', partnerAccount, mainAccount, true))
        allItems.push(...addSourceToItems(partnerAccount.revenue_items || [], 'Conta Bancária', partnerAccount, mainAccount, true))
        allItems.push(...addSourceToItems(partnerAccount.credit_card_expense_items || [], 'Cartão de Crédito', partnerAccount, mainAccount, true))
        allItems.push(...addSourceToItems(partnerAccount.credit_card_revenue_items || [], 'Cartão de Crédito', partnerAccount, mainAccount, true))
        allItems.push(...addSourceToItems(partnerAccount.benefit_card_expense_items || [], 'Cartão Benefício', partnerAccount, mainAccount, true))
        allItems.push(...addSourceToItems(partnerAccount.benefit_card_revenue_items || [], 'Cartão Benefício', partnerAccount, mainAccount, true))
      }

      allItems.sort((left, right) => {
        const byDate = String(right.date || '').localeCompare(String(left.date || ''))
        if (byDate !== 0) return byDate
        return String(right.id ?? '').localeCompare(String(left.id ?? ''), undefined, { numeric: true })
      })
      setClosureItems(allItems)
      setIsClosurePartnerView(isPartnerView)
      setClosureLoanPayments(closureData.loan_payments || [])
      setShowDetailsModal(true)
    } catch (error) {
      console.error('Erro ao carregar detalhes do fechamento:', error)
      setToast({ show: true, message: 'Erro ao carregar detalhes do fechamento', type: 'error' })
    }
  }

  const handleSettleClosure = async () => {
    if (!selectedClosure || !settlementDate) return

    try {
      await axios.put(`/api/balance/closures/${selectedClosure.id}/settle`, {
        settlement_notes: settlementNotes || null,
        settlement_date: settlementDate,
      })

      setShowSettleModal(false)
      setShowDetailsModal(false)
      setSettlementNotes('')
      setClosureLoanPayments([])
      setToast({ show: true, message: 'Fechamento marcado como quitado!', type: 'success' })

      if (appliedYear != null) void loadClosures(appliedYear)
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
      if (appliedYear != null) void loadClosures(appliedYear)
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

          if (appliedYear != null) void loadClosures(appliedYear)
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
      if (appliedYear != null) void loadClosures(appliedYear)

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

  const clampCents = (digits: string, maxAmount: number): string => {
    const cents = parseInt(digits || '0', 10)
    const maxCents = Math.max(0, Math.round(maxAmount * 100))
    if (!cents) return ''
    return String(Math.min(cents, maxCents))
  }

  const paymentClosureRemaining = (closure: BalanceClosure): number =>
    Math.max(0, parseFloat(String(closure.remaining_balance ?? Math.abs(closure.net_balance ?? 0))))

  const editPaymentRemaining = (closure: BalanceClosure): number => {
    const otherPaid = (closure.closure_payments || [])
      .filter(p => p.id !== editingPaymentId)
      .reduce((sum, p) => sum + parseFloat(String(p.amount ?? 0)), 0)
    const debt = Math.abs(parseFloat(String(closure.net_balance ?? 0)))
    return Math.max(0, debt - otherPaid)
  }

  const handlePaymentAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '')
    setPaymentAmountCents(paymentClosure ? clampCents(digits, paymentClosureRemaining(paymentClosure)) : digits)
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
          if (appliedYear != null) void loadClosures(appliedYear)

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
          if (appliedYear != null) void loadClosures(appliedYear)
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
          if (appliedYear != null) void loadClosures(appliedYear)
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
              subtitle="Consulte fechamentos por parceiro e ano ou inicie um novo fechamento por período"
              actions={
                <CadastroListPrimaryButton
                  label="Realizar fechamento"
                  icon={<Archive size={18} />}
                  onClick={() => {
                    const q = selectedPartnerAccountId ? `?partner=${selectedPartnerAccountId}` : ''
                    navigate(`${REALIZAR_PATH}${q}`)
                  }}
                />
              }
            />
          }
          tabs={
            <CadastroListPageFilterCard
              hasActiveFilters={hasActiveListFilters}
              onClearFilters={clearListFilters}
              onApply={applyListFilters}
              applying={closuresLoading}
              applyDisabled={!selectedPartnerAccountId}
              resultHint={filterResultHint}
            >
              <CadastroFilterField label="Conta compartilhada" icon={<Building2 size={12} />}>
                <select
                  value={selectedPartnerAccountId || ''}
                  onChange={(e) =>
                    setSelectedPartnerAccountId(e.target.value ? parseInt(e.target.value, 10) : null)
                  }
                  className={cadastroFilterFieldCls}
                >
                  <option value="">Selecione...</option>
                  {partnerSelectOptions}
                </select>
              </CadastroFilterField>
              <CadastroFilterField label="Ano" icon={<Calendar size={12} />}>
                <select
                  value={draftYear}
                  onChange={(e) => setDraftYear(e.target.value)}
                  className={cadastroFilterFieldCls}
                >
                  <option value="">Todos</option>
                  {years.map((year) => (
                    <option key={year} value={String(year)}>
                      {year}
                    </option>
                  ))}
                </select>
              </CadastroFilterField>
            </CadastroListPageFilterCard>
          }
        >
          <>
            {closuresLoading && (
              <CadastroListPageLoading label="Carregando fechamentos…" />
            )}

            {!closuresLoading && !filtersApplied && (
              <CadastroListPageEmptyCard
                icon={<Filter size={32} className="text-gray-400" />}
                title="Nenhum filtro aplicado"
                description="Escolha o parceiro e o ano (ou Todos) e clique em Aplicar para listar os fechamentos."
              />
            )}

            {!closuresLoading && filtersApplied && (
              <div className="space-y-4">
                {selectedPartnerAccountId && (
                  <div className="mb-6 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Building2 size={16} className="text-color-primary" />
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {partners.find((p) => p.shared_account_id === selectedPartnerAccountId)?.shared_account?.name ||
                            'Conta parceira'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Calendar size={16} className="text-color-primary" />
                        Ano: {appliedYear === 'all' ? 'Todos' : appliedYear}
                      </div>
                    </div>
                  </div>
                )}

                {closures.length === 0 ? (
                  <CadastroListPageEmptyCard
                    icon={<Archive size={32} className="text-gray-400" />}
                    title="Nenhum fechamento encontrado"
                    description="Use Realizar fechamento para registrar um novo período."
                  />
                ) : (
                  <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Unlock className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" />
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
                          <CreditCard className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" />
                          <div>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Pago</p>
                            <p className="text-lg font-bold text-gray-900 dark:text-white">
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
                          <Banknote className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" />
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

                  <div className={selectedClosureIds.size > 0 || showClosuresBackToTop ? 'pb-20' : ''}>
                    <ListPageTable
                      framed
                      minWidth={980}
                      leadingMode="bulk"
                      colsRest={
                        <>
                          <ListTableSpacerCol />
                          <col style={{ width: 28, minWidth: 28, maxWidth: 28 }} />
                          <col />
                          <col style={{ width: '12%', minWidth: 120 }} />
                          <col style={{ width: '12%', minWidth: 120 }} />
                          <col />
                          <col style={{ width: '10%', minWidth: 96 }} />
                          <col style={{ width: '10%', minWidth: 96 }} />
                          <col style={{ width: '9%', minWidth: 88 }} />
                          <col style={{ width: 240, minWidth: 240 }} />
                        </>
                      }
                      head={
                        <tr>
                          <ListTableCheckboxHeader
                            state={closureSelectHeaderState}
                            onToggle={toggleSelectAll}
                          />
                          <ListTableIndexHeader />
                          <ListTableSpacerHeader />
                          <th className="w-7 max-w-[28px] p-0 align-middle" aria-hidden />
                          <ListTableStaticHeader label="Período" />
                          <ListTableStaticHeader label="Conta Principal" />
                          <ListTableStaticHeader label="Contraparte" />
                          <ListTableStaticHeader label="Valores" />
                          <ListTableStaticHeader label="Pagamentos" />
                          <ListTableStaticHeader label="Saldo" />
                          <ListTableStaticHeader label="Status" />
                          <ListTableStaticHeader
                            label="Ações"
                            className={`${listPageTableStickyActionsHeaderCls} w-[240px]`}
                          />
                        </tr>
                      }
                    >
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
                            className={`${listPageTableRowHoverCls} border-t border-t-gray-200 dark:border-t-gray-700 border-l-4 ${
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
                            <ListTableCheckboxCell
                              checked={selectedClosureIds.has(closure.id)}
                              onToggle={() => toggleClosureSelection(closure.id)}
                            />
                            <ListTableIndexCell index={index + 1} />
                            <ListTableSpacerCell />
                            <td className="w-7 max-w-[28px] p-0 align-middle">
                              {(closure.closure_payments || []).length > 0 ? (
                                <div className="flex h-full items-center justify-center">
                                  <button
                                    type="button"
                                    onClick={() => toggleClosureExpansion(closure.id)}
                                    className={cadastroRowIconBtnCls}
                                    title={expandedClosureIds.has(closure.id) ? 'Colapsar pagamentos' : 'Expandir pagamentos'}
                                  >
                                    {expandedClosureIds.has(closure.id) ? (
                                      <ChevronDown size={14} />
                                    ) : (
                                      <ChevronRight size={14} />
                                    )}
                                  </button>
                                </div>
                              ) : null}
                            </td>
                            {/* Coluna Período — Início + Fim mesclados */}
                            <td className={listPageTableTdCls}>
                              <div className="flex flex-col items-start gap-1 text-left">
                                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                  {closureReferenceLabel(closure)}
                                </span>
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 w-5 shrink-0">De</span>
                                  <span className="text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                    {parseClosureDateTime(closure.period_start_date).toLocaleDateString('pt-BR')}
                                  </span>
                                  <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                                    {parseClosureDateTime(closure.period_start_date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 w-5 shrink-0">Até</span>
                                  <span className="text-xs font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                                    {parseClosureDateTime(closurePeriodEndRaw(closure)).toLocaleDateString('pt-BR')}
                                  </span>
                                  <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                                    {parseClosureDateTime(closurePeriodEndRaw(closure)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                {closure.notes && (
                                  <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-[130px]">• {closure.notes}</span>
                                )}
                              </div>
                            </td>
                            <td className={`${listPageTableTdCls} max-w-[150px]`}>
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
                            <td className={`${listPageTableTdCls} max-w-[150px]`}>
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
                            <td className={listPageTableTdCls}>
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="text-xs font-medium text-green-600 dark:text-green-400 whitespace-nowrap">
                                  ↑ {formatCurrency(displayToReceive)}
                                </span>
                                <span className="text-xs font-medium text-red-600 dark:text-red-400 whitespace-nowrap">
                                  ↓ {formatCurrency(displayToPay)}
                                </span>
                              </div>
                            </td>
                            {/* Coluna Pagamentos (antes do Saldo) */}
                            <td className={`${listPageTableTdCls} whitespace-nowrap`}>
                              {(() => {
                                const totalPaid = parseFloat(String(closure.total_paid ?? 0))
                                const paymentsCount = (closure.closure_payments || []).length
                                return paymentsCount > 0 ? (
                                  <div className="flex flex-col items-start gap-0.5">
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
                                  <td className={`${listPageTableTdCls} whitespace-nowrap ${
                                    settlementCreditSigned > 0
                                      ? 'text-green-600 dark:text-green-400'
                                      : settlementCreditSigned < 0
                                      ? 'text-red-600 dark:text-red-400'
                                      : 'text-gray-600 dark:text-gray-400'
                                  }`}>
                                    <div className="flex flex-col items-start">
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
                                <td className={`${listPageTableTdCls} whitespace-nowrap ${
                                  displayBalance > 0
                                    ? 'text-green-600 dark:text-green-400'
                                    : displayBalance < 0
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-gray-600 dark:text-gray-400'
                                }`}>
                                  <div className="flex flex-col items-start">
                                    <span className="font-medium">{formatSignedCurrency(displayBalance)}</span>
                                    {isRemainingView && (
                                      <span className="text-[10px] text-gray-400 dark:text-gray-500">restante</span>
                                    )}
                                  </div>
                                </td>
                              )
                            })()}
                            <td className={listPageTableTdCls}>
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
                            <td
                              className={`${listPageTableStickyActionsCellCls} overflow-hidden ${
                                selectedClosureIds.has(closure.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                              }`}
                            >
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleViewClosureDetails(closure)}
                                  className={cadastroRowIconBtnCls}
                                  title="Ver detalhes do fechamento"
                                >
                                  <Eye size={15} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setExportTargetClosure(closure as any); setShowExportModal(true) }}
                                  className={cadastroRowIconBtnCls}
                                  title="Exportar fechamento"
                                >
                                  <Download size={15} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setJsonClosureData(closure.closure_data)
                                    setShowJsonModal(true)
                                    setJsonCopied(false)
                                  }}
                                  className={cadastroRowIconBtnCls}
                                  title="Ver JSON completo"
                                >
                                  <Braces size={15} />
                                </button>
                                {!closure.is_settled && (() => {
                                  const noBalance = parseFloat(String(closure.remaining_balance ?? Math.abs(parseFloat(String(closure.net_balance ?? 0))))) <= 0.01
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => !noBalance && openPaymentModal(closure)}
                                      disabled={noBalance}
                                      className={reportRowActionBtnClass(!noBalance)}
                                      title={noBalance ? 'Saldo zerado' : 'Registrar pagamento parcial'}
                                    >
                                      <CreditCard size={15} />
                                    </button>
                                  )
                                })()}
                                {!closure.is_settled ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedClosure(closure)
                                      setSettlementDate('')
                                      setShowSettleModal(true)
                                    }}
                                    className={cadastroRowIconBtnCls}
                                    title="Marcar como quitado"
                                  >
                                    <CheckCircle size={15} />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleUnsettleClosure(closure)}
                                    className={cadastroRowIconBtnCls}
                                    title="Remover quitação"
                                  >
                                    <CheckCircle size={15} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => hasRemovableLoanLiquidations && !closure.is_settled && handleOpenRemoveLoanPaymentsModal(closure)}
                                  disabled={!hasRemovableLoanLiquidations || closure.is_settled}
                                  className={reportRowActionBtnClass(hasRemovableLoanLiquidations && !closure.is_settled)}
                                  title={
                                    closure.is_settled
                                      ? 'Remova a quitação para poder remover liquidações de empréstimos'
                                      : hasRemovableLoanLiquidations
                                        ? 'Remover liquidações de empréstimos deste fechamento'
                                        : 'Este fechamento não possui liquidações de empréstimos'
                                  }
                                >
                                  <Banknote size={15} />
                                </button>
                                {!closure.is_settled && (
                                  <button
                                    type="button"
                                    onClick={() => handleReopenClosure(closure)}
                                    className={cadastroRowIconDangerCls}
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
                                <td colSpan={11} className="pl-10 pr-4 py-2">
                                  <div className="flex items-center gap-2">
                                    <div className="w-1 h-4 rounded-full bg-indigo-500 dark:bg-indigo-400 shrink-0" />
                                    <CreditCard size={13} className="text-gray-500 dark:text-gray-400" />
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
                                <td className="sticky right-0 z-10 bg-indigo-50 py-2 px-3 dark:bg-indigo-900/15" />
                              </tr>
                              {/* Cabeçalho das colunas — alinhado com as colunas da tabela pai */}
                              <tr className="bg-gray-50 dark:bg-gray-700/40 border-t border-gray-200 dark:border-gray-700 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                <td className="w-8 align-middle px-2 py-1.5" />
                                <td className="w-8 align-middle px-2 py-1.5 text-left">#</td>
                                <td className="list-page-table-spacer w-1 p-0 align-middle" />
                                <td className="w-7 max-w-[28px] p-0 align-middle" />
                                <td className="align-middle px-4 py-1.5 text-left">Data</td>
                                <td className="align-middle px-3 py-1.5 text-left">Valor pago</td>
                                <td className="align-middle px-3 py-1.5" colSpan={5}>
                                  Observação
                                </td>
                                <td className="sticky right-0 z-10 w-[175px] align-middle bg-gray-50 px-3 py-1.5 dark:bg-gray-700/40">
                                  Ações
                                </td>
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
                                  <td className="w-8 align-middle px-2 py-2" />
                                  {/* select — índice do pagamento */}
                                  <td className="w-8 align-middle px-2 py-2 text-left text-xs font-medium text-gray-400 dark:text-gray-500">
                                    {payIdx + 1}
                                  </td>
                                  <td className="list-page-table-spacer w-1 p-0 align-middle" />
                                  <td className="w-7 max-w-[28px] p-0 align-middle" />
                                  {/* Período → data do pagamento */}
                                  <td className={`${listPageTableTdCls} py-2 text-xs whitespace-nowrap align-middle`}>
                                    {new Date(payment.payment_date).toLocaleDateString('pt-BR')}
                                  </td>
                                  {/* Conta Principal → valor pago (alinhado à direita) */}
                                  <td className="align-middle px-3 py-2 text-left text-xs font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">
                                    {formatCurrency(parseFloat(String(payment.amount)))}
                                  </td>
                                  {/* Contraparte + Valores + Pagamentos + Saldo + Status → observação (colSpan=5) */}
                                  <td colSpan={5} className="align-middle px-3 py-2 text-xs text-gray-500 dark:text-gray-400 truncate overflow-hidden">
                                    {payment.notes || <span className="italic text-gray-300 dark:text-gray-600">—</span>}
                                  </td>
                                  {/* Ações — sticky */}
                                  <td
                                    className={`sticky right-0 z-10 align-middle py-2 px-3 ${rowBg} hover:bg-indigo-50/60 dark:hover:bg-indigo-900/20`}
                                  >
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
                                      <td colSpan={11} className="pl-10 pr-4 py-2">
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
                                      <td className="sticky right-0 z-10 bg-amber-50 py-2 px-3 dark:bg-amber-900/15" />
                                    </tr>
                                    {settlementCredits.map((credit, ci) => (
                                      <tr key={`credit-${credit.loan_id ?? ci}`} className="border-t border-amber-100 dark:border-amber-900/30 bg-amber-50/50 dark:bg-amber-900/10">
                                        <td className="w-8 align-middle px-2 py-2" />
                                        <td className="w-8 align-middle px-2 py-2 text-left text-xs text-amber-600 dark:text-amber-400">
                                          {ci + 1}
                                        </td>
                                        <td className="list-page-table-spacer w-1 p-0 align-middle" />
                                        <td className="w-7 max-w-[28px] p-0 align-middle" />
                                        <td className="align-middle px-3 py-2 text-xs text-gray-600 dark:text-gray-400" colSpan={2}>
                                          {credit.description || 'Crédito da quitação'}
                                        </td>
                                        <td colSpan={5} className="align-middle px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                                          Empréstimo a pagar · #{credit.loan_id}
                                        </td>
                                        <td className="sticky right-0 z-10 align-middle bg-amber-50/50 py-2 px-3 text-left text-xs font-semibold text-red-600 dark:bg-amber-900/10 dark:text-red-400">
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
                                <td colSpan={11} className="pb-0"></td>
                                <td className="sticky right-0 z-10 bg-white pb-0 dark:bg-gray-800"></td>
                              </tr>
                            </React.Fragment>
                          )}
                          </React.Fragment>
                          )
                        })}
                    </ListPageTable>
                  </div>
                  </>
                )}
              </div>
            )}
          </>
        </CadastroListPageBody>
      </CadastroListPageShell>

        {/* Barra Flutuante de Ações em Lote - Fixed no rodapé, respeita o sidebar */}
        {filtersApplied && selectedClosureIds.size > 0 && (() => {
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
        {filtersApplied && showClosuresBackToTop && selectedClosureIds.size === 0 && (
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
        {/* Modal: Detalhes do Fechamento - Itens */}
        {showDetailsModal && selectedClosure && (
          <SharedClosureItemsModal
            closure={selectedClosure}
            items={closureItems}
            loanPayments={closureLoanPayments}
            isPartnerView={isClosurePartnerView}
            onClose={() => {
              setShowDetailsModal(false)
              setSelectedClosure(null)
              setClosureItems([])
              setClosureLoanPayments([])
              setIsClosurePartnerView(false)
            }}
          />
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
                      <CadastroFieldLabel required>Data da quitação</CadastroFieldLabel>
                      <DateField
                        value={settlementDate}
                        onChange={setSettlementDate}
                        maxDate={new Date()}
                        className={`${cadastroFieldCls} mt-0.5`}
                      />
                    </label>
                  </CadastroModalFieldsRow>
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
              disabled={!settlementDate}
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
                      const remaining = paymentClosureRemaining(paymentClosure)
                      const isFullyPaid = remaining <= 0
                      return (
                        <div className={`rounded-lg border p-3 text-sm ${isFullyPaid ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20' : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'}`}>
                          <p className="mb-1 text-xs text-gray-600 dark:text-gray-400">Saldo devedor restante</p>
                          <p className={`text-lg font-bold ${isFullyPaid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {isFullyPaid ? formatCurrency(0) : `- ${formatCurrency(remaining)}`}
                          </p>
                        </div>
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
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Máximo: {formatCurrency(paymentClosureRemaining(paymentClosure))}
                      </p>
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Data do Pagamento</CadastroFieldLabel>
                      <DateField
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
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel>Valor</CadastroFieldLabel>
                      <div className="relative mt-0.5">
                        <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold ${parseInt(editPaymentCents || '0') > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>R$</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatAmountMask(editPaymentCents)}
                          onChange={e => setEditPaymentCents(
                            clampCents(e.target.value.replace(/\D/g, ''), editPaymentRemaining(editingPaymentClosure)),
                          )}
                          className={`${cadastroFieldCls} pl-10 ${parseInt(editPaymentCents || '0') > 0 ? 'border-green-400 font-semibold text-green-700 dark:text-green-300' : ''}`}
                          placeholder="0,00"
                        />
                      </div>
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel>Data</CadastroFieldLabel>
                      <DateField
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

export default SharedBalanceListPage

