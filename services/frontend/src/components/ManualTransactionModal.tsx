import { useState, useEffect } from 'react'
import axios from 'axios'
import { DollarSign, Tag, Users, FileText, AlertTriangle, Lock, Landmark, Gift } from 'lucide-react'
import Toast from './Toast'
import { DateField } from './date'
import {
  CadastroModalShell,
  CadastroModalHeader,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroFormSection,
  CadastroModalFieldsGrid,
  CadastroModalFieldsRow,
  CadastroFieldLabel,
  cadastroFieldCls,
  cadastroOptionLabelCls,
  cadastroAccentControlCls,
} from './CadastroFormLayout'
import { useAlert } from '../hooks/useAlert'
import { dateToLocalString, dateToLocalTimestamp, parseLocalDateTime } from '../utils/dateUtils'
import { validateAccountPeriodDate } from '../services/accountPeriodClosuresApi'
import { sharingPartnerLabel, sharingPercentForKind } from '../utils/accountFormatter'
import OwnershipPercentField from './OwnershipPercentField'
import { maskPercentInput } from '../utils/percentInput'

interface ClosedPeriodValidation {
  is_closed: boolean
  closure_id: number | null
  closure_year: number | null
  closure_month: number | null
  is_settled: boolean
  next_open_date: string | null
  message: string | null
}

interface Bank {
  id: number
  code: string
  name: string
  full_name: string | null
}

interface Account {
  id: number
  name: string | null
  description: string | null
  bank: Bank | null
  agency: number | null
  account_number: string | null
}

interface Tag {
  id: number
  name: string
  description: string | null
  icon: string | null
  type: string
  active: boolean
}

interface Subtag {
  id: number
  tag_id: number
  name: string
  description: string | null
  type: string
  icon: string | null
  active: boolean
  tag_name: string | null
}

interface SharedPartner {
  id: number
  account_id: number
  shared_account_id: number
  my_contribution_percentage: number
  revenue_contribution_percentage?: number
  description: string | null
  active: boolean
  shared_account: Account | null
}

export type ManualLaunchDestination = 'extrato' | 'beneficio'

interface BenefitCardOption {
  id: number
  name: string
  number: string
}

interface ManualTransactionModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  /** Destino inicial ao abrir o modal (relatório de extrato). */
  defaultDestination?: ManualLaunchDestination
}

