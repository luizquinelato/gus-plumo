import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { DateField } from '../components/date'
import { formatDateBR, parseLocalDate, dateToLocalString, dateToLocalTimestamp, getTodayLocalDate } from '../utils/dateUtils'
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
  listPageTableSectionCls,
} from '../components/CadastroListPageLayout'
import { ListPageNestedTable } from '../components/ListPageTable'
import BulkSelectCheckbox from '../components/BulkSelectCheckbox'
import {
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
  cadastroAccentControlCls,
  cadastroFieldCls,
  cadastroOptionLabelCls,
} from '../components/CadastroFormLayout'
import FloatingFooterBar from '../components/FloatingFooterBar'
import Toast from '../components/Toast'
import LoadingSpinner from '../components/LoadingSpinner'
import BalanceDetailsModal from '../components/BalanceDetailsModal'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import {
  buildSharedAccountNameColorMap,
  sharedAccountNameColorClass,
} from '../utils/sharedAccountNameColors'
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
import { Scale, Calendar, Building2, TrendingUp, TrendingDown, Minus, Receipt, Archive, Eye, Lock, Unlock, ChevronDown, ChevronUp, Landmark, Gift, FileJson, Braces, Copy, Check, CheckCircle, Clock, Trash2, ChevronRight, AlertTriangle, X, Download, Filter, Search, Banknote, HelpCircle, ArrowUpCircle, ArrowDownCircle, ArrowUp, ArrowDown, ArrowLeftRight, UnfoldVertical, FoldVertical, CheckSquare, Square, MinusSquare, Plus, MessageSquare, Pencil, RefreshCw } from 'lucide-react'
import { exportBalanceClosureToPDF } from '../utils/pdfExport'
import { exportBalanceClosureToExcel } from '../utils/exportToExcel'
import { ExportClosureModal } from '../components/ExportClosureModal'
import ClosureRecalculateModal from '../components/ClosureRecalculateModal'

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

const cardListItemCls =
  'rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800'
const closureCardPendingCls = `${cardListItemCls} border-l-4 border-l-amber-500`
const closureCardSettledCls =
  `${cardListItemCls} border-l-4 border-l-green-500 bg-green-50/50 dark:bg-green-900/10`

/** Colunas de dados repartem o espaço igualmente; só `#` + spacer fixos. */
const closureNestedCols4 = (
  <>
    <ListTableSpacerCol />
    <col />
    <col />
    <col />
    <col />
  </>
)
const closureNestedCols3 = (
  <>
    <ListTableSpacerCol />
    <col />
    <col />
    <col />
  </>
)
const closureNestedCols5 = (
  <>
    <ListTableSpacerCol />
    <col />
    <col />
    <col />
    <col />
    <col />
  </>
)

function ClosureExpandSectionTitle({
  icon,
  title,
  count,
  trailing,
  tone = 'indigo',
}: {
  icon: React.ReactNode
  title: string
  count?: number
  trailing?: React.ReactNode
  tone?: 'indigo' | 'amber'
}) {
  const toneCls =
    tone === 'amber'
      ? 'text-amber-800 dark:text-amber-200'
      : 'text-indigo-700 dark:text-indigo-300'
  const barCls = tone === 'amber' ? 'bg-amber-500' : 'bg-indigo-500 dark:bg-indigo-400'
  const countCls =
    tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-indigo-400 dark:text-indigo-500'
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className={`h-4 w-1 shrink-0 rounded-full ${barCls}`} />
      {icon}
      <span className={`text-xs font-semibold uppercase tracking-wide ${toneCls}`}>{title}</span>
      {count != null && count > 0 ? (
        <span className={`text-xs ${countCls}`}>({count})</span>
      ) : null}
      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  )
}

function getAccountDisplayName(account: Account | undefined) {
  if (!account) return 'Sem nome'
  return account.name || account.description || 'Sem nome'
}

/** Data no formato do input datetime-local (YYYY-MM-DDTHH:MM, horário local). */
function toLocalDateTimeInput(date: Date = new Date()): string {
  return dateToLocalTimestamp(date).slice(0, 16).replace(' ', 'T')
}

