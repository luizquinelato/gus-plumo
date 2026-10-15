import { useState, useEffect } from 'react'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageShell,
  CadastroListPageTabs,
  CadastroListPageFilterCard,
  CadastroListPageSearchField,
  CadastroFilterField,
  cadastroFilterFieldCls,
  cadastroRowIconBtnCls,
  cadastroRowIconDangerCls,
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
import LoadingSpinner from '../components/LoadingSpinner'
import Toast from '../components/Toast'
import { DateField } from '../components/date'
import { parseLocalDate } from '../utils/dateUtils'
import {
  Wallet, Plus, Edit2, Trash2, ChevronDown, ChevronRight, Filter, Calendar, CheckCircle, Clock,
  AlertTriangle, Percent, DollarSign, ArrowUp, ArrowDown, Building2, UserX, Link2, Lock, HelpCircle,
  Banknote, Scale, MessageSquare, Check,
} from 'lucide-react'
import { useConfirm } from '../hooks/useConfirm'

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

interface LoanPayment {
  id: number
  loan_id: number
  amount: number
  payment_date: string
  payment_type: 'manual' | 'linked'
  notes: string | null
  source_type: string | null
  source_id: number | null
  balance_closure_id: number | null  // Se preenchido, pagamento está bloqueado (vinculado a fechamento)
}

interface Loan {
  id: number
  loan_type: 'lent' | 'borrowed'
  principal_amount: number
  description: string
  loan_date: string
  due_date: string | null
  interest_enabled: boolean
  interest_type: 'simple' | 'compound' | null
  interest_rate: number | null
  interest_period: 'daily' | 'monthly' | 'yearly' | null
  counterpart_account_id: number | null
  external_name: string | null
  external_description: string | null
  status: 'open' | 'settled'
  settled_at: string | null
  last_reopened_at: string | null
  reopened_count: number
  source_type: string | null
  source_id: number | null
  account_id: number
  total_paid: number
  remaining_balance: number
  is_owner: boolean
  counterpart?: {
    id: number
    name: string
    bank_name: string | null
  }
  payments: LoanPayment[]
}

interface Partner {
  id: number
  shared_account_id: number
  shared_account: {
    id: number
    name: string | null
    description: string | null
    bank: {
      code: string
      name: string
    } | null
    agency: number | string | null
    account_number: string | number | null
  } | null
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value)
}

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleDateString('pt-BR')
}

