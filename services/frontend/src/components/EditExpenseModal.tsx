import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import '../styles/datepicker-custom.css'
import { X, Users, Edit2, FileText, Tag as TagIcon, CreditCard, Percent, Calendar } from 'lucide-react'
import Toast from './Toast'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { dateToLocalTimestamp } from '../utils/dateUtils'

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

interface Tag {
  id: number
  name: string
  description: string | null
  type: string
  active: boolean
}

interface Subtag {
  id: number
  name: string
  tag_id: number
  tag_name: string
  tag_type: string  // "receita" ou "despesa"
}

interface Card {
  id: number
  owner: string
  description: string | null
  number: string
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

interface Partner {
  id: number
  account_id: number
  shared_account_id: number
  my_contribution_percentage: number
  description: string | null
  active: boolean
  shared_account: Account | null
}

interface EditExpenseModalProps {
  isOpen: boolean
  onClose: () => void
  expense: {
    id: number
    source: 'bank' | 'card' | 'benefit'
    description: string
    amount: number
    date: string
    subtag_id: number | null
    subtag_name: string | null
    category: string | null
    card_number: string | null
    ownership_percentage: number | null
    shared_partner_id: number | null
  } | null
  onSuccess: () => void
  /** Modo simplificado: exibe apenas tag/subtag e compartilhamento */
  limitedMode?: boolean
}

const EditExpenseModal = ({ isOpen, onClose, expense, onSuccess, limitedMode = false }: EditExpenseModalProps) => {
  const [tags, setTags] = useState<Tag[]>([])
  const [subtags, setSubtags] = useState<Subtag[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(false) // ✅ Flag para controlar carregamento inicial
  const [isInitialized, setIsInitialized] = useState(false) // ✅ Flag para prevenir submissão prematura
  const hasLoadedDataRef = useRef(false) // ✅ Rastreia se já carregou dados para este expense
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })

  // Hook para fechar modal com ESC
  useEscapeKey(onClose, isOpen)

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  // Hook para submeter com Enter (apenas dentro do modal)
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const target = e.target as HTMLElement

        // NÃO submeter se ainda não foi inicializado
        if (!isInitialized) {
          return
        }

        // Verificar se o target está dentro do modal
        const modalElement = document.querySelector('[data-modal="edit-expense"]')
        if (!modalElement || !modalElement.contains(target)) {
          return
        }