function nowLocalDateTimeInput(): string {
  return toLocalDateTimeInput()
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

/** Default da quitação manual: fim do período do balanço (limitado a agora). */
function closureSettleDefaultInput(closure: BalanceClosure): string {
  const now = nowLocalDateTimeInput()
  const end = parseClosureDateTime(closurePeriodEndRaw(closure))
  if (Number.isNaN(end.getTime())) return now
  const value = toLocalDateTimeInput(end)
  return value > now ? now : value
}

const SharedBalanceListPage = () => {
  const { showConfirm, ConfirmComponent } = useConfirm()
  const navigate = useNavigate()
  const [draftPartnerAccountId, setDraftPartnerAccountId] = useState<number | null>(null)
  const [appliedPartnerAccountId, setAppliedPartnerAccountId] = useState<number | null>(null)
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
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })

  // Estados para fechamentos
  const [closures, setClosures] = useState<BalanceClosure[]>([])
  const [selectedClosure, setSelectedClosure] = useState<BalanceClosure | null>(null)
  const [closureItems, setClosureItems] = useState<BalanceClosureItem[]>([])
  const [closureLoanPayments, setClosureLoanPayments] = useState<any[]>([])  // Pagamentos de empréstimos do fechamento
  const [isClosurePartnerView, setIsClosurePartnerView] = useState(false)  // Se estamos vendo da perspectiva da conta parceira
  const [showClosureModal, setShowClosureModal] = useState(false)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [isSettlingClosure, setIsSettlingClosure] = useState(false)
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
  const [recalcClosure, setRecalcClosure] = useState<BalanceClosure | null>(null)

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
  const [unsettleClearPayments, setUnsettleClearPayments] = useState(true)
  const [unsettleClearLoans, setUnsettleClearLoans] = useState(true)
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
  const [paymentModalMode, setPaymentModalMode] = useState<'partial' | 'settle'>('partial')
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false)
  // Estados para modal de edição de pagamento
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false)
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null)
  const [editingPaymentClosure, setEditingPaymentClosure] = useState<BalanceClosure | null>(null)
  const [editPaymentCents, setEditPaymentCents] = useState('')
  const [editPaymentDate, setEditPaymentDate] = useState('')
  const [editPaymentNotes, setEditPaymentNotes] = useState('')
  const [isSavingPaymentEdit, setIsSavingPaymentEdit] = useState(false)

  const [reopenModalClosure, setReopenModalClosure] = useState<BalanceClosure | null>(null)
  const [reopenClearPayments, setReopenClearPayments] = useState(true)
  const [reopenClearLoans, setReopenClearLoans] = useState(true)
  const [reopenExecuting, setReopenExecuting] = useState(false)

  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false)
  const [bulkDeleteClearPayments, setBulkDeleteClearPayments] = useState(true)
  const [bulkDeleteClearLoans, setBulkDeleteClearLoans] = useState(true)
  const [bulkUnsettleClosures, setBulkUnsettleClosures] = useState<BalanceClosure[] | null>(null)
  const [bulkUnsettleClearPayments, setBulkUnsettleClearPayments] = useState(true)
  const [bulkUnsettleClearLoans, setBulkUnsettleClearLoans] = useState(true)
  const [bulkSettleClosures, setBulkSettleClosures] = useState<BalanceClosure[] | null>(null)
  const [bulkSettleMode, setBulkSettleMode] = useState<'today' | 'manual'>('today')
  const [bulkSettleDates, setBulkSettleDates] = useState<Record<number, string>>({})

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
      }
    }
    loadInitialData()
  }, [])

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

  const loadClosures = async (
    yearFilter: number | 'all',
    partnerAccountId: number | null = appliedPartnerAccountId,
  ) => {
    setClosuresLoading(true)
    setSelectedClosureIds(new Set())
    try {
      const params: Record<string, number> = { limit: 1000 }
      if (yearFilter !== 'all') {
        params.year = yearFilter
      }
      if (partnerAccountId) {
        const sharing = partners.find((p) => p.shared_account_id === partnerAccountId)
        if (sharing) {
          params.expense_sharing_id = sharing.id
        }
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
    const yearFilter = draftYear === '' ? 'all' : Number(draftYear)
    setAppliedPartnerAccountId(draftPartnerAccountId)
    setAppliedYear(yearFilter)
    setFiltersApplied(true)
    void loadClosures(yearFilter, draftPartnerAccountId)
  }

  const clearListFilters = () => {
    setDraftPartnerAccountId(null)
    setAppliedPartnerAccountId(null)
    setDraftYear('')
    setAppliedYear('all')
    setSelectedClosureIds(new Set())
    setFiltersApplied(true)
    void loadClosures('all', null)
  }

  const hasActiveListFilters =
    Boolean(draftPartnerAccountId) ||
    draftYear !== '' ||
    Boolean(appliedPartnerAccountId) ||
    (appliedYear !== null && appliedYear !== 'all')

  const closureSelectHeaderState = useMemo(
    () => selectionHeaderState(
      closures.map((c) => c.id),
      selectedClosureIds,
    ),
    [closures, selectedClosureIds],
  )

  const filterResultHint = useMemo(() => {
    if (!filtersApplied) return undefined
    const partnerLabel = appliedPartnerAccountId
      ? getAccountDisplayName(
          partners.find((p) => p.shared_account_id === appliedPartnerAccountId)?.shared_account,
        )
      : 'Todos os parceiros'
    const yearLabel = appliedYear === 'all' ? 'Todos os anos' : String(appliedYear)
    return `${closures.length} fechamento${closures.length === 1 ? '' : 's'} · ${partnerLabel} · ${yearLabel}`
  }, [filtersApplied, appliedYear, closures.length, appliedPartnerAccountId, partners])

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
    const closure = paymentClosure ?? selectedClosure
    if (!closure || !settlementDate) return

    setIsSettlingClosure(true)
    try {
      await axios.put(`/api/balance/closures/${closure.id}/settle`, {
        settlement_notes: settlementNotes || null,
        settlement_date: settlementDate,
      })

      setShowPaymentModal(false)
      setPaymentClosure(null)
      setPaymentAmountCents('')
      setShowDetailsModal(false)
      setSelectedClosure(null)
      setSettlementNotes('')
      setSettlementDate('')
      setClosureLoanPayments([])
      setToast({ show: true, message: 'Fechamento marcado como quitado!', type: 'success' })

      if (appliedYear != null) void loadClosures(appliedYear)
    } catch (error: any) {
      console.error('Erro ao quitar fechamento:', error)
      setToast({ show: true, message: error.response?.data?.detail || 'Erro ao quitar fechamento', type: 'error' })
    } finally {
      setIsSettlingClosure(false)
    }
  }

  const handleUnsettleClosure = (closure: BalanceClosure) => {
    const activePayments = (closure.closure_payments || []).filter((p) => p.active !== false)
    const loanLiq = filterRegularLoanPayments(getClosureLoanPaymentsList(closure))
    setUnsettleClearPayments(activePayments.length > 0)
    setUnsettleClearLoans(loanLiq.length > 0)
    setUnsettleClosure(closure)
    setUnsettleClearError(null)
    setShowUnsettleModal(true)
  }

  const handleConfirmUnsettle = async (options: { clearPayments: boolean; clearLoanLiquidations: boolean }) => {
    if (!unsettleClosure) return
    setUnsettleClearingAll(true)
    setUnsettleClearError(null)
    try {
      if (options.clearLoanLiquidations) {
        const loanIds = filterRegularLoanPayments(getClosureLoanPaymentsList(unsettleClosure)).map(
          (lp: { loan_id: number }) => lp.loan_id,
        )
        if (loanIds.length > 0) {
          await axios.delete(`/api/balance/closures/${unsettleClosure.id}/loan-payments`, {
            data: { loan_ids: loanIds },
          })
        }
      }
      if (options.clearPayments) {
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
        options.clearPayments &&
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

  const executeDeleteClosure = async (
    closure: BalanceClosure,
    options: { clearPayments: boolean; clearLoans: boolean },
  ) => {
    if (options.clearLoans) {
      const loanIds = filterRegularLoanPayments(getClosureLoanPaymentsList(closure)).map(
        (lp: { loan_id: number }) => lp.loan_id,
      )
      if (loanIds.length > 0) {
        await axios.delete(`/api/balance/closures/${closure.id}/loan-payments`, {
          data: { loan_ids: loanIds },
        })
      }
    }
    if (options.clearPayments) {
      await axios.delete(`/api/balance/closures/${closure.id}/payments`)
    }
    await axios.delete(`/api/balance/closures/${closure.id}`)
  }

  const deleteClosureIncludingSettled = async (
    closure: BalanceClosure,
    options: { clearPayments: boolean; clearLoans: boolean },
  ) => {
    if (closure.is_settled) {
      if (options.clearLoans) {
        const loanIds = filterRegularLoanPayments(getClosureLoanPaymentsList(closure)).map(
          (lp: { loan_id: number }) => lp.loan_id,
        )
        if (loanIds.length > 0) {
          await axios.delete(`/api/balance/closures/${closure.id}/loan-payments`, {
            data: { loan_ids: loanIds },
          })
        }
      }
      if (options.clearPayments) {
        await axios.delete(`/api/balance/closures/${closure.id}/payments`)
      }
      await axios.delete(`/api/balance/closures/${closure.id}/settle`)
    }
    await executeDeleteClosure(closure, options)
  }

  const handleReopenClosure = (closure: BalanceClosure) => {
    if (closure.is_settled) {
      setToast({
        show: true,
        message: 'Fechamento quitado: use o ícone de quitado para remover a quitação antes de excluir.',
        type: 'warning',
      })
      return
    }

    const activePayments = (closure.closure_payments || []).filter((p) => p.active !== false)
    const loanLiq = filterRegularLoanPayments(getClosureLoanPaymentsList(closure))
    if (activePayments.length > 0 || loanLiq.length > 0) {
      setReopenModalClosure(closure)
      setReopenClearPayments(activePayments.length > 0)
      setReopenClearLoans(loanLiq.length > 0)
      return
    }

    showConfirm(
      'Excluir fechamento',
      `Deseja excluir o fechamento de ${String(closure.month).padStart(2, '0')}/${closure.year}? Será possível fechar o período novamente.`,
      async () => {
        try {
          await executeDeleteClosure(closure, { clearPayments: false, clearLoans: false })
          setToast({ show: true, message: 'Fechamento excluído com sucesso!', type: 'success' })
          if (appliedYear != null) void loadClosures(appliedYear)
        } catch (error: any) {
          console.error('Erro ao excluir fechamento:', error)
          setToast({
            show: true,
            message: error.response?.data?.detail || 'Erro ao excluir fechamento',
            type: 'error',
          })
        }
      },
      'Excluir',
      'Cancelar',
    )
  }

  const handleConfirmReopenClosure = async () => {
    if (!reopenModalClosure) return
    setReopenExecuting(true)
    try {
      await executeDeleteClosure(reopenModalClosure, {
        clearPayments: reopenClearPayments,
        clearLoans: reopenClearLoans,
      })
      setToast({ show: true, message: 'Fechamento excluído com sucesso!', type: 'success' })
      setReopenModalClosure(null)
      if (appliedYear != null) void loadClosures(appliedYear)
    } catch (error: any) {
      console.error('Erro ao excluir fechamento:', error)
      setToast({
        show: true,
        message: error.response?.data?.detail || 'Erro ao excluir fechamento',
        type: 'error',
      })
    } finally {
      setReopenExecuting(false)
    }
  }

  const handleRemoveClosureLoanLiquidation = (
    closure: BalanceClosure,
    loanId: number,
    description: string,
  ) => {
    if (closure.is_settled) {
      setToast({
        show: true,
        message: 'Remova a quitação antes de alterar liquidações de empréstimo.',
        type: 'warning',
      })
      return
    }
    showConfirm(
      'Remover liquidação de empréstimo',
      `Remover a liquidação "${description || 'Empréstimo'}"? O empréstimo será reaberto.`,
      async () => {
        try {
          await axios.delete(`/api/balance/closures/${closure.id}/loan-payments`, {
            data: { loan_ids: [loanId] },
          })
          setToast({ show: true, message: 'Liquidação removida.', type: 'success' })
          if (appliedYear != null) void loadClosures(appliedYear)
        } catch (error: any) {
          setToast({
            show: true,
            message: error.response?.data?.detail || 'Erro ao remover liquidação',
            type: 'error',
          })
        }
      },
      'Remover',
      'Cancelar',
    )
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
    let openReceive = 0
    let openPay = 0
    let loanReceiveOpen = 0
    let loanPayOpen = 0
    let pendingCount = 0
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

      loanPaymentsCount += filterRegularLoanPayments(getClosureLoanPaymentsList(closure)).length

      if (closure.is_settled) {
        return
      }

      pendingCount += 1
      openReceive += totalToReceive
      openPay += Math.abs(totalToPay)
      loanReceiveOpen += loanToReceive
      loanPayOpen += Math.abs(loanToPay)
    })

    return {
      openReceive,
      openPay,
      loanReceiveOpen,
      loanPayOpen,
      pendingCount,
      loanPaymentsCount,
    }
  }, [closures, loggedAccountId])

  const closureAccountNameColors = useMemo(() => {
    const ids: number[] = []
    if (loggedAccountId != null) ids.push(Number(loggedAccountId))
    for (const partner of partners) {
      if (partner.shared_account_id) ids.push(Number(partner.shared_account_id))
    }
    for (const closure of closures) {
      const mainId = closure.closure_data?.main_account_card?.account_id
      const partnerId = closure.closure_data?.partner_account_card?.account_id
      if (mainId) ids.push(Number(mainId))
      if (partnerId) ids.push(Number(partnerId))
    }
    return buildSharedAccountNameColorMap(ids, loggedAccountId)
  }, [closures, loggedAccountId, partners])

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

  const closePaymentModal = () => {
    setShowPaymentModal(false)
    setPaymentClosure(null)
    setPaymentAmountCents('')
    setPaymentNotes('')
    setSettlementNotes('')
    setSettlementDate('')
  }

  const openPaymentModal = (closure: BalanceClosure) => {
    const remaining = paymentClosureRemaining(closure)
    setPaymentClosure(closure)
    setSelectedClosure(closure)
    setPaymentAmountCents('')
    setPaymentDate(getTodayLocalDate())
    setPaymentNotes('')
    setSettlementDate(getTodayLocalDate())
    setSettlementNotes('')
    setPaymentModalMode(remaining > 0.01 ? 'partial' : 'settle')
    setShowPaymentModal(true)
  }

  const paymentModalDateFieldWrapCls = `${cadastroFieldCls} mt-0.5 box-border !py-0 flex h-9 items-center`

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

  const selectedClosuresForBulk = useMemo(
    () => closures.filter((c) => selectedClosureIds.has(c.id)),
    [closures, selectedClosureIds],
  )

  const runBulkDeleteClosures = async (options: { clearPayments: boolean; clearLoans: boolean }) => {
    setBulkActionLoading(true)
    try {
      let successCount = 0
      let errorCount = 0

      for (const closure of selectedClosuresForBulk) {
        try {
          await deleteClosureIncludingSettled(closure, options)
          successCount++
        } catch {
          errorCount++
        }
      }

      if (errorCount === 0) {
        setToast({ show: true, message: `${successCount} fechamento(s) excluído(s)!`, type: 'success' })
      } else {
        setToast({
          show: true,
          message: `${successCount} excluído(s), ${errorCount} erro(s)`,
          type: 'warning',
        })
      }

      setSelectedClosureIds(new Set())
      if (appliedYear != null) void loadClosures(appliedYear)

      const sharing = partners.find((p) => p.shared_account_id === appliedPartnerAccountId)
      if (sharing) {
        await loadLastClosureAndSetDates(sharing.id)
      }
    } catch {
      setToast({ show: true, message: 'Erro ao excluir fechamentos', type: 'error' })
    } finally {
      setBulkActionLoading(false)
    }
  }

  const handleBulkReopen = () => {
    if (selectedClosureIds.size === 0) return

    const selected = selectedClosuresForBulk
    const anyPayments = selected.some(
      (c) => (c.closure_payments || []).filter((p) => p.active !== false).length > 0,
    )
    const anyLoans = selected.some((c) => filterRegularLoanPayments(getClosureLoanPaymentsList(c)).length > 0)
    const anySettled = selected.some((c) => c.is_settled)

    if (anyPayments || anyLoans || anySettled) {
      setBulkDeleteClearPayments(anyPayments)
      setBulkDeleteClearLoans(anyLoans)
      setBulkDeleteModalOpen(true)
      return
    }

    showConfirm(
      'Excluir fechamentos',
      `Excluir ${selected.length} fechamento(s)? Os períodos poderão ser fechados novamente.`,
      () => void runBulkDeleteClosures({ clearPayments: false, clearLoans: false }),
      'Excluir',
      'Cancelar',
    )
  }

  const handleConfirmBulkDelete = () => {
    setBulkDeleteModalOpen(false)
    void runBulkDeleteClosures({
      clearPayments: bulkDeleteClearPayments,
      clearLoans: bulkDeleteClearLoans,
    })
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

    setBulkUnsettleClearPayments(true)
    setBulkUnsettleClearLoans(true)
    setBulkUnsettleClosures(settledClosures)
  }

  const closeBulkUnsettleModal = () => {
    if (bulkActionLoading) return
    setBulkUnsettleClosures(null)
  }

  const handleConfirmBulkUnsettle = async () => {
    const targets = bulkUnsettleClosures
    if (!targets?.length) return
    setBulkActionLoading(true)
    try {
      let successCount = 0
      const failures: string[] = []

      for (const closure of targets) {
        try {
          if (bulkUnsettleClearLoans) {
            const loanIds = filterRegularLoanPayments(getClosureLoanPaymentsList(closure)).map(
              (lp: { loan_id: number }) => lp.loan_id,
            )
            if (loanIds.length > 0) {
              await axios.delete(`/api/balance/closures/${closure.id}/loan-payments`, {
                data: { loan_ids: loanIds },
              })
            }
          }
          if (bulkUnsettleClearPayments) {
            const hasPayments = (closure.closure_payments || []).some((p) => p.active !== false)
            if (hasPayments) {
              await axios.delete(`/api/balance/closures/${closure.id}/payments`)
            }
          }
          await axios.delete(`/api/balance/closures/${closure.id}/settle`)
          successCount++
        } catch (error: any) {
          const detail = error.response?.data?.detail
          const message = typeof detail === 'string' ? detail : (detail?.message || 'erro ao reabrir')
          failures.push(`${closureReferenceLabel(closure)}: ${message}`)
        }
      }

      if (failures.length === 0) {
        setToast({ show: true, message: `Quitação removida de ${successCount} fechamento(s)!`, type: 'success' })
      } else {
        setToast({
          show: true,
          message: `${successCount} reaberto(s), ${failures.length} com erro — ${failures.join('; ')}`,
          type: 'warning',
        })
      }

      setBulkUnsettleClosures(null)
      setSelectedClosureIds(new Set())
      if (appliedYear != null) void loadClosures(appliedYear)
    } finally {
      setBulkActionLoading(false)
    }
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

    setBulkSettleMode('today')
    setBulkSettleDates(Object.fromEntries(unsettledClosures.map((c) => [c.id, closureSettleDefaultInput(c)])))
    setBulkSettleClosures(unsettledClosures)
  }

  const closeBulkSettleModal = () => {
    if (bulkActionLoading) return
    setBulkSettleClosures(null)
    setBulkSettleDates({})
  }

  const handleConfirmBulkSettle = async () => {
    const targets = bulkSettleClosures
    if (!targets?.length) return

    if (bulkSettleMode === 'manual') {
      const now = nowLocalDateTimeInput()
      const missing = targets.filter((c) => !bulkSettleDates[c.id])
      if (missing.length > 0) {
        setToast({ show: true, message: 'Preencha a data/hora de pagamento de todos os balanços.', type: 'warning' })
        return
      }
      const future = targets.filter((c) => bulkSettleDates[c.id] > now)
      if (future.length > 0) {
        setToast({ show: true, message: 'A data/hora de pagamento não pode ser futura.', type: 'warning' })
        return
      }
    }

    setBulkActionLoading(true)
    try {
      let successCount = 0
      let errorCount = 0

      for (const closure of targets) {
        try {
          await axios.put(`/api/balance/closures/${closure.id}/settle`, {
            settlement_notes: null,
            ...(bulkSettleMode === 'manual' ? { settlement_date: bulkSettleDates[closure.id] } : {}),
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

      setBulkSettleClosures(null)
      setBulkSettleDates({})
      setSelectedClosureIds(new Set())
      if (appliedYear != null) void loadClosures(appliedYear)
    } finally {
      setBulkActionLoading(false)
    }
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
        } else if (showPaymentModal) {
          closePaymentModal()
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
        } else if (showDetailsModal) {
          setShowDetailsModal(false)
          setSelectedClosure(null)
          setClosureItems([])
          setClosureLoanPayments([])
          setIsClosurePartnerView(false)
        }
      }
    }

    if (showDetailsModal || showJsonModal || showPaymentModal) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showDetailsModal, showJsonModal, showPaymentModal])

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
                    const q = draftPartnerAccountId ? `?partner=${draftPartnerAccountId}` : ''
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
              resultHint={filterResultHint}
            >
              <CadastroFilterField label="Conta compartilhada" icon={<Building2 size={12} />}>
                <select
                  value={draftPartnerAccountId || ''}
                  onChange={(e) =>
                    setDraftPartnerAccountId(e.target.value ? parseInt(e.target.value, 10) : null)
                  }
                  className={cadastroFilterFieldCls}
                >
                  <option value="">Todos</option>
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
                title="Selecione os filtros"
                description="Escolha a conta compartilhada e o ano (ou deixe Todos) e clique em Aplicar para carregar os fechamentos."
              />
            )}

            {!closuresLoading && filtersApplied && (
              <div className="space-y-4">
                {closures.length === 0 ? (
                  <CadastroListPageEmptyCard
                    icon={<Archive size={32} className="text-gray-400" />}
                    title="Nenhum fechamento encontrado"
                    description="Use Realizar fechamento para registrar um novo período."
                  />
                ) : (
                  <>
                  <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
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
                          <Scale size={18} />
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Balanço aberto</h2>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {closuresScorecards.pendingCount}{' '}
                            {closuresScorecards.pendingCount === 1 ? 'fechamento pendente' : 'fechamentos pendentes'}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 divide-y divide-gray-200 dark:divide-gray-600 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                        <div className="flex min-h-[6.5rem] flex-col justify-center bg-white px-5 py-4 dark:bg-gray-800">
                          <div className="mb-2 flex items-center gap-2 text-gray-500 dark:text-gray-400">
                            <ArrowUp size={14} className="text-[var(--color-success)]" />
                            <span className="text-xs font-semibold uppercase tracking-wide">À receber</span>
                          </div>
                          <p className="text-xl font-bold tabular-nums text-[var(--color-success)] sm:text-2xl">
                            {formatCurrency(closuresScorecards.openReceive)}
                          </p>
                        </div>
                        <div className="flex min-h-[6.5rem] flex-col justify-center bg-white px-5 py-4 dark:bg-gray-800">
                          <div className="mb-2 flex items-center gap-2 text-gray-500 dark:text-gray-400">
                            <ArrowDown size={14} className="text-[var(--color-danger)]" />
                            <span className="text-xs font-semibold uppercase tracking-wide">À pagar</span>
                          </div>
                          <p className="text-xl font-bold tabular-nums text-[var(--color-danger)] sm:text-2xl">
                            {formatCurrency(closuresScorecards.openPay)}
                          </p>
                        </div>
                      </div>
                    </article>

                    <article className={`${listPageTableSectionCls} flex flex-col overflow-hidden`}>
                      <div
                        className="flex items-start gap-3 border-b border-l-4 border-gray-200 px-5 py-4 dark:border-gray-600"
                        style={{ borderLeftColor: 'var(--color-3)' }}
                      >
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-[color-mix(in_srgb,var(--color-3)_20%,transparent)]"
                          style={{
                            color: 'var(--color-3)',
                            background: 'color-mix(in srgb, var(--color-3) 14%, transparent)',
                          }}
                        >
                          <Landmark size={18} />
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Empréstimos aberto</h2>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {closuresScorecards.loanPaymentsCount}{' '}
                            {closuresScorecards.loanPaymentsCount === 1 ? 'liquidação' : 'liquidações'}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 divide-y divide-gray-200 dark:divide-gray-600 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                        <div className="flex min-h-[6.5rem] flex-col justify-center bg-white px-5 py-4 dark:bg-gray-800">
                          <div className="mb-2 flex items-center gap-2 text-gray-500 dark:text-gray-400">
                            <ArrowUp size={14} className="text-[var(--color-success)]" />
                            <span className="text-xs font-semibold uppercase tracking-wide">À receber</span>
                          </div>
                          <p className="text-xl font-bold tabular-nums text-[var(--color-success)] sm:text-2xl">
                            {formatCurrency(closuresScorecards.loanReceiveOpen)}
                          </p>
                        </div>
                        <div className="flex min-h-[6.5rem] flex-col justify-center bg-white px-5 py-4 dark:bg-gray-800">
                          <div className="mb-2 flex items-center gap-2 text-gray-500 dark:text-gray-400">
                            <ArrowDown size={14} className="text-[var(--color-danger)]" />
                            <span className="text-xs font-semibold uppercase tracking-wide">À pagar</span>
                          </div>
                          <p className="text-xl font-bold tabular-nums text-[var(--color-danger)] sm:text-2xl">
                            {formatCurrency(closuresScorecards.loanPayOpen)}
                          </p>
                        </div>
                      </div>
                    </article>
                  </div>

                  <div className={selectedClosureIds.size > 0 || showClosuresBackToTop ? 'pb-20' : ''}>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                        <BulkSelectCheckbox state={closureSelectHeaderState} onClick={toggleSelectAll} />
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          Selecionar todos os fechamentos
                          <span className="ml-1 tabular-nums text-gray-400">({closures.length})</span>
                        </span>
                      </div>
                        {closures.map((closure) => {
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
                          const closureLoanLiquidations = filterRegularLoanPayments(
                            getClosureLoanPaymentsList(closure),
                          )
                          const partialPaymentsCount = (closure.closure_payments || []).length
                          const hasExpandableDetails =
                            partialPaymentsCount > 0 || closureLoanLiquidations.length > 0
                          const cardShellCls = closure.is_settled ? closureCardSettledCls : closureCardPendingCls
                          const selected = selectedClosureIds.has(closure.id)
                          const otherCard = isCounterpart ? mainCard : partnerCard
                          const periodStart = parseClosureDateTime(closure.period_start_date)
                          const periodEnd = parseClosureDateTime(closurePeriodEndRaw(closure))
                          const periodRangeLabel = `${periodStart.toLocaleDateString('pt-BR')} ${periodStart.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} → ${periodEnd.toLocaleDateString('pt-BR')} ${periodEnd.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                          const totalPaid = parseFloat(String(closure.total_paid ?? 0))
                          const paymentsCount = (closure.closure_payments || []).length
                          const settlementCreditSigned = getSettlementCreditSignedForViewer(closure, !isCounterpart)
                          const settlementCreditTotal = getSettlementCreditTotal(closure)
                          const remainingBalance = closure.is_settled
                            ? 0
                            : Math.sign(displayNetBalance || 1) *
                              Math.abs(parseFloat(String(closure.remaining_balance ?? displayNetBalance)))
                          const displayBalance = closure.is_settled
                            ? (settlementCreditTotal > 0.01 ? settlementCreditSigned : 0)
                            : totalPaid > 0
                              ? remainingBalance
                              : displayNetBalance
                          const isRemainingView = !closure.is_settled && totalPaid > 0
                          const isCreditSettleView = closure.is_settled && settlementCreditTotal > 0.01

                          return (
                          <div
                            key={closure.id}
                            className={`${cardShellCls} ${
                              selected ? 'ring-1 ring-[color-mix(in_srgb,var(--color-1)_35%,transparent)]' : ''
                            }`}
                          >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                              <BulkSelectCheckbox
                                checked={selected}
                                onClick={() => toggleClosureSelection(closure.id)}
                              />
                              {hasExpandableDetails ? (
                                <button
                                  type="button"
                                  onClick={() => toggleClosureExpansion(closure.id)}
                                  className="shrink-0 rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                                  title={
                                    expandedClosureIds.has(closure.id)
                                      ? 'Colapsar pagamentos e liquidações'
                                      : 'Expandir pagamentos e liquidações'
                                  }
                                  aria-expanded={expandedClosureIds.has(closure.id)}
                                >
                                  {expandedClosureIds.has(closure.id) ? (
                                    <ChevronDown size={20} />
                                  ) : (
                                    <ChevronRight size={20} />
                                  )}
                                </button>
                              ) : (
                                <span className="w-7 shrink-0" aria-hidden />
                              )}
                              <div className="min-w-0 max-w-[15rem] shrink sm:max-w-[19rem] md:max-w-[22rem] md:shrink-0">
                                <p
                                  className="truncate text-sm font-semibold text-gray-900 dark:text-white"
                                  title={closureReferenceLabel(closure)}
                                >
                                  {closureReferenceLabel(closure)}
                                </p>
                                <p
                                  className="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400"
                                  title={periodRangeLabel}
                                >
                                  {periodRangeLabel}
                                </p>
                                <div className="flex min-w-0 items-center gap-1.5">
                                <div className="min-w-0 max-w-[45%] shrink">
                                  {viewerCard?.account_id ? (
                                    <SharedAccountDisplay
                                      compact
                                      nameClassName="!text-xs text-gray-700 dark:text-gray-300"
                                      account={{
                                        id: viewerCard.account_id || 0,
                                        name: viewerCard.account_name,
                                        bank: {
                                          code: viewerCard.bank_code || '',
                                          name: viewerCard.bank_name || '',
                                        },
                                        agency: viewerCard.agency,
                                        account_number: viewerCard.account_number,
                                      }}
                                    />
                                  ) : (
                                    <span className="text-xs text-gray-400">—</span>
                                  )}
                                </div>
                                <span
                                  className="inline-flex shrink-0 text-gray-400 dark:text-gray-500"
                                  title="Troca entre contas compartilhadas"
                                  aria-hidden
                                >
                                  <ArrowLeftRight size={12} strokeWidth={2} />
                                </span>
                                <div className="min-w-0 max-w-[45%] shrink">
                                  {otherCard?.account_id ? (
                                    <SharedAccountDisplay
                                      compact
                                      nameClassName={`!text-xs ${sharedAccountNameColorClass(
                                        closureAccountNameColors,
                                        otherCard.account_id,
                                        loggedAccountId,
                                      )}`}
                                      account={{
                                        id: otherCard.account_id || 0,
                                        name: otherCard.account_name,
                                        bank: {
                                          code: otherCard.bank_code || '',
                                          name: otherCard.bank_name || '',
                                        },
                                        agency: otherCard.agency,
                                        account_number: otherCard.account_number,
                                      }}
                                    />
                                  ) : (
                                    <span className="text-xs text-gray-400">—</span>
                                  )}
                                </div>
                                </div>
                              </div>
                              <div className="mx-0.5 hidden h-10 w-px shrink-0 bg-gray-200 dark:bg-gray-600 sm:block" />
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                              <div className="hidden text-right self-start w-[128px] md:block">
                                <p className="text-sm text-gray-500 dark:text-gray-400">Valores</p>
                                <p className="whitespace-nowrap text-xs font-bold text-gray-900 dark:text-gray-100">
                                  <span className="text-green-600 dark:text-green-400">↑ {formatCurrency(displayToReceive)}</span>
                                </p>
                                <p className="whitespace-nowrap text-xs font-bold">
                                  <span className="text-red-600 dark:text-red-400">↓ {formatCurrency(displayToPay)}</span>
                                </p>
                              </div>
                              <div className="mx-1 hidden h-10 w-px shrink-0 bg-gray-200 dark:bg-gray-600 md:block" />
                              <div className="hidden text-right self-start w-[96px] md:block">
                                <p className="text-sm text-gray-500 dark:text-gray-400">Empréstimos</p>
                                {closureLoanLiquidations.length > 0 ? (
                                  <>
                                    <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
                                      {closureLoanLiquidations.length}
                                    </p>
                                    <p className="text-xs font-medium text-amber-600 dark:text-amber-500">liquidações</p>
                                  </>
                                ) : (
                                  <p className="text-xs font-bold text-gray-300 dark:text-gray-600">—</p>
                                )}
                              </div>
                              <div className="mx-1 hidden h-10 w-px shrink-0 bg-gray-200 dark:bg-gray-600 md:block" />
                              <div className="hidden text-right self-start w-[100px] md:block">
                                <p className="text-sm text-gray-500 dark:text-gray-400">Pagamentos</p>
                                {paymentsCount > 0 ? (
                                  <>
                                    <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{paymentsCount}</p>
                                    <p className="text-xs font-bold text-green-600 dark:text-green-400">
                                      {formatCurrency(totalPaid)}
                                    </p>
                                  </>
                                ) : (
                                  <p className="text-xs font-bold text-gray-300 dark:text-gray-600">—</p>
                                )}
                              </div>
                              <div className="mx-1 hidden h-10 w-px shrink-0 bg-gray-200 dark:bg-gray-600 md:block" />
                              <div className="hidden text-right self-start w-[110px] md:block" title="Valor apurado no fechamento">
                                <p className="text-sm text-gray-500 dark:text-gray-400">Resultado</p>
                                <p
                                  className={`font-bold ${
                                    displayNetBalance > 0
                                      ? 'text-green-600 dark:text-green-400'
                                      : displayNetBalance < 0
                                        ? 'text-red-600 dark:text-red-400'
                                        : 'text-gray-900 dark:text-gray-100'
                                  }`}
                                >
                                  {formatSignedCurrency(displayNetBalance)}
                                </p>
                              </div>
                              <div className="mx-1 hidden h-10 w-px shrink-0 bg-gray-200 dark:bg-gray-600 md:block" />
                              <div className="text-right self-start w-[110px]" title="Quanto ainda falta pagar/receber">
                                <p className="text-sm text-gray-500 dark:text-gray-400">Saldo</p>
                                <p
                                  className={`font-bold ${
                                    displayBalance > 0
                                      ? 'text-green-600 dark:text-green-400'
                                      : displayBalance < 0
                                        ? 'text-red-600 dark:text-red-400'
                                        : 'text-gray-900 dark:text-gray-100'
                                  }`}
                                >
                                  {formatSignedCurrency(displayBalance)}
                                </p>
                                {isCreditSettleView && (
                                  <p className="text-xs text-amber-600 dark:text-amber-400">crédito quitação</p>
                                )}
                                {isRemainingView && (
                                  <p className="text-xs text-gray-500 dark:text-gray-400">restante</p>
                                )}
                              </div>
                              <div className="mx-1 hidden h-10 w-px shrink-0 bg-gray-200 dark:bg-gray-600 sm:block" />
                              <div className="flex items-center self-center">
                                {closure.is_settled ? (
                                  <span className="inline-flex w-[88px] items-center justify-center gap-1.5 rounded px-3 py-1 text-xs font-medium text-white bg-green-600">
                                    <Lock size={14} strokeWidth={2.25} aria-hidden />
                                    Quitado
                                  </span>
                                ) : (
                                  <span className="inline-flex w-[88px] items-center justify-center gap-1.5 rounded px-3 py-1 text-xs font-medium text-white bg-blue-600">
                                    <Unlock size={14} strokeWidth={2.25} aria-hidden />
                                    Pendente
                                  </span>
                                )}
                              </div>
                              <div className="mx-1 hidden h-10 w-px shrink-0 bg-gray-200 dark:bg-gray-600 sm:block" />
                              <div className="flex items-center gap-1 self-center">
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
                                  onClick={() => setRecalcClosure(closure)}
                                  className={cadastroRowIconBtnCls}
                                  title="Recalcular fechamento (comparar com lançamentos atuais)"
                                >
                                  <RefreshCw size={15} />
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
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExportTargetClosure(closure as any)
                                    setShowExportModal(true)
                                  }}
                                  className={cadastroRowIconBtnCls}
                                  title="Exportar fechamento"
                                >
                                  <Download size={15} />
                                </button>
                                {closure.is_settled ? (
                                  <button
                                    type="button"
                                    onClick={() => handleUnsettleClosure(closure)}
                                    className={`${cadastroRowIconBtnCls} text-green-600 dark:text-green-400`}
                                    title="Quitado — remover quitação"
                                  >
                                    <Lock size={15} />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => openPaymentModal(closure)}
                                    className={reportRowActionBtnClass(true)}
                                    title="Registrar pagamento ou quitar"
                                  >
                                    <Plus size={15} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleReopenClosure(closure)}
                                  className={reportRowActionBtnClass(!closure.is_settled, 'danger')}
                                  title={
                                    closure.is_settled
                                      ? 'Excluir fechamento (remova a quitação antes)'
                                      : 'Excluir fechamento'
                                  }
                                  disabled={closure.is_settled}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </div>
                          </div>
                          {expandedClosureIds.has(closure.id) && hasExpandableDetails && (
                            <div className="mt-4 ml-10 space-y-5">
                                {partialPaymentsCount > 0 && (
                                  <>
                                    <ClosureExpandSectionTitle
                                      icon={<Banknote size={14} className="text-gray-500 dark:text-gray-400" />}
                                      title="Pagamentos parciais"
                                      count={partialPaymentsCount}
                                      trailing={
                                        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                          Total pago:{' '}
                                          <span className="font-semibold text-green-600 dark:text-green-400">
                                            {formatCurrency(parseFloat(String(closure.total_paid ?? 0)))}
                                          </span>
                                        </span>
                                      }
                                    />
                                    <ListPageNestedTable
                                      alignWithListLeading
                                      leadingMode="index-only"
                                      colsRest={closureNestedCols4}
                                      head={
                                        <tr>
                                          <ListTableIndexHeader />
                                          <ListTableSpacerHeader />
                                          <ListTableStaticHeader label="Data" className="px-3 py-2" />
                                          <ListTableStaticHeader label="Valor pago" className="px-3 py-2" />
                                          <ListTableStaticHeader label="Observação" className="px-3 py-2" />
                                          <ListTableStaticHeader label="Ações" className="px-2 py-2" />
                                        </tr>
                                      }
                                    >
                                      {(closure.closure_payments || []).map((payment, payIdx) => (
                                        <tr key={payment.id} className={listPageTableRowHoverCls}>
                                          <ListTableIndexCell index={payIdx + 1} />
                                          <ListTableSpacerCell />
                                          <td className="px-3 py-2 text-sm whitespace-nowrap text-gray-800 dark:text-gray-100">
                                            {new Date(payment.payment_date).toLocaleDateString('pt-BR')}
                                          </td>
                                          <td className="px-3 py-2 text-sm font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">
                                            {formatCurrency(parseFloat(String(payment.amount)))}
                                          </td>
                                          <td className="max-w-0 px-3 py-2 text-sm text-gray-500 dark:text-gray-400 truncate">
                                            {payment.notes || <span className="italic text-gray-300 dark:text-gray-600">—</span>}
                                          </td>
                                          <td className="px-2 py-2">
                                            <div className="flex items-center gap-0.5">
                                              {!closure.is_settled && (
                                                <button
                                                  type="button"
                                                  onClick={() => openEditPayment(payment, closure)}
                                                  className={cadastroRowIconBtnCls}
                                                  title="Editar pagamento"
                                                >
                                                  <Pencil size={14} />
                                                </button>
                                              )}
                                              <button
                                                type="button"
                                                onClick={() => handleDeletePayment(closure, payment.id)}
                                                className={cadastroRowIconDangerCls}
                                                title="Remover pagamento"
                                              >
                                                <Trash2 size={14} />
                                              </button>
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                    </ListPageNestedTable>
                                    {(() => {
                                      const settlementCredits = getSettlementCreditEntries(closure)
                                      if (settlementCredits.length === 0) return null
                                      const signedTotal = getSettlementCreditSignedForViewer(closure, !isCounterpart)
                                      return (
                                        <div className="mt-4">
                                          <ClosureExpandSectionTitle
                                            tone="amber"
                                            icon={<Banknote size={14} className="text-amber-600 dark:text-amber-400" />}
                                            title="Saldo gerado no pagamento a maior"
                                            trailing={
                                              <span
                                                className={`text-xs font-bold whitespace-nowrap ${
                                                  signedTotal < 0
                                                    ? 'text-red-600 dark:text-red-400'
                                                    : 'text-green-600 dark:text-green-400'
                                                }`}
                                              >
                                                {formatSignedCurrency(signedTotal)}
                                              </span>
                                            }
                                          />
                                          <ListPageNestedTable
                                            alignWithListLeading
                                            leadingMode="index-only"
                                            colsRest={closureNestedCols3}
                                            head={
                                              <tr>
                                                <ListTableIndexHeader />
                                                <ListTableSpacerHeader />
                                                <ListTableStaticHeader label="Descrição" className="px-3 py-2" />
                                                <ListTableStaticHeader label="Empréstimo" className="px-3 py-2" />
                                                <ListTableStaticHeader label="Saldo" className="px-3 py-2" />
                                              </tr>
                                            }
                                          >
                                            {settlementCredits.map((credit, ci) => (
                                              <tr key={`credit-${credit.loan_id ?? ci}`} className={listPageTableRowHoverCls}>
                                                <ListTableIndexCell index={ci + 1} />
                                                <ListTableSpacerCell />
                                                <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                                                  {credit.description || 'Crédito da quitação'}
                                                </td>
                                                <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                                                  #{credit.loan_id}
                                                </td>
                                                <td className="px-3 py-2 text-sm font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">
                                                  {formatSignedCurrency(
                                                    signedLoanFieldValue(credit.original_amount || 0, isCounterpart, 'remaining'),
                                                  )}
                                                </td>
                                              </tr>
                                            ))}
                                          </ListPageNestedTable>
                                        </div>
                                      )
                                    })()}
                                  </>
                                )}
                                {closureLoanLiquidations.length > 0 && (
                                  <>
                                    <ClosureExpandSectionTitle
                                      tone="amber"
                                      icon={<Landmark size={14} className="text-amber-700 dark:text-amber-300" />}
                                      title="Liquidações de empréstimo"
                                      count={closureLoanLiquidations.length}
                                    />
                                    <ListPageNestedTable
                                      alignWithListLeading
                                      leadingMode="index-only"
                                      colsRest={closureNestedCols5}
                                      head={
                                        <tr>
                                          <ListTableIndexHeader />
                                          <ListTableSpacerHeader />
                                          <ListTableStaticHeader label="Tipo" className="px-3 py-2" />
                                          <ListTableStaticHeader label="Descrição" className="px-3 py-2" />
                                          <ListTableStaticHeader label="Quitado" className="px-3 py-2" />
                                          <ListTableStaticHeader label="Saldo restante" className="px-3 py-2" />
                                          <ListTableStaticHeader label="Ações" className="px-2 py-2" />
                                        </tr>
                                      }
                                    >
                                      {closureLoanLiquidations.map((lp: any, liIdx: number) => {
                                        const originalIsLent = lp.loan_type === 'lent'
                                        const isLent = isCounterpart ? !originalIsLent : originalIsLent
                                        return (
                                          <tr
                                            key={`loan-liq-${lp.loan_id}-${liIdx}`}
                                            className={`${listPageTableRowHoverCls} border-l-4 border-l-amber-500`}
                                          >
                                            <ListTableIndexCell index={liIdx + 1} />
                                            <ListTableSpacerCell />
                                            <td className="px-3 py-2">
                                              <span
                                                className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold text-white ${
                                                  isLent ? 'bg-green-600' : 'bg-red-600'
                                                }`}
                                              >
                                                {isLent ? 'A receber' : 'A pagar'}
                                              </span>
                                            </td>
                                            <td className="px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-100">
                                              {lp.description || `Empréstimo #${lp.loan_id}`}
                                            </td>
                                            <td className="px-3 py-2 text-sm font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">
                                              {formatCurrency(Math.abs(lp.amount_paid || 0))}
                                            </td>
                                            <td className="px-3 py-2 text-sm whitespace-nowrap">
                                              <span
                                                className={
                                                  Math.abs(lp.remaining_after || 0) < 0.01
                                                    ? 'text-gray-500 dark:text-gray-400'
                                                    : isLent
                                                      ? 'text-green-600 dark:text-green-400'
                                                      : 'text-red-600 dark:text-red-400'
                                                }
                                              >
                                                {formatCurrency(Math.abs(lp.remaining_after || 0))}
                                              </span>
                                            </td>
                                            <td className="px-2 py-2">
                                              <button
                                                type="button"
                                                disabled={closure.is_settled}
                                                onClick={() =>
                                                  handleRemoveClosureLoanLiquidation(
                                                    closure,
                                                    lp.loan_id,
                                                    lp.description || '',
                                                  )
                                                }
                                                className={
                                                  closure.is_settled
                                                    ? `${cadastroRowIconDangerCls} cursor-not-allowed opacity-40`
                                                    : cadastroRowIconDangerCls
                                                }
                                                title={
                                                  closure.is_settled
                                                    ? 'Remova a quitação antes'
                                                    : 'Remover liquidação'
                                                }
                                              >
                                                <Trash2 size={14} />
                                              </button>
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </ListPageNestedTable>
                                  </>
                                )}
                            </div>
                          )}
                          </div>
                          )
                        })}
                    </div>
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
        <ClosureRecalculateModal
          closure={recalcClosure}
          loggedAccountId={loggedAccountId}
          onClose={() => setRecalcClosure(null)}
          onApplied={() => {
            setToast({ show: true, message: 'Fechamento atualizado com recálculo.', type: 'success' })
            if (appliedYear != null) void loadClosures(appliedYear)
          }}
        />

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
              <CadastroFormSection title="Empréstimos bloqueados" icon={<Trash2 size={14} />} bodyClassName="p-0">
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{paymentDeleteError.message}</p>
                  </CadastroModalFieldsRow>
                  {paymentDeleteError.loans.length > 0 && (
                    <CadastroModalFieldsRow>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-100">
                        {paymentDeleteError.loans.map(loan => (
                          <li key={loan.id}>
                            <span className="font-medium">{loan.description}</span>
                            <span className="text-xs text-amber-700 dark:text-amber-300"> (#{loan.id})</span>
                          </li>
                        ))}
                      </ul>
                    </CadastroModalFieldsRow>
                  )}
                  <CadastroModalFieldsRow>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Ajuste ou exclua esses empréstimos em Empréstimos e tente novamente.
                    </p>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
            </CadastroModalBody>
            <CadastroModalFooter onClose={() => setPaymentDeleteError(null)} hideSave closeLabel="Fechar" />
          </CadastroModalShell>
        )}

        {/* Modal: Remover quitação */}
        {showUnsettleModal && unsettleClosure && (() => {
          const activePayments = (unsettleClosure.closure_payments || []).filter((p) => p.active !== false)
          const unsettleLoans = filterRegularLoanPayments(getClosureLoanPaymentsList(unsettleClosure))
          const hasPayments = activePayments.length > 0
          const hasLoans = unsettleLoans.length > 0
          return (
          <CadastroModalShell
            maxWidth="max-w-3xl"
            onBackdropClick={() => { setShowUnsettleModal(false); setUnsettleClosure(null); setUnsettleClearError(null) }}
            zClass="z-50"
          >
            <CadastroModalHeader
              isEdit={true}
              title="Remover Quitação"
              subtitle={`Fechamento ${String(unsettleClosure.month).padStart(2, '0')}/${unsettleClosure.year} voltará ao status pendente.`}
              onClose={() => { setShowUnsettleModal(false); setUnsettleClosure(null); setUnsettleClearError(null) }}
              icon={<Unlock size={18} />}
            />
            <CadastroModalBody>
              <CadastroFormSection title="Pagamentos parciais" icon={<Banknote size={14} />} bodyClassName="p-0">
                {hasPayments ? (
                  <div className="divide-y divide-gray-300 dark:divide-gray-600">
                    {activePayments.map((p: any) => (
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
                  <p className="px-3 py-3 text-sm italic text-gray-500 dark:text-gray-400">Nenhum pagamento parcial.</p>
                )}
              </CadastroFormSection>
              <CadastroFormSection title="Liquidações de empréstimo" icon={<Landmark size={14} />} bodyClassName="p-0">
                {hasLoans ? (
                  <div className="divide-y divide-amber-100 dark:divide-amber-900/40">
                    {unsettleLoans.map((lp: any) => (
                      <div
                        key={lp.loan_id}
                        className="flex items-center justify-between bg-amber-50/60 px-3 py-2 text-sm dark:bg-amber-900/15"
                      >
                        <span className="font-medium text-gray-800 dark:text-gray-100">
                          {lp.description || `Empréstimo #${lp.loan_id}`}
                        </span>
                        <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                          {formatCurrency(Math.abs(lp.amount_paid || 0))} quitado
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-3 py-3 text-sm italic text-gray-500 dark:text-gray-400">Nenhuma liquidação de empréstimo.</p>
                )}
              </CadastroFormSection>
              {(hasPayments || hasLoans) && (
                <CadastroFormSection title="O que limpar" icon={<Trash2 size={14} />} bodyClassName="p-0">
                  <CadastroModalFieldsGrid>
                    {hasPayments && (
                      <CadastroModalFieldsRow>
                        <label className={`${cadastroOptionLabelCls} items-start`}>
                          <input
                            type="checkbox"
                            checked={unsettleClearPayments}
                            onChange={(e) => setUnsettleClearPayments(e.target.checked)}
                            className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                          />
                          <span>
                            <span className="block text-sm font-medium">Limpar pagamentos parciais</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {activePayments.length} pagamento(s) registrado(s)
                            </span>
                          </span>
                        </label>
                      </CadastroModalFieldsRow>
                    )}
                    {hasLoans && (
                      <CadastroModalFieldsRow>
                        <label className={`${cadastroOptionLabelCls} items-start`}>
                          <input
                            type="checkbox"
                            checked={unsettleClearLoans}
                            onChange={(e) => setUnsettleClearLoans(e.target.checked)}
                            className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                          />
                          <span>
                            <span className="block text-sm font-medium">Limpar liquidações de empréstimo</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {unsettleLoans.length} liquidação(ões) — empréstimos serão reabertos
                            </span>
                          </span>
                        </label>
                      </CadastroModalFieldsRow>
                    )}
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
              )}
              {unsettleClearError && (
                <CadastroFormSection title="Não é possível limpar os pagamentos" icon={<AlertTriangle size={14} />} bodyClassName="p-0">
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow>
                      <p className="text-sm text-amber-800 dark:text-amber-200">{unsettleClearError.message}</p>
                    </CadastroModalFieldsRow>
                    {unsettleClearError.loans.length > 0 && (
                      <CadastroModalFieldsRow>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-100">
                          {unsettleClearError.loans.map(loan => (
                            <li key={loan.id}>
                              <span className="font-medium">{loan.description}</span>
                              <span className="text-xs text-amber-700 dark:text-amber-300"> (#{loan.id})</span>
                            </li>
                          ))}
                        </ul>
                      </CadastroModalFieldsRow>
                    )}
                    <CadastroModalFieldsRow>
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        Ajuste ou exclua esses empréstimos em Empréstimos e tente novamente.
                      </p>
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
              )}
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={() => { setShowUnsettleModal(false); setUnsettleClosure(null); setUnsettleClearError(null) }}
              saving={unsettleClearingAll}
              onSave={() =>
                handleConfirmUnsettle({
                  clearPayments: unsettleClearPayments,
                  clearLoanLiquidations: unsettleClearLoans,
                })
              }
              saveLabel="Remover quitação"
              saveTone={hasPayments || hasLoans ? 'danger' : 'default'}
              saveIcon={hasPayments || hasLoans ? <Trash2 size={15} /> : <Unlock size={15} />}
            />
          </CadastroModalShell>
          )
        })()}
        {/* Modal: Remover quitação em massa */}
        {bulkUnsettleClosures && (() => {
          const withPayments = bulkUnsettleClosures.filter(
            (c) => (c.closure_payments || []).some((p) => p.active !== false),
          ).length
          const withLoans = bulkUnsettleClosures.filter(
            (c) => filterRegularLoanPayments(getClosureLoanPaymentsList(c)).length > 0,
          ).length
          return (
            <CadastroModalShell maxWidth="max-w-lg" onBackdropClick={closeBulkUnsettleModal} zClass="z-50">
              <CadastroModalHeader
                isEdit={true}
                title="Remover quitação"
                subtitle={`${bulkUnsettleClosures.length} fechamento(s) quitado(s) selecionado(s)`}
                onClose={closeBulkUnsettleModal}
                icon={<Unlock size={18} />}
              />
              <CadastroModalBody>
                <CadastroFormSection title="O que limpar" icon={<Trash2 size={14} />} bodyClassName="p-0">
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow>
                      <label className={`${cadastroOptionLabelCls} items-start`}>
                        <input
                          type="checkbox"
                          checked={bulkUnsettleClearPayments}
                          onChange={(e) => setBulkUnsettleClearPayments(e.target.checked)}
                          disabled={bulkActionLoading || withPayments === 0}
                          className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                        />
                        <span>
                          <span className="block text-sm font-medium">Remover todos os pagamentos</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {withPayments > 0
                              ? `Em ${withPayments} fechamento(s) com pagamento (inclui o lançado na quitação)`
                              : 'Nenhum fechamento selecionado tem pagamento'}
                          </span>
                        </span>
                      </label>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow>
                      <label className={`${cadastroOptionLabelCls} items-start`}>
                        <input
                          type="checkbox"
                          checked={bulkUnsettleClearLoans}
                          onChange={(e) => setBulkUnsettleClearLoans(e.target.checked)}
                          disabled={bulkActionLoading || withLoans === 0}
                          className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                        />
                        <span>
                          <span className="block text-sm font-medium">Limpar liquidações de empréstimo</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {withLoans > 0
                              ? `Em ${withLoans} fechamento(s) — empréstimos reabertos`
                              : 'Nenhum fechamento selecionado tem liquidação'}
                          </span>
                        </span>
                      </label>
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
              </CadastroModalBody>
              <CadastroModalFooter
                onClose={closeBulkUnsettleModal}
                saving={bulkActionLoading}
                onSave={() => void handleConfirmBulkUnsettle()}
                saveLabel={`Reabrir ${bulkUnsettleClosures.length} fechamento(s)`}
                saveIcon={<Unlock size={15} />}
              />
            </CadastroModalShell>
          )
        })()}
        {/* Modal: Quitar fechamentos em massa */}
        {bulkSettleClosures && (() => {
          const maxDateTime = nowLocalDateTimeInput()
          return (
            <CadastroModalShell maxWidth="max-w-xl" onBackdropClick={closeBulkSettleModal} zClass="z-50">
              <CadastroModalHeader
                isEdit={true}
                title="Quitar fechamentos"
                subtitle={`${bulkSettleClosures.length} fechamento(s) não quitado(s) selecionado(s)`}
                onClose={closeBulkSettleModal}
                icon={<CheckCircle size={18} />}
              />
              <CadastroModalBody>
                <CadastroFormSection title="Data de lançamento do pagamento" icon={<Calendar size={14} />} bodyClassName="p-0">
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow>
                      <div className="flex flex-wrap gap-4">
                        <label className={cadastroOptionLabelCls}>
                          <input
                            type="radio"
                            checked={bulkSettleMode === 'today'}
                            onChange={() => setBulkSettleMode('today')}
                            disabled={bulkActionLoading}
                            className={cadastroAccentControlCls}
                          />
                          Hoje
                        </label>
                        <label className={cadastroOptionLabelCls}>
                          <input
                            type="radio"
                            checked={bulkSettleMode === 'manual'}
                            onChange={() => setBulkSettleMode('manual')}
                            disabled={bulkActionLoading}
                            className={cadastroAccentControlCls}
                          />
                          Preencher manual
                        </label>
                      </div>
                    </CadastroModalFieldsRow>
                    {bulkSettleMode === 'today' ? (
                      <CadastroModalFieldsRow>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Todos os pagamentos serão lançados com a data e hora do momento da quitação.
                        </p>
                      </CadastroModalFieldsRow>
                    ) : (
                      bulkSettleClosures.map((closure) => (
                        <CadastroModalFieldsRow key={closure.id} cols={2}>
                          <div className="min-w-0 self-center">
                            <p className="truncate text-sm font-medium text-gray-900 dark:text-white" title={closureReferenceLabel(closure)}>
                              {closureReferenceLabel(closure)}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Restante: {formatCurrency(Math.abs(Number(closure.remaining_balance ?? closure.net_balance ?? 0)))}
                            </p>
                          </div>
                          <label className="block min-w-0">
                            <CadastroFieldLabel required>Data/hora do pagamento</CadastroFieldLabel>
                            <input
                              type="datetime-local"
                              value={bulkSettleDates[closure.id] ?? ''}
                              max={maxDateTime}
                              onChange={(e) =>
                                setBulkSettleDates((prev) => ({ ...prev, [closure.id]: e.target.value }))
                              }
                              disabled={bulkActionLoading}
                              className={`${cadastroFieldCls} mt-0.5`}
                            />
                          </label>
                        </CadastroModalFieldsRow>
                      ))
                    )}
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
              </CadastroModalBody>
              <CadastroModalFooter
                onClose={closeBulkSettleModal}
                saving={bulkActionLoading}
                onSave={() => void handleConfirmBulkSettle()}
                saveLabel={`Quitar ${bulkSettleClosures.length} fechamento(s)`}
                saveIcon={<CheckCircle size={15} />}
              />
            </CadastroModalShell>
          )
        })()}
        {/* Modal: Excluir fechamentos em massa */}
        {bulkDeleteModalOpen && (() => {
          const selected = selectedClosuresForBulk
          const settledCount = selected.filter((c) => c.is_settled).length
          const withPayments = selected.filter(
            (c) => (c.closure_payments || []).filter((p) => p.active !== false).length > 0,
          ).length
          const withLoans = selected.filter(
            (c) => filterRegularLoanPayments(getClosureLoanPaymentsList(c)).length > 0,
          ).length
          const showPaymentOpt = withPayments > 0
          const showLoanOpt = withLoans > 0
          return (
            <CadastroModalShell
              maxWidth="max-w-lg"
              onBackdropClick={() => setBulkDeleteModalOpen(false)}
              zClass="z-50"
            >
              <CadastroModalHeader
                isEdit={true}
                title="Excluir fechamentos"
                subtitle={`${selected.length} selecionado(s) — os períodos poderão ser fechados novamente.`}
                onClose={() => setBulkDeleteModalOpen(false)}
                icon={<Trash2 size={18} />}
                iconStyle={{ backgroundColor: 'var(--crud-delete)', color: '#fff' }}
              />
              <CadastroModalBody>
                <CadastroFormSection title="Resumo" icon={<Scale size={14} />} bodyClassName="p-0">
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        {settledCount > 0
                          ? `${settledCount} quitado(s): a quitação será removida antes de excluir. `
                          : null}
                        A mesma opção abaixo vale para todos os selecionados.
                      </p>
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
                {(showPaymentOpt || showLoanOpt) && (
                  <CadastroFormSection title="O que limpar" icon={<Trash2 size={14} />} bodyClassName="p-0">
                    <CadastroModalFieldsGrid>
                      {showPaymentOpt && (
                        <CadastroModalFieldsRow>
                          <label className={`${cadastroOptionLabelCls} items-start`}>
                            <input
                              type="checkbox"
                              checked={bulkDeleteClearPayments}
                              onChange={(e) => setBulkDeleteClearPayments(e.target.checked)}
                              className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                            />
                            <span>
                              <span className="block text-sm font-medium">Limpar pagamentos parciais</span>
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                Em {withPayments} fechamento(s) com pagamento
                              </span>
                            </span>
                          </label>
                        </CadastroModalFieldsRow>
                      )}
                      {showLoanOpt && (
                        <CadastroModalFieldsRow>
                          <label className={`${cadastroOptionLabelCls} items-start`}>
                            <input
                              type="checkbox"
                              checked={bulkDeleteClearLoans}
                              onChange={(e) => setBulkDeleteClearLoans(e.target.checked)}
                              className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                            />
                            <span>
                              <span className="block text-sm font-medium">Limpar liquidações de empréstimo</span>
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                Em {withLoans} fechamento(s) — empréstimos reabertos
                              </span>
                            </span>
                          </label>
                        </CadastroModalFieldsRow>
                      )}
                    </CadastroModalFieldsGrid>
                  </CadastroFormSection>
                )}
              </CadastroModalBody>
              <CadastroModalFooter
                onClose={() => setBulkDeleteModalOpen(false)}
                saving={bulkActionLoading}
                onSave={handleConfirmBulkDelete}
                saveLabel={`Excluir ${selected.length} fechamento(s)`}
                saveTone="danger"
                saveIcon={<Trash2 size={15} />}
              />
            </CadastroModalShell>
          )
        })()}
        {/* Modal: Excluir fechamento (com opção de limpar vínculos) */}
        {reopenModalClosure && (() => {
          const activePayments = (reopenModalClosure.closure_payments || []).filter((p) => p.active !== false)
          const reopenLoans = filterRegularLoanPayments(getClosureLoanPaymentsList(reopenModalClosure))
          return (
            <CadastroModalShell
              maxWidth="max-w-lg"
              onBackdropClick={() => setReopenModalClosure(null)}
              zClass="z-50"
            >
              <CadastroModalHeader
                isEdit={true}
                title="Excluir fechamento"
                subtitle={`${String(reopenModalClosure.month).padStart(2, '0')}/${reopenModalClosure.year} — o período poderá ser fechado novamente.`}
                onClose={() => setReopenModalClosure(null)}
                icon={<Trash2 size={18} />}
                iconStyle={{ backgroundColor: 'var(--crud-delete)', color: '#fff' }}
              />
              <CadastroModalBody>
                <CadastroFormSection title="Resumo" icon={<Scale size={14} />} bodyClassName="p-0">
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Este fechamento possui registros vinculados. Escolha o que remover junto com o fechamento.
                      </p>
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
                <CadastroFormSection title="O que limpar" icon={<Trash2 size={14} />} bodyClassName="p-0">
                  <CadastroModalFieldsGrid>
                    {activePayments.length > 0 && (
                      <CadastroModalFieldsRow>
                        <label className={`${cadastroOptionLabelCls} items-start`}>
                          <input
                            type="checkbox"
                            checked={reopenClearPayments}
                            onChange={(e) => setReopenClearPayments(e.target.checked)}
                            className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                          />
                          <span>
                            <span className="block text-sm font-medium">Limpar pagamentos parciais</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {activePayments.length} pagamento(s) registrado(s)
                            </span>
                          </span>
                        </label>
                      </CadastroModalFieldsRow>
                    )}
                    {reopenLoans.length > 0 && (
                      <CadastroModalFieldsRow>
                        <label className={`${cadastroOptionLabelCls} items-start`}>
                          <input
                            type="checkbox"
                            checked={reopenClearLoans}
                            onChange={(e) => setReopenClearLoans(e.target.checked)}
                            className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                          />
                          <span>
                            <span className="block text-sm font-medium">Limpar liquidações de empréstimo</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {reopenLoans.length} liquidação(ões) — empréstimos serão reabertos
                            </span>
                          </span>
                        </label>
                      </CadastroModalFieldsRow>
                    )}
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
              </CadastroModalBody>
              <CadastroModalFooter
                onClose={() => setReopenModalClosure(null)}
                saving={reopenExecuting}
                onSave={() => void handleConfirmReopenClosure()}
                saveLabel="Excluir fechamento"
                saveTone="danger"
                saveIcon={<Trash2 size={15} />}
              />
            </CadastroModalShell>
          )
        })()}
        {/* Modal: Pagamento parcial e quitação */}
        {showPaymentModal && paymentClosure && (() => {
          const remaining = paymentClosureRemaining(paymentClosure)
          const canRegisterPayment = remaining > 0.01
          const mode = canRegisterPayment ? paymentModalMode : 'settle'
          const partialValid =
            Boolean(paymentAmountCents) &&
            parseInt(paymentAmountCents) > 0 &&
            Boolean(paymentDate)
          const settleValid = Boolean(settlementDate)
          const saving = mode === 'partial' ? isSubmittingPayment : isSettlingClosure
          const saveDisabled = mode === 'partial' ? !partialValid : !settleValid

          return (
          <CadastroModalShell
            maxWidth="max-w-2xl"
            onBackdropClick={closePaymentModal}
            zClass="z-50"
          >
            <CadastroModalHeader
              isEdit={false}
              title="Pagamento do fechamento"
              subtitle={`Período ${String(paymentClosure.month).padStart(2, '0')}/${paymentClosure.year}`}
              onClose={closePaymentModal}
              icon={<Banknote size={18} />}
            />
            <CadastroModalBody>
              <CadastroFormSection title="Resumo" icon={<Scale size={14} />} bodyClassName="p-0">
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow>
                    <div
                      className={`w-full rounded-lg border px-4 py-3 ${
                        canRegisterPayment
                          ? 'border-red-200 bg-red-50 dark:border-red-800/60 dark:bg-red-900/20'
                          : 'border-green-200 bg-green-50 dark:border-green-800/60 dark:bg-green-900/20'
                      }`}
                    >
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Saldo restante
                      </p>
                      <p
                        className={`mt-1 text-2xl font-bold tabular-nums ${
                          canRegisterPayment
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-green-600 dark:text-green-400'
                        }`}
                      >
                        {canRegisterPayment ? formatCurrency(remaining) : formatCurrency(0)}
                      </p>
                      {!canRegisterPayment && (
                        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                          Sem saldo pendente — marque como quitado.
                        </p>
                      )}
                    </div>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <div>
                      <CadastroFieldLabel>O que deseja fazer?</CadastroFieldLabel>
                      <div className="mt-1.5 flex flex-wrap items-center gap-6">
                        <label
                          className={`${cadastroOptionLabelCls} ${!canRegisterPayment ? 'cursor-not-allowed opacity-50' : ''}`}
                        >
                          <input
                            type="radio"
                            name="closure-payment-mode"
                            checked={mode === 'partial'}
                            disabled={!canRegisterPayment}
                            onChange={() => setPaymentModalMode('partial')}
                            className={cadastroAccentControlCls}
                          />
                          Pagamento parcial
                        </label>
                        <label className={cadastroOptionLabelCls}>
                          <input
                            type="radio"
                            name="closure-payment-mode"
                            checked={mode === 'settle'}
                            onChange={() => setPaymentModalMode('settle')}
                            className={cadastroAccentControlCls}
                          />
                          Quitar fechamento
                        </label>
                      </div>
                    </div>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
              {((mode === 'partial' && canRegisterPayment) || mode === 'settle') && (
                <CadastroFormSection title="Dados" icon={<Banknote size={14} />} bodyClassName="p-0">
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow cols={2}>
                      <label className="block min-w-0">
                        <CadastroFieldLabel required>Data</CadastroFieldLabel>
                        <div className={paymentModalDateFieldWrapCls}>
                          <DateField
                            value={mode === 'partial' ? paymentDate : settlementDate}
                            onChange={mode === 'partial' ? setPaymentDate : setSettlementDate}
                            maxDate={new Date()}
                            className="min-h-0 w-full border-0 bg-transparent p-0 shadow-none"
                          />
                        </div>
                      </label>
                      {mode === 'partial' && canRegisterPayment ? (
                        <label className="block min-w-0">
                          <CadastroFieldLabel required>Valor</CadastroFieldLabel>
                          <div className="relative mt-0.5">
                            <span
                              className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold ${
                                parseInt(paymentAmountCents || '0') > 0
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-gray-400 dark:text-gray-500'
                              }`}
                            >
                              R$
                            </span>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={formatAmountMask(paymentAmountCents)}
                              onChange={handlePaymentAmountChange}
                              className={`${cadastroFieldCls} h-9 w-full py-0 pl-9 ${
                                parseInt(paymentAmountCents || '0') > 0
                                  ? 'border-green-400 font-semibold text-green-700 dark:border-green-600 dark:text-green-300'
                                  : ''
                              }`}
                              placeholder="0,00"
                            />
                          </div>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Máx. {formatCurrency(remaining)}
                          </p>
                        </label>
                      ) : (
                        <div aria-hidden />
                      )}
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
              )}
              {((mode === 'partial' && canRegisterPayment) || mode === 'settle') && (
                <CadastroFormSection title="Observações" icon={<MessageSquare size={14} />} bodyClassName="p-0">
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow>
                      <label className="block min-w-0">
                        <span className="sr-only">Observações</span>
                        <textarea
                          value={mode === 'partial' ? paymentNotes : settlementNotes}
                          onChange={(e) =>
                            mode === 'partial'
                              ? setPaymentNotes(e.target.value)
                              : setSettlementNotes(e.target.value)
                          }
                          className={`${cadastroFieldCls} min-h-[2.75rem] resize-y`}
                          placeholder={
                            mode === 'partial'
                              ? 'Ex: PIX, transferência…'
                              : 'Ex: acordo final, comprovante…'
                          }
                          rows={2}
                        />
                      </label>
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
              )}
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={closePaymentModal}
              onSave={() => {
                if (mode === 'partial') void handleAddPayment()
                else void handleSettleClosure()
              }}
              saving={saving}
              disabled={saveDisabled || saving}
              saveLabel={mode === 'partial' ? 'Registrar pagamento' : 'Quitar fechamento'}
              saveIcon={mode === 'partial' ? <Check size={15} /> : <CheckCircle size={15} />}
              saveTone={mode === 'settle' ? 'success' : 'default'}
            />
          </CadastroModalShell>
          )
        })()}
        {/* Modal: Editar Pagamento */}
        {showEditPaymentModal && editingPaymentClosure && (
          <CadastroModalShell maxWidth="max-w-2xl" onBackdropClick={closeEditPaymentModal} zClass="z-50">
            <CadastroModalHeader
              isEdit={true}
              title="Editar Pagamento"
              onClose={closeEditPaymentModal}
              icon={<Banknote size={18} />}
            />
            <CadastroModalBody>
              <CadastroFormSection title="Dados" icon={<Banknote size={14} />} bodyClassName="p-0">
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow cols={2}>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Data</CadastroFieldLabel>
                      <div className={paymentModalDateFieldWrapCls}>
                        <DateField
                          value={editPaymentDate}
                          onChange={setEditPaymentDate}
                          maxDate={new Date()}
                          className="min-h-0 w-full border-0 bg-transparent p-0 shadow-none"
                        />
                      </div>
                    </label>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Valor</CadastroFieldLabel>
                      <div className="relative mt-0.5">
                        <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold ${parseInt(editPaymentCents || '0') > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}`}>R$</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatAmountMask(editPaymentCents)}
                          onChange={e => setEditPaymentCents(
                            clampCents(e.target.value.replace(/\D/g, ''), editPaymentRemaining(editingPaymentClosure)),
                          )}
                          className={`${cadastroFieldCls} h-9 w-full py-0 pl-9 ${parseInt(editPaymentCents || '0') > 0 ? 'border-green-400 font-semibold text-green-700 dark:border-green-600 dark:text-green-300' : ''}`}
                          placeholder="0,00"
                        />
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Máx. {formatCurrency(editPaymentRemaining(editingPaymentClosure))}
                      </p>
                    </label>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
              <CadastroFormSection title="Observações" icon={<MessageSquare size={14} />} bodyClassName="p-0">
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <span className="sr-only">Observações</span>
                      <textarea
                        value={editPaymentNotes}
                        onChange={e => setEditPaymentNotes(e.target.value)}
                        placeholder="Ex: PIX, transferência…"
                        className={`${cadastroFieldCls} min-h-[2.75rem] resize-y`}
                        rows={2}
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

