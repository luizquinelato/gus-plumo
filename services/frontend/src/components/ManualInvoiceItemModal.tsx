import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { CreditCard, Tag, Users, FileText, Receipt } from 'lucide-react'
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
import { dateToLocalString, dateToLocalTimestamp, parseLocalDateTime } from '../utils/dateUtils'
import { sharingPartnerLabel, sharingPercentForKind } from '../utils/accountFormatter'
import OwnershipPercentField from './OwnershipPercentField'
import { maskPercentInput, finalizePercentInput } from '../utils/percentInput'

interface TagOption {
  id: number
  name: string
  type: string
}

interface SubtagOption {
  id: number
  tag_id: number
  name: string
  type: string
  tag_name: string | null
}

interface SharedPartner {
  id: number
  my_contribution_percentage: number
  revenue_contribution_percentage?: number
  description: string | null
  shared_account?: { name?: string; description?: string } | null
}

export interface ManualInvoiceItemContext {
  cardId: number
  cardName: string
  cardNumber: string
  yearMonth: string
  /** Emissor já usado neste cartão (BTG / Mercado Pago). */
  issuer: 'btg' | 'mercadopago'
}

interface ManualInvoiceItemModalProps {
  isOpen: boolean
  context: ManualInvoiceItemContext | null
  onClose: () => void
  onSuccess: () => void
}

const ISSUER_LABEL: Record<'btg' | 'mercadopago', string> = {
  btg: 'BTG',
  mercadopago: 'Mercado Pago',
}

function parseAmountInput(raw: string): number {
  const normalized = raw.trim().replace(',', '.')
  if (normalized === '' || normalized === '-' || normalized === '.' || normalized === '-.') {
    return NaN
  }
  return parseFloat(normalized)
}

function formatYearMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-')
  const names = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const idx = parseInt(month, 10) - 1
  if (!year || idx < 0 || idx > 11) return yearMonth
  return `${names[idx]} ${year}`
}

