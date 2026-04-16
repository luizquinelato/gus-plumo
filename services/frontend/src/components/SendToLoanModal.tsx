import { useState, useEffect } from 'react'
import axios from 'axios'
import { X, Wallet, PlusCircle, Users, Calendar, Percent } from 'lucide-react'
import Toast from './Toast'
import { useEscapeKey } from '../hooks/useEscapeKey'

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

interface Loan {
  id: number
  description: string
  principal_amount: number
  remaining_balance: number
  total_paid: number
  loan_type: 'lent' | 'borrowed'
  loan_date: string
  interest_enabled: boolean
  interest_type?: 'simple' | 'compound'
  interest_rate?: number
  interest_period?: 'daily' | 'monthly' | 'yearly'
  counterpart?: {
    name?: string
  }
  external_name?: string
}

interface Partner {
  id: number
  shared_account_id: number
  shared_account?: {
    id: number
    name?: string | null
    description?: string | null
    bank?: {
      id: number
      code: string
      name: string
      full_name?: string
    } | null
    agency?: number | null
    account_number?: string | null
  } | null
}

interface SendToLoanModalProps {
  isOpen: boolean
  onClose: () => void
  expense: {
    id: number
    source: 'bank' | 'card' | 'benefit'
    description: string
    amount: number
    date?: string
  } | null
  onSuccess: (message?: string) => void
}

