import { useState, useEffect } from 'react'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import LoadingSpinner from '../components/LoadingSpinner'
import Toast from '../components/Toast'
import { Wallet, Plus, Edit2, Trash2, ChevronDown, ChevronRight, Search, X, Filter, Calendar, Users, TrendingUp, TrendingDown, CheckCircle, Check, Clock, AlertTriangle, Percent, DollarSign, ArrowUp, ArrowDown, Building2, UserX, Link2, Lock, HelpCircle } from 'lucide-react'
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

export default function EmprestimosPage() {
  const { showConfirm, ConfirmComponent } = useConfirm()

  // Estados principais
  const [loans, setLoans] = useState<Loan[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })

  // Filtros
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'lent' | 'borrowed'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'settled'>('all')
  const [filterPartner, setFilterPartner] = useState<number | null>(null)
  const [showInactive, setShowInactive] = useState(false)

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
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(dateToInputString(new Date()))
  const [paymentNotes, setPaymentNotes] = useState('')
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
    loadLoans()
    loadPartners()
  }, [])

  // Ajusta o sinal do valor quando o tipo de empréstimo muda
  useEffect(() => {
    if (formAmount && formAmount !== '-') {
      const numValue = parseFloat(formAmount)
      if (!isNaN(numValue)) {
        if (formLoanType === 'lent' && numValue > 0) {
          // Emprestei precisa ser negativo
          setFormAmount((-Math.abs(numValue)).toFixed(2))
        } else if (formLoanType === 'borrowed' && numValue < 0) {
          // Peguei emprestado precisa ser positivo
          setFormAmount(Math.abs(numValue).toFixed(2))
        }
      }
    }
  }, [formLoanType])

  // Atalhos de teclado para modais
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showReopenModal) {
          setShowReopenModal(false)
          setReopeningLoan(null)
        } else if (showPaymentModal) {
          setShowPaymentModal(false)
          setPayingLoan(null)
          setEditingPayment(null)
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
    if (!formAmount || !formDescription) {
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
      // Backend espera sempre valor positivo - o loan_type indica a direção
      const principalAmount = Math.abs(parseFloat(formAmount))

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
      loadLoans()
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
    // Aplicar sinal negativo para "lent" (emprestei = saída de dinheiro)
    const amount = loan.loan_type === 'lent' ? -Math.abs(loan.principal_amount) : Math.abs(loan.principal_amount)
    setFormAmount(amount.toFixed(2))
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
      loadLoans()
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
          loadLoans()
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
    setEditingPayment(payment || null)
    setPaymentAmount(payment ? payment.amount.toString() : '')
    setPaymentDate(payment ? payment.payment_date.split('T')[0] : dateToInputString(new Date()))
    setPaymentNotes(payment?.notes || '')
    setShowPaymentModal(true)
  }

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!payingLoan || !paymentAmount) {
      showToast('Informe o valor do pagamento', 'warning')
      return
    }

    const amount = parseFloat(paymentAmount)

    // Validação: valor deve ser positivo
    if (amount <= 0) {
      showToast('O valor deve ser maior que zero', 'warning')
      return
    }

    // Validação: para novo pagamento, não pode exceder o saldo restante
    if (!editingPayment && amount > payingLoan.remaining_balance) {
      showToast(`O valor não pode ser maior que o saldo restante (${formatCurrency(payingLoan.remaining_balance)})`, 'warning')
      return
    }

    setIsSubmitting(true)
    try {
      if (editingPayment) {
        // Atualizar pagamento existente
        await axios.patch(`/api/loans/${payingLoan.id}/payments/${editingPayment.id}`, {
          amount: amount,
          payment_date: paymentDate || null,  // Enviar como string YYYY-MM-DD
          notes: paymentNotes || null
        })
        showToast('Pagamento atualizado com sucesso!', 'success')
      } else {
        // Criar novo pagamento
        await axios.post(`/api/loans/${payingLoan.id}/pay`, {
          amount: amount,
          payment_date: paymentDate || null,  // Enviar como string YYYY-MM-DD
          notes: paymentNotes || null
        })
        showToast('Pagamento registrado com sucesso!', 'success')
      }
      setShowPaymentModal(false)
      setPayingLoan(null)
      setEditingPayment(null)
      loadLoans()
    } catch (error: any) {
      showToast(error.response?.data?.detail || 'Erro ao salvar pagamento', 'error')
    } finally {
      setIsSubmitting(false)
    }
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
          loadLoans()
        } catch (error: any) {
          showToast(error.response?.data?.detail || 'Erro ao excluir pagamento', 'error')
        }
      },
      'Excluir',
      'Cancelar'
    )
  }

  const handleSettle = (loan: Loan) => {
    // Calcular valor corrigido com juros se habilitado
    const principal = Math.abs(Number(loan.principal_amount))
    let correctedAmount = principal
    let balanceToSettle = Math.abs(Number(loan.remaining_balance))
    let interestDetails: { interestAmount: number; description: string; rate: number; period: string; type: string } | null = null

    if (loan.interest_enabled && loan.interest_rate && loan.interest_period) {
      const interest = calculateInterest(
        principal,
        loan.loan_date,
        Number(loan.interest_rate),
        loan.interest_type as 'simple' | 'compound',
        loan.interest_period as 'daily' | 'monthly' | 'yearly'
      )
      correctedAmount = interest.correctedAmount
      // Saldo corrigido = valor corrigido - total já pago
      const totalPaid = principal - Math.abs(Number(loan.remaining_balance))
      balanceToSettle = interest.correctedAmount - totalPaid

      const periodLabel = loan.interest_period === 'daily' ? 'ao dia' : loan.interest_period === 'monthly' ? 'ao mês' : 'ao ano'
      const typeLabel = loan.interest_type === 'compound' ? 'composto' : 'simples'

      interestDetails = {
        interestAmount: interest.interestAmount,
        description: interest.description,
        rate: Number(loan.interest_rate),
        period: periodLabel,
        type: typeLabel
      }
    }

    // Montar mensagem com detalhes
    let message = `Deseja quitar completamente o empréstimo "${loan.description}"?\n\n`
    message += `📌 Principal: ${formatCurrency(principal)}\n`

    if (interestDetails) {
      message += `📈 Juros (${interestDetails.rate.toFixed(2)}% ${interestDetails.period}, ${interestDetails.type}):\n`
      message += `     ${interestDetails.description}\n`
      message += `     +${formatCurrency(interestDetails.interestAmount)}\n`
      message += `💰 Valor Corrigido: ${formatCurrency(correctedAmount)}\n`
    }

    message += `\n✅ Saldo a quitar: ${formatCurrency(balanceToSettle)}`

    showConfirm(
      'Quitar Empréstimo',
      message,
      async () => {
        try {
          await axios.post(`/api/loans/${loan.id}/settle`, {
            notes: 'Quitação manual',
            corrected_amount: correctedAmount
          })
          showToast('Empréstimo quitado com sucesso!', 'success')
          loadLoans()
        } catch (error: any) {
          showToast(error.response?.data?.detail || 'Erro ao quitar empréstimo', 'error')
        }
      },
      'Quitar',
      'Cancelar'
    )
  }

  // Filtrar empréstimos
  const filteredLoans = loans.filter(loan => {
    if (searchTerm && !loan.description.toLowerCase().includes(searchTerm.toLowerCase())) return false
    if (filterType !== 'all' && loan.loan_type !== filterType) return false
    if (filterStatus !== 'all' && loan.status !== filterStatus) return false
    if (filterPartner && loan.counterpart_account_id !== filterPartner) return false
    return true
  })

  // Separar empréstimos ativos e inativos (quitados)
  const activeLoans = filteredLoans.filter(loan => loan.status !== 'settled')
  const inactiveLoans = filteredLoans.filter(loan => loan.status === 'settled')

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

  // Labels dinâmicos baseados na direção do empréstimo
  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-color-primary-light rounded-lg">
              <Wallet className="h-6 w-6 text-color-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Empréstimos</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Gerencie empréstimos feitos e recebidos</p>
            </div>
          </div>
          <button
            onClick={() => { resetForm(); setShowCreateModal(true) }}
            className="flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors"
            style={{ backgroundColor: 'var(--crud-create)' }}
          >
            <Plus size={18} /> Novo Empréstimo
          </button>
        </div>

        {/* Filtros */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Busca */}
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por descrição..."
                className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <X size={16} className="text-gray-400 hover:text-gray-600" />
                </button>
              )}
            </div>

            {/* Tipo */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">Todos os tipos</option>
              <option value="lent">A Receber (emprestei)</option>
              <option value="borrowed">A Pagar (peguei emprestado)</option>
            </select>

            {/* Status */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">Todos os status</option>
              <option value="open">Aberto</option>
              <option value="settled">Quitado</option>
            </select>

            {/* Parceiro */}
            <select
              value={filterPartner || ''}
              onChange={(e) => setFilterPartner(e.target.value ? parseInt(e.target.value) : null)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">Todos os parceiros</option>
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
          </div>
        </div>

        {/* Lista de Empréstimos Ativos */}
        <div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
              <LoadingSpinner />
            </div>
          ) : activeLoans.length === 0 && inactiveLoans.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
              <Wallet className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400">Nenhum empréstimo encontrado</p>
            </div>
          ) : activeLoans.length === 0 ? (
            <div className="text-center py-8 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
              <CheckCircle className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-400 dark:text-gray-500 text-sm">Nenhum empréstimo ativo</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeLoans.map(loan => {
                // Determinar direção efetiva para os badges
                const effectiveType = loan.is_owner ? loan.loan_type : (loan.loan_type === 'lent' ? 'borrowed' : 'lent')
                const isLent = effectiveType === 'lent'

                return (
                <div
                  key={loan.id}
                  className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 border-l-4 border-l-blue-500"
                >
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
                              <button onClick={() => handleOpenPayment(loan)} className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg" title="Registrar Pagamento">
                                <Plus size={18} />
                              </button>
                              <button onClick={() => handleSettle(loan)} className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg" title="Quitar">
                                <CheckCircle size={18} />
                              </button>
                              <button onClick={() => handleEdit(loan)} className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg" title="Editar">
                                <Edit2 size={18} />
                              </button>
                            </>
                          )}
                          {/* Excluir sempre disponível para o owner */}
                          <button onClick={() => handleDelete(loan)} className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg" title="Excluir">
                            <Trash2 size={18} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Detalhes expandidos */}
                  {expandedLoans.has(loan.id) && (
                    <div className="mt-4 ml-10 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                        <h4 className="font-medium text-gray-900 dark:text-white">Histórico de Pagamentos</h4>
                      </div>
                      {loan.payments.length === 0 ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400 italic p-4">Nenhum pagamento registrado</p>
                      ) : (
                        <table className="w-full">
                          <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Data</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Observações</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Valor</th>
                              {loan.is_owner && <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-20">Ações</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {loan.payments.map(payment => (
                              <tr
                                key={payment.id}
                                className="border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                                onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = 'var(--color-1)' }}
                                onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = '' }}
                              >
                                <td className="px-4 py-3 text-sm text-gray-900 dark:text-white whitespace-nowrap">
                                  {formatDateTime(payment.payment_date)}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                                  {payment.notes || '-'}
                                </td>
                                <td className="px-4 py-3 text-sm font-medium text-green-600 dark:text-green-400 text-right whitespace-nowrap">
                                  {formatCurrency(payment.amount)}
                                </td>
                                {loan.is_owner && (
                                  <td className="px-4 py-3 text-right">
                                    {payment.balance_closure_id ? (
                                      <div
                                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 cursor-help"
                                        title="Este pagamento está vinculado a um fechamento de balanço. Para editar ou excluir, vá até a página de Balanço > aba Fechamentos e exclua o fechamento ou remova as liquidações de empréstimos."
                                      >
                                        <Lock size={12} className="text-gray-500 dark:text-gray-400" />
                                        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Fechamento</span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-end gap-1">
                                        <button
                                          onClick={() => handleOpenPayment(loan, payment)}
                                          className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg"
                                          title="Editar Pagamento"
                                        >
                                          <Edit2 size={14} />
                                        </button>
                                        <button
                                          onClick={() => handleDeletePayment(loan, payment)}
                                          className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                                          title="Excluir Pagamento"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              )})}
            </div>
          )}
        </div>

        {/* Seção de Inativos (Quitados) */}
        {inactiveLoans.length > 0 && (
          <div className="mt-6">
            {/* Divisor com botão para exibir/esconder */}
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
              <button
                onClick={() => setShowInactive(!showInactive)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                {showInactive ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span>Quitados ({inactiveLoans.length})</span>
              </button>
              <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
            </div>

            {/* Lista de Inativos */}
            {showInactive && (
              <div className="space-y-3">
                  {inactiveLoans.map(loan => {
                    // Determinar direção efetiva para os badges
                    const effectiveType = loan.is_owner ? loan.loan_type : (loan.loan_type === 'lent' ? 'borrowed' : 'lent')
                    const isLent = effectiveType === 'lent'

                    return (
                    <div
                      key={loan.id}
                      className="p-4 bg-green-50/50 dark:bg-green-900/10 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 border-l-4 border-l-green-500"
                    >
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
                              <button onClick={() => handleReopen(loan)} className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg" title="Reabrir empréstimo">
                                <Lock size={18} />
                              </button>
                              <button onClick={() => handleEdit(loan, true)} className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg" title="Editar (descrição/contraparte)">
                                <Edit2 size={18} />
                              </button>
                              <button onClick={() => handleDelete(loan)} className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg" title="Excluir">
                                <Trash2 size={18} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Detalhes expandidos */}
                      {expandedLoans.has(loan.id) && (
                        <div className="mt-4 ml-10 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                            <h4 className="font-medium text-gray-900 dark:text-white">Histórico de Pagamentos</h4>
                          </div>
                          {loan.payments.length === 0 ? (
                            <p className="text-sm text-gray-500 dark:text-gray-400 italic p-4">Nenhum pagamento registrado</p>
                          ) : (
                            <table className="w-full">
                              <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                                <tr>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Data</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Observações</th>
                                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Valor</th>
                                  {loan.is_owner && <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-20">Ações</th>}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {loan.payments.map(payment => (
                                  <tr
                                    key={payment.id}
                                    className="border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                                    onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = 'var(--color-1)' }}
                                    onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = '' }}
                                  >
                                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white whitespace-nowrap">
                                      {formatDateTime(payment.payment_date)}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                                      {payment.notes || '-'}
                                    </td>
                                    <td className="px-4 py-3 text-sm font-medium text-green-600 dark:text-green-400 text-right whitespace-nowrap">
                                      {formatCurrency(payment.amount)}
                                    </td>
                                    {loan.is_owner && (
                                      <td className="px-4 py-3 text-right">
                                        {payment.balance_closure_id ? (
                                          <div
                                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 cursor-help"
                                            title="Este pagamento está vinculado a um fechamento de balanço. Para editar ou excluir, vá até a página de Balanço > aba Fechamentos e exclua o fechamento ou remova as liquidações de empréstimos."
                                          >
                                            <Lock size={12} className="text-gray-500 dark:text-gray-400" />
                                            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Fechamento</span>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() => handleDeletePayment(loan, payment)}
                                            className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                                            title="Excluir pagamento (reabre o empréstimo)"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        )}
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  )})}
              </div>
            )}
          </div>
        )}

        {/* Modal de Criar/Editar Empréstimo */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Wallet size={20} className="text-color-primary" />
                  {editingLoan ? (editingSettled ? 'Editar Empréstimo (Quitado)' : 'Editar Empréstimo') : 'Novo Empréstimo'}
                </h2>
                <button onClick={() => { setShowCreateModal(false); resetForm() }} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                  <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </button>
              </div>
              <form onSubmit={handleCreate} className="p-4 space-y-4">
                {/* Aviso para edição de quitado */}
                {editingSettled && (
                  <div className="bg-yellow-50 dark:bg-yellow-900/30 rounded-lg p-3 text-sm text-yellow-700 dark:text-yellow-300 flex items-center gap-2">
                    <AlertTriangle size={16} />
                    <span>Empréstimo quitado: apenas descrição e contraparte podem ser alterados</span>
                  </div>
                )}
                {/* Tipo - Switch estilo ConflictReviewModal */}
                <div className={editingSettled ? 'opacity-50 pointer-events-none' : ''}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Tipo de Empréstimo</label>
                  <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600 w-fit">
                    <button
                      type="button"
                      onClick={() => setFormLoanType('lent')}
                      className={`px-4 py-2 text-sm font-medium transition-all ${
                        formLoanType === 'lent'
                          ? 'text-white bg-green-600'
                          : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      Emprestei (a receber)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormLoanType('borrowed')}
                      className={`px-4 py-2 text-sm font-medium transition-all border-l border-gray-300 dark:border-gray-600 ${
                        formLoanType === 'borrowed'
                          ? 'text-white bg-red-600'
                          : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      Peguei emprestado (a pagar)
                    </button>
                  </div>
                </div>
                {/* Valor e Data - Layout igual ManualTransactionModal */}
                <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${editingSettled ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      <DollarSign size={16} />
                      Valor *
                    </label>
                    <div className="relative">
                      <span className={`absolute left-3 top-1/2 -translate-y-1/2 font-semibold ${
                        formLoanType === 'lent' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                      }`}>
                        R$
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={formAmount}
                        onChange={(e) => handleAmountChange(e.target.value, setFormAmount, formLoanType === 'lent' ? 'negative' : 'positive')}
                        onBlur={() => handleAmountBlur(formAmount, setFormAmount, formLoanType === 'lent' ? 'negative' : 'positive')}
                        placeholder={formLoanType === 'lent' ? '-0.00' : '0.00'}
                        required
                        disabled={editingSettled}
                        className={`w-full pl-12 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 font-semibold focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                          formLoanType === 'lent' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                        } ${editingSettled ? 'cursor-not-allowed' : ''}`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      <Calendar size={16} />
                      Data *
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
                        value={formLoanDate}
                        onChange={(e) => setFormLoanDate(e.target.value)}
                        disabled={editingSettled}
                        required
                        style={{ colorScheme: 'light dark' }}
                        className={`w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${editingSettled ? 'cursor-not-allowed' : ''}`}
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          const input = e.currentTarget.previousElementSibling as any
                          if (input && input._openPicker) {
                            input._openPicker()
                          }
                        }}
                        disabled={editingSettled}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-color-primary transition-colors disabled:opacity-50"
                        title="Abrir calendário"
                      >
                        <Calendar size={16} />
                      </button>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição</label>
                  <input type="text" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} required
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
                {/* Contraparte */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <Users size={14} className="inline mr-1" /> Contraparte
                  </label>
                  <div className="flex items-center gap-2 mb-2">
                    <input type="checkbox" checked={formUseExternal} onChange={(e) => setFormUseExternal(e.target.checked)} className="w-4 h-4" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Entidade externa</span>
                  </div>
                  {formUseExternal ? (
                    <input type="text" value={formExternalName} onChange={(e) => setFormExternalName(e.target.value)}
                      placeholder="Nome da pessoa/empresa" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" />
                  ) : (
                    <select value={formPartnerId || ''} onChange={(e) => setFormPartnerId(e.target.value ? parseInt(e.target.value) : null)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
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
                  )}
                </div>
                {/* Vencimento */}
                <div className={editingSettled ? 'opacity-50 pointer-events-none' : ''}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <Calendar size={14} className="inline mr-1" /> Vencimento (opcional)
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
                      value={formDueDate}
                      onChange={(e) => setFormDueDate(e.target.value)}
                      disabled={editingSettled}
                      style={{ colorScheme: 'light dark' }}
                      className={`w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent ${editingSettled ? 'cursor-not-allowed' : ''}`}
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        const input = e.currentTarget.previousElementSibling as any
                        if (input && input._openPicker) {
                          input._openPicker()
                        }
                      }}
                      disabled={editingSettled}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-color-primary transition-colors disabled:opacity-50"
                      title="Abrir calendário"
                    >
                      <Calendar size={16} />
                    </button>
                  </div>
                </div>
                {/* Juros */}
                <div className={`border-t border-gray-200 dark:border-gray-700 pt-4 ${editingSettled ? 'opacity-50 pointer-events-none' : ''}`}>
                  <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input type="checkbox" checked={formInterestEnabled} onChange={(e) => setFormInterestEnabled(e.target.checked)} className="w-4 h-4" disabled={editingSettled} />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      <Percent size={14} className="inline mr-1" /> Aplicar juros
                    </span>
                  </label>
                  {formInterestEnabled && (
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <select value={formInterestType} onChange={(e) => setFormInterestType(e.target.value as any)} disabled={editingSettled}
                        className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700">
                        <option value="simple">Simples</option>
                        <option value="compound">Composto</option>
                      </select>
                      <input type="number" step="0.01" value={formInterestRate} onChange={(e) => setFormInterestRate(e.target.value)} disabled={editingSettled}
                        placeholder="Taxa %" className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" />
                      <select value={formInterestPeriod} onChange={(e) => setFormInterestPeriod(e.target.value as any)} disabled={editingSettled}
                        className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700">
                        <option value="daily">ao dia</option>
                        <option value="monthly">ao mês</option>
                        <option value="yearly">ao ano</option>
                      </select>
                    </div>
                  )}
                </div>
                {/* Botões */}
                <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button type="button" onClick={() => { setShowCreateModal(false); resetForm() }} disabled={isSubmitting}
                    className="px-4 py-2 text-white hover:opacity-90 rounded-lg" style={{ backgroundColor: 'var(--crud-cancel)' }}>
                    Cancelar
                  </button>
                  <button type="submit" disabled={isSubmitting}
                    className="px-4 py-2 text-white rounded-lg flex items-center gap-2 disabled:opacity-50" style={{ backgroundColor: 'var(--crud-create)' }}>
                    {isSubmitting ? 'Salvando...' : editingLoan ? 'Salvar' : 'Criar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal de Pagamento */}
        {showPaymentModal && payingLoan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4">
              <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <DollarSign size={20} className="text-green-600 dark:text-green-400" />
                  {editingPayment ? 'Editar Pagamento' : 'Registrar Pagamento'}
                </h2>
                <button onClick={() => { setShowPaymentModal(false); setEditingPayment(null) }} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                  <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </button>
              </div>
              <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-600 dark:text-gray-400">{payingLoan.description}</p>
                <p className="text-sm text-gray-500">Saldo restante: <span className={`font-bold ${payingLoan.loan_type === 'lent' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatCurrency(payingLoan.remaining_balance)}</span></p>
              </div>
              <form onSubmit={handleAddPayment} className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      <DollarSign size={16} />
                      Valor *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-green-600 dark:text-green-400">
                        $
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={paymentAmount}
                        onChange={(e) => {
                          // Limitar ao saldo restante durante digitação
                          const value = e.target.value.replace(',', '.')
                          const numValue = parseFloat(value)
                          if (!editingPayment && !isNaN(numValue) && numValue > payingLoan.remaining_balance) {
                            setPaymentAmount(payingLoan.remaining_balance.toFixed(2))
                          } else {
                            handleAmountChange(e.target.value, setPaymentAmount)
                          }
                        }}
                        onBlur={() => handleAmountBlur(paymentAmount, setPaymentAmount)}
                        placeholder="0.00"
                        required
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 font-semibold text-green-600 dark:text-green-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    {!editingPayment && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Máx: {formatCurrency(payingLoan.remaining_balance)}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      <Calendar size={16} />
                      Data *
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
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        required
                        style={{ colorScheme: 'light dark' }}
                        className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                        <Calendar size={16} />
                      </button>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Observações (opcional)</label>
                  <input type="text" value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" />
                </div>
                <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button type="button" onClick={() => { setShowPaymentModal(false); setEditingPayment(null) }} disabled={isSubmitting}
                    className="px-4 py-2 text-white hover:opacity-90 rounded-lg" style={{ backgroundColor: 'var(--crud-cancel)' }}>Cancelar</button>
                  <button type="submit" disabled={isSubmitting}
                    className="px-4 py-2 text-white rounded-lg disabled:opacity-50" style={{ backgroundColor: 'var(--crud-create)' }}>
                    {isSubmitting ? 'Salvando...' : editingPayment ? 'Salvar' : 'Registrar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal de Reabrir Empréstimo */}
        {showReopenModal && reopeningLoan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4">
              <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Lock size={20} className="text-color-primary" />
                  Reabrir Empréstimo
                </h2>
                <button onClick={() => { setShowReopenModal(false); setReopeningLoan(null) }} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                  <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </button>
              </div>
              <form onSubmit={handleReopenSubmit} className="p-4 space-y-4">
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  <p><strong>{reopeningLoan.description}</strong></p>
                  <p className="mt-1">
                    Principal atual: <span className={reopeningLoan.loan_type === 'lent' ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-green-600 dark:text-green-400 font-semibold'}>
                      {formatCurrency(reopeningLoan.loan_type === 'lent' ? -reopeningLoan.principal_amount : reopeningLoan.principal_amount)}
                    </span>
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Valor Adicional *
                  </label>
                  <input
                    type="text"
                    value={reopenAmount}
                    onChange={(e) => handleAmountChange(e.target.value, setReopenAmount, 'positive')}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-color-primary focus:border-transparent"
                    placeholder="0.00"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    O valor será adicionado ao principal existente
                  </p>
                </div>

                {/* Juros */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reopenInterestEnabled}
                      onChange={(e) => setReopenInterestEnabled(e.target.checked)}
                      className="w-4 h-4 text-color-primary rounded"
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
                      <Percent size={14} /> Aplicar Juros
                    </span>
                  </label>

                  {reopenInterestEnabled && (
                    <div className="grid grid-cols-3 gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tipo</label>
                        <select
                          value={reopenInterestType}
                          onChange={(e) => setReopenInterestType(e.target.value as 'simple' | 'compound')}
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                          <option value="simple">Simples</option>
                          <option value="compound">Composto</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Taxa (%)</label>
                        <input
                          type="text"
                          value={reopenInterestRate}
                          onChange={(e) => setReopenInterestRate(e.target.value.replace(/[^0-9.,]/g, ''))}
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Período</label>
                        <select
                          value={reopenInterestPeriod}
                          onChange={(e) => setReopenInterestPeriod(e.target.value as 'daily' | 'monthly' | 'yearly')}
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                          <option value="daily">Diário</option>
                          <option value="monthly">Mensal</option>
                          <option value="yearly">Anual</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button type="button" onClick={() => { setShowReopenModal(false); setReopeningLoan(null) }} disabled={isSubmitting}
                    className="px-4 py-2 text-white hover:opacity-90 rounded-lg" style={{ backgroundColor: 'var(--crud-cancel)' }}>
                    Cancelar
                  </button>
                  <button type="submit" disabled={isSubmitting || !reopenAmount}
                    className="px-4 py-2 text-white rounded-lg disabled:opacity-50" style={{ backgroundColor: 'var(--crud-create)' }}>
                    {isSubmitting ? 'Reabrindo...' : 'Reabrir'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast.show && <Toast message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, show: false })} />}

        {/* Confirm Dialog */}
        <ConfirmComponent />
      </main>
    </div>
  )
}