const ManualInvoiceItemModal = ({ isOpen, context, onClose, onSuccess }: ManualInvoiceItemModalProps) => {
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
    show: false,
    message: '',
    type: 'success',
  })

  const [tags, setTags] = useState<TagOption[]>([])
  const [subtags, setSubtags] = useState<SubtagOption[]>([])
  const [partners, setPartners] = useState<SharedPartner[]>([])
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const suppressBackdropCloseRef = useRef(false)
  const contextKey = context ? `${context.cardId}:${context.yearMonth}` : ''

  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    tag_id: 0,
    subtag_id: 0,
    adjustment_type: 'proprio' as 'proprio' | 'compartilhado',
    expense_sharing_id: null as number | null,
    ownership_percentage: '100.00',
    current_installment: '',
    total_installments: '',
    adjustment_notes: '',
    create_mapping: false,
  })

  const resetForm = useCallback(() => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    setSelectedDate(today)
    setFormData({
      description: '',
      amount: '',
      tag_id: 0,
      subtag_id: 0,
      adjustment_type: 'proprio',
      expense_sharing_id: null,
      ownership_percentage: '100.00',
      current_installment: '',
      total_installments: '',
      adjustment_notes: '',
      create_mapping: false,
    })
  }, [])

  const applyCardDefaults = useCallback(async (cardId: number) => {
    try {
      const { data: card } = await axios.get(`/api/cartoes/${cardId}`)
      if (card.ownership_type === 'compartilhado' && card.expense_sharing_id) {
        setFormData((prev) => ({
          ...prev,
          adjustment_type: 'compartilhado',
          expense_sharing_id: card.expense_sharing_id,
          ownership_percentage: String(
            card.expense_ownership_percentage ?? card.revenue_ownership_percentage ?? 50,
          ),
        }))
      }
    } catch {
      /* mantém padrão próprio */
    }
  }, [])

  useEffect(() => {
    if (!isOpen || !context) return
    suppressBackdropCloseRef.current = true
    const unlockBackdrop = window.setTimeout(() => {
      suppressBackdropCloseRef.current = false
    }, 300)
    return () => window.clearTimeout(unlockBackdrop)
  }, [isOpen, contextKey])

  useEffect(() => {
    if (!isOpen || !context) return
    setLoadError(null)
    resetForm()
    const cardId = context.cardId
    let cancelled = false
    const load = async () => {
      try {
        const [tagsRes, subtagsRes, partnersRes] = await Promise.all([
          axios.get('/api/expenses/tags'),
          axios.get('/api/expenses/subtags'),
          axios.get('/api/expense-sharing/'),
        ])
        if (cancelled) return
        setTags(tagsRes.data)
        setSubtags(subtagsRes.data)
        setPartners(partnersRes.data)
        await applyCardDefaults(cardId)
      } catch {
        if (cancelled) return
        setLoadError('Não foi possível carregar tags e compartilhamentos. Feche e tente novamente.')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [isOpen, contextKey, resetForm, applyCardDefaults])

  const getTransactionType = (): 'receita' | 'despesa' | null => {
    const amount = parseAmountInput(formData.amount)
    if (isNaN(amount) || amount === 0) return null
    return amount > 0 ? 'receita' : 'despesa'
  }

  const getFilteredSubtags = (): SubtagOption[] => {
    const type = getTransactionType()
    if (!type || formData.tag_id === 0) return []
    return subtags.filter((s) => s.tag_id === formData.tag_id && s.type === type)
  }

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    const regex = /^-?\d*[.,]?\d*$/
    if (value === '' || regex.test(value)) {
      const numValue = parseAmountInput(value)
      if (!isNaN(numValue) && Math.abs(numValue) > 99999999.99) return
      setFormData((prev) => ({ ...prev, amount: value, subtag_id: 0 }))
    }
  }

  const handleAmountBlur = () => {
    const amount = parseAmountInput(formData.amount)
    if (!isNaN(amount)) {
      setFormData((prev) => ({ ...prev, amount: amount.toFixed(2) }))
    }
  }

  const handleSubmit = async () => {
    if (!context) return

    if (!formData.description.trim()) {
      setToast({ show: true, message: 'Digite uma descrição', type: 'error' })
      return
    }

    const amount = parseAmountInput(formData.amount)
    if (isNaN(amount) || amount === 0) {
      setToast({ show: true, message: 'Digite um valor válido (diferente de zero)', type: 'error' })
      return
    }

    const curRaw = formData.current_installment.trim()
    const totRaw = formData.total_installments.trim()
    const hasCur = curRaw.length > 0
    const hasTot = totRaw.length > 0
    if (hasCur !== hasTot) {
      setToast({ show: true, message: 'Informe parcela atual e total, ou deixe ambos vazios', type: 'error' })
      return
    }
    let currentInstallment: number | null = null
    let totalInstallments: number | null = null
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
        setToast({ show: true, message: 'Parcelas inválidas', type: 'error' })
        return
      }
    }

    if (formData.adjustment_type === 'compartilhado' && !formData.expense_sharing_id) {
      setToast({ show: true, message: 'Selecione um compartilhamento', type: 'error' })
      return
    }

    try {
      setIsLoading(true)
      const payload = {
        credit_card_id: context.cardId,
        year_month: context.yearMonth,
        date: dateToLocalTimestamp(selectedDate),
        description: formData.description.trim(),
        amount,
        subtag_id: formData.subtag_id === 0 ? null : formData.subtag_id,
        expense_sharing_id: formData.adjustment_type === 'compartilhado' ? formData.expense_sharing_id : null,
        ownership_percentage: parseFloat(formData.ownership_percentage),
        current_installment: currentInstallment,
        total_installments: totalInstallments,
        issuer: context.issuer,
        adjustment_notes: formData.adjustment_notes.trim() || null,
        create_mapping: formData.create_mapping,
      }

      await axios.post('/api/expenses/credit-card-invoices/manual', payload)
      onSuccess()
      resetForm()
      onClose()
    } catch (error: unknown) {
      const detail =
        axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
          ? error.response.data.detail
          : 'Erro ao salvar acerto. Tente novamente.'
      setToast({ show: true, message: detail, type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
        const target = e.target as HTMLElement
        if (target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT') {
          e.preventDefault()
          void handleSubmit()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isLoading, onClose])

  if (!isOpen || !context) return null

  const transactionType = getTransactionType()
  const amountColor =
    transactionType === 'receita'
      ? 'text-green-600 dark:text-green-400'
      : transactionType === 'despesa'
        ? 'text-red-600 dark:text-red-400'
        : 'text-gray-600 dark:text-gray-400'

  const cardLabel = `${context.cardName}${context.cardNumber ? ` •••• ${context.cardNumber.slice(-4)}` : ''}`

  return (
    <>
      <CadastroModalShell
        maxWidth="max-w-3xl"
        onBackdropClick={() => {
          if (suppressBackdropCloseRef.current) return
          onClose()
        }}
      >
        <CadastroModalHeader
          isEdit={false}
          title="Acerto manual na fatura"
          subtitle={
            <>
              {cardLabel} — fatura {formatYearMonthLabel(context.yearMonth)}
              <span className="ml-2 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                {ISSUER_LABEL[context.issuer]}
              </span>
            </>
          }
          onClose={onClose}
          icon={<Receipt size={18} />}
        />
        <CadastroModalBody>
          {loadError ? (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {loadError}
            </p>
          ) : null}
          <CadastroFormSection title="Lançamento" icon={<FileText size={14} />}>
            <CadastroModalFieldsGrid>
              <CadastroModalFieldsRow cols={2}>
                <label className="block min-w-0">
                  <CadastroFieldLabel required>Data da compra</CadastroFieldLabel>
                  <DateField
                    value={dateToLocalString(selectedDate)}
                    onChange={(value) => {
                      const parsed = parseLocalDateTime(`${value}T12:00:00`)
                      if (parsed) setSelectedDate(parsed)
                    }}
                    disabled={isLoading}
                    className={`${cadastroFieldCls} mt-0.5`}
                  />
                </label>
                <label className="block min-w-0">
                  <CadastroFieldLabel required>
                    Valor{' '}
                    {transactionType ? (
                      <span className={`font-semibold ${amountColor}`}>
                        ({transactionType === 'receita' ? 'Crédito' : 'Débito'})
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
                      placeholder="0,00"
                      className={`${cadastroFieldCls} pl-10 font-semibold disabled:opacity-50 ${amountColor}`}
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Negativo = débito na fatura · Positivo = crédito/estorno (como na importação)
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
                    placeholder="Ex.: Cancelamento - Magalu"
                    className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                  />
                </label>
              </CadastroModalFieldsRow>
              <CadastroModalFieldsRow cols={2}>
                <label className="block min-w-0">
                  <CadastroFieldLabel>Parcela atual</CadastroFieldLabel>
                  <input
                    type="number"
                    min={1}
                    value={formData.current_installment}
                    onChange={(e) => setFormData({ ...formData, current_installment: e.target.value })}
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
                    onChange={(e) => setFormData({ ...formData, total_installments: e.target.value })}
                    disabled={isLoading}
                    placeholder="Opcional"
                    className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
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
                    onChange={(e) =>
                      setFormData({ ...formData, tag_id: Number(e.target.value), subtag_id: 0 })
                    }
                    disabled={isLoading}
                    className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                  >
                    <option value={0}>Selecione...</option>
                    {tags.map((tag) => (
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
                      {!transactionType
                        ? 'Informe o valor primeiro'
                        : formData.tag_id === 0
                          ? 'Selecione uma tag'
                          : 'Selecione...'}
                    </option>
                    {getFilteredSubtags().map((subtag) => (
                      <option key={subtag.id} value={subtag.id}>
                        {subtag.name}
                      </option>
                    ))}
                  </select>
                </label>
              </CadastroModalFieldsRow>
              <CadastroModalFieldsRow>
                <label
                  className={`${cadastroOptionLabelCls} items-start ${formData.subtag_id === 0 ? 'opacity-60' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={formData.create_mapping}
                    onChange={(e) => setFormData({ ...formData, create_mapping: e.target.checked })}
                    disabled={isLoading || formData.subtag_id === 0}
                    className={`${cadastroAccentControlCls} mt-1 h-4 w-4`}
                  />
                  <span className="text-sm">Criar mapeamento automático (descrição exata)</span>
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
                      checked={formData.adjustment_type === 'proprio'}
                      onChange={() =>
                        setFormData({
                          ...formData,
                          adjustment_type: 'proprio',
                          expense_sharing_id: null,
                          ownership_percentage: '100.00',
                        })
                      }
                      disabled={isLoading}
                      className={cadastroAccentControlCls}
                    />
                    Próprio
                  </label>
                  <label className={cadastroOptionLabelCls}>
                    <input
                      type="radio"
                      checked={formData.adjustment_type === 'compartilhado'}
                      onChange={() => setFormData({ ...formData, adjustment_type: 'compartilhado' })}
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
                    <CadastroFieldLabel required>Parceiro</CadastroFieldLabel>
                    <select
                      value={formData.expense_sharing_id ?? 0}
                      onChange={(e) => {
                        const sharingId = Number(e.target.value) || null
                        const selected = partners.find((p) => p.id === sharingId)
                        setFormData({
                          ...formData,
                          expense_sharing_id: sharingId,
                          ownership_percentage: selected
                            ? String(
                                sharingPercentForKind(
                                  selected,
                                  transactionType === 'receita' ? 'revenue' : 'expense',
                                ),
                              )
                            : formData.ownership_percentage,
                        })
                      }}
                      disabled={isLoading}
                      className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                    >
                      <option value={0}>Selecione...</option>
                      {partners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {sharingPartnerLabel(p)}
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
                    onBlur={() =>
                      setFormData((prev) => ({
                        ...prev,
                        ownership_percentage: finalizePercentInput(prev.ownership_percentage) || '100.00',
                      }))
                    }
                    disabled={isLoading}
                  />
                </CadastroModalFieldsRow>
              ) : null}
              <CadastroModalFieldsRow>
                <label className="block min-w-0">
                  <CadastroFieldLabel>Observações</CadastroFieldLabel>
                  <input
                    type="text"
                    value={formData.adjustment_notes}
                    onChange={(e) => setFormData({ ...formData, adjustment_notes: e.target.value })}
                    disabled={isLoading}
                    placeholder="Padrão: Acerto manual"
                    className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                  />
                </label>
              </CadastroModalFieldsRow>
            </CadastroModalFieldsGrid>
          </CadastroFormSection>

          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
            <CreditCard size={12} />
            Emissor {ISSUER_LABEL[context.issuer]} (mesmo deste cartão). Gravado na fatura{' '}
            {context.yearMonth}, como na importação do PDF.
          </p>
        </CadastroModalBody>
        <CadastroModalFooter
          onClose={onClose}
          onSave={() => void handleSubmit()}
          saveLabel="Incluir na fatura"
          closeLabel="Cancelar"
          disabled={isLoading}
          saving={isLoading}
        />
      </CadastroModalShell>

      {toast.show ? (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast((t) => ({ ...t, show: false }))} />
      ) : null}
    </>
  )
}

export default ManualInvoiceItemModal