        // Não submeter em TEXTAREA, SELECT ou BUTTON
        if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.tagName === 'BUTTON') {
          return
        }

        e.preventDefault()
        const form = modalElement.querySelector('form')
        if (form) {
          form.requestSubmit()
        }
      }
    }

    // ✅ Adicionar um pequeno delay para evitar submissão imediata ao abrir o modal
    const timeoutId = setTimeout(() => {
      window.addEventListener('keydown', handleKeyDown)
    }, 300)

    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, isInitialized, isLoadingData]) // ✅ Adicionar isInitialized como dependência

  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    tag_id: 0,
    subtag_id: 0,
    card_number: '',
    adjustment_type: 'proprio' as 'proprio' | 'compartilhado',
    shared_partner_id: null as number | null,
    ownership_percentage: '100.00'
  })

  // Carrega dados quando o modal abre
  useEffect(() => {
    if (isOpen && expense) {
      // ✅ SEMPRE resetar flags ao abrir/trocar de expense
      setIsLoadingData(true)
      setIsInitialized(false)
      hasLoadedDataRef.current = false // ✅ Resetar flag de carregamento
      // ✅ Resetar toast ao abrir o modal (evita que toast anterior apareça)
      setToast({ show: false, message: '', type: 'success' })

      const loadAllData = async () => {
        try {
          await Promise.all([
            loadTags(),
            loadSubtags(),
            loadPartners(),
            expense.source === 'card' || expense.source === 'benefit' ? loadCards() : Promise.resolve()
          ])
          hasLoadedDataRef.current = true // ✅ Marcar que os dados foram carregados
        } finally {
          setIsLoadingData(false)
        }
      }

      loadAllData()
    } else if (!isOpen) {
      // ✅ Resetar flags quando o modal fechar
      setIsLoadingData(false)
      setIsInitialized(false)
      hasLoadedDataRef.current = false
      // ✅ Resetar toast ao fechar o modal
      setToast({ show: false, message: '', type: 'success' })
    }
  }, [isOpen, expense?.id]) // ✅ Usar expense?.id ao invés de expense para detectar mudanças

  // Inicializa o formulário quando os dados estão carregados
  useEffect(() => {
    // SÓ inicializar se os dados JÁ foram carregados (hasLoadedDataRef.current === true)
    if (isOpen && expense && subtags.length > 0 && !isLoadingData && hasLoadedDataRef.current) {
      // Encontrar a tag_id da subtag selecionada
      const selectedSubtag = subtags.find(st => st.id === expense.subtag_id)

      // Definir a data do expense
      setSelectedDate(new Date(expense.date))

      // Determinar se é compartilhado baseado nos dados do expense
      const isShared = expense.shared_partner_id !== null && expense.shared_partner_id !== undefined
      const adjustmentType = isShared ? 'compartilhado' : 'proprio'

      setFormData({
        description: expense.description,
        amount: typeof expense.amount === 'number' ? expense.amount.toFixed(2) : String(expense.amount),
        tag_id: selectedSubtag?.tag_id || 0,
        subtag_id: expense.subtag_id || 0,
        card_number: expense.card_number || '',
        adjustment_type: adjustmentType,
        shared_partner_id: expense.shared_partner_id || null,
        ownership_percentage: expense.ownership_percentage?.toString() || '100.00'
      })

      // Marcar como inicializado após carregar todos os dados
      const currentExpenseId = expense.id
      const timeoutId = setTimeout(() => {
        if (isOpen && expense?.id === currentExpenseId && !isLoadingData) {
          setIsInitialized(true)
        }
      }, 600)

      return () => {
        clearTimeout(timeoutId)
      }
    } else if (!isLoadingData) {
      // Só resetar isInitialized quando NÃO estiver carregando
      setIsInitialized(false)
    }
  }, [isOpen, expense?.id, subtags.length, isLoadingData]) // ✅ Usar valores primitivos ao invés de objetos

  const loadTags = async () => {
    try {
      const response = await axios.get('/api/expenses/tags')
      setTags(response.data)
    } catch (error) {
      console.error('Erro ao carregar tags:', error)
    }
  }

  const loadSubtags = async () => {
    try {
      const response = await axios.get('/api/reports/subtags')
      setSubtags(response.data)
    } catch (error) {
      console.error('Erro ao carregar subtags:', error)
    }
  }

  const loadCards = async () => {
    try {
      const response = await axios.get('/api/cartoes')
      setCards(response.data)
    } catch (error) {
      console.error('Erro ao carregar cartões:', error)
    }
  }

  const loadPartners = async () => {
    try {
      const response = await axios.get('/api/expense-sharing')
      const sorted = [...response.data].sort((a: Partner, b: Partner) =>
        getPartnerLabel(a).localeCompare(getPartnerLabel(b), 'pt-BR')
      )
      setPartners(sorted)
    } catch (error) {
      console.error('Erro ao carregar parceiros:', error)
    }
  }

  const getPartnerLabel = (partner: Partner): string => {
    const parts: string[] = []

    // Nome da conta compartilhada
    const accountName = partner.shared_account?.name || partner.shared_account?.description
    if (accountName) {
      parts.push(accountName)
    }

    // Banco
    if (partner.shared_account?.bank?.name) {
      parts.push(partner.shared_account.bank.name)
    }

    // Agência
    if (partner.shared_account?.agency) {
      parts.push(`Ag: ${partner.shared_account.agency}`)
    }

    // Número da conta
    if (partner.shared_account?.account_number) {
      parts.push(`Conta: ${partner.shared_account.account_number}`)
    }

    return parts.length > 0 ? parts.join(' • ') : 'Sem informações'
  }

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value

    // Permite: números, sinal negativo no início, e um ponto decimal
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

    // Permite: números positivos e um ponto decimal
    const regex = /^\d*\.?\d*$/

    if (value === '' || regex.test(value)) {
      setFormData({ ...formData, ownership_percentage: value })
    }
  }

  const handleOwnershipPercentageBlur = () => {
    if (formData.ownership_percentage) {
      const numValue = parseFloat(formData.ownership_percentage)
      if (!isNaN(numValue)) {
        // Limita entre 0 e 100
        const clampedValue = Math.min(Math.max(numValue, 0), 100)
        setFormData({ ...formData, ownership_percentage: clampedValue.toFixed(2) })
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Prevenir submissão se o modal ainda não foi inicializado
    if (!isInitialized) {
      return
    }

    if (!expense) {
      return
    }

    // Validação de valor (apenas no modo completo)
    const amount = parseFloat(formData.amount)
    if (!limitedMode && (isNaN(amount) || amount === 0)) {
      showToast('Digite um valor válido (diferente de zero)', 'error')
      return
    }

    // Validação de porcentagem
    const percentage = parseFloat(formData.ownership_percentage)
    if (formData.shared_partner_id && (isNaN(percentage) || percentage < 0 || percentage > 100)) {
      showToast('A porcentagem deve estar entre 0 e 100', 'warning')
      return
    }

    try {
      setIsLoading(true)
      const endpoint = expense.source === 'bank'
        ? `/api/expenses/bank-statements/${expense.id}`
        : `/api/expenses/credit-card-invoices/${expense.id}`

      // No modo limitado, preserva os valores originais de descrição, amount e data
      const payload: any = {
        description: limitedMode ? expense.description : formData.description,
        amount: limitedMode ? expense.amount : amount,
        date: limitedMode ? expense.date : dateToLocalTimestamp(selectedDate),
        subtag_id: formData.subtag_id || null,
        shared_partner_id: formData.shared_partner_id,
        ownership_percentage: formData.shared_partner_id ? parseFloat(formData.ownership_percentage) : null
      }

      // Adiciona card_number apenas para faturas de cartão
      if (expense.source === 'card') {
        payload.card_number = limitedMode ? expense.card_number : formData.card_number
      }

      await axios.put(endpoint, payload)

      showToast('Despesa atualizada com sucesso!', 'success')

      setTimeout(() => {
        onSuccess()
        onClose()
      }, 1500)
    } catch (error: any) {
      console.error('Erro ao atualizar despesa:', error)
      showToast(
        error.response?.data?.detail || 'Erro ao atualizar despesa. Tente novamente.',
        'error'
      )
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen || !expense) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div data-modal="edit-expense" className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto relative">
        {/* ✅ Loading overlay cobrindo todo o modal */}
        {isLoadingData && (
          <div className="absolute inset-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm z-50 rounded-lg flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mx-auto mb-3"></div>
              <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Carregando dados...</p>
            </div>
          </div>
        )}
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--crud-edit)', color: 'white' }}>
              <Edit2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Editar Despesa
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Atualize as informações da transação
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
          {/* Data e Hora — oculto no modo limitado */}
          {!limitedMode && (
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
          )}

          {/* Descrição — oculto no modo limitado */}
          {!limitedMode && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <FileText size={16} />
                Descrição *
              </label>
              <input
                type="text"
                required
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                disabled={isLoading}
                placeholder="Ex: Almoço Restaurante X"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              />
            </div>
          )}

          {/* Valor — oculto no modo limitado */}
          {!limitedMode && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <span className="text-sm font-bold">R$</span>
                Valor *
              </label>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 font-semibold ${
                  parseFloat(formData.amount) < 0
                    ? 'text-red-600 dark:text-red-400'
                    : parseFloat(formData.amount) > 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-gray-500 dark:text-gray-400'
                }`}>
                  R$
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={formData.amount}
                  onChange={handleAmountChange}
                  onBlur={handleAmountBlur}
                  disabled={isLoading}
                  placeholder="0.00"
                  className={`w-full pl-12 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 font-semibold focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 ${
                    parseFloat(formData.amount) < 0
                      ? 'text-red-600 dark:text-red-400'
                      : parseFloat(formData.amount) > 0
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-gray-900 dark:text-white'
                  }`}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Use valores negativos para despesas e positivos para receitas
              </p>
            </div>
          )}

          {/* Cartão (apenas para faturas de cartão, oculto no modo limitado) */}
          {expense?.source === 'card' && !limitedMode && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <CreditCard size={16} />
                Cartão *
              </label>
              <select
                required
                value={formData.card_number}
                onChange={(e) => setFormData({ ...formData, card_number: e.target.value })}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              >
                <option value="">Selecione um cartão...</option>
                {cards.map(card => (
                  <option key={card.id} value={card.number}>
                    {card.owner} - {card.number} {card.description ? `(${card.description})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Tag e Subtag */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Tag */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <TagIcon size={16} />
                Tag
              </label>
              <select
                value={formData.tag_id || ''}
                onChange={(e) => {
                  const newTagId = parseInt(e.target.value) || 0
                  setFormData({ ...formData, tag_id: newTagId, subtag_id: 0 })
                }}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              >
                <option value="">Selecione uma tag...</option>
                {tags.map(tag => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Subtag */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <TagIcon size={16} />
                Subtag
              </label>
              <select
                value={formData.subtag_id || ''}
                onChange={(e) => setFormData({ ...formData, subtag_id: parseInt(e.target.value) || 0 })}
                disabled={isLoading || !formData.tag_id}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
              >
                <option value="">
                  {formData.tag_id === 0 ? 'Selecione uma tag primeiro' : 'Selecione uma subtag...'}
                </option>
                {subtags
                  .filter(subtag => {
                    // Filtra por tag_id
                    if (subtag.tag_id !== formData.tag_id) return false
                    // Filtra por tipo baseado no valor (negativo = despesa, positivo = receita)
                    // Usa formData.amount se disponível, senão usa expense.amount
                    const amountStr = formData.amount || ''
                    const amount = amountStr !== '' ? parseFloat(amountStr) : (expense?.amount || 0)
                    const expectedType = amount < 0 ? 'despesa' : 'receita'
                    return subtag.tag_type === expectedType
                  })
                  .map(subtag => (
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
                    adjustment_type: e.target.value as any,
                    shared_partner_id: null,
                    ownership_percentage: '100.00'
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
                  value={formData.shared_partner_id || 0}
                  onChange={(e) => {
                    const partnerId = Number(e.target.value) || null
                    const selectedPartner = partners.find(p => p.id === partnerId)
                    setFormData({
                      ...formData,
                      shared_partner_id: partnerId,
                      ownership_percentage: selectedPartner ? selectedPartner.my_contribution_percentage.toString() : '100.00'
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

          {/* Informações adicionais (apenas se houver categoria original) */}
          {expense.category && (
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Categoria Original:</span>
                  <span className="text-gray-900 dark:text-white">{expense.category}</span>
                </div>
              </div>
            </div>
          )}

          {/* Botões */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 px-4 py-2.5 rounded-lg text-white font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: 'var(--crud-cancel)' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 px-4 py-2.5 text-white font-medium rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              style={{ backgroundColor: 'var(--crud-edit)' }}
            >
              {isLoading ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>

      {/* Toast de notificações */}
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}
    </div>
  )
}

export default EditExpenseModal

