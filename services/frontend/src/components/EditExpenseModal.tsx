import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { Users, Edit2, Tag as TagIcon, Calendar } from 'lucide-react'
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
import { useEscapeKey } from '../hooks/useEscapeKey'
import { dateToLocalString, dateToLocalTimestamp, parseLocalDateTime } from '../utils/dateUtils'
import { validateAccountPeriodDate } from '../services/accountPeriodClosuresApi'
import { sharingPartnerLabel, sharingPercentForKind } from '../utils/accountFormatter'
import OwnershipPercentField from './OwnershipPercentField'
import { maskPercentInput, finalizePercentInput } from '../utils/percentInput'

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
  revenue_contribution_percentage?: number
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
    current_installment?: number | null
    total_installments?: number | null
  } | null
  onSuccess: () => void
  /** Modo simplificado: exibe apenas tag/subtag e compartilhamento */
  limitedMode?: boolean
  /** Faturas: edita valor, data, descrição e parcelas (cartão fixo) */
  invoiceItemMode?: boolean
}

function parseAmountInput(raw: string): number {
  const normalized = raw.trim().replace(',', '.')
  if (normalized === '' || normalized === '-' || normalized === '.' || normalized === '-.') {
    return NaN
  }
  return parseFloat(normalized)
}

const EditExpenseModal = ({
  isOpen,
  onClose,
  expense,
  onSuccess,
  limitedMode = false,
  invoiceItemMode = false,
}: EditExpenseModalProps) => {
  const showCoreFields = !limitedMode || invoiceItemMode
  const lockCoreFields = limitedMode && !invoiceItemMode
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

        const form = document.getElementById('edit-expense-form')
        if (!form || !form.contains(target)) {
          return
        }

        // Não submeter em TEXTAREA, SELECT ou BUTTON
        if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.tagName === 'BUTTON') {
          return
        }

        e.preventDefault()
        if (form instanceof HTMLFormElement) {
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
    ownership_percentage: '100.00',
    current_installment: '',
    total_installments: '',
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
        ownership_percentage: expense.ownership_percentage?.toString() || '100.00',
        current_installment:
          expense.current_installment != null ? String(expense.current_installment) : '',
        total_installments:
          expense.total_installments != null ? String(expense.total_installments) : '',
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

  const getPartnerLabel = (partner: Partner): string => sharingPartnerLabel(partner)

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value

    // Permite: números, sinal negativo no início, e um ponto decimal
    const regex = /^-?\d*[.,]?\d*$/

    if (value === '' || regex.test(value)) {
      const numValue = parseAmountInput(value)
      if (!isNaN(numValue) && Math.abs(numValue) > 99999999.99) {
        return // Não atualiza se exceder o limite
      }
      setFormData({ ...formData, amount: value })
    }
  }

  const handleAmountBlur = () => {
    const amount = parseAmountInput(formData.amount)
    if (!isNaN(amount)) {
      setFormData({ ...formData, amount: amount.toFixed(2) })
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
    const amount = parseAmountInput(formData.amount)
    if (showCoreFields && (isNaN(amount) || amount === 0)) {
      showToast('Digite um valor válido (diferente de zero)', 'error')
      return
    }

    let currentInstallment: number | null = null
    let totalInstallments: number | null = null
    if (invoiceItemMode && expense.source === 'card') {
      const curRaw = formData.current_installment.trim()
      const totRaw = formData.total_installments.trim()
      const hasCur = curRaw.length > 0
      const hasTot = totRaw.length > 0
      if (hasCur !== hasTot) {
        showToast('Informe parcela atual e total, ou deixe ambos vazios', 'error')
        return
      }
      if (hasCur && hasTot) {
        currentInstallment = parseInt(curRaw, 10)
        totalInstallments = parseInt(totRaw, 10)
        if (
          isNaN(currentInstallment) ||
          isNaN(totalInstallments) ||
          currentInstallment < 1 ||
          totalInstallments < 1 ||
          currentInstallment > totalInstallments
        ) {
          showToast('Parcelas inválidas', 'error')
          return
        }
      }
    }

    // Validação de porcentagem
    const percentage = parseFloat(formData.ownership_percentage)
    if (formData.shared_partner_id && (isNaN(percentage) || percentage < 0 || percentage > 100)) {
      showToast('A porcentagem deve estar entre 0 e 100', 'warning')
      return
    }

    if (expense.source === 'bank') {
      const datesToCheck = [expense.date.slice(0, 10)]
      if (showCoreFields) {
        datesToCheck.push(dateToLocalString(selectedDate))
      }
      for (const dateValue of [...new Set(datesToCheck)]) {
        try {
          const validation = await validateAccountPeriodDate(dateValue)
          if (validation.is_closed) {
            showToast(validation.message || 'Este mês da conta já está fechado.', 'warning')
            return
          }
        } catch (error) {
          console.error('Erro ao validar mês fechado da conta:', error)
        }
      }
    }

    try {
      setIsLoading(true)
      const endpoint = expense.source === 'bank'
        ? `/api/expenses/bank-statements/${expense.id}`
        : `/api/expenses/credit-card-invoices/${expense.id}`

      // No modo limitado, preserva os valores originais de descrição, amount e data
      const payload: Record<string, unknown> = {
        description: lockCoreFields ? expense.description : formData.description.trim(),
        amount: lockCoreFields ? expense.amount : amount,
        date: lockCoreFields ? expense.date : dateToLocalTimestamp(selectedDate),
        subtag_id: formData.subtag_id || null,
        shared_partner_id: formData.shared_partner_id,
        ownership_percentage: formData.shared_partner_id ? parseFloat(formData.ownership_percentage) : null,
      }

      if (expense.source === 'card') {
        payload.card_number = invoiceItemMode || lockCoreFields ? expense.card_number : formData.card_number
        if (invoiceItemMode) {
          payload.current_installment = currentInstallment
          payload.total_installments = totalInstallments
        }
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
    <>
      <CadastroModalShell maxWidth="max-w-3xl" onBackdropClick={onClose}>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {isLoadingData && (
          <div className="absolute inset-0 z-50 flex items-center justify-center rounded-xl bg-white/80 backdrop-blur-sm dark:bg-gray-800/80">
            <div className="text-center">
              <div className="mx-auto mb-3 h-12 w-12 animate-spin rounded-full border-4 border-[var(--color-1)] border-t-transparent"></div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Carregando dados...</p>
            </div>
          </div>
        )}
        <CadastroModalHeader
          isEdit
          title="Editar Despesa"
          subtitle="Atualize as informações da transação"
          onClose={onClose}
          icon={<Edit2 size={18} />}
        />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" id="edit-expense-form">
          <CadastroModalBody>
            {showCoreFields && (
              <CadastroFormSection title="Identificação" icon={<Calendar size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow cols={2}>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>
                        {invoiceItemMode ? 'Data da compra' : 'Data e Hora'}
                      </CadastroFieldLabel>
                      <DateField
                        withTime={!invoiceItemMode}
                        value={
                          invoiceItemMode
                            ? dateToLocalString(selectedDate)
                            : dateToLocalTimestamp(selectedDate)
                        }
                        onChange={(value) => {
                          if (invoiceItemMode) {
                            const parsed = parseLocalDateTime(`${value}T12:00:00`)
                            if (parsed) setSelectedDate(parsed)
                          } else {
                            setSelectedDate(parseLocalDateTime(value) ?? new Date())
                          }
                        }}
                        disabled={isLoading}
                        className={`${cadastroFieldCls} mt-0.5`}
                      />
                    </label>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Valor</CadastroFieldLabel>
                      <div className="relative mt-0.5">
                        <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold ${
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
                          className={`${cadastroFieldCls} pl-10 font-semibold disabled:opacity-50 ${
                            parseFloat(formData.amount) < 0
                              ? 'text-red-600 dark:text-red-400'
                              : parseFloat(formData.amount) > 0
                                ? 'text-green-600 dark:text-green-400'
                                : ''
                          }`}
                        />
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {invoiceItemMode
                          ? 'Negativo = débito na fatura · Positivo = crédito/estorno'
                          : 'Use valores negativos para despesas e positivos para receitas'}
                      </p>
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Descrição</CadastroFieldLabel>
                      <input
                        type="text"
                        required
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        disabled={isLoading}
                        placeholder="Ex: Almoço Restaurante X"
                        className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                      />
                    </label>
                  </CadastroModalFieldsRow>
                  {expense?.source === 'card' && invoiceItemMode ? (
                    <CadastroModalFieldsRow cols={2}>
                      <label className="block min-w-0">
                        <CadastroFieldLabel>Parcela atual</CadastroFieldLabel>
                        <input
                          type="number"
                          min={1}
                          value={formData.current_installment}
                          onChange={(e) =>
                            setFormData({ ...formData, current_installment: e.target.value })
                          }
                          disabled={isLoading}
                          placeholder="Opcional"
                          className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                        />
                      </label>
                      <label className="block min-w-0">
                        <CadastroFieldLabel>Total parcelas</CadastroFieldLabel>
                        <input
                          type="number"
                          min={1}
                          value={formData.total_installments}
                          onChange={(e) =>
                            setFormData({ ...formData, total_installments: e.target.value })
                          }
                          disabled={isLoading}
                          placeholder="Opcional"
                          className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                        />
                      </label>
                    </CadastroModalFieldsRow>
                  ) : null}
                  {expense?.source === 'card' && !invoiceItemMode ? (
                    <CadastroModalFieldsRow>
                      <label className="block min-w-0">
                        <CadastroFieldLabel required>Cartão</CadastroFieldLabel>
                        <select
                          required
                          value={formData.card_number}
                          onChange={(e) => setFormData({ ...formData, card_number: e.target.value })}
                          disabled={isLoading}
                          className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                        >
                          <option value="">Selecione um cartão...</option>
                          {cards.map(card => (
                            <option key={card.id} value={card.number}>
                              {card.owner} - {card.number} {card.description ? `(${card.description})` : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    </CadastroModalFieldsRow>
                  ) : null}
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
            )}

            <CadastroFormSection title="Classificação" icon={<TagIcon size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow cols={2}>
                  <label className="block min-w-0">
                    <CadastroFieldLabel>Tag</CadastroFieldLabel>
                    <select
                      value={formData.tag_id || ''}
                      onChange={(e) => {
                        const newTagId = parseInt(e.target.value) || 0
                        setFormData({ ...formData, tag_id: newTagId, subtag_id: 0 })
                      }}
                      disabled={isLoading}
                      className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                    >
                      <option value="">Selecione uma tag...</option>
                      {tags.map(tag => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block min-w-0">
                    <CadastroFieldLabel>Subtag</CadastroFieldLabel>
                    <select
                      value={formData.subtag_id || ''}
                      onChange={(e) => setFormData({ ...formData, subtag_id: parseInt(e.target.value) || 0 })}
                      disabled={isLoading || !formData.tag_id}
                      className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                    >
                      <option value="">
                        {formData.tag_id === 0 ? 'Selecione uma tag primeiro' : 'Selecione uma subtag...'}
                      </option>
                      {subtags
                        .filter(subtag => {
                          if (subtag.tag_id !== formData.tag_id) return false
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
                  </label>
                </CadastroModalFieldsRow>
                {expense.category ? (
                  <CadastroModalFieldsRow>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Categoria original</span>
                      <span className="text-gray-900 dark:text-white">{expense.category}</span>
                    </div>
                  </CadastroModalFieldsRow>
                ) : null}
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
                          shared_partner_id: null,
                          ownership_percentage: '100.00'
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
                        value={formData.shared_partner_id || 0}
                        onChange={(e) => {
                          const partnerId = Number(e.target.value) || null
                          const selectedPartner = partners.find(p => p.id === partnerId)
                          setFormData({
                            ...formData,
                            shared_partner_id: partnerId,
                            ownership_percentage: selectedPartner
                              ? sharingPercentForKind(
                                  selectedPartner,
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
                      onBlur={() => {
                        const finalized = finalizePercentInput(formData.ownership_percentage)
                        if (finalized) {
                          const numValue = parseFloat(finalized)
                          if (!isNaN(numValue)) {
                            const clamped = Math.min(Math.max(numValue, 0), 100)
                            setFormData({ ...formData, ownership_percentage: clamped.toFixed(2) })
                          }
                        }
                      }}
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
              const form = document.getElementById('edit-expense-form') as HTMLFormElement | null
              form?.requestSubmit()
            }}
            saving={isLoading}
            disabled={isLoading}
            saveLabel="Salvar"
          />
        </form>
        </div>
      </CadastroModalShell>

      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}
    </>
  )
}

export default EditExpenseModal

