import { useState, useEffect } from 'react'
import axios from 'axios'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import '../styles/datepicker-custom.css'
import { X, Calendar, DollarSign, Tag, Users, Percent, FileText, Save, AlertTriangle, Lock } from 'lucide-react'
import Toast from './Toast'
import { useAlert } from '../hooks/useAlert'
import { dateToLocalString, dateToLocalTimestamp } from '../utils/dateUtils'

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
  description: string | null
  active: boolean
  shared_account: Account | null
}

interface ManualTransactionModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const ManualTransactionModal = ({ isOpen, onClose, onSuccess }: ManualTransactionModalProps) => {
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
      loadData()
      resetForm()
    }
  }, [isOpen])

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
          const form = document.querySelector('form')
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
      const [verifyRes, tagsRes, subtagsRes, partnersRes] = await Promise.all([
        axios.get('/api/auth/verify'),
        axios.get('/api/expenses/tags'),
        axios.get('/api/expenses/subtags'),
        axios.get('/api/expense-sharing/')
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
    } catch (error) {
      console.error('Erro ao carregar dados:', error)
      showError('Erro', 'Erro ao carregar dados do formulário')
    }
  }

  const resetForm = () => {
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

  const handleOwnershipPercentageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value

    // Permite: números positivos, um ponto decimal, e no máximo 2 casas decimais
    const regex = /^\d{0,3}(\.\d{0,2})?$/

    if (value === '' || regex.test(value)) {
      // Se o valor for maior que 100, limita a 100
      const numValue = parseFloat(value)
      if (!isNaN(numValue) && numValue > 100) {
        setFormData({ ...formData, ownership_percentage: '100.00' })
      } else {
        setFormData({ ...formData, ownership_percentage: value })
      }
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

  const getPartnerLabel = (partner: SharedPartner): string => {
    if (!partner.shared_account) {
      return `Conta #${partner.shared_account_id}`
    }

    const parts: string[] = []

    // Nome da conta
    if (partner.shared_account.name?.trim()) {
      parts.push(partner.shared_account.name.trim())
    }

    // Banco
    if (partner.shared_account.bank?.name?.trim()) {
      parts.push(partner.shared_account.bank.name.trim())
    }

    // Agência
    if (partner.shared_account.agency) {
      parts.push(`Ag: ${partner.shared_account.agency}`)
    }

    // Número da conta
    if (partner.shared_account.account_number?.trim()) {
      parts.push(`Cc: ${partner.shared_account.account_number.trim()}`)
    }

    // Se não tem nenhuma informação, mostra o ID
    return parts.length > 0 ? parts.join(' • ') : `Conta #${partner.shared_account_id}`
  }

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
      const payload = {
        account_id: accountId,
        date: dateToLocalTimestamp(transactionDate),  // ✅ Usa timezone local (GMT-3) ao invés de UTC
        description: formData.description.trim(),
        amount: amount,
        subtag_id: formData.subtag_id === 0 ? null : formData.subtag_id,  // null se não selecionado
        expense_sharing_id: formData.adjustment_type === 'compartilhado' ? formData.expense_sharing_id : null,
        ownership_percentage: parseFloat(formData.ownership_percentage),
        adjustment_notes: formData.adjustment_notes.trim() || null,
        create_mapping: formData.create_mapping
      }

      const response = await axios.post('/api/expenses/bank-statements/manual', payload)

      // Atualiza os dados na tela principal
      onSuccess()

      // Limpa o formulário para um possível novo lançamento
      resetForm()

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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-1)', color: 'var(--on-color-1)' }}>
              <DollarSign className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Novo Lançamento Manual
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Crie uma transação manualmente
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Grid 2 colunas - Data e Valor */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Data */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Calendar size={16} />
                Data e Hora *
              </label>
              <DatePicker
                selected={selectedDate}
                onChange={(date: Date | null) => setSelectedDate(date || new Date())}
                showTimeSelect
                timeFormat="HH:mm"
                timeIntervals={15}
                dateFormat="dd/MM/yyyy HH:mm"
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                required
              />
            </div>

            {/* Valor */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <DollarSign size={16} />
                Valor * {transactionType && (
                  <span className={`text-xs font-semibold ${amountColor}`}>
                    ({transactionType === 'receita' ? 'Receita' : 'Despesa'})
                  </span>
                )}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 font-semibold">
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
                  className={`w-full pl-12 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 ${amountColor} font-semibold focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50`}
                  required
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Use valores negativos para despesas e positivos para receitas
              </p>
            </div>
          </div>

          {/* Descrição */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <FileText size={16} />
              Descrição *
            </label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              disabled={isLoading}
              placeholder="Ex: Almoço Restaurante X"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              required
            />
          </div>

          {/* Tag e Subtag */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Tag */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Tag size={16} />
                Tag
              </label>
              <select
                value={formData.tag_id}
                onChange={(e) => setFormData({ ...formData, tag_id: Number(e.target.value), subtag_id: 0 })}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              >
                <option value={0}>Selecione uma tag...</option>
                {getFilteredTags().map(tag => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Subtag */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Tag size={16} />
                Subtag
              </label>
              <select
                value={formData.subtag_id}
                onChange={(e) => setFormData({ ...formData, subtag_id: Number(e.target.value) })}
                disabled={isLoading || formData.tag_id === 0 || !transactionType}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
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
            </div>
          </div>

          {/* Tipo de Ajuste */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <Users size={16} />
              Tipo de Ajuste
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
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
                  className="text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Próprio</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="compartilhado"
                  checked={formData.adjustment_type === 'compartilhado'}
                  onChange={(e) => setFormData({
                    ...formData,
                    adjustment_type: e.target.value as any
                  })}
                  disabled={isLoading}
                  className="text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Compartilhado</span>
              </label>
            </div>
          </div>

          {/* Parceiro Compartilhado (condicional) */}
          {formData.adjustment_type === 'compartilhado' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Users size={16} />
                  Compartilhamento *
                </label>
                <select
                  value={formData.expense_sharing_id || 0}
                  onChange={(e) => {
                    const sharingId = Number(e.target.value) || null
                    const selectedSharing = partners.find(p => p.id === sharingId)
                    setFormData({
                      ...formData,
                      expense_sharing_id: sharingId,
                      ownership_percentage: selectedSharing ? selectedSharing.my_contribution_percentage.toString() : '100.00'
                    })
                  }}
                  disabled={isLoading}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                  required
                >
                  <option value={0}>Selecione um compartilhamento</option>
                  {partners.map(partner => (
                    <option key={partner.id} value={partner.id}>
                      {getPartnerLabel(partner)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Percent size={16} />
                  Minha Contribuição (%)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formData.ownership_percentage}
                  onChange={handleOwnershipPercentageChange}
                  onBlur={handleOwnershipPercentageBlur}
                  disabled={isLoading}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                />
              </div>
            </div>
          )}

          {/* Observações */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <FileText size={16} />
              Observações
            </label>
            <textarea
              value={formData.adjustment_notes}
              onChange={(e) => setFormData({ ...formData, adjustment_notes: e.target.value })}
              disabled={isLoading}
              placeholder="Notas adicionais sobre esta transação..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 resize-none"
            />
          </div>

          {/* Criar Mapeamento */}
          <div className={`border rounded-lg p-4 ${formData.subtag_id === 0 ? 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'}`}>
            <label className={`flex items-start gap-3 ${formData.subtag_id === 0 ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={formData.create_mapping}
                onChange={(e) => setFormData({ ...formData, create_mapping: e.target.checked })}
                disabled={isLoading || formData.subtag_id === 0}
                className="mt-1 text-blue-600 focus:ring-blue-500 rounded disabled:cursor-not-allowed"
              />
              <div>
                <span className={`text-sm font-medium ${formData.subtag_id === 0 ? 'text-gray-500 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>
                  Criar mapeamento automático
                </span>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {formData.subtag_id === 0
                    ? 'Selecione uma subtag para habilitar o mapeamento automático'
                    : 'Salva esta descrição para categorização automática futura (correspondência exata)'
                  }
                </p>
              </div>
            </label>
          </div>

          {/* Botões */}
          <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 px-4 py-2 rounded-lg text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: 'var(--crud-cancel)' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              style={{ backgroundColor: 'var(--crud-create)' }}
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                  Salvando...
                </>
              ) : (
                <>
                  <Save size={16} />
                  Criar Lançamento
                </>
              )}
            </button>
          </div>
        </form>

        {/* Toast */}
        {toast.show && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast({ ...toast, show: false })}
          />
        )}
      </div>

      {/* Dialog de Período Fechado */}
      {showClosedPeriodDialog && closedPeriodInfo && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-yellow-100 dark:bg-yellow-900/30">
                  <AlertTriangle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    Período Fechado
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    A data selecionada está em um período já fechado
                  </p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Lock className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                  <div className="text-sm text-yellow-800 dark:text-yellow-200">
                    <p className="font-medium mb-1">
                      Fechamento de {closedPeriodInfo.closure_month && getMonthName(closedPeriodInfo.closure_month)}/{closedPeriodInfo.closure_year}
                    </p>
                    <p>
                      Status: {closedPeriodInfo.is_settled ? (
                        <span className="text-green-600 dark:text-green-400 font-medium">Quitado</span>
                      ) : (
                        <span className="text-orange-600 dark:text-orange-400 font-medium">Pendente</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {closedPeriodInfo.next_open_date && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Próxima data disponível: <span className="font-medium text-gray-900 dark:text-white">
                    {new Date(closedPeriodInfo.next_open_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                  </span>
                </p>
              )}

              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400">
                <p className="font-medium text-gray-900 dark:text-white mb-2">O que deseja fazer?</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Alterar para a próxima data disponível</li>
                  <li>Reabrir o período fechado na tela de Balanço</li>
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowClosedPeriodDialog(false)
                  setClosedPeriodInfo(null)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              {closedPeriodInfo.next_open_date && (
                <button
                  type="button"
                  onClick={handleUseNextOpenDate}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
                  style={{ backgroundColor: 'var(--color-1)' }}
                >
                  Usar Próxima Data
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ManualTransactionModal