const formatDateTime = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Calcula juros (simples ou composto) baseado na data do empréstimo
 * Implementa lógica de mercado com carência no primeiro período e pro-rata die
 *
 * REGRAS DE MERCADO:
 * 1. Juros Diário: cálculo direto por dia
 * 2. Juros Mensal: carência no 1º mês (zero juros), depois pro-rata die
 * 3. Juros Anual: carência no 1º ano (zero juros), depois converte para mensal/diário
 *
 * CONVERSÃO DE TAXAS (Compostos):
 * - Taxa diária equivalente = (1 + i_mensal)^(1/30) - 1
 * - Taxa mensal equivalente = (1 + i_anual)^(1/12) - 1
 *
 * @param principal Valor principal do empréstimo (sempre positivo)
 * @param loanDate Data do empréstimo
 * @param interestRate Taxa de juros em % (ex: 10 = 10%)
 * @param interestType 'simple' ou 'compound'
 * @param interestPeriod 'daily', 'monthly', 'yearly'
 * @returns Valor corrigido com juros, valor do juros e períodos calculados
 */
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
    // JUROS DIÁRIO: cálculo direto por dia, sem carência
    periods = diffDays
    if (interestType === 'compound') {
      correctedAmount = principalNum * Math.pow(1 + rate, periods)
    } else {
      correctedAmount = principalNum * (1 + rate * periods)
    }
    description = `${periods} dias × ${interestRate}% ao dia`
  } else if (interestPeriod === 'monthly') {
    // JUROS MENSAL: carência no 1º mês
    const DAYS_IN_MONTH = 30
    const fullMonths = Math.floor(diffDays / DAYS_IN_MONTH)
    const extraDays = diffDays % DAYS_IN_MONTH

    if (diffDays < DAYS_IN_MONTH) {
      // Ainda no primeiro mês - zero juros (carência)
      correctedAmount = principalNum
      periods = 0
      description = `Carência: ${diffDays} dias (1º mês)`
    } else {
      // Após o primeiro mês: meses completos + pro-rata dos dias extras
      if (interestType === 'compound') {
        // Juros compostos: M = P × (1 + i)^(meses_completos + dias_extras/30)
        const totalPeriods = fullMonths + (extraDays / DAYS_IN_MONTH)
        correctedAmount = principalNum * Math.pow(1 + rate, totalPeriods)
        periods = totalPeriods
      } else {
        // Juros simples: M = P × (1 + i × (meses_completos + dias_extras/30))
        const totalPeriods = fullMonths + (extraDays / DAYS_IN_MONTH)
        correctedAmount = principalNum * (1 + rate * totalPeriods)
        periods = totalPeriods
      }
      description = `${fullMonths} mês(es) + ${extraDays} dias pro-rata`
    }
  } else {
    // JUROS ANUAL: carência no 1º ano, converte para mensal/diário
    const DAYS_IN_YEAR = 365
    const DAYS_IN_MONTH = 30
    const fullYears = Math.floor(diffDays / DAYS_IN_YEAR)
    const remainingDays = diffDays % DAYS_IN_YEAR
    const fullMonthsInRemainder = Math.floor(remainingDays / DAYS_IN_MONTH)
    const extraDays = remainingDays % DAYS_IN_MONTH

    if (diffDays < DAYS_IN_YEAR) {
      // Ainda no primeiro ano - zero juros (carência)
      correctedAmount = principalNum
      periods = 0
      const monthsElapsed = Math.floor(diffDays / DAYS_IN_MONTH)
      const daysElapsed = diffDays % DAYS_IN_MONTH
      description = `Carência: ${monthsElapsed}m ${daysElapsed}d (1º ano)`
    } else {
      // Após o primeiro ano
      if (interestType === 'compound') {
        // Conversão de taxa anual para mensal (equivalente)
        const monthlyRate = Math.pow(1 + rate, 1 / 12) - 1
        const fullMonthsTotal = fullYears * 12 + fullMonthsInRemainder
        const totalPeriods = fullMonthsTotal + (extraDays / DAYS_IN_MONTH)
        correctedAmount = principalNum * Math.pow(1 + monthlyRate, totalPeriods)
        periods = fullYears + (remainingDays / DAYS_IN_YEAR)
      } else {
        // Juros simples: proporção direta do ano
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

// Helper para converter Date para string YYYY-MM-DD
const dateToInputString = (date: Date | null): string => {
  if (!date) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const cardListItemCls =
  'rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800'
const loanCardOpenCls = `${cardListItemCls} border-l-4 border-l-blue-500`
const loanCardSettledCls =
  `${cardListItemCls} border-l-4 border-l-green-500 bg-green-50/50 dark:bg-green-900/10`

const loanPaymentColsRestOwner = (
  <>
    <ListTableSpacerCol />
    <col />
    <col />
    <col />
    <col />
  </>
)

const loanPaymentColsRestViewer = (
  <>
    <ListTableSpacerCol />
    <col />
    <col />
    <col />
  </>
)

function getLoanSettleContext(loan: Loan) {
  const principal = Math.abs(Number(loan.principal_amount))
  let correctedAmount = principal
  let remaining = Math.max(0, Math.abs(Number(loan.remaining_balance)))

  if (loan.interest_enabled && loan.interest_rate && loan.interest_period && loan.interest_type) {
    const interest = calculateInterest(
      principal,
      loan.loan_date,
      Number(loan.interest_rate),
      loan.interest_type,
      loan.interest_period,
    )
    correctedAmount = interest.correctedAmount
    const totalPaid = principal - Math.abs(Number(loan.remaining_balance))
    remaining = Math.max(0, interest.correctedAmount - totalPaid)
  }

  return { principal, correctedAmount, remaining }
}

export default function EmprestimosPage() {
  const { showConfirm, ConfirmComponent } = useConfirm()

  // Estados principais
  const [loans, setLoans] = useState<Loan[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })

  // Filtros (rascunho vs aplicado — lista só após Aplicar)
  const [draftFilterType, setDraftFilterType] = useState<'all' | 'lent' | 'borrowed'>('all')
  const [draftFilterPartner, setDraftFilterPartner] = useState<number | null>(null)
  const [appliedFilterType, setAppliedFilterType] = useState<'all' | 'lent' | 'borrowed'>('all')
  const [appliedFilterPartner, setAppliedFilterPartner] = useState<number | null>(null)
  /** Busca por descrição na lista (só após aplicar filtros) */
  const [searchTerm, setSearchTerm] = useState('')
  const [filtersApplied, setFiltersApplied] = useState(false)
  const [listTab, setListTab] = useState<'open' | 'settled'>('open')

  // Estados de expansão e modais
  const [expandedLoans, setExpandedLoans] = useState<Set<number>>(new Set())
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showReopenModal, setShowReopenModal] = useState(false)
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null)
  const [editingSettled, setEditingSettled] = useState(false) // Flag para edição limitada de quitados
  const [payingLoan, setPayingLoan] = useState<Loan | null>(null)
  const [reopeningLoan, setReopeningLoan] = useState<Loan | null>(null)

  // Form do modal de criação
  const [formLoanType, setFormLoanType] = useState<'lent' | 'borrowed'>('lent')
  const [formAmount, setFormAmount] = useState('')
  const [formAmountCents, setFormAmountCents] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formLoanDate, setFormLoanDate] = useState(dateToInputString(new Date()))
  const [formDueDate, setFormDueDate] = useState('')
  const [formUseExternal, setFormUseExternal] = useState(false)
  const [formPartnerId, setFormPartnerId] = useState<number | null>(null)
  const [formExternalName, setFormExternalName] = useState('')
  const [formInterestEnabled, setFormInterestEnabled] = useState(false)
  const [formInterestType, setFormInterestType] = useState<'simple' | 'compound'>('simple')
  const [formInterestRate, setFormInterestRate] = useState('')
  const [formInterestPeriod, setFormInterestPeriod] = useState<'daily' | 'monthly' | 'yearly'>('monthly')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Form do modal de pagamento
  const [paymentAmountCents, setPaymentAmountCents] = useState('')
  const [paymentDate, setPaymentDate] = useState(dateToInputString(new Date()))
  const [paymentNotes, setPaymentNotes] = useState('')
  const [paymentModalMode, setPaymentModalMode] = useState<'partial' | 'settle'>('partial')
  const [settlementDate, setSettlementDate] = useState(dateToInputString(new Date()))
  const [settlementNotes, setSettlementNotes] = useState('')
  const [isSettlingLoan, setIsSettlingLoan] = useState(false)
  const [editingPayment, setEditingPayment] = useState<LoanPayment | null>(null)

  // Form do modal de reabrir
  const [reopenAmount, setReopenAmount] = useState('')
  const [reopenInterestEnabled, setReopenInterestEnabled] = useState(false)
  const [reopenInterestType, setReopenInterestType] = useState<'simple' | 'compound'>('simple')
  const [reopenInterestRate, setReopenInterestRate] = useState('')
  const [reopenInterestPeriod, setReopenInterestPeriod] = useState<'daily' | 'monthly' | 'yearly'>('monthly')

  // Handlers para máscara de valor (igual ao ManualTransactionModal)
  const handleAmountChange = (value: string, setter: (v: string) => void, forceSign?: 'negative' | 'positive') => {
    // Remove caracteres inválidos
    let cleanValue = value

    // Se forçar sinal, remove sinais incorretos
    if (forceSign === 'negative') {
      // Remove qualquer + e garante que não seja positivo
      cleanValue = cleanValue.replace(/^\+/, '')
      // Se não começa com - e não está vazio, adiciona -
      if (cleanValue && !cleanValue.startsWith('-') && cleanValue !== '0' && cleanValue !== '0.') {
        cleanValue = '-' + cleanValue
      }
    } else if (forceSign === 'positive') {
      // Remove qualquer sinal negativo
      cleanValue = cleanValue.replace(/^-/, '')
    }

    // Permite: números, sinal negativo no início (se permitido), e um ponto decimal
    const regex = forceSign === 'positive' ? /^\d*\.?\d*$/ : /^-?\d*\.?\d*$/
    if (cleanValue === '' || cleanValue === '-' || regex.test(cleanValue)) {
      const numValue = parseFloat(cleanValue)
      if (!isNaN(numValue) && Math.abs(numValue) > 99999999.99) {
        return // Não atualiza se exceder o limite
      }
      setter(cleanValue)
    }
  }

  const handleAmountBlur = (value: string, setter: (v: string) => void, forceSign?: 'negative' | 'positive') => {
    const amount = parseFloat(value)
    if (!isNaN(amount)) {
      let finalAmount = amount
      // Garante o sinal correto no blur
      if (forceSign === 'negative' && finalAmount > 0) {
        finalAmount = -finalAmount
      } else if (forceSign === 'positive' && finalAmount < 0) {
        finalAmount = Math.abs(finalAmount)
      }
      setter(finalAmount.toFixed(2))
    }
  }

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  useEffect(() => {
    void loadPartners()
  }, [])

  // Máscara BRL: dígitos brutos → "1.234,56"
  const formatAmountMask = (cents: string): string => {
    const num = parseInt(cents || '0', 10)
    return (num / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const paymentModalDateFieldWrapCls = `${cadastroFieldCls} mt-0.5 box-border !py-0 flex h-9 items-center`

  const clampPaymentCents = (digits: string, maxAmount: number): string => {
    const cents = parseInt(digits || '0', 10)
    const maxCents = Math.max(0, Math.round(maxAmount * 100))
    if (!cents) return ''
    return String(Math.min(cents, maxCents))
  }

  const closePaymentModal = () => {
    setShowPaymentModal(false)
    setPayingLoan(null)
    setEditingPayment(null)
    setPaymentAmountCents('')
    setPaymentNotes('')
    setSettlementNotes('')
  }

  // Atalhos de teclado para modais
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showReopenModal) {
          setShowReopenModal(false)
          setReopeningLoan(null)
        } else if (showPaymentModal) {
          closePaymentModal()
        } else if (showCreateModal) {
          setShowCreateModal(false)
          resetForm()
        }
      }
    }

    if (showCreateModal || showPaymentModal || showReopenModal) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showCreateModal, showPaymentModal, showReopenModal])

  const loadLoans = async () => {
    try {
      setIsLoading(true)
      const response = await axios.get('/api/loans/')
      // A API retorna { loans: [...], total: N }
      setLoans(response.data.loans || [])
    } catch (error) {
      console.error('Erro ao carregar empréstimos:', error)
      showToast('Erro ao carregar empréstimos', 'error')
    } finally {
      setIsLoading(false)
    }
  }

  const refreshLoansIfApplied = () => {
    if (filtersApplied) void loadLoans()
  }

  const loadPartners = async () => {
    try {
      // Usa endpoint de expense-sharing que retorna os compartilhamentos com parceiros
      const response = await axios.get('/api/expense-sharing/')
      // Mantém a estrutura original com shared_account completo
      setPartners(response.data)
    } catch (error) {
      console.error('Erro ao carregar parceiros:', error)
    }
  }

  // Função auxiliar para obter o nome de exibição da conta
  const getAccountDisplayName = (account: Partner['shared_account']) => {
    if (!account) return 'Sem nome'
    return account.name || account.description || 'Sem nome'
  }

  const toggleLoan = (loanId: number) => {
    const newExpanded = new Set(expandedLoans)
    if (newExpanded.has(loanId)) {
      newExpanded.delete(loanId)
    } else {
      newExpanded.add(loanId)
    }
    setExpandedLoans(newExpanded)
  }

  const resetForm = () => {
    setFormLoanType('lent')
    setFormAmount('')
    setFormAmountCents('')
    setFormDescription('')
    setFormLoanDate(dateToInputString(new Date()))
    setFormDueDate('')
    setFormUseExternal(false)
    setFormPartnerId(null)
    setFormExternalName('')
    setFormInterestEnabled(false)
    setFormInterestType('simple')
    setFormInterestRate('')
    setFormInterestPeriod('monthly')
    setEditingLoan(null)
    setEditingSettled(false)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formAmountCents || formAmountCents === '0' || !formDescription) {
      showToast('Preencha os campos obrigatórios', 'warning')
      return
    }
    if (!formUseExternal && !formPartnerId) {
      showToast('Selecione uma conta parceira ou marque como externo', 'warning')
      return
    }
    if (formInterestEnabled && !formInterestRate) {
      showToast('Informe a taxa de juros', 'warning')
      return
    }

    setIsSubmitting(true)
    try {
      const principalAmount = parseInt(formAmountCents || '0', 10) / 100

      const data: any = {
        loan_type: formLoanType,
        principal_amount: principalAmount,
        description: formDescription,
        loan_date: formLoanDate || null,  // Enviar como string YYYY-MM-DD (igual BalancoPage)
        due_date: formDueDate || null,    // Enviar como string YYYY-MM-DD (igual BalancoPage)
        interest_enabled: formInterestEnabled,
        interest_type: formInterestEnabled ? formInterestType : null,
        interest_rate: formInterestEnabled ? parseFloat(formInterestRate) : null,
        interest_period: formInterestEnabled ? formInterestPeriod : null,
      }

      if (formUseExternal) {
        data.external_name = formExternalName
      } else {
        data.counterpart_account_id = formPartnerId
      }

      if (editingLoan) {
        await axios.patch(`/api/loans/${editingLoan.id}`, data)
        showToast('Empréstimo atualizado com sucesso!', 'success')
      } else {
        await axios.post('/api/loans/', data)
        showToast('Empréstimo criado com sucesso!', 'success')
      }

      setShowCreateModal(false)
      resetForm()
      refreshLoansIfApplied()
    } catch (error: any) {
      console.error('Erro ao salvar empréstimo:', error)
      showToast(error.response?.data?.detail || 'Erro ao salvar empréstimo', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEdit = (loan: Loan, settledMode: boolean = false) => {
    setEditingLoan(loan)
    setEditingSettled(settledMode)
    setFormLoanType(loan.loan_type)
    const absAmount = Math.abs(loan.principal_amount)
    setFormAmountCents(String(Math.round(absAmount * 100)))
    setFormAmount(`${loan.loan_type === 'borrowed' ? '-' : ''}${absAmount.toFixed(2)}`)
    setFormDescription(loan.description)
    setFormLoanDate(loan.loan_date.split('T')[0])
    setFormDueDate(loan.due_date ? loan.due_date.split('T')[0] : '')
    setFormUseExternal(!!loan.external_name)
    setFormPartnerId(loan.counterpart_account_id)
    setFormExternalName(loan.external_name || '')
    setFormInterestEnabled(loan.interest_enabled)
    setFormInterestType(loan.interest_type || 'simple')
    setFormInterestRate(loan.interest_rate ? Number(loan.interest_rate).toFixed(2) : '')
    setFormInterestPeriod(loan.interest_period || 'monthly')
    setShowCreateModal(true)
  }

  const handleReopen = (loan: Loan) => {
    setReopeningLoan(loan)
    setReopenAmount('')
    setReopenInterestEnabled(false)
    setReopenInterestType(loan.interest_type || 'simple')
    setReopenInterestRate(loan.interest_rate?.toString() || '')
    setReopenInterestPeriod(loan.interest_period || 'monthly')
    setShowReopenModal(true)
  }

  const handleReopenSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reopeningLoan || !reopenAmount) return

    const amount = parseFloat(reopenAmount.replace(',', '.'))
    if (amount <= 0) {
      showToast('O valor adicional deve ser maior que zero', 'warning')
      return
    }

    setIsSubmitting(true)
    try {
      await axios.post(`/api/loans/${reopeningLoan.id}/reopen`, {
        additional_amount: amount,
        interest_enabled: reopenInterestEnabled,
        interest_type: reopenInterestEnabled ? reopenInterestType : null,
        interest_rate: reopenInterestEnabled ? parseFloat(reopenInterestRate.replace(',', '.')) : null,
        interest_period: reopenInterestEnabled ? reopenInterestPeriod : null
      })
      showToast('Empréstimo reaberto com sucesso!', 'success')
      setShowReopenModal(false)
      setReopeningLoan(null)
      refreshLoansIfApplied()
    } catch (error: any) {
      showToast(error.response?.data?.detail || 'Erro ao reabrir empréstimo', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = (loan: Loan) => {
    showConfirm(
      'Excluir Empréstimo',
      `Tem certeza que deseja excluir o empréstimo "${loan.description}"? Esta ação não pode ser desfeita.`,
      async () => {
        try {
          await axios.delete(`/api/loans/${loan.id}`)
          showToast('Empréstimo excluído com sucesso!', 'success')
          refreshLoansIfApplied()
        } catch (error: any) {
          showToast(error.response?.data?.detail || 'Erro ao excluir empréstimo', 'error')
        }
      },
      'Excluir',
      'Cancelar'
    )
  }

  const handleOpenPayment = (loan: Loan, payment?: LoanPayment) => {
    setPayingLoan(loan)
    if (payment) {
      setEditingPayment(payment)
      setPaymentAmountCents(String(Math.round(payment.amount * 100)))
      setPaymentDate(payment.payment_date.split('T')[0])
      setPaymentNotes(payment.notes || '')
      setShowPaymentModal(true)
      return
    }
    const { remaining } = getLoanSettleContext(loan)
    setEditingPayment(null)
    setPaymentAmountCents('')
    setPaymentDate(dateToInputString(new Date()))
    setPaymentNotes('')
    setSettlementDate(dateToInputString(new Date()))
    setSettlementNotes('')
    setPaymentModalMode(remaining > 0.01 ? 'partial' : 'settle')
    setShowPaymentModal(true)
  }

  const handleAddPartialPayment = async () => {
    const amount = parseInt(paymentAmountCents || '0', 10) / 100
    if (!payingLoan || !paymentAmountCents || amount <= 0 || !paymentDate) {
      showToast('Informe valor e data do pagamento', 'warning')
      return
    }

    const { remaining } = getLoanSettleContext(payingLoan)
    if (amount > remaining + 0.001) {
      showToast(`O valor não pode ser maior que o saldo restante (${formatCurrency(remaining)})`, 'warning')
      return
    }

    setIsSubmitting(true)
    try {
      await axios.post(`/api/loans/${payingLoan.id}/pay`, {
        amount,
        payment_date: paymentDate || null,
        notes: paymentNotes || null,
      })
      showToast('Pagamento registrado com sucesso!', 'success')
      setExpandedLoans((prev) => new Set(prev).add(payingLoan.id))
      closePaymentModal()
      refreshLoansIfApplied()
    } catch (error: any) {
      showToast(error.response?.data?.detail || 'Erro ao registrar pagamento', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSaveEditPayment = async () => {
    const amount = parseInt(paymentAmountCents || '0', 10) / 100
    if (!payingLoan || !editingPayment || !paymentAmountCents || amount <= 0) {
      showToast('Informe o valor do pagamento', 'warning')
      return
    }

    setIsSubmitting(true)
    try {
      await axios.patch(`/api/loans/${payingLoan.id}/payments/${editingPayment.id}`, {
        amount,
        payment_date: paymentDate || null,
        notes: paymentNotes || null,
      })
      showToast('Pagamento atualizado com sucesso!', 'success')
      closePaymentModal()
      refreshLoansIfApplied()
    } catch (error: any) {
      showToast(error.response?.data?.detail || 'Erro ao salvar pagamento', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSettleLoanFromModal = async () => {
    if (!payingLoan) return
    const { correctedAmount } = getLoanSettleContext(payingLoan)

    setIsSettlingLoan(true)
    try {
      await axios.post(`/api/loans/${payingLoan.id}/settle`, {
        notes: settlementNotes.trim() || 'Quitação manual',
        corrected_amount: correctedAmount,
      })
      showToast('Empréstimo quitado com sucesso!', 'success')
      closePaymentModal()
      refreshLoansIfApplied()
    } catch (error: any) {
      showToast(error.response?.data?.detail || 'Erro ao quitar empréstimo', 'error')
    } finally {
      setIsSettlingLoan(false)
    }
  }

  const handlePaymentAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '')
    if (!payingLoan) {
      setPaymentAmountCents(digits)
      return
    }
    const { remaining } = getLoanSettleContext(payingLoan)
    setPaymentAmountCents(clampPaymentCents(digits, remaining))
  }

  const handleDeletePayment = (loan: Loan, payment: LoanPayment) => {
    const isSettled = loan.status === 'settled'
    const title = isSettled ? 'Excluir Pagamento e Reabrir' : 'Excluir Pagamento'
    const message = isSettled
      ? `Deseja excluir o pagamento de ${formatCurrency(payment.amount)} do dia ${formatDate(payment.payment_date)}?\n\n⚠️ O empréstimo será reaberto automaticamente.`
      : `Deseja excluir o pagamento de ${formatCurrency(payment.amount)} do dia ${formatDate(payment.payment_date)}?`

    showConfirm(
      title,
      message,
      async () => {
        try {
          await axios.delete(`/api/loans/${loan.id}/payments/${payment.id}`)
          showToast(isSettled ? 'Pagamento excluído e empréstimo reaberto!' : 'Pagamento excluído com sucesso!', 'success')
          refreshLoansIfApplied()
        } catch (error: any) {
          showToast(error.response?.data?.detail || 'Erro ao excluir pagamento', 'error')
        }
      },
      'Excluir',
      'Cancelar'
    )
  }

  const hasActiveFilters = draftFilterType !== 'all' || draftFilterPartner != null

  const applyFilters = async () => {
    setSearchTerm('')
    setAppliedFilterType(draftFilterType)
    setAppliedFilterPartner(draftFilterPartner)
    setFiltersApplied(true)
    await loadLoans()
  }

  const clearFilters = () => {
    setDraftFilterType('all')
    setDraftFilterPartner(null)
  }

  const filteredLoans = filtersApplied
    ? loans.filter((loan) => {
        const q = searchTerm.trim()
        if (q && !loan.description.toLowerCase().includes(q.toLowerCase())) {
          return false
        }
        if (appliedFilterType !== 'all' && loan.loan_type !== appliedFilterType) return false
        if (appliedFilterPartner && loan.counterpart_account_id !== appliedFilterPartner) return false
        return true
      })
    : []

  const openLoans = filteredLoans.filter((loan) => loan.status !== 'settled')
  const settledLoans = filteredLoans.filter((loan) => loan.status === 'settled')
  const displayLoans = listTab === 'open' ? openLoans : settledLoans

  const getStatusIcon = (loan: Loan) => {
    // Status: Apenas Open e Settled
    const statusConfig: Record<string, { icon: any; cssVar: string; label: string }> = {
      open: { icon: Clock, cssVar: '--status-info', label: 'Aberto' },
      settled: { icon: CheckCircle, cssVar: '--status-success', label: 'Quitado' }
    }
    const config = statusConfig[loan.status]
    const Icon = config.icon
    return (
      <span
        className="inline-flex items-center justify-center p-1 rounded-full text-white"
        style={{ backgroundColor: `var(${config.cssVar})` }}
        title={config.label}
      >
        <Icon size={14} />
      </span>
    )
  }

  const renderLoanPaymentHistory = (loan: Loan) => (
    <div className="mt-4 ml-10">
      <h4 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">Histórico de Pagamentos</h4>
      {loan.payments.length === 0 ? (
        <p className="text-sm italic text-gray-500 dark:text-gray-400">Nenhum pagamento registrado</p>
      ) : (
        <div className="overflow-x-auto">
          <ListPageNestedTable
            alignWithListLeading
            leadingMode="index-only"
            colsRest={loan.is_owner ? loanPaymentColsRestOwner : loanPaymentColsRestViewer}
            head={
              <tr>
                <ListTableIndexHeader />
                <ListTableSpacerHeader />
                <ListTableStaticHeader label="Data" className="px-3 py-2" />
                <ListTableStaticHeader label="Observações" className="px-3 py-2" />
                <ListTableStaticHeader label="Valor" className="px-3 py-2 text-right" />
                {loan.is_owner && <ListTableStaticHeader label="Ações" className="px-2 py-2" />}
              </tr>
            }
          >
            {loan.payments.map((payment, payIdx) => (
              <tr key={payment.id} className={listPageTableRowHoverCls}>
                <ListTableIndexCell index={payIdx + 1} />
                <ListTableSpacerCell />
                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                  {formatDateTime(payment.payment_date)}
                </td>
                <td className="max-w-0 truncate px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  {payment.notes || '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-sm font-semibold text-green-600 dark:text-green-400">
                  {formatCurrency(payment.amount)}
                </td>
                {loan.is_owner && (
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    {payment.balance_closure_id ? (
                      <div
                        className="inline-flex cursor-help items-center gap-1.5 rounded bg-gray-100 px-2 py-1 dark:bg-gray-700"
                        title="Este pagamento está vinculado a um fechamento de balanço. Para editar ou excluir, vá até a página de Balanço > aba Fechamentos e exclua o fechamento ou remova as liquidações de empréstimos."
                      >
                        <Lock size={12} className="text-gray-500 dark:text-gray-400" />
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Fechamento</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        {loan.status !== 'settled' && (
                          <button
                            type="button"
                            onClick={() => handleOpenPayment(loan, payment)}
                            className={cadastroRowIconBtnCls}
                            title="Editar pagamento"
                          >
                            <Edit2 size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeletePayment(loan, payment)}
                          className={cadastroRowIconDangerCls}
                          title={
                            loan.status === 'settled'
                              ? 'Excluir pagamento (reabre o empréstimo)'
                              : 'Excluir pagamento'
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </ListPageNestedTable>
        </div>
      )}
    </div>
  )

  // Labels dinâmicos baseados na direção do empréstimo
  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <CadastroListPageShell>
        <CadastroListPageBody
          header={
            <CadastroListPageHero
              icon={<Wallet className="h-6 w-6" />}
              title="Empréstimos"
              subtitle="Gerencie empréstimos feitos e recebidos"
              actions={
                <button
                  onClick={() => { resetForm(); setShowCreateModal(true) }}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: 'var(--crud-create)' }}
                >
                  <Plus size={18} /> Novo Empréstimo
                </button>
              }
            />
          }
          tabs={
            <CadastroListPageFilterCard
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearFilters}
              onApply={() => void applyFilters()}
              applying={isLoading}
              resultHint={
                filtersApplied
                  ? `${filteredLoans.length} empréstimo${filteredLoans.length === 1 ? '' : 's'}`
                  : undefined
              }
            >
              <CadastroFilterField label="Tipo" icon={<ArrowUp size={12} />}>
                <select
                  value={draftFilterType}
                  onChange={(e) => setDraftFilterType(e.target.value as 'all' | 'lent' | 'borrowed')}
                  className={cadastroFilterFieldCls}
                >
                  <option value="all">Todos</option>
                  <option value="lent">A receber</option>
                  <option value="borrowed">A pagar</option>
                </select>
              </CadastroFilterField>
              <CadastroFilterField label="Parceiro" icon={<Building2 size={12} />}>
                <select
                  value={draftFilterPartner ?? ''}
                  onChange={(e) =>
                    setDraftFilterPartner(e.target.value ? parseInt(e.target.value, 10) : null)
                  }
                  className={cadastroFilterFieldCls}
                >
                  <option value="">Todos</option>
                  {[...partners]
                    .sort((a, b) => {
                      const nameA = getAccountDisplayName(a.shared_account).toLowerCase()
                      const nameB = getAccountDisplayName(b.shared_account).toLowerCase()
                      return nameA.localeCompare(nameB, 'pt-BR')
                    })
                    .map((p) => {
                      const acc = p.shared_account
                      const bankName = acc?.bank?.name || 'Sem banco'
                      const agencyInfo = acc?.agency ? `Ag: ${acc.agency}` : ''
                      const accountInfo = acc?.account_number ? `Conta: ${acc.account_number}` : ''
                      const details = [bankName, agencyInfo, accountInfo].filter(Boolean).join(' • ')
                      return (
                        <option key={p.shared_account_id} value={p.shared_account_id}>
                          {getAccountDisplayName(acc)} • {details}
                        </option>
                      )
                    })}
                </select>
              </CadastroFilterField>
            </CadastroListPageFilterCard>
          }
        >
        <div>
          {isLoading ? (
            <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white py-12 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <LoadingSpinner />
            </div>
          ) : !filtersApplied ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <Filter size={48} className="mx-auto mb-4 text-gray-300 dark:text-gray-600" />
              <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Selecione os filtros</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Escolha o tipo e o parceiro (ou deixe Todos) e clique em Aplicar para carregar os empréstimos.
              </p>
            </div>
          ) : loans.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <Wallet className="mx-auto mb-4 h-12 w-12 text-gray-400" />
              <p className="text-gray-500 dark:text-gray-400">Nenhum empréstimo cadastrado</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="px-4 pt-3">
                <CadastroListPageTabs
                  tabs={[
                    { key: 'open', label: 'Em aberto', icon: <Clock size={16} />, count: openLoans.length },
                    { key: 'settled', label: 'Quitados', icon: <CheckCircle size={16} />, count: settledLoans.length },
                  ]}
                  active={listTab}
                  onChange={setListTab}
                  trailing={
                    <div className="w-72">
                      <CadastroListPageSearchField
                        value={searchTerm}
                        onChange={setSearchTerm}
                        placeholder="Buscar por descrição…"
                      />
                    </div>
                  }
                />
              </div>
              <div className="p-4">
          {displayLoans.length === 0 ? (
            <div className="py-8 text-center">
              <Wallet className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {listTab === 'open' ? 'Nenhum empréstimo em aberto neste filtro' : 'Nenhum empréstimo quitado neste filtro'}
              </p>
            </div>
          ) : listTab === 'open' ? (
            <div className="space-y-3">
              {openLoans.map((loan) => {
                // Determinar direção efetiva para os badges
                const effectiveType = loan.is_owner ? loan.loan_type : (loan.loan_type === 'lent' ? 'borrowed' : 'lent')
                const isLent = effectiveType === 'lent'

                return (
                <div key={loan.id} className={loanCardOpenCls}>
                  {/* Header do empréstimo */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1">
                      <button onClick={() => toggleLoan(loan.id)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                        {expandedLoans.has(loan.id) ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-gray-900 dark:text-white truncate">{loan.description}</span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                          {/* Badge A Receber / A Pagar */}
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-white ${
                              isLent ? 'bg-green-600' : 'bg-red-600'
                            }`}
                          >
                            {isLent ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                            {isLent ? 'A Receber' : 'A Pagar'}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar size={14} /> {formatDate(loan.loan_date)}
                          </span>
                          <span className="flex items-center gap-1" title={loan.counterpart_account_id ? 'Conta vinculada' : 'Pessoa externa'}>
                            {loan.counterpart_account_id ? (
                              <Link2 size={14} className="text-color-primary" />
                            ) : (
                              <UserX size={14} className="text-gray-400" />
                            )}
                            {loan.counterpart?.name || loan.external_name || 'Externo'}
                          </span>
                          {loan.interest_enabled && (
                            <span className="flex items-center gap-1">
                              <Percent size={14} /> {Number(loan.interest_rate).toFixed(2)}% {loan.interest_period === 'daily' ? 'ao dia' : loan.interest_period === 'monthly' ? 'ao mês' : 'ao ano'} ({loan.interest_type === 'compound' ? 'composto' : 'simples'})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* Valores - Principal, Corrigido (se juros) e Saldo - SEMPRE POSITIVOS */}
                      {(() => {
                        // Todos os valores são sempre positivos - o badge indica a direção
                        const principalDisplay = Math.abs(loan.principal_amount)

                        // Calcular valor corrigido com juros (se habilitado)
                        let correctedDisplay = principalDisplay
                        let interestInfo: { correctedAmount: number; interestAmount: number; periods: number } | null = null
                        if (loan.interest_enabled && loan.interest_rate && loan.interest_type && loan.interest_period) {
                          interestInfo = calculateInterest(
                            loan.principal_amount,
                            loan.loan_date,
                            loan.interest_rate,
                            loan.interest_type,
                            loan.interest_period
                          )
                          correctedDisplay = Math.abs(interestInfo.correctedAmount)
                        }

                        // Saldo restante (sempre positivo)
                        const baseForBalance = interestInfo ? interestInfo.correctedAmount : loan.principal_amount
                        const remainingFromCorrected = baseForBalance - loan.total_paid
                        const isBalanceZero = remainingFromCorrected <= 0.01 || loan.status === 'settled'
                        const balanceDisplay = isBalanceZero ? 0 : Math.abs(remainingFromCorrected)

                        // Cores baseadas na direção (não no sinal)
                        const balanceColor = isBalanceZero
                          ? 'text-gray-900 dark:text-gray-100'
                          : isLent
                            ? 'text-green-600 dark:text-green-400'  // A receber = verde
                            : 'text-red-600 dark:text-red-400'       // A pagar = vermelho

                        return (
                          <>
                            <div className="text-right self-start w-[100px]">
                              <p className="text-sm text-gray-500 dark:text-gray-400">Principal</p>
                              <p className={`font-bold ${principalDisplay === 0 ? 'text-gray-900 dark:text-gray-100' : 'text-gray-900 dark:text-gray-100'}`}>
                                {formatCurrency(principalDisplay)}
                              </p>
                            </div>
                            {loan.interest_enabled && interestInfo && (
                              <>
                                <div className="w-px h-10 bg-gray-200 dark:bg-gray-600 self-center"></div>
                                <div className="text-right self-start w-[130px] -ml-2">
                                  <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center justify-end gap-1">
                                    Corrigido
                                    <span className="relative group cursor-help">
                                      <HelpCircle size={14} className="text-amber-500 dark:text-amber-400" />
                                      <span className="absolute bottom-full right-0 mb-1 w-48 p-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                                        <strong>{loan.interest_type === 'compound' ? 'Juros Compostos' : 'Juros Simples'}</strong><br />
                                        {loan.interest_rate}% {loan.interest_period === 'daily' ? 'ao dia' : loan.interest_period === 'monthly' ? 'ao mês' : 'ao ano'}<br />
                                        <span className="text-gray-300">{interestInfo.description}</span>
                                      </span>
                                    </span>
                                  </p>
                                  <p className={`font-bold ${correctedDisplay === 0 ? 'text-gray-900 dark:text-gray-100' : isLent ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {formatCurrency(correctedDisplay)}
                                  </p>
                                  <p className="text-xs text-gray-500 dark:text-gray-400">
                                    +{formatCurrency(Math.abs(interestInfo.interestAmount))}
                                  </p>
                                </div>
                              </>
                            )}
                            <div className="w-px h-10 bg-gray-200 dark:bg-gray-600 self-center mx-1"></div>
                            <div className="text-right self-start w-[110px]">
                              <p className="text-sm text-gray-500 dark:text-gray-400">{isLent ? 'Saldo a Receber' : 'Saldo a Pagar'}</p>
                              <p className={`font-bold ${balanceDisplay === 0 ? 'text-gray-900 dark:text-gray-100' : balanceColor}`}>
                                {formatCurrency(balanceDisplay)}
                              </p>
                            </div>
                            <div className="w-px h-10 bg-gray-200 dark:bg-gray-600 self-center mx-1"></div>
                            {/* Badge Status (Aberto) */}
                            <div className="flex items-center self-center">
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium w-[80px] justify-center bg-blue-600 text-white">
                                <span className="text-sm font-bold">○</span>
                                Aberto
                              </span>
                            </div>
                          </>
                        )
                      })()}

                      {/* Ações */}
                      {loan.is_owner && (
                        <div className="flex items-center gap-1 self-center">
                          {/* Ações apenas para empréstimos não quitados */}
                          {loan.status !== 'settled' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenPayment(loan)}
                                className={cadastroRowIconBtnCls}
                                title="Registrar pagamento ou quitar"
                              >
                                <Plus size={18} />
                              </button>
                              <button type="button" onClick={() => handleEdit(loan)} className={cadastroRowIconBtnCls} title="Editar">
                                <Edit2 size={18} />
                              </button>
                            </>
                          )}
                          {/* Excluir sempre disponível para o owner */}
                          <button type="button" onClick={() => handleDelete(loan)} className={cadastroRowIconDangerCls} title="Excluir">
                            <Trash2 size={18} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {expandedLoans.has(loan.id) && renderLoanPaymentHistory(loan)}
                </div>
              )})}
            </div>
          ) : (
            <div className="space-y-3">
              {settledLoans.map((loan) => {
                    // Determinar direção efetiva para os badges
                    const effectiveType = loan.is_owner ? loan.loan_type : (loan.loan_type === 'lent' ? 'borrowed' : 'lent')
                    const isLent = effectiveType === 'lent'

                    return (
                    <div key={loan.id} className={loanCardSettledCls}>
                      {/* Header do empréstimo */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 flex-1">
                          <button onClick={() => toggleLoan(loan.id)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                            {expandedLoans.has(loan.id) ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-gray-900 dark:text-white truncate">{loan.description}</span>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                              {/* Badge A Receber / A Pagar */}
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-white ${
                                  isLent ? 'bg-green-600' : 'bg-red-600'
                                }`}
                              >
                                {isLent ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                                {isLent ? 'A Receber' : 'A Pagar'}
                              </span>
                              <span className="flex items-center gap-1">
                                <Calendar size={14} /> {formatDate(loan.loan_date)}
                              </span>
                              {loan.settled_at && (
                                <span className="flex items-center gap-1" title="Data e hora da quitação">
                                  <CheckCircle size={14} className="text-green-600 dark:text-green-400" /> {formatDateTime(loan.settled_at)}
                                </span>
                              )}
                              <span className="flex items-center gap-1" title={loan.counterpart_account_id ? 'Conta vinculada' : 'Pessoa externa'}>
                                {loan.counterpart_account_id ? (
                                  <Link2 size={14} className="text-color-primary" />
                                ) : (
                                  <UserX size={14} className="text-gray-400" />
                                )}
                                {loan.counterpart?.name || loan.external_name || 'Externo'}
                              </span>
                              {loan.interest_enabled && (
                                <span className="flex items-center gap-1">
                                  <Percent size={14} /> {Number(loan.interest_rate).toFixed(2)}% {loan.interest_period === 'daily' ? 'ao dia' : loan.interest_period === 'monthly' ? 'ao mês' : 'ao ano'} ({loan.interest_type === 'compound' ? 'composto' : 'simples'})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {/* Valores - SEMPRE POSITIVOS (quitados) */}
                          {(() => {
                            // Todos os valores são sempre positivos
                            const principalDisplay = Math.abs(loan.principal_amount)

                            // Calcular valor corrigido para quitados (mostra quanto foi pago no total)
                            let correctedDisplay = principalDisplay
                            let interestInfo: { correctedAmount: number; interestAmount: number; periods: number; description: string } | null = null
                            if (loan.interest_enabled && loan.interest_rate && loan.interest_type && loan.interest_period) {
                              interestInfo = calculateInterest(
                                loan.principal_amount,
                                loan.loan_date,
                                loan.interest_rate,
                                loan.interest_type as 'simple' | 'compound',
                                loan.interest_period as 'daily' | 'monthly' | 'yearly'
                              )
                              correctedDisplay = Math.abs(interestInfo.correctedAmount)
                            }

                            return (
                              <>
                                <div className="text-right self-start w-[100px]">
                                  <p className="text-sm text-gray-500 dark:text-gray-400">Principal</p>
                                  <p className="font-bold text-gray-900 dark:text-gray-100">
                                    {formatCurrency(principalDisplay)}
                                  </p>
                                </div>
                                {loan.interest_enabled && interestInfo && (
                                  <>
                                    <div className="w-px h-10 bg-gray-200 dark:bg-gray-600 self-center"></div>
                                    <div className="text-right self-start w-[130px] -ml-2">
                                      <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center justify-end gap-1">
                                        Corrigido
                                        <span className="relative group cursor-help">
                                          <HelpCircle size={14} className="text-amber-500 dark:text-amber-400" />
                                          <span className="absolute bottom-full right-0 mb-1 w-48 p-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                                            <strong>{loan.interest_type === 'compound' ? 'Juros Compostos' : 'Juros Simples'}</strong><br />
                                            {loan.interest_rate}% {loan.interest_period === 'daily' ? 'ao dia' : loan.interest_period === 'monthly' ? 'ao mês' : 'ao ano'}<br />
                                            <span className="text-gray-300">{interestInfo.description}</span>
                                          </span>
                                        </span>
                                      </p>
                                      <p className={`font-bold ${correctedDisplay === 0 ? 'text-gray-900 dark:text-gray-100' : isLent ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                        {formatCurrency(correctedDisplay)}
                                      </p>
                                      <p className="text-xs text-gray-500 dark:text-gray-400">
                                        +{formatCurrency(Math.abs(interestInfo.interestAmount))}
                                      </p>
                                    </div>
                                  </>
                                )}
                                <div className="w-px h-10 bg-gray-200 dark:bg-gray-600 self-center mx-1"></div>
                                <div className="text-right self-start w-[110px]">
                                  <p className="text-sm text-gray-500 dark:text-gray-400">{isLent ? 'Saldo a Receber' : 'Saldo a Pagar'}</p>
                                  <p className="font-bold text-gray-900 dark:text-gray-100">R$ 0,00</p>
                                </div>
                                <div className="w-px h-10 bg-gray-200 dark:bg-gray-600 self-center mx-1"></div>
                                {/* Badge Status (Quitado) */}
                                <div className="flex items-center self-center">
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium w-[80px] justify-center bg-green-600 text-white">
                                    <span className="text-sm font-bold">✓</span>
                                    Quitado
                                  </span>
                                </div>
                              </>
                            )
                          })()}

                          {/* Ações para quitados - mantém espaço para alinhamento */}
                          {loan.is_owner && (
                            <div className="flex items-center gap-1 self-center">
                              {/* Espaço invisível para manter alinhamento com abertos (3 botões) */}
                              <div className="w-[34px]"></div>
                              <button type="button" onClick={() => handleReopen(loan)} className={cadastroRowIconBtnCls} title="Reabrir empréstimo">
                                <Lock size={18} />
                              </button>
                              <button type="button" onClick={() => handleEdit(loan, true)} className={cadastroRowIconBtnCls} title="Editar (descrição/contraparte)">
                                <Edit2 size={18} />
                              </button>
                              <button type="button" onClick={() => handleDelete(loan)} className={cadastroRowIconDangerCls} title="Excluir">
                                <Trash2 size={18} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {expandedLoans.has(loan.id) && renderLoanPaymentHistory(loan)}
                    </div>
              )})}
            </div>
          )}
              </div>
            </div>
          )}
        </div>

        </CadastroListPageBody>
      </CadastroListPageShell>

        {/* Modal de Criar/Editar Empréstimo */}
        {showCreateModal && (
          <CadastroModalShell
            maxWidth="max-w-lg"
            zClass="z-50"
          >
            <CadastroModalHeader
              isEdit={!!editingLoan}
              title={editingLoan ? (editingSettled ? 'Editar Empréstimo (Quitado)' : 'Editar Empréstimo') : 'Novo Empréstimo'}
              subtitle={editingSettled ? 'Empréstimo quitado: apenas descrição e contraparte podem ser alterados' : 'Entre contas do sistema ou contraparte externa'}
              onClose={() => { setShowCreateModal(false); resetForm() }}
              icon={<Wallet size={18} />}
            />
            <form onSubmit={handleCreate} className="flex min-h-0 flex-1 flex-col" id="emprestimo-form">
              <CadastroModalBody>
                {editingSettled && (
                  <CadastroFormSection title="Aviso" icon={<AlertTriangle size={14} />}>
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                      Empréstimo quitado: apenas descrição e contraparte podem ser alterados
                    </p>
                  </CadastroFormSection>
                )}
                <CadastroFormSection title="Identificação" icon={<Wallet size={14} />}>
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow cols={2}>
                      <label className={`block min-w-0 ${editingSettled ? 'pointer-events-none opacity-50' : ''}`}>
                        <CadastroFieldLabel required>
                          Valor {formAmountCents && formAmountCents !== '0' ? (
                            <span className={`font-semibold ${formLoanType === 'lent' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                              ({formLoanType === 'lent' ? 'A receber' : 'A pagar'})
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
                            value={formAmount}
                            onChange={(e) => {
                              const value = e.target.value
                              if (value !== '' && !/^-?\d*\.?\d*$/.test(value)) return
                              const n = parseFloat(value)
                              if (!isNaN(n) && Math.abs(n) > 99999999.99) return
                              setFormAmount(value)
                              setFormAmountCents(isNaN(n) ? '' : String(Math.round(Math.abs(n) * 100)))
                              if (!isNaN(n) && n !== 0) setFormLoanType(n > 0 ? 'lent' : 'borrowed')
                            }}
                            onBlur={() => {
                              const n = parseFloat(formAmount)
                              if (!isNaN(n)) setFormAmount(n.toFixed(2))
                            }}
                            placeholder="0.00"
                            required
                            disabled={editingSettled}
                            className={`${cadastroFieldCls} pl-10 font-semibold ${
                              !formAmountCents || formAmountCents === '0'
                                ? 'text-gray-600 dark:text-gray-400'
                                : formLoanType === 'lent'
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-600 dark:text-red-400'
                            } ${editingSettled ? 'cursor-not-allowed' : ''}`}
                          />
                        </div>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Use valores positivos para a receber e negativos para a pagar
                        </p>
                      </label>
                      <label className={`block min-w-0 ${editingSettled ? 'pointer-events-none opacity-50' : ''}`}>
                        <CadastroFieldLabel required>Data</CadastroFieldLabel>
                        <DateField
                          value={formLoanDate}
                          onChange={setFormLoanDate}
                          disabled={editingSettled}
                          className={`${cadastroFieldCls} mt-0.5 ${editingSettled ? 'cursor-not-allowed opacity-50' : ''}`}
                        />
                      </label>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow>
                      <label className="block min-w-0">
                        <CadastroFieldLabel required>Descrição</CadastroFieldLabel>
                        <input
                          type="text"
                          value={formDescription}
                          onChange={(e) => setFormDescription(e.target.value)}
                          required
                          className={`${cadastroFieldCls} mt-0.5`}
                        />
                      </label>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow>
                      <div className="min-w-0">
                        <CadastroFieldLabel>Contraparte</CadastroFieldLabel>
                        <select
                          value={formPartnerId || ''}
                          onChange={(e) => setFormPartnerId(e.target.value ? parseInt(e.target.value) : null)}
                          disabled={formUseExternal}
                          className={`${cadastroFieldCls} mt-0.5 disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <option value="">Selecione uma conta parceira</option>
                          {[...partners]
                            .sort((a, b) => {
                              const nameA = getAccountDisplayName(a.shared_account).toLowerCase()
                              const nameB = getAccountDisplayName(b.shared_account).toLowerCase()
                              return nameA.localeCompare(nameB, 'pt-BR')
                            })
                            .map(p => {
                              const acc = p.shared_account
                              const bankName = acc?.bank?.name || 'Sem banco'
                              const agencyInfo = acc?.agency ? `Ag: ${acc.agency}` : ''
                              const accountInfo = acc?.account_number ? `Conta: ${acc.account_number}` : ''
                              const details = [bankName, agencyInfo, accountInfo].filter(Boolean).join(' • ')
                              return (
                                <option key={p.shared_account_id} value={p.shared_account_id}>
                                  {getAccountDisplayName(acc)} • {details}
                                </option>
                              )
                            })}
                        </select>
                        <label className={`${cadastroOptionLabelCls} mt-2.5`}>
                          <input
                            type="checkbox"
                            checked={formUseExternal}
                            onChange={(e) => {
                              setFormUseExternal(e.target.checked)
                              if (e.target.checked) {
                                setFormPartnerId(null)
                              } else {
                                setFormExternalName('')
                              }
                            }}
                            className={`${cadastroAccentControlCls} h-4 w-4 rounded border-gray-300`}
                          />
                          Externo
                        </label>
                        {formUseExternal ? (
                          <input
                            type="text"
                            value={formExternalName}
                            onChange={(e) => setFormExternalName(e.target.value)}
                            placeholder="Nome da pessoa ou empresa"
                            className={`${cadastroFieldCls} mt-2`}
                          />
                        ) : null}
                      </div>
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
                <CadastroFormSection title="Condições" icon={<Percent size={14} />}>
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow>
                      <label className={`block min-w-0 ${editingSettled ? 'pointer-events-none opacity-50' : ''}`}>
                        <CadastroFieldLabel>Vencimento</CadastroFieldLabel>
                        <DateField
                          value={formDueDate}
                          onChange={setFormDueDate}
                          minDate={formLoanDate ? parseLocalDate(formLoanDate) ?? undefined : undefined}
                          disabled={editingSettled}
                          className={`${cadastroFieldCls} mt-0.5 ${editingSettled ? 'cursor-not-allowed opacity-50' : ''}`}
                        />
                      </label>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow>
                      <div className={editingSettled ? 'pointer-events-none opacity-50' : ''}>
                        <label className={cadastroOptionLabelCls}>
                          <input
                            type="checkbox"
                            checked={formInterestEnabled}
                            onChange={(e) => setFormInterestEnabled(e.target.checked)}
                            className={`${cadastroAccentControlCls} h-4 w-4 rounded border-gray-300`}
                            disabled={editingSettled}
                          />
                          Aplicar juros
                        </label>
                        {formInterestEnabled && (
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            <select
                              value={formInterestType}
                              onChange={(e) => setFormInterestType(e.target.value as any)}
                              disabled={editingSettled}
                              className={cadastroFieldCls}
                            >
                              <option value="simple">Simples</option>
                              <option value="compound">Composto</option>
                            </select>
                            <input
                              type="number"
                              step="0.01"
                              value={formInterestRate}
                              onChange={(e) => setFormInterestRate(e.target.value)}
                              disabled={editingSettled}
                              placeholder="Taxa %"
                              className={cadastroFieldCls}
                            />
                            <select
                              value={formInterestPeriod}
                              onChange={(e) => setFormInterestPeriod(e.target.value as any)}
                              disabled={editingSettled}
                              className={cadastroFieldCls}
                            >
                              <option value="daily">ao dia</option>
                              <option value="monthly">ao mês</option>
                              <option value="yearly">ao ano</option>
                            </select>
                          </div>
                        )}
                      </div>
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
              </CadastroModalBody>
              <CadastroModalFooter
                onClose={() => { setShowCreateModal(false); resetForm() }}
                onSave={() => {
                  const form = document.getElementById('emprestimo-form') as HTMLFormElement | null
                  form?.requestSubmit()
                }}
                saving={isSubmitting}
                saveLabel={editingLoan ? 'Salvar' : 'Criar'}
              />
            </form>
          </CadastroModalShell>
        )}

        {/* Modal: pagamento parcial / quitação (novo) ou edição de pagamento */}
        {showPaymentModal && payingLoan && editingPayment && (
          <CadastroModalShell maxWidth="max-w-2xl" onBackdropClick={closePaymentModal} zClass="z-50">
            <CadastroModalHeader
              isEdit
              title="Editar pagamento"
              subtitle={payingLoan.description}
              onClose={closePaymentModal}
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
                          value={paymentDate}
                          onChange={setPaymentDate}
                          maxDate={new Date()}
                          className="min-h-0 w-full border-0 bg-transparent p-0 shadow-none"
                        />
                      </div>
                    </label>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Valor</CadastroFieldLabel>
                      <div className="relative mt-0.5">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-green-600 dark:text-green-400">
                          R$
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatAmountMask(paymentAmountCents)}
                          onChange={(e) => setPaymentAmountCents(e.target.value.replace(/\D/g, ''))}
                          className={`${cadastroFieldCls} h-9 w-full py-0 pl-9 font-semibold text-green-700 dark:text-green-300`}
                          placeholder="0,00"
                        />
                      </div>
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
                        value={paymentNotes}
                        onChange={(e) => setPaymentNotes(e.target.value)}
                        className={`${cadastroFieldCls} min-h-[2.75rem] resize-y`}
                        placeholder="Ex: PIX, transferência…"
                        rows={2}
                      />
                    </label>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={closePaymentModal}
              onSave={() => void handleSaveEditPayment()}
              saving={isSubmitting}
              disabled={!paymentAmountCents || parseInt(paymentAmountCents, 10) <= 0 || !paymentDate}
              saveLabel="Salvar"
              saveIcon={<Check size={15} />}
            />
          </CadastroModalShell>
        )}
        {showPaymentModal && payingLoan && !editingPayment && (() => {
          const { remaining } = getLoanSettleContext(payingLoan)
          const canRegisterPayment = remaining > 0.01
          const mode = canRegisterPayment ? paymentModalMode : 'settle'
          const partialValid =
            Boolean(paymentAmountCents) &&
            parseInt(paymentAmountCents, 10) > 0 &&
            Boolean(paymentDate)
          const settleValid = Boolean(settlementDate)
          const saving = mode === 'partial' ? isSubmitting : isSettlingLoan
          const saveDisabled = mode === 'partial' ? !partialValid : !settleValid

          return (
            <CadastroModalShell maxWidth="max-w-2xl" onBackdropClick={closePaymentModal} zClass="z-50">
              <CadastroModalHeader
                isEdit={false}
                title="Pagamento do empréstimo"
                subtitle={payingLoan.description}
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
                              name="loan-payment-mode"
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
                              name="loan-payment-mode"
                              checked={mode === 'settle'}
                              onChange={() => setPaymentModalMode('settle')}
                              className={cadastroAccentControlCls}
                            />
                            Quitar empréstimo
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
                                  parseInt(paymentAmountCents || '0', 10) > 0
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
                                  parseInt(paymentAmountCents || '0', 10) > 0
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
                  if (mode === 'partial') void handleAddPartialPayment()
                  else void handleSettleLoanFromModal()
                }}
                saving={saving}
                disabled={saveDisabled || saving}
                saveLabel={mode === 'partial' ? 'Registrar pagamento' : 'Quitar empréstimo'}
                saveIcon={mode === 'partial' ? <Check size={15} /> : <CheckCircle size={15} />}
                saveTone={mode === 'settle' ? 'success' : 'default'}
              />
            </CadastroModalShell>
          )
        })()}

        {/* Modal de Reabrir Empréstimo */}
        {showReopenModal && reopeningLoan && (
          <CadastroModalShell
            maxWidth="max-w-md"
            onBackdropClick={() => { setShowReopenModal(false); setReopeningLoan(null) }}
            zClass="z-50"
          >
            <CadastroModalHeader
              isEdit={true}
              title="Reabrir Empréstimo"
              subtitle={reopeningLoan.description}
              onClose={() => { setShowReopenModal(false); setReopeningLoan(null) }}
              icon={<Lock size={18} />}
            />
            <form onSubmit={handleReopenSubmit} className="flex min-h-0 flex-1 flex-col" id="emprestimo-reabrir-form">
              <CadastroModalBody>
                <CadastroFormSection title="Valor" icon={<DollarSign size={14} />}>
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow>
                      <p className="text-sm text-gray-700 dark:text-gray-300">
                        Principal atual:{' '}
                        <span className={reopeningLoan.loan_type === 'lent' ? 'font-semibold text-red-600 dark:text-red-400' : 'font-semibold text-green-600 dark:text-green-400'}>
                          {formatCurrency(reopeningLoan.loan_type === 'lent' ? -reopeningLoan.principal_amount : reopeningLoan.principal_amount)}
                        </span>
                      </p>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow>
                      <label className="block min-w-0">
                        <CadastroFieldLabel required>Valor Adicional</CadastroFieldLabel>
                        <input
                          type="text"
                          value={reopenAmount}
                          onChange={(e) => handleAmountChange(e.target.value, setReopenAmount, 'positive')}
                          className={`${cadastroFieldCls} mt-0.5`}
                          placeholder="0.00"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          O valor será adicionado ao principal existente
                        </p>
                      </label>
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
                <CadastroFormSection title="Juros" icon={<Percent size={14} />}>
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow>
                      <label className={cadastroOptionLabelCls}>
                        <input
                          type="checkbox"
                          checked={reopenInterestEnabled}
                          onChange={(e) => setReopenInterestEnabled(e.target.checked)}
                          className={`${cadastroAccentControlCls} h-4 w-4 rounded border-gray-300`}
                        />
                        Aplicar juros
                      </label>
                    </CadastroModalFieldsRow>
                    {reopenInterestEnabled && (
                      <CadastroModalFieldsRow cols={3}>
                        <label className="block min-w-0">
                          <CadastroFieldLabel>Tipo</CadastroFieldLabel>
                          <select
                            value={reopenInterestType}
                            onChange={(e) => setReopenInterestType(e.target.value as 'simple' | 'compound')}
                            className={`${cadastroFieldCls} mt-0.5`}
                          >
                            <option value="simple">Simples</option>
                            <option value="compound">Composto</option>
                          </select>
                        </label>
                        <label className="block min-w-0">
                          <CadastroFieldLabel>Taxa (%)</CadastroFieldLabel>
                          <input
                            type="text"
                            value={reopenInterestRate}
                            onChange={(e) => setReopenInterestRate(e.target.value.replace(/[^0-9.,]/g, ''))}
                            className={`${cadastroFieldCls} mt-0.5`}
                            placeholder="0.00"
                          />
                        </label>
                        <label className="block min-w-0">
                          <CadastroFieldLabel>Período</CadastroFieldLabel>
                          <select
                            value={reopenInterestPeriod}
                            onChange={(e) => setReopenInterestPeriod(e.target.value as 'daily' | 'monthly' | 'yearly')}
                            className={`${cadastroFieldCls} mt-0.5`}
                          >
                            <option value="daily">Diário</option>
                            <option value="monthly">Mensal</option>
                            <option value="yearly">Anual</option>
                          </select>
                        </label>
                      </CadastroModalFieldsRow>
                    )}
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
              </CadastroModalBody>
              <CadastroModalFooter
                onClose={() => { setShowReopenModal(false); setReopeningLoan(null) }}
                onSave={() => {
                  const form = document.getElementById('emprestimo-reabrir-form') as HTMLFormElement | null
                  form?.requestSubmit()
                }}
                saving={isSubmitting}
                disabled={!reopenAmount}
                saveLabel="Reabrir"
              />
            </form>
          </CadastroModalShell>
        )}

        {/* Toast */}
        {toast.show && <Toast message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, show: false })} />}

        {/* Confirm Dialog */}
        <ConfirmComponent />
    </div>
  )
}