const ManualTransactionModal = ({
  isOpen,
  onClose,
  onSuccess,
  defaultDestination = 'extrato',
}: ManualTransactionModalProps) => {
  // Alert hook
  const { showError } = useAlert()

  // Toast state
  interface ToastState {
    show: boolean
    message: string
    type: 'success' | 'error' | 'warning'
  }

  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  // Estados de dados
  const [tags, setTags] = useState<Tag[]>([])
  const [subtags, setSubtags] = useState<Subtag[]>([])
  const [partners, setPartners] = useState<SharedPartner[]>([])
  const [accountId, setAccountId] = useState<number | null>(null)
  const [benefitCards, setBenefitCards] = useState<BenefitCardOption[]>([])
  const [launchDestination, setLaunchDestination] = useState<ManualLaunchDestination>(defaultDestination)
  const [creditCardId, setCreditCardId] = useState<number>(0)

  // Estados do formulário
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    tag_id: 0,
    subtag_id: 0,
    adjustment_type: 'proprio' as 'proprio' | 'compartilhado',
    expense_sharing_id: null as number | null,
    ownership_percentage: '100.00',
    adjustment_notes: '',
    create_mapping: false
  })

  const [isLoading, setIsLoading] = useState(false)

  // Estados para validação de período fechado
  const [closedPeriodInfo, setClosedPeriodInfo] = useState<ClosedPeriodValidation | null>(null)
  const [showClosedPeriodDialog, setShowClosedPeriodDialog] = useState(false)

  // Carregar dados ao abrir modal
  useEffect(() => {
    if (isOpen) {
      setLaunchDestination(defaultDestination)
      loadData()
      resetForm(defaultDestination)
    }
  }, [isOpen, defaultDestination])

  // Atualizar subtags quando tag ou valor mudar
  useEffect(() => {
    if (formData.tag_id > 0) {
      // Filtrar subtags pela tag selecionada
      // (filtro por tipo será feito no render baseado no valor)
    }
  }, [formData.tag_id, formData.amount])

  // Atualizar ownership_percentage quando adjustment_type mudar
  useEffect(() => {
    if (formData.adjustment_type === 'proprio') {
      setFormData(prev => ({ ...prev, ownership_percentage: '100.00' }))
    } else if (formData.adjustment_type === 'compartilhado') {
      setFormData(prev => ({ ...prev, ownership_percentage: '50.00' }))
    }
  }, [formData.adjustment_type])

  // Atalhos de teclado
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter' && !e.shiftKey) {
        const target = e.target as HTMLElement
        if (target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT') {
          e.preventDefault()
          const form = document.getElementById('manual-transaction-form') as HTMLFormElement | null
          if (form) {
            form.requestSubmit()
          }
        }
      }
    }

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  const loadData = async () => {
    try {
      const [verifyRes, tagsRes, subtagsRes, partnersRes, cartoesRes] = await Promise.all([
        axios.get('/api/auth/verify'),
        axios.get('/api/expenses/tags'),
        axios.get('/api/expenses/subtags'),
        axios.get('/api/expense-sharing/'),
        axios.get('/api/cartoes/'),
      ])

      // Obter account_id do JWT token
      if (verifyRes.data.valid && verifyRes.data.user?.account_id) {
        setAccountId(verifyRes.data.user.account_id)
      } else {
        showError('Erro', 'Nenhuma conta selecionada. Por favor, selecione uma conta primeiro.')
        onClose()
        return
      }

      setTags(tagsRes.data)
      setSubtags(subtagsRes.data)
      setPartners(partnersRes.data)
      const cards = (cartoesRes.data as { id: number; name: string; number: string; type?: string; active?: boolean }[])
        .filter((c) => c.type === 'beneficios' && c.active !== false)
      setBenefitCards(cards)
    } catch (error) {
      console.error('Erro ao carregar dados:', error)
      showError('Erro', 'Erro ao carregar dados do formulário')
    }
  }

  const resetForm = (destination: ManualLaunchDestination = defaultDestination) => {
    setLaunchDestination(destination)
    setCreditCardId(0)
    setSelectedDate(new Date())
    setFormData({
      description: '',
      amount: '',
      tag_id: 0,
      subtag_id: 0,
      adjustment_type: 'proprio',
      expense_sharing_id: null,
      ownership_percentage: '100.00',
      adjustment_notes: '',
      create_mapping: false
    })
  }

  const getTransactionType = (): 'receita' | 'despesa' | null => {
    const amount = parseFloat(formData.amount)
    if (isNaN(amount) || amount === 0) return null
    return amount > 0 ? 'receita' : 'despesa'
  }

  const getFilteredTags = (): Tag[] => {
    // Não filtrar tags por tipo - mostrar todas
    return tags
  }

  const getFilteredSubtags = (): Subtag[] => {
    const type = getTransactionType()
    if (!type || formData.tag_id === 0) return []
    return subtags.filter(s => s.tag_id === formData.tag_id && s.type === type)
  }

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value

    // Permite: números, sinal negativo no início, e um ponto decimal
    // Regex: opcional '-' no início, seguido de dígitos, opcionalmente um '.' seguido de dígitos
    const regex = /^-?\d*\.?\d*$/

    if (value === '' || regex.test(value)) {
      // Validação adicional: limita a 8 dígitos antes do ponto decimal
      // DECIMAL(10, 2) permite no máximo 99.999.999,99
      const numValue = parseFloat(value)
      if (!isNaN(numValue) && Math.abs(numValue) > 99999999.99) {
        return // Não atualiza se exceder o limite
      }
      setFormData({ ...formData, amount: value })
    }
  }

  const handleAmountBlur = () => {
    const amount = parseFloat(formData.amount)
    if (!isNaN(amount)) {
      setFormData({ ...formData, amount: amount.toFixed(2) })
    }
  }

  const handleOwnershipPercentageBlur = () => {
    if (formData.ownership_percentage) {
      const numValue = parseFloat(formData.ownership_percentage)
      if (!isNaN(numValue)) {
        // Limita entre 0 e 100
        const clampedValue = Math.min(Math.max(numValue, 0), 100)
        setFormData({ ...formData, ownership_percentage: clampedValue.toFixed(2) })
      } else {
        // Se não for um número válido, reseta para 0.00
        setFormData({ ...formData, ownership_percentage: '0.00' })
      }
    } else {
      // Se estiver vazio, reseta para 0.00
      setFormData({ ...formData, ownership_percentage: '0.00' })
    }
  }

  const getPartnerLabel = (partner: SharedPartner): string => sharingPartnerLabel(partner)

  // Validar se a data/hora está em um período fechado
  const validateDateAgainstClosures = async (date: Date, sharingId: number): Promise<ClosedPeriodValidation | null> => {
    try {
      const dateStr = dateToLocalString(date) // YYYY-MM-DD (local, não UTC)
      const timeStr = date.toTimeString().split(' ')[0] // HH:MM:SS

      const response = await axios.get('/api/balance/closures/validate-date', {
        params: {
          expense_sharing_id: sharingId,
          date: dateStr,
          time: timeStr // ✅ Envia hora também para validação por timestamp
        }
      })
      return response.data
    } catch (error) {
      console.error('Erro ao validar data contra fechamentos:', error)
      return null
    }
  }

  // Usar a próxima data disponível e submeter automaticamente
  const handleUseNextOpenDate = async () => {
    if (closedPeriodInfo?.next_open_date) {
      const nextDate = new Date(closedPeriodInfo.next_open_date + 'T12:00:00')
      setSelectedDate(nextDate)
      setShowClosedPeriodDialog(false)
      setClosedPeriodInfo(null)

      // Auto-submit com a nova data
      await submitTransaction(nextDate)
    }
  }

  // Formatar nome do mês
  const getMonthName = (month: number): string => {
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
    return months[month - 1] || ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validações
    if (!accountId) {
      showToast('Conta não identificada. Por favor, recarregue a página.', 'error')
      return
    }

    if (!formData.description.trim()) {
      showToast('Digite uma descrição', 'error')
      return
    }

    const amount = parseFloat(formData.amount)
    if (isNaN(amount) || amount === 0) {
      showToast('Digite um valor válido (diferente de zero)', 'error')
      return
    }

    // Validação: DECIMAL(10, 2) permite no máximo 99.999.999,99
    const maxAmount = 99999999.99
    if (Math.abs(amount) > maxAmount) {
      showToast(`O valor não pode exceder R$ ${maxAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'error')
      return
    }

    if (formData.adjustment_type === 'compartilhado' && !formData.expense_sharing_id) {
      showToast('Selecione um compartilhamento', 'error')
      return
    }

    if (launchDestination === 'beneficio' && creditCardId <= 0) {
      showToast('Selecione o cartão de benefícios', 'error')
      return
    }

    // Validação de período fechado da conta (extrato)
    const accountValidation = await validateAccountPeriodDate(dateToLocalString(selectedDate))
    if (accountValidation?.is_closed) {
      setClosedPeriodInfo({
        is_closed: true,
        closure_id: accountValidation.closure_id ?? null,
        closure_year: accountValidation.closure_year ?? null,
        closure_month: accountValidation.closure_month ?? null,
        is_settled: false,
        next_open_date: accountValidation.next_open_date ?? null,
        message: accountValidation.message ?? null,
      })
      setShowClosedPeriodDialog(true)
      return
    }

    // Validação de período fechado (apenas para lançamentos compartilhados)
    if (formData.adjustment_type === 'compartilhado' && formData.expense_sharing_id) {
      const validation = await validateDateAgainstClosures(selectedDate, formData.expense_sharing_id)
      if (validation?.is_closed) {
        setClosedPeriodInfo(validation)
        setShowClosedPeriodDialog(true)
        return // Não continua o submit - mostra o dialog primeiro
      }
    }

    // Continua com o submit normal
    await submitTransaction()
  }

  const submitTransaction = async (dateOverride?: Date) => {
    try {
      setIsLoading(true)

      const transactionDate = dateOverride || selectedDate
      const amount = parseFloat(formData.amount)
      const commonPayload = {
        date: dateToLocalTimestamp(transactionDate),
        description: formData.description.trim(),
        amount: amount,
        subtag_id: formData.subtag_id === 0 ? null : formData.subtag_id,
        expense_sharing_id: formData.adjustment_type === 'compartilhado' ? formData.expense_sharing_id : null,
        ownership_percentage: parseFloat(formData.ownership_percentage),
        adjustment_notes: formData.adjustment_notes.trim() || null,
        create_mapping: formData.create_mapping,
      }

      const response =
        launchDestination === 'beneficio'
          ? await axios.post('/api/expenses/benefit-card-statements/manual', {
              ...commonPayload,
              credit_card_id: creditCardId,
            })
          : await axios.post('/api/expenses/bank-statements/manual', {
              ...commonPayload,
              account_id: accountId,
            })

      // Atualiza os dados na tela principal
      onSuccess()

      // Limpa o formulário para um possível novo lançamento
      resetForm(launchDestination)

      // Mostra mensagem de sucesso em toast
      showToast(response.data.message || 'Lançamento criado com sucesso!', 'success')
    } catch (error: any) {
      console.error('Erro ao criar lançamento:', error)
      showToast(
        error.response?.data?.detail || 'Erro ao criar lançamento. Tente novamente.',
        'error'
      )
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  const transactionType = getTransactionType()
  const amountColor = transactionType === 'receita' ? 'text-green-600 dark:text-green-400' :
                      transactionType === 'despesa' ? 'text-red-600 dark:text-red-400' :
                      'text-gray-600 dark:text-gray-400'

  return (
    <>
      <CadastroModalShell maxWidth="max-w-3xl" onBackdropClick={onClose}>
        <CadastroModalHeader
          isEdit={false}
          title="Novo Lançamento Manual"
          subtitle="Crie uma transação manualmente"
          onClose={onClose}
          icon={<DollarSign size={18} />}
        />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" id="manual-transaction-form">
          <CadastroModalBody>
            <CadastroFormSection title="Destino" icon={<Landmark size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow>
                  <div className="flex flex-wrap gap-4">
                    <label className={cadastroOptionLabelCls}>
                      <input
                        type="radio"
                        value="extrato"
                        checked={launchDestination === 'extrato'}
                        onChange={() => {
                          setLaunchDestination('extrato')
                          setCreditCardId(0)
                        }}
                        disabled={isLoading}
                        className={cadastroAccentControlCls}
                      />
                      <Landmark size={14} className="text-[var(--color-1)]" aria-hidden />
                      Extrato bancário
                    </label>
                    <label className={cadastroOptionLabelCls}>
                      <input
                        type="radio"
                        value="beneficio"
                        checked={launchDestination === 'beneficio'}
                        onChange={() => setLaunchDestination('beneficio')}
                        disabled={isLoading || benefitCards.length === 0}
                        className={cadastroAccentControlCls}
                      />
                      <Gift size={14} className="text-[var(--color-3)]" aria-hidden />
                      Cartão de benefícios
                    </label>
                  </div>
                  {benefitCards.length === 0 ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Cadastre um cartão de benefícios para lançar nesta origem.
                    </p>
                  ) : null}
                </CadastroModalFieldsRow>
                {launchDestination === 'beneficio' ? (
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Cartão de benefícios</CadastroFieldLabel>
                      <select
                        value={creditCardId || 0}
                        onChange={(e) => setCreditCardId(Number(e.target.value))}
                        disabled={isLoading}
                        className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                        required
                      >
                        <option value={0}>Selecione o cartão...</option>
                        {benefitCards.map((card) => (
                          <option key={card.id} value={card.id}>
                            {card.name} •••• {card.number}
                          </option>
                        ))}
                      </select>
                    </label>
                  </CadastroModalFieldsRow>
                ) : null}
              </CadastroModalFieldsGrid>
            </CadastroFormSection>

            <CadastroFormSection title="Identificação" icon={<FileText size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow cols={2}>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Data e Hora</CadastroFieldLabel>
                    <DateField
                      withTime
                      value={dateToLocalTimestamp(selectedDate)}
                      onChange={(value) => setSelectedDate(parseLocalDateTime(value) ?? new Date())}
                      disabled={isLoading}
                      className={`${cadastroFieldCls} mt-0.5`}
                    />
                  </label>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>
                      Valor {transactionType ? (
                        <span className={`font-semibold ${amountColor}`}>
                          ({transactionType === 'receita' ? 'Receita' : 'Despesa'})
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
                        value={formData.amount}
                        onChange={handleAmountChange}
                        onBlur={handleAmountBlur}
                        disabled={isLoading}
                        placeholder="0.00"
                        className={`${cadastroFieldCls} pl-10 font-semibold disabled:opacity-50 ${amountColor}`}
                        required
                      />
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Use valores negativos para despesas e positivos para receitas
                    </p>
                  </label>
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Descrição</CadastroFieldLabel>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      disabled={isLoading}
                      placeholder="Ex: Almoço Restaurante X"
                      className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                      required
                    />
                  </label>
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow>
                  <label className="block min-w-0">
                    <CadastroFieldLabel>Observações</CadastroFieldLabel>
                    <textarea
                      value={formData.adjustment_notes}
                      onChange={(e) => setFormData({ ...formData, adjustment_notes: e.target.value })}
                      disabled={isLoading}
                      placeholder="Notas adicionais sobre esta transação..."
                      rows={3}
                      className={`${cadastroFieldCls} mt-0.5 resize-none disabled:opacity-50`}
                    />
                  </label>
                </CadastroModalFieldsRow>
              </CadastroModalFieldsGrid>
            </CadastroFormSection>

            <CadastroFormSection title="Classificação" icon={<Tag size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow cols={2}>
                  <label className="block min-w-0">
                    <CadastroFieldLabel>Tag</CadastroFieldLabel>
                    <select
                      value={formData.tag_id}
                      onChange={(e) => setFormData({ ...formData, tag_id: Number(e.target.value), subtag_id: 0 })}
                      disabled={isLoading}
                      className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                    >
                      <option value={0}>Selecione uma tag...</option>
                      {getFilteredTags().map(tag => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block min-w-0">
                    <CadastroFieldLabel>Subtag</CadastroFieldLabel>
                    <select
                      value={formData.subtag_id}
                      onChange={(e) => setFormData({ ...formData, subtag_id: Number(e.target.value) })}
                      disabled={isLoading || formData.tag_id === 0 || !transactionType}
                      className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                    >
                      <option value={0}>
                        {formData.tag_id === 0 ? 'Selecione uma tag primeiro' : !transactionType ? 'Digite o valor primeiro' : 'Selecione uma subtag...'}
                      </option>
                      {getFilteredSubtags().map(subtag => (
                        <option key={subtag.id} value={subtag.id}>
                          {subtag.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow>
                  <label className={`${cadastroOptionLabelCls} items-start ${formData.subtag_id === 0 ? 'cursor-not-allowed opacity-60' : ''}`}>
                    <input
                      type="checkbox"
                      checked={formData.create_mapping}
                      onChange={(e) => setFormData({ ...formData, create_mapping: e.target.checked })}
                      disabled={isLoading || formData.subtag_id === 0}
                      className={`${cadastroAccentControlCls} mt-1 h-4 w-4 rounded border-gray-300 disabled:cursor-not-allowed`}
                    />
                    <span>
                      <span className="block text-sm font-medium">Criar mapeamento automático</span>
                      <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                        {formData.subtag_id === 0
                          ? 'Selecione uma subtag para habilitar o mapeamento automático'
                          : 'Salva esta descrição para categorização automática futura (correspondência exata)'}
                      </span>
                    </span>
                  </label>
                </CadastroModalFieldsRow>
              </CadastroModalFieldsGrid>
            </CadastroFormSection>

            <CadastroFormSection title="Compartilhamento" icon={<Users size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow>
                  <div className="flex flex-wrap gap-4">
                    <label className={cadastroOptionLabelCls}>
                      <input
                        type="radio"
                        value="proprio"
                        checked={formData.adjustment_type === 'proprio'}
                        onChange={(e) => setFormData({
                          ...formData,
                          adjustment_type: e.target.value as 'proprio' | 'compartilhado',
                          expense_sharing_id: null
                        })}
                        disabled={isLoading}
                        className={cadastroAccentControlCls}
                      />
                      Próprio
                    </label>
                    <label className={cadastroOptionLabelCls}>
                      <input
                        type="radio"
                        value="compartilhado"
                        checked={formData.adjustment_type === 'compartilhado'}
                        onChange={(e) => setFormData({
                          ...formData,
                          adjustment_type: e.target.value as 'proprio' | 'compartilhado'
                        })}
                        disabled={isLoading}
                        className={cadastroAccentControlCls}
                      />
                      Compartilhado
                    </label>
                  </div>
                </CadastroModalFieldsRow>
                {formData.adjustment_type === 'compartilhado' ? (
                  <CadastroModalFieldsRow cols={2}>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Compartilhamento</CadastroFieldLabel>
                      <select
                        value={formData.expense_sharing_id || 0}
                        onChange={(e) => {
                          const sharingId = Number(e.target.value) || null
                          const selectedSharing = partners.find(p => p.id === sharingId)
                          setFormData({
                            ...formData,
                            expense_sharing_id: sharingId,
                            ownership_percentage: selectedSharing
                              ? sharingPercentForKind(
                                  selectedSharing,
                                  Number(formData.amount) >= 0 ? 'revenue' : 'expense'
                                ).toString()
                              : '100.00'
                          })
                        }}
                        disabled={isLoading}
                        className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                        required
                      >
                        <option value={0}>Selecione um compartilhamento</option>
                        {partners.map(partner => (
                          <option key={partner.id} value={partner.id}>
                            {getPartnerLabel(partner)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <OwnershipPercentField
                      context="transaction"
                      value={formData.ownership_percentage}
                      onChange={(raw) =>
                        setFormData({ ...formData, ownership_percentage: maskPercentInput(raw) })
                      }
                      onBlur={handleOwnershipPercentageBlur}
                      disabled={isLoading}
                    />
                  </CadastroModalFieldsRow>
                ) : null}
              </CadastroModalFieldsGrid>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={onClose}
            onSave={() => {
              const form = document.getElementById('manual-transaction-form') as HTMLFormElement | null
              form?.requestSubmit()
            }}
            saving={isLoading}
            disabled={isLoading}
            saveLabel="Criar Lançamento"
          />
        </form>
      </CadastroModalShell>

      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}

      {showClosedPeriodDialog && closedPeriodInfo && (
        <CadastroModalShell
          maxWidth="max-w-md"
          zClass="z-[110]"
          onBackdropClick={() => {
            setShowClosedPeriodDialog(false)
            setClosedPeriodInfo(null)
          }}
        >
          <CadastroModalHeader
            isEdit={false}
            title="Período Fechado"
            subtitle="A data selecionada está em um período já fechado"
            onClose={() => {
              setShowClosedPeriodDialog(false)
              setClosedPeriodInfo(null)
            }}
            icon={<AlertTriangle size={18} />}
            iconStyle={{ backgroundColor: 'var(--color-warning)', color: 'var(--on-color-warning)' }}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Fechamento" icon={<Lock size={14} />}>
              <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                <p className="font-medium">
                  Fechamento de {closedPeriodInfo.closure_month && getMonthName(closedPeriodInfo.closure_month)}/{closedPeriodInfo.closure_year}
                </p>
                <p>
                  Status:{' '}
                  {closedPeriodInfo.is_settled ? (
                    <span className="font-medium text-green-600 dark:text-green-400">Quitado</span>
                  ) : (
                    <span className="font-medium text-orange-600 dark:text-orange-400">Pendente</span>
                  )}
                </p>
                {closedPeriodInfo.next_open_date ? (
                  <p className="text-gray-600 dark:text-gray-400">
                    Próxima data disponível:{' '}
                    <span className="font-medium text-gray-900 dark:text-white">
                      {new Date(closedPeriodInfo.next_open_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                    </span>
                  </p>
                ) : null}
                <div>
                  <p className="mb-1 font-medium text-gray-900 dark:text-white">O que deseja fazer?</p>
                  <ul className="list-disc space-y-1 pl-5 text-gray-600 dark:text-gray-400">
                    <li>Alterar para a próxima data disponível</li>
                    <li>Reabrir o período fechado na tela de Balanço</li>
                  </ul>
                </div>
              </div>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={() => {
              setShowClosedPeriodDialog(false)
              setClosedPeriodInfo(null)
            }}
            onSave={closedPeriodInfo.next_open_date ? handleUseNextOpenDate : undefined}
            hideSave={!closedPeriodInfo.next_open_date}
            saveLabel="Usar Próxima Data"
          />
        </CadastroModalShell>
      )}
    </>
  )
}

export default ManualTransactionModal