export default function SendToLoanModal({ isOpen, onClose, expense, onSuccess }: SendToLoanModalProps) {
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })
  const [isLoading, setIsLoading] = useState(false)
  const [action, setAction] = useState<'new_loan' | 'add_payment'>('new_loan')
  
  // Novo empréstimo - tipo determinado automaticamente pelo tipo do item
  // Receita (dinheiro entrando) → Peguei emprestado (borrowed)
  // Despesa (dinheiro saindo) → Emprestei (lent)
  const [partners, setPartners] = useState<Partner[]>([])
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(null)
  const [externalName, setExternalName] = useState('')
  const [useExternal, setUseExternal] = useState(false)
  const [dueDate, setDueDate] = useState<string>('')  // YYYY-MM-DD string (evita problema de timezone)
  const [loanDescription, setLoanDescription] = useState('')
  
  // Juros
  const [interestEnabled, setInterestEnabled] = useState(false)
  const [interestType, setInterestType] = useState<'simple' | 'compound'>('simple')
  const [interestRate, setInterestRate] = useState('')
  const [interestPeriod, setInterestPeriod] = useState<'daily' | 'monthly' | 'yearly'>('monthly')
  
  // Pagamento de empréstimo existente
  const [loans, setLoans] = useState<Loan[]>([])
  const [selectedLoanId, setSelectedLoanId] = useState<number | null>(null)
  const [paymentNotes, setPaymentNotes] = useState('')

  useEscapeKey(onClose, isOpen)

  // Determinar se o item é uma receita (positivo) ou despesa (negativo)
  const isRevenue = (expense?.amount ?? 0) > 0

  // Tipo de empréstimo automático baseado no item:
  // - Receita = dinheiro entrando = Peguei emprestado (borrowed)
  // - Despesa = dinheiro saindo = Emprestei (lent)
  const loanType: 'lent' | 'borrowed' = isRevenue ? 'borrowed' : 'lent'

  useEffect(() => {
    if (isOpen) {
      loadData()
      // Pré-preencher descrição com a descrição do item
      setLoanDescription(expense?.description || '')
      // Pré-preencher notas do pagamento com a descrição do item (aba Liquidar)
      setPaymentNotes(expense?.description || '')
      // Limpar seleções anteriores
      setSelectedLoanId(null)
      setSelectedPartnerId(null)
      setExternalName('')
      setUseExternal(false)
    }
  }, [isOpen, expense])

  const loadData = async () => {
    try {
      const [partnersRes, loansRes] = await Promise.all([
        axios.get('/api/expense-sharing'),
        axios.get('/api/loans?status=open')
      ])
      setPartners(partnersRes.data.filter((p: Partner) => p.shared_account_id))
      setLoans(loansRes.data.loans || [])
    } catch (error) {
      console.error('Erro ao carregar dados:', error)
    }
  }

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
  }

  const formatRate = (rate: number | string | undefined) => {
    if (!rate) return '0%'
    // Remove decimais desnecessários (12.0000 -> 12, 12.5000 -> 12.5)
    const numRate = typeof rate === 'string' ? parseFloat(rate) : rate
    const formatted = parseFloat(numRate.toFixed(4))
    return `${formatted}%`
  }

  /**
   * Calcula juros acumulados desde a data do empréstimo até hoje
   */
  const calculateInterest = (
    principal: number,
    loanDateStr: string,
    rate: number,
    type: 'simple' | 'compound',
    period: 'daily' | 'monthly' | 'yearly'
  ): { correctedAmount: number; interestAmount: number; description: string } => {
    const startDate = new Date(loanDateStr)
    const today = new Date()
    const diffTime = today.getTime() - startDate.getTime()
    const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)))

    const principalNum = Math.abs(principal)
    const rateDecimal = rate / 100

    let correctedAmount: number
    let description: string

    if (period === 'daily') {
      if (type === 'compound') {
        correctedAmount = principalNum * Math.pow(1 + rateDecimal, diffDays)
      } else {
        correctedAmount = principalNum * (1 + rateDecimal * diffDays)
      }
      description = `${diffDays} dias × ${rate}% ao dia`
    } else if (period === 'monthly') {
      const DAYS_IN_MONTH = 30
      const fullMonths = Math.floor(diffDays / DAYS_IN_MONTH)
      const extraDays = diffDays % DAYS_IN_MONTH

      if (diffDays < DAYS_IN_MONTH) {
        correctedAmount = principalNum
        description = `Carência: ${diffDays} dias (1º mês)`
      } else {
        const totalPeriods = fullMonths + (extraDays / DAYS_IN_MONTH)
        if (type === 'compound') {
          correctedAmount = principalNum * Math.pow(1 + rateDecimal, totalPeriods)
        } else {
          correctedAmount = principalNum * (1 + rateDecimal * totalPeriods)
        }
        description = `${fullMonths} mês(es) + ${extraDays} dias pro-rata`
      }
    } else {
      // yearly
      const DAYS_IN_YEAR = 365
      const DAYS_IN_MONTH = 30
      const fullYears = Math.floor(diffDays / DAYS_IN_YEAR)
      const remainingDays = diffDays % DAYS_IN_YEAR
      const fullMonthsInRemainder = Math.floor(remainingDays / DAYS_IN_MONTH)
      const extraDays = remainingDays % DAYS_IN_MONTH

      if (diffDays < DAYS_IN_YEAR) {
        correctedAmount = principalNum
        const monthsElapsed = Math.floor(diffDays / DAYS_IN_MONTH)
        description = `Carência: ${monthsElapsed} mês(es) e ${diffDays % DAYS_IN_MONTH} dias (1º ano)`
      } else {
        const totalPeriods = fullYears + (fullMonthsInRemainder / 12) + (extraDays / DAYS_IN_YEAR)
        if (type === 'compound') {
          correctedAmount = principalNum * Math.pow(1 + rateDecimal, totalPeriods)
        } else {
          correctedAmount = principalNum * (1 + rateDecimal * totalPeriods)
        }
        description = `${fullYears} ano(s) + ${fullMonthsInRemainder} mês(es) + ${extraDays} dias`
      }
    }

    return {
      correctedAmount,
      interestAmount: correctedAmount - principalNum,
      description
    }
  }

  // Filtrar empréstimos compatíveis com o tipo do item
  // - Receita (valor positivo) → só pode liquidar empréstimos onde EMPRESTEI (lent) - estou recebendo de volta
  // - Despesa (valor negativo) → só pode liquidar empréstimos onde PEGUEI EMPRESTADO (borrowed) - estou pagando
  const compatibleLoans = loans.filter(loan => {
    if (isRevenue) {
      // Receita: só empréstimos onde emprestei (estou recebendo de volta)
      return loan.loan_type === 'lent'
    } else {
      // Despesa: só empréstimos onde peguei emprestado (estou pagando)
      return loan.loan_type === 'borrowed'
    }
  })

  // Calcular informações do empréstimo selecionado (com valor corrigido por juros)
  const selectedLoanInfo = (() => {
    if (!selectedLoanId || action !== 'add_payment') return null

    const loan = compatibleLoans.find(l => l.id === selectedLoanId)
    if (!loan) return null

    const itemAmount = Math.abs(expense?.amount ?? 0)
    const principal = Math.abs(loan.principal_amount)
    const totalPaid = loan.total_paid || 0

    // Calcular saldo corrigido com juros (se habilitado)
    let correctedBalance: number
    let interestAmount = 0
    let interestDescription = ''

    if (loan.interest_enabled && loan.interest_rate && loan.interest_type && loan.interest_period) {
      const interest = calculateInterest(
        principal,
        loan.loan_date,
        loan.interest_rate,
        loan.interest_type,
        loan.interest_period
      )
      correctedBalance = interest.correctedAmount - totalPaid
      interestAmount = interest.interestAmount
      interestDescription = interest.description
    } else {
      // Sem juros: saldo = principal - já pago
      correctedBalance = principal - totalPaid
    }

    const hasExcess = itemAmount > correctedBalance
    const excessAmount = hasExcess ? itemAmount - correctedBalance : 0

    return {
      loan,
      itemAmount,
      principal,
      totalPaid,
      correctedBalance,
      interestAmount,
      interestDescription,
      hasExcess,
      excessAmount,
      effectivePayment: hasExcess ? correctedBalance : itemAmount
    }
  })()

  // Calcular preview de juros quando habilitado
  const interestPreview = (() => {
    if (!interestEnabled || !expense?.date || !interestRate || parseFloat(interestRate) <= 0) {
      return null
    }
    return calculateInterest(
      Math.abs(expense.amount),
      expense.date,
      parseFloat(interestRate),
      interestType,
      interestPeriod
    )
  })()

  // Retorna o nome real da tabela de origem
  const getSourceTable = () => {
    if (!expense) return 'bank_statements'
    if (expense.source === 'bank') return 'bank_statements'
    if (expense.source === 'card') return 'credit_card_invoices'
    return 'benefit_card_statements'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!expense) return

    // Validações
    if (action === 'new_loan') {
      if (!useExternal && !selectedPartnerId) {
        showToast('Selecione uma conta parceira ou informe um nome externo', 'warning')
        return
      }
      if (useExternal && !externalName.trim()) {
        showToast('Informe o nome da entidade externa', 'warning')
        return
      }
      if (interestEnabled && (!interestRate || parseFloat(interestRate) <= 0)) {
        showToast('Informe uma taxa de juros válida', 'warning')
        return
      }
    } else {
      if (!selectedLoanId) {
        showToast('Selecione um empréstimo', 'warning')
        return
      }
    }

    try {
      setIsLoading(true)
      const payload: any = {
        source_table: getSourceTable(),
        source_id: expense.id,
        action: action
      }

      if (action === 'new_loan') {
        payload.loan_type = loanType
        payload.description = loanDescription.trim() || expense.description
        if (useExternal) {
          payload.external_name = externalName.trim()
        } else {
          const partner = partners.find(p => p.id === selectedPartnerId)
          payload.counterpart_account_id = partner?.shared_account_id
        }
        if (dueDate) {
          payload.due_date = dueDate  // Enviar como string YYYY-MM-DD (evita problema de timezone)
        }
        payload.interest_enabled = interestEnabled
        if (interestEnabled) {
          payload.interest_type = interestType
          payload.interest_rate = parseFloat(interestRate)
          payload.interest_period = interestPeriod
        }
      } else {
        payload.loan_id = selectedLoanId
        payload.notes = paymentNotes
        // Sempre limitar ao saldo quando houver excedente (evita lançar valor maior que o devido)
        if (selectedLoanInfo?.hasExcess) {
          payload.limit_to_balance = true
        }
      }

      await axios.post('/api/loans/create-from-source', payload)
      const successMessage = action === 'new_loan' ? 'Empréstimo criado com sucesso!' : 'Pagamento registrado com sucesso!'
      onClose()
      onSuccess(successMessage)
    } catch (error: any) {
      showToast(error.response?.data?.detail || 'Erro ao processar', 'error')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen || !expense) return null

  return (
    <>
      {toast.show && <Toast message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, show: false })} />}

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Wallet size={20} className="text-color-primary" />
              Enviar para Empréstimo
            </h2>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
              <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </button>
          </div>

          {/* Info do Item */}
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {isRevenue ? 'Receita:' : 'Despesa:'}
                </p>
                <p className="font-medium text-gray-900 dark:text-white truncate">{expense.description}</p>
                <p className={`text-lg font-bold mt-1 ${isRevenue ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {isRevenue ? '' : '-'}{formatCurrency(Math.abs(expense.amount))}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1 justify-end">
                  <Calendar size={14} /> Data:
                </p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {expense?.date ? new Date(expense.date).toLocaleDateString('pt-BR') : '-'}
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            {/* Tabs: Novo Empréstimo ou Pagamento */}
            <div className="flex rounded-lg bg-gray-100 dark:bg-gray-700 p-1">
              <button type="button" onClick={() => setAction('new_loan')}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${action === 'new_loan' ? 'bg-white dark:bg-gray-600 text-color-primary shadow' : 'text-gray-600 dark:text-gray-400'}`}>
                <PlusCircle size={16} className="inline mr-1" /> Novo Empréstimo
              </button>
              <button type="button" onClick={() => setAction('add_payment')}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${action === 'add_payment' ? 'bg-white dark:bg-gray-600 text-color-primary shadow' : 'text-gray-600 dark:text-gray-400'}`}>
                <Wallet size={16} className="inline mr-1" /> Liquidar Existente
              </button>
            </div>

            {action === 'new_loan' ? (
              <>
                {/* Tipo de Empréstimo */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Tipo de Empréstimo</label>
                  <div className={`inline-flex items-center px-4 py-2 rounded-lg font-medium text-white ${
                    loanType === 'lent' ? 'bg-green-600' : 'bg-red-600'
                  }`}>
                    {loanType === 'lent' ? 'Emprestei (a receber)' : 'Peguei emprestado (a pagar)'}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {isRevenue
                      ? 'Receita = dinheiro entrando'
                      : 'Despesa = dinheiro saindo'}
                  </p>
                </div>

                {/* Descrição do Empréstimo */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Descrição do Empréstimo
                  </label>
                  <input
                    type="text"
                    value={loanDescription}
                    onChange={(e) => setLoanDescription(e.target.value)}
                    placeholder="Descrição do empréstimo"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Pré-preenchido com a descrição do item. Edite se necessário.
                  </p>
                </div>

                {/* Contraparte */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <Users size={14} className="inline mr-1" /> Contraparte
                  </label>
                  <div className="flex items-center gap-2 mb-2">
                    <input type="checkbox" checked={useExternal} onChange={(e) => setUseExternal(e.target.checked)}
                      className="w-4 h-4 text-color-primary" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Entidade externa (não é conta do sistema)</span>
                  </div>
                  {useExternal ? (
                    <input type="text" value={externalName} onChange={(e) => setExternalName(e.target.value)}
                      placeholder="Nome da pessoa/empresa" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                  ) : (
                    <select value={selectedPartnerId || ''} onChange={(e) => setSelectedPartnerId(e.target.value ? parseInt(e.target.value) : null)}
                      style={{ colorScheme: 'light' }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                      <option value="" style={{ color: '#111827', backgroundColor: '#ffffff' }}>Selecione uma conta parceira</option>
                      {[...partners]
                        .sort((a, b) => {
                          const nameA = a.shared_account?.name || a.shared_account?.description || 'Sem nome'
                          const nameB = b.shared_account?.name || b.shared_account?.description || 'Sem nome'
                          return nameA.localeCompare(nameB, 'pt-BR')
                        })
                        .map(p => {
                          const acc = p.shared_account
                          const accountName = acc?.name || acc?.description || 'Sem nome'
                          const bankName = acc?.bank?.name || 'Sem banco'
                          const agencyInfo = acc?.agency ? `Ag: ${acc.agency}` : ''
                          const accountInfo = acc?.account_number ? `Conta: ${acc.account_number}` : ''
                          const details = [bankName, agencyInfo, accountInfo].filter(Boolean).join(' • ')
                          return (
                            <option key={p.id} value={p.id} style={{ color: '#111827', backgroundColor: '#ffffff' }}>
                              {accountName} • {details}
                            </option>
                          )
                        })}
                    </select>
                  )}
                </div>

                {/* Vencimento */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <Calendar size={14} className="inline mr-1" /> Vencimento (opcional)
                  </label>
                  <div className="relative">
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      style={{ colorScheme: 'light dark' }}
                      className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        const input = (e.currentTarget as HTMLElement).previousElementSibling as HTMLInputElement
                        input?.showPicker?.()
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded text-gray-500 dark:text-gray-400"
                    >
                      <Calendar size={16} />
                    </button>
                  </div>
                </div>

                {/* Juros */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input type="checkbox" checked={interestEnabled} onChange={(e) => setInterestEnabled(e.target.checked)}
                      className="w-4 h-4 text-color-primary" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      <Percent size={14} className="inline mr-1" /> Aplicar juros
                    </span>
                  </label>
                  {interestEnabled && (
                    <>
                      <div className="grid grid-cols-3 gap-2 mt-2">
                        <select value={interestType} onChange={(e) => setInterestType(e.target.value as any)}
                          style={{ colorScheme: 'light' }}
                          className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                          <option value="simple" style={{ color: '#111827', backgroundColor: '#ffffff' }}>Simples</option>
                          <option value="compound" style={{ color: '#111827', backgroundColor: '#ffffff' }}>Composto</option>
                        </select>
                        <input type="number" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)}
                          placeholder="Taxa %" className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                        <select value={interestPeriod} onChange={(e) => setInterestPeriod(e.target.value as any)}
                          style={{ colorScheme: 'light' }}
                          className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                          <option value="daily" style={{ color: '#111827', backgroundColor: '#ffffff' }}>ao dia</option>
                          <option value="monthly" style={{ color: '#111827', backgroundColor: '#ffffff' }}>ao mês</option>
                          <option value="yearly" style={{ color: '#111827', backgroundColor: '#ffffff' }}>ao ano</option>
                        </select>
                      </div>

                      {/* Preview de juros acumulados */}
                      {interestPreview && expense?.date && (
                        <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
                          <p className="text-xs text-amber-700 dark:text-amber-400 mb-1">
                            📅 Data do empréstimo: {new Date(expense.date).toLocaleDateString('pt-BR')}
                          </p>
                          <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
                            📈 {interestPreview.description}
                          </p>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600 dark:text-gray-400">Juros acumulados:</span>
                            <span className={`text-sm font-bold ${interestPreview.interestAmount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500'}`}>
                              +{formatCurrency(interestPreview.interestAmount)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Valor corrigido:</span>
                            <span className={`text-sm font-bold ${loanType === 'lent' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                              {loanType === 'lent' ? '-' : ''}{formatCurrency(interestPreview.correctedAmount)}
                            </span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Lista de empréstimos compatíveis */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <Wallet size={14} className="inline mr-1" /> Empréstimo
                  </label>
                  {compatibleLoans.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                      {isRevenue
                        ? 'Nenhum empréstimo "Emprestei" encontrado para receber pagamento'
                        : 'Nenhum empréstimo "Peguei Emprestado" encontrado para pagar'}
                    </p>
                  ) : (
                    <select value={selectedLoanId || ''} onChange={(e) => setSelectedLoanId(e.target.value ? parseInt(e.target.value) : null)}
                      style={{ colorScheme: 'light' }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                      <option value="" style={{ color: '#111827', backgroundColor: '#ffffff' }}>Selecione um empréstimo</option>
                      {compatibleLoans.map(loan => (
                        <option key={loan.id} value={loan.id} style={{ color: '#111827', backgroundColor: '#ffffff' }}>
                          {loan.description} - {loan.counterpart?.name || loan.external_name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Painel de comparação quando empréstimo selecionado */}
                {selectedLoanInfo && (() => {
                  // Lógica de cores consistente com EmprestimosPage:
                  // - Emprestei (lent): dinheiro SAIU da conta → negativo/vermelho
                  // - Peguei (borrowed): dinheiro ENTROU na conta → positivo/verde
                  const isLent = selectedLoanInfo.loan.loan_type === 'lent'
                  const principalColor = isLent ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                  const principalSign = isLent ? '-' : '+'
                  // Pagamentos: inverso do principal (reduzem a posição)
                  const paymentColor = isLent ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                  const paymentSign = isLent ? '+' : '-'

                  return (
                  <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 space-y-3">
                    {/* Info do empréstimo */}
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      <p className="font-medium text-gray-900 dark:text-white">{selectedLoanInfo.loan.description}</p>
                      <p className="text-xs">📅 Data: {new Date(selectedLoanInfo.loan.loan_date).toLocaleDateString('pt-BR')}</p>
                      {selectedLoanInfo.loan.interest_enabled && (
                        <p className="text-xs">
                          📈 {formatRate(selectedLoanInfo.loan.interest_rate)} {selectedLoanInfo.loan.interest_period === 'daily' ? 'ao dia' : selectedLoanInfo.loan.interest_period === 'monthly' ? 'ao mês' : 'ao ano'} ({selectedLoanInfo.loan.interest_type === 'compound' ? 'composto' : 'simples'})
                        </p>
                      )}
                    </div>

                    {/* Tabela de valores */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Valor do item:</span>
                        <span className={`font-bold ${isRevenue ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {isRevenue ? '+' : '-'}{formatCurrency(selectedLoanInfo.itemAmount)}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Principal:</span>
                        <span className={principalColor}>{principalSign}{formatCurrency(selectedLoanInfo.principal)}</span>
                      </div>

                      {selectedLoanInfo.interestAmount > 0 && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-600 dark:text-gray-400">Juros acumulados:</span>
                          <span className={principalColor}>{principalSign}{formatCurrency(selectedLoanInfo.interestAmount)}</span>
                        </div>
                      )}

                      {selectedLoanInfo.totalPaid > 0 && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-600 dark:text-gray-400">Já pago:</span>
                          <span className={paymentColor}>
                            {paymentSign}{formatCurrency(selectedLoanInfo.totalPaid)}
                          </span>
                        </div>
                      )}

                      <div className="flex justify-between items-center text-sm font-bold border-t border-gray-300 dark:border-gray-500 pt-2">
                        <span className="text-gray-700 dark:text-gray-300">Saldo corrigido:</span>
                        <span className={principalColor}>{principalSign}{formatCurrency(selectedLoanInfo.correctedBalance)}</span>
                      </div>

                      {selectedLoanInfo.interestDescription && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                          {selectedLoanInfo.interestDescription}
                        </p>
                      )}
                    </div>

                    {/* Aviso de excedente - sem checkbox, apenas informativo */}
                    {selectedLoanInfo.hasExcess && (
                      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
                        <p className="text-sm text-amber-700 dark:text-amber-400">
                          ⚠️ O valor do item excede o saldo. Será registrado apenas <strong>{formatCurrency(selectedLoanInfo.correctedBalance)}</strong> para quitar o empréstimo.
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          💰 Excedente não utilizado: {formatCurrency(selectedLoanInfo.excessAmount)}
                        </p>
                      </div>
                    )}

                    {/* Resumo do pagamento */}
                    {!selectedLoanInfo.hasExcess && (
                      <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg">
                        <p className="text-sm text-green-700 dark:text-green-400">
                          ✅ Será registrado um pagamento de <strong>{formatCurrency(selectedLoanInfo.itemAmount)}</strong>
                        </p>
                        {selectedLoanInfo.itemAmount >= selectedLoanInfo.correctedBalance && (
                          <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                            O empréstimo será quitado!
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )})()}

                {/* Notas */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Observações (opcional)</label>
                  <input type="text" value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)}
                    placeholder="Observação sobre este pagamento"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Pré-preenchido com a descrição do item. Edite se necessário.
                  </p>
                </div>
              </>
            )}

            {/* Botões */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button type="button" onClick={onClose} disabled={isLoading}
                className="px-4 py-2 text-white hover:opacity-90 rounded-lg transition-colors"
                style={{ backgroundColor: 'var(--crud-cancel)' }}>
                Cancelar
              </button>
              <button type="submit" disabled={isLoading || (action === 'add_payment' && (compatibleLoans.length === 0 || !selectedLoanId))}
                className="px-4 py-2 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--crud-create)' }}>
                {isLoading ? 'Processando...' : action === 'new_loan' ? 'Criar Empréstimo' : 'Registrar Pagamento'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

