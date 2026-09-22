import { useState, useEffect } from 'react'
import axios from 'axios'
import { Wallet, PlusCircle, Users, Calendar, Percent } from 'lucide-react'
import Toast from './Toast'
import {
  CadastroModalShell,
  CadastroModalHeader,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroFormSection,
  CadastroModalFieldsGrid,
  CadastroModalFieldsRow,
  CadastroFieldLabel,
  CadastroModalTabs,
  cadastroFieldCls,
  cadastroOptionLabelCls,
  cadastroAccentControlCls,
} from './CadastroFormLayout'
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

      <CadastroModalShell maxWidth="max-w-lg" onBackdropClick={onClose}>
        <CadastroModalHeader
          isEdit={false}
          title="Enviar para Empréstimo"
          subtitle={expense.description}
          onClose={onClose}
          icon={<Wallet size={18} />}
        />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" id="send-to-loan-form">
          <CadastroModalBody
            chrome={
              <CadastroModalTabs
                tabs={[
                  { key: 'new_loan', label: 'Novo Empréstimo', icon: <PlusCircle size={14} /> },
                  { key: 'add_payment', label: 'Liquidar Existente', icon: <Wallet size={14} /> },
                ]}
                active={action}
                onChange={setAction}
                ariaLabel="Ação do empréstimo"
              />
            }
          >
            <CadastroFormSection title="Lançamento" icon={<Calendar size={14} />}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {isRevenue ? 'Receita' : 'Despesa'}
                  </p>
                  <p className={`mt-1 text-lg font-bold ${isRevenue ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {isRevenue ? '' : '-'}{formatCurrency(Math.abs(expense.amount))}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Data</p>
                  <p className="mt-1 font-medium text-gray-900 dark:text-white">
                    {expense.date ? new Date(expense.date).toLocaleDateString('pt-BR') : '-'}
                  </p>
                </div>
              </div>
            </CadastroFormSection>

            {action === 'new_loan' ? (
              <>
                <CadastroFormSection title="Identificação" icon={<Wallet size={14} />}>
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow>
                      <div>
                        <CadastroFieldLabel>Tipo de Empréstimo</CadastroFieldLabel>
                        <p className={`mt-1 text-sm font-medium ${loanType === 'lent' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {loanType === 'lent' ? 'Emprestei (a receber)' : 'Peguei emprestado (a pagar)'}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                          {isRevenue ? 'Receita = dinheiro entrando' : 'Despesa = dinheiro saindo'}
                        </p>
                      </div>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow>
                      <label className="block min-w-0">
                        <CadastroFieldLabel>Descrição do Empréstimo</CadastroFieldLabel>
                        <input
                          type="text"
                          value={loanDescription}
                          onChange={(e) => setLoanDescription(e.target.value)}
                          placeholder="Descrição do empréstimo"
                          className={`${cadastroFieldCls} mt-0.5`}
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Pré-preenchido com a descrição do item. Edite se necessário.
                        </p>
                      </label>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow>
                      <label className="block min-w-0">
                        <CadastroFieldLabel>Vencimento</CadastroFieldLabel>
                        <input
                          type="date"
                          value={dueDate}
                          onChange={(e) => setDueDate(e.target.value)}
                          className={`${cadastroFieldCls} mt-0.5`}
                        />
                      </label>
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>

                <CadastroFormSection title="Contraparte" icon={<Users size={14} />}>
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow>
                      <label className={cadastroOptionLabelCls}>
                        <input
                          type="checkbox"
                          checked={useExternal}
                          onChange={(e) => setUseExternal(e.target.checked)}
                          className={`${cadastroAccentControlCls} h-4 w-4 rounded border-gray-300`}
                        />
                        Entidade externa (não é conta do sistema)
                      </label>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow>
                      {useExternal ? (
                        <label className="block min-w-0">
                          <CadastroFieldLabel required>Nome</CadastroFieldLabel>
                          <input
                            type="text"
                            value={externalName}
                            onChange={(e) => setExternalName(e.target.value)}
                            placeholder="Nome da pessoa/empresa"
                            className={`${cadastroFieldCls} mt-0.5`}
                          />
                        </label>
                      ) : (
                        <label className="block min-w-0">
                          <CadastroFieldLabel required>Conta parceira</CadastroFieldLabel>
                          <select
                            value={selectedPartnerId || ''}
                            onChange={(e) => setSelectedPartnerId(e.target.value ? parseInt(e.target.value) : null)}
                            className={`${cadastroFieldCls} mt-0.5`}
                          >
                            <option value="">Selecione uma conta parceira</option>
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
                                  <option key={p.id} value={p.id}>
                                    {accountName} • {details}
                                  </option>
                                )
                              })}
                          </select>
                        </label>
                      )}
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>

                <CadastroFormSection title="Juros" icon={<Percent size={14} />}>
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow>
                      <label className={cadastroOptionLabelCls}>
                        <input
                          type="checkbox"
                          checked={interestEnabled}
                          onChange={(e) => setInterestEnabled(e.target.checked)}
                          className={`${cadastroAccentControlCls} h-4 w-4 rounded border-gray-300`}
                        />
                        Aplicar juros
                      </label>
                    </CadastroModalFieldsRow>
                    {interestEnabled ? (
                      <>
                        <CadastroModalFieldsRow cols={3}>
                          <label className="block min-w-0">
                            <CadastroFieldLabel>Tipo</CadastroFieldLabel>
                            <select
                              value={interestType}
                              onChange={(e) => setInterestType(e.target.value as 'simple' | 'compound')}
                              className={`${cadastroFieldCls} mt-0.5`}
                            >
                              <option value="simple">Simples</option>
                              <option value="compound">Composto</option>
                            </select>
                          </label>
                          <label className="block min-w-0">
                            <CadastroFieldLabel>Taxa %</CadastroFieldLabel>
                            <input
                              type="number"
                              step="0.01"
                              value={interestRate}
                              onChange={(e) => setInterestRate(e.target.value)}
                              placeholder="Taxa %"
                              className={`${cadastroFieldCls} mt-0.5`}
                            />
                          </label>
                          <label className="block min-w-0">
                            <CadastroFieldLabel>Período</CadastroFieldLabel>
                            <select
                              value={interestPeriod}
                              onChange={(e) => setInterestPeriod(e.target.value as 'daily' | 'monthly' | 'yearly')}
                              className={`${cadastroFieldCls} mt-0.5`}
                            >
                              <option value="daily">ao dia</option>
                              <option value="monthly">ao mês</option>
                              <option value="yearly">ao ano</option>
                            </select>
                          </label>
                        </CadastroModalFieldsRow>
                        {interestPreview && expense.date ? (
                          <CadastroModalFieldsRow>
                            <div className="space-y-1 text-sm">
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                Data do empréstimo: {new Date(expense.date).toLocaleDateString('pt-BR')}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">{interestPreview.description}</p>
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600 dark:text-gray-400">Juros acumulados</span>
                                <span className={`font-bold ${interestPreview.interestAmount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500'}`}>
                                  +{formatCurrency(interestPreview.interestAmount)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-gray-700 dark:text-gray-300">Valor corrigido</span>
                                <span className={`font-bold ${loanType === 'lent' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                  {loanType === 'lent' ? '-' : ''}{formatCurrency(interestPreview.correctedAmount)}
                                </span>
                              </div>
                            </div>
                          </CadastroModalFieldsRow>
                        ) : null}
                      </>
                    ) : null}
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
              </>
            ) : (
              <>
                <CadastroFormSection title="Empréstimo" icon={<Wallet size={14} />}>
                  <CadastroModalFieldsGrid>
                    <CadastroModalFieldsRow>
                      {compatibleLoans.length === 0 ? (
                        <p className="text-sm italic text-gray-500 dark:text-gray-400">
                          {isRevenue
                            ? 'Nenhum empréstimo "Emprestei" encontrado para receber pagamento'
                            : 'Nenhum empréstimo "Peguei Emprestado" encontrado para pagar'}
                        </p>
                      ) : (
                        <label className="block min-w-0">
                          <CadastroFieldLabel required>Empréstimo</CadastroFieldLabel>
                          <select
                            value={selectedLoanId || ''}
                            onChange={(e) => setSelectedLoanId(e.target.value ? parseInt(e.target.value) : null)}
                            className={`${cadastroFieldCls} mt-0.5`}
                          >
                            <option value="">Selecione um empréstimo</option>
                            {compatibleLoans.map(loan => (
                              <option key={loan.id} value={loan.id}>
                                {loan.description} - {loan.counterpart?.name || loan.external_name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </CadastroModalFieldsRow>
                    {selectedLoanInfo ? (() => {
                      const isLent = selectedLoanInfo.loan.loan_type === 'lent'
                      const principalColor = isLent ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                      const principalSign = isLent ? '-' : '+'
                      const paymentColor = isLent ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      const paymentSign = isLent ? '+' : '-'

                      return (
                        <CadastroModalFieldsRow>
                          <div className="space-y-2 text-sm">
                            <p className="font-medium text-gray-900 dark:text-white">{selectedLoanInfo.loan.description}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Data: {new Date(selectedLoanInfo.loan.loan_date).toLocaleDateString('pt-BR')}
                            </p>
                            {selectedLoanInfo.loan.interest_enabled && (
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {formatRate(selectedLoanInfo.loan.interest_rate)} {selectedLoanInfo.loan.interest_period === 'daily' ? 'ao dia' : selectedLoanInfo.loan.interest_period === 'monthly' ? 'ao mês' : 'ao ano'} ({selectedLoanInfo.loan.interest_type === 'compound' ? 'composto' : 'simples'})
                              </p>
                            )}
                            <div className="flex justify-between">
                              <span className="text-gray-600 dark:text-gray-400">Valor do item</span>
                              <span className={`font-bold ${isRevenue ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                {isRevenue ? '+' : '-'}{formatCurrency(selectedLoanInfo.itemAmount)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600 dark:text-gray-400">Principal</span>
                              <span className={principalColor}>{principalSign}{formatCurrency(selectedLoanInfo.principal)}</span>
                            </div>
                            {selectedLoanInfo.interestAmount > 0 && (
                              <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-gray-400">Juros acumulados</span>
                                <span className={principalColor}>{principalSign}{formatCurrency(selectedLoanInfo.interestAmount)}</span>
                              </div>
                            )}
                            {selectedLoanInfo.totalPaid > 0 && (
                              <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-gray-400">Já pago</span>
                                <span className={paymentColor}>{paymentSign}{formatCurrency(selectedLoanInfo.totalPaid)}</span>
                              </div>
                            )}
                            <div className="flex justify-between border-t border-gray-200 pt-2 font-bold dark:border-gray-600">
                              <span className="text-gray-700 dark:text-gray-300">Saldo corrigido</span>
                              <span className={principalColor}>{principalSign}{formatCurrency(selectedLoanInfo.correctedBalance)}</span>
                            </div>
                            {selectedLoanInfo.interestDescription && (
                              <p className="text-xs italic text-gray-500 dark:text-gray-400">{selectedLoanInfo.interestDescription}</p>
                            )}
                            {selectedLoanInfo.hasExcess ? (
                              <p className="text-sm text-amber-700 dark:text-amber-400">
                                O valor do item excede o saldo. Será registrado apenas {formatCurrency(selectedLoanInfo.correctedBalance)} para quitar o empréstimo.
                                Excedente não utilizado: {formatCurrency(selectedLoanInfo.excessAmount)}
                              </p>
                            ) : (
                              <p className="text-sm text-green-700 dark:text-green-400">
                                Será registrado um pagamento de {formatCurrency(selectedLoanInfo.itemAmount)}
                                {selectedLoanInfo.itemAmount >= selectedLoanInfo.correctedBalance ? ' — o empréstimo será quitado.' : ''}
                              </p>
                            )}
                          </div>
                        </CadastroModalFieldsRow>
                      )
                    })() : null}
                    <CadastroModalFieldsRow>
                      <label className="block min-w-0">
                        <CadastroFieldLabel>Observações</CadastroFieldLabel>
                        <input
                          type="text"
                          value={paymentNotes}
                          onChange={(e) => setPaymentNotes(e.target.value)}
                          placeholder="Observação sobre este pagamento"
                          className={`${cadastroFieldCls} mt-0.5`}
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Pré-preenchido com a descrição do item. Edite se necessário.
                        </p>
                      </label>
                    </CadastroModalFieldsRow>
                  </CadastroModalFieldsGrid>
                </CadastroFormSection>
              </>
            )}
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={onClose}
            onSave={() => {
              const form = document.getElementById('send-to-loan-form') as HTMLFormElement | null
              form?.requestSubmit()
            }}
            saving={isLoading}
            disabled={isLoading || (action === 'add_payment' && (compatibleLoans.length === 0 || !selectedLoanId))}
            saveLabel={action === 'new_loan' ? 'Criar Empréstimo' : 'Registrar Pagamento'}
          />
        </form>
      </CadastroModalShell>
    </>
  )
}
