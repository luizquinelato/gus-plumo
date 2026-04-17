import { useState, useEffect } from 'react'
import { X, GripVertical, AlertTriangle, ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import axios from 'axios'
import { formatSharedAccountDisplay } from '../utils/accountFormatter'
import { useAlert } from '../hooks/useAlert'
import type { ExpenseTemplate, ApplyTemplateRequest } from '../types/expenseTemplate'
import { dateToLocalString } from '../utils/dateUtils'

interface ClosedPeriodValidation {
  is_closed: boolean
  closure_id: number | null
  closure_year: number | null
  closure_month: number | null
  is_settled: boolean
  next_open_date: string | null
  message: string | null
}

interface ClosedPeriodItem {
  itemIndex: number
  description: string
  date: string
  validation: ClosedPeriodValidation
}

interface ApplyTemplateModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  template: ExpenseTemplate | null
}

interface Tag {
  id: number
  name: string
  description: string | null
  icon: string | null
}

interface Subtag {
  id: number
  name: string
  tag_id: number
  tag_name: string
  type: 'receita' | 'despesa'
}

interface Account {
  id: number
  name?: string
  description?: string
  bank?: {
    id: number
    code: string
    name: string
    full_name?: string
  }
  agency?: string
  account_number?: string
}

interface ExpenseSharingSetting {
  id: number
  account_id: number
  shared_account_id: number
  my_contribution_percentage: number
  description: string | null
  active: boolean
  shared_account?: Account
}

interface EditableItem {
  template_item_id: number
  date: string
  description: string
  amount: string
  tag_id: number
  subtag_id: number
  ownership_percentage: string
  expense_sharing_id: number | null
}

const ApplyTemplateModal = ({ isOpen, onClose, onSuccess, template }: ApplyTemplateModalProps) => {
  const { showError, showSuccess } = useAlert()
  const [items, setItems] = useState<EditableItem[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [subtags, setSubtags] = useState<Subtag[]>([])
  const [sharings, setSharings] = useState<ExpenseSharingSetting[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Estados para validação de período fechado
  const [closedPeriodItems, setClosedPeriodItems] = useState<ClosedPeriodItem[]>([])
  const [showClosedPeriodDialog, setShowClosedPeriodDialog] = useState(false)

  useEffect(() => {
    if (isOpen && template) {
      loadData()
      initializeItems()
    }
  }, [isOpen, template])

  const loadData = async () => {
    try {
      setIsLoading(true)
      const [tagsRes, subtagsRes, sharingsRes] = await Promise.all([
        axios.get('/api/expenses/tags'),
        axios.get('/api/expenses/subtags'),
        axios.get('/api/expense-sharing')
      ])
      setTags(tagsRes.data)
      setSubtags(subtagsRes.data)
      setSharings(sharingsRes.data.filter((s: any) => s.active))
    } catch (error) {
      console.error('Erro ao carregar dados:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const initializeItems = () => {
    if (!template) return

    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1

    const editableItems = template.items.map(item => {
      // Calcula a data baseada no day_of_month
      let dateStr = ''
      if (item.day_of_month) {
        const day = item.day_of_month
        dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      } else {
        // Se não tem dia definido, usa hoje (local, não UTC)
        dateStr = dateToLocalString(now)
      }

      return {
        template_item_id: item.id,
        date: dateStr,
        description: item.description,
        amount: item.amount?.toString() || '',
        tag_id: item.subtag?.tag_id || 0,
        subtag_id: item.subtag_id || 0,
        ownership_percentage: item.ownership_percentage?.toString() || '100.00',
        expense_sharing_id: item.expense_sharing_id || null
      }
    })

    setItems(editableItems)
  }

  const updateItem = (index: number, field: keyof EditableItem, value: any) => {
    const updated = [...items]
    updated[index] = { ...updated[index], [field]: value }
    setItems(updated)
  }

  // Validar se a data/hora está em um período fechado
  const validateDateAgainstClosures = async (date: string, sharingId: number): Promise<ClosedPeriodValidation | null> => {
    try {
      // Extrair hora da data (formato: YYYY-MM-DD ou YYYY-MM-DDTHH:MM:SS)
      const dateObj = new Date(date)
      const dateStr = dateToLocalString(dateObj) // YYYY-MM-DD (local, não UTC)
      const timeStr = dateObj.toTimeString().split(' ')[0] // HH:MM:SS

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

  // Formatar nome do mês
  const getMonthName = (month: number): string => {
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
    return months[month - 1] || ''
  }

  // Usar próxima data disponível para todos os itens com período fechado e submeter automaticamente
  const handleUseNextOpenDates = async () => {
    const updated = [...items]

    for (const closedItem of closedPeriodItems) {
      if (closedItem.validation.next_open_date) {
        updated[closedItem.itemIndex] = {
          ...updated[closedItem.itemIndex],
          date: closedItem.validation.next_open_date
        }
      }
    }

    setItems(updated)
    setShowClosedPeriodDialog(false)
    setClosedPeriodItems([])

    // Auto-submit com os itens atualizados
    await submitTemplate(updated)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!template) return

    // Verifica se há itens com valor preenchido
    const activeItems = items.filter(item => !isNaN(parseFloat(item.amount)) && parseFloat(item.amount) !== 0)
    if (activeItems.length === 0) {
      showError('Erro de Validação', 'Preencha o valor de pelo menos um item para criar lançamentos')
      return
    }

    // Ativa loading imediatamente
    setIsSaving(true)

    try {
      // Validações básicas (apenas para itens com valor)
      for (let i = 0; i < items.length; i++) {
        if (isNaN(parseFloat(items[i].amount)) || parseFloat(items[i].amount) === 0) continue

        const item = items[i]

        if (!item.description.trim()) {
          showError('Erro de Validação', `Item ${i + 1}: Descrição é obrigatória`)
          setIsSaving(false)
          return
        }
        if (!item.date) {
          showError('Erro de Validação', `Item ${i + 1}: Data é obrigatória`)
          setIsSaving(false)
          return
        }
        if (!item.amount || parseFloat(item.amount) === 0) {
          showError('Erro de Validação', `Item ${i + 1}: Valor é obrigatório e não pode ser zero`)
          setIsSaving(false)
          return
        }

        // Valida valor
        const amount = parseFloat(item.amount)
        if (isNaN(amount)) {
          showError('Erro de Validação', `Item ${i + 1}: Valor inválido`)
          setIsSaving(false)
          return
        }
        if (Math.abs(amount) > 99999999.99) {
          showError('Erro de Validação', `Item ${i + 1}: Valor máximo é ±R$ 99.999.999,99`)
          setIsSaving(false)
          return
        }

        // Valida tipo de subtag vs valor (se ambos estiverem preenchidos)
        if (item.subtag_id && item.subtag_id > 0) {
          const subtag = subtags.find(s => s.id === item.subtag_id)

          if (subtag) {
            if (subtag.type === 'receita' && amount < 0) {
              showError('Erro de Validação', `Item ${i + 1}: Não é possível lançar valor negativo em subtag de RECEITA (${subtag.name})`)
              setIsSaving(false)
              return
            }
            if (subtag.type === 'despesa' && amount > 0) {
              showError('Erro de Validação', `Item ${i + 1}: Não é possível lançar valor positivo em subtag de DESPESA (${subtag.name})`)
              setIsSaving(false)
              return
            }
          }
        }
      }

      // Validação de período fechado (apenas para itens com valor e compartilhamento)
      const itemsWithSharing = activeItems.filter(item => item.expense_sharing_id)
      if (itemsWithSharing.length > 0) {
        const closedItems: ClosedPeriodItem[] = []

        for (let i = 0; i < items.length; i++) {
          if (isNaN(parseFloat(items[i].amount)) || parseFloat(items[i].amount) === 0) continue

          const item = items[i]
          if (item.expense_sharing_id) {
            const validation = await validateDateAgainstClosures(item.date, item.expense_sharing_id)
            if (validation?.is_closed) {
              closedItems.push({
                itemIndex: i,
                description: item.description,
                date: item.date,
                validation
              })
            }
          }
        }

        if (closedItems.length > 0) {
          setClosedPeriodItems(closedItems)
          setShowClosedPeriodDialog(true)
          setIsSaving(false)
          return // Não continua - mostra o dialog primeiro
        }
      }

      // Continua com o submit normal
      await submitTemplate()
    } catch (error) {
      console.error('Erro no handleSubmit:', error)
      setIsSaving(false)
    }
  }

  const submitTemplate = async (itemsOverride?: EditableItem[]) => {
    setIsSaving(true)

    // Filtra apenas itens com valor preenchido (diferente de zero)
    const source = itemsOverride ?? items
    const itemsToSubmit = source.filter(item => {
      const num = parseFloat(item.amount)
      return !isNaN(num) && num !== 0
    })

    try {
      const request: ApplyTemplateRequest = {
        items: itemsToSubmit.map(item => ({
          date: item.date,
          description: item.description.trim(),
          amount: parseFloat(item.amount),
          subtag_id: item.subtag_id && item.subtag_id !== 0 ? item.subtag_id : 0,
          ownership_percentage: parseFloat(item.ownership_percentage),
          expense_sharing_id: item.expense_sharing_id || undefined
        }))
      }

      await axios.post(`/api/expense-templates/${template!.id}/apply`, request)

      showSuccess('Sucesso', `${itemsToSubmit.length} ${itemsToSubmit.length === 1 ? 'lançamento criado' : 'lançamentos criados'} com sucesso!`)
      onSuccess()
      onClose()
    } catch (error: any) {
      console.error('Erro ao aplicar template:', error)
      showError('Erro', error.response?.data?.detail || 'Erro ao aplicar template')
    } finally {
      setIsSaving(false)
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return

      // Bloqueia ESC se estiver salvando
      if (e.key === 'Escape') {
        if (!isSaving) {
          onClose()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, isSaving])

  if (!isOpen || !template) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        // Bloqueia fechar clicando no overlay se estiver salvando
        if (e.target === e.currentTarget && !isSaving) {
          onClose()
        }
      }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[95vw] max-w-[1600px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
              Aplicar Template: {template.name}
            </h2>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Revise e ajuste os valores antes de criar os lançamentos
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={isSaving ? "Processando..." : "Fechar (ESC)"}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Carregando...</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Header dos campos */}
              <div className="flex items-end gap-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                <div className="w-[14px]"></div>
                <div className="flex items-center w-6">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">#</span>
                </div>
                <div className="flex-1 grid grid-cols-[2fr_1.2fr_0.8fr_1fr_1fr_1.2fr_0.6fr] gap-2">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Descrição</span>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Valor</span>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Data</span>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Tag</span>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Subtag</span>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Compartilhamento</span>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Minha %</span>
                </div>
              </div>

              {/* Itens */}
              {items.map((item, index) => {
                const selectedSubtag = item.subtag_id ? subtags.find(s => s.id === item.subtag_id) : null
                return (
                <div
                  key={index}
                  className="flex items-center gap-2"
                >
                  <div className="flex items-center">
                    <GripVertical size={14} className="text-gray-400" />
                  </div>
                  {/* Número do item */}
                  <div className="flex items-center">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1">
                      #{index + 1}
                      {selectedSubtag && (
                        selectedSubtag.type === 'receita'
                          ? <ArrowUpCircle size={14} className="text-green-600 dark:text-green-400" title="Receita" />
                          : <ArrowDownCircle size={14} className="text-red-600 dark:text-red-400" title="Despesa" />
                      )}
                    </span>
                  </div>

                  {/* Campos do item em grid horizontal */}
                  <div className="flex-1 grid grid-cols-[2fr_1.2fr_0.8fr_1fr_1fr_1.2fr_0.6fr] gap-2">
                    {/* Descrição */}
                    <div>
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateItem(index, 'description', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                        placeholder="Ex: Aluguel"
                      />
                    </div>

                    {/* Valor com prefixo R$ */}
                    <div>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 text-sm">
                          R$
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={item.amount}
                          onChange={(e) => {
                            const value = e.target.value
                            if (value === '') { updateItem(index, 'amount', ''); return }
                            const subtag = subtags.find(s => s.id === item.subtag_id)
                            const sanitized = value.replace(',', '.')
                            if (!/^-?\d{0,8}(\.\d{0,2})?$/.test(sanitized) && !sanitized.match(/^-?\d{0,8}\.$/)) return
                            // Preserva ponto flutuante (ex: "200.") antes de qualquer parseFloat
                            if (sanitized.endsWith('.')) {
                              let stored = sanitized
                              if (subtag?.type === 'despesa' && !sanitized.startsWith('-')) stored = '-' + sanitized
                              else if (subtag?.type === 'receita' && sanitized.startsWith('-')) stored = sanitized.slice(1)
                              updateItem(index, 'amount', stored)
                              return
                            }
                            if (sanitized === '-' && subtag?.type !== 'receita') {
                              updateItem(index, 'amount', '-'); return
                            }
                            let numValue = parseFloat(sanitized)
                            if (!isNaN(numValue)) {
                              if (subtag?.type === 'despesa' && numValue > 0) numValue = -numValue
                              else if (subtag?.type === 'receita' && numValue < 0) numValue = Math.abs(numValue)
                              if (Math.abs(numValue) <= 99999999.99)
                                updateItem(index, 'amount', numValue.toString())
                            }
                          }}
                          onBlur={(e) => {
                            const value = e.target.value
                            if (value && value !== '-') {
                              const numValue = parseFloat(value)
                              if (!isNaN(numValue)) {
                                updateItem(index, 'amount', numValue.toFixed(2))
                              }
                            }
                          }}
                          className={`w-full pl-8 pr-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-sm font-semibold ${
                            item.amount && parseFloat(item.amount) >= 0
                              ? 'text-green-600 dark:text-green-400'
                              : item.amount && parseFloat(item.amount) < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-gray-900 dark:text-white'
                          }`}
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    {/* Data */}
                    <div>
                      <input
                        type="date"
                        value={item.date}
                        onChange={(e) => updateItem(index, 'date', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      />
                    </div>

                    {/* Tag */}
                    <div>
                      <select
                        value={item.tag_id || 0}
                        onChange={(e) => {
                          const tagId = parseInt(e.target.value)
                          const updated = [...items]
                          updated[index] = {
                            ...updated[index],
                            tag_id: tagId,
                            subtag_id: 0
                          }
                          setItems(updated)
                        }}
                        className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      >
                        <option value={0}>Selecione...</option>
                        {tags.map(tag => (
                          <option key={tag.id} value={tag.id}>
                            {tag.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Subtag */}
                    <div>
                      <select
                        value={item.subtag_id || 0}
                        onChange={(e) => {
                          const subtagId = parseInt(e.target.value)
                          const newSubtag = subtags.find(s => s.id === subtagId)
                          const updated = [...items]
                          let newAmount = updated[index].amount
                          // Auto-ajusta sinal do valor conforme tipo da subtag
                          if (newSubtag && newAmount && newAmount !== '-') {
                            const num = parseFloat(newAmount)
                            if (!isNaN(num) && num !== 0) {
                              if (newSubtag.type === 'despesa' && num > 0) newAmount = (-num).toFixed(2)
                              else if (newSubtag.type === 'receita' && num < 0) newAmount = Math.abs(num).toFixed(2)
                            }
                          }
                          updated[index] = { ...updated[index], subtag_id: subtagId, amount: newAmount }
                          setItems(updated)
                        }}
                        className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                        disabled={!item.tag_id || item.tag_id === 0}
                      >
                        <option value={0}>Selecione...</option>
                        {subtags
                          .filter(s => s.tag_id === item.tag_id)
                          .map(subtag => (
                            <option key={subtag.id} value={subtag.id}>
                              {subtag.type === 'receita' ? '🟢 ' : '🔴 '}{subtag.name}
                            </option>
                          ))}
                      </select>
                    </div>

                    {/* Compartilhamento */}
                    <div>
                      <select
                        value={item.expense_sharing_id || ''}
                        onChange={(e) => {
                          const sharingId = e.target.value ? parseInt(e.target.value) : null
                          const updated = [...items]

                          if (sharingId) {
                            const sharing = sharings.find(s => s.id === sharingId)
                            updated[index] = {
                              ...updated[index],
                              expense_sharing_id: sharingId,
                              ownership_percentage: sharing ? sharing.my_contribution_percentage.toString() : '100.00'
                            }
                          } else {
                            updated[index] = {
                              ...updated[index],
                              expense_sharing_id: null,
                              ownership_percentage: '100.00'
                            }
                          }

                          setItems(updated)
                        }}
                        className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      >
                        <option value="">Sem</option>
                        {sharings.map(sharing => (
                          <option key={sharing.id} value={sharing.id}>
                            {formatSharedAccountDisplay(sharing.shared_account, sharing.my_contribution_percentage)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Minha Contribuição (%) */}
                    <div>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={item.ownership_percentage}
                          onChange={(e) => {
                            const value = e.target.value
                            if (value === '') {
                              updateItem(index, 'ownership_percentage', '')
                              return
                            }
                            const sanitized = value.replace(',', '.')
                            if (/^\d{0,3}(\.\d{0,2})?$/.test(sanitized)) {
                              const numValue = parseFloat(sanitized)
                              if (!isNaN(numValue) && numValue <= 100) {
                                updateItem(index, 'ownership_percentage', sanitized)
                              } else if (sanitized.endsWith('.') || sanitized.match(/^\d+\.$/)) {
                                updateItem(index, 'ownership_percentage', sanitized)
                              }
                            }
                          }}
                          onBlur={(e) => {
                            const value = e.target.value
                            if (value) {
                              const numValue = parseFloat(value)
                              if (!isNaN(numValue)) {
                                updateItem(index, 'ownership_percentage', numValue.toFixed(2))
                              }
                            } else {
                              updateItem(index, 'ownership_percentage', '100.00')
                            }
                          }}
                          className="w-full px-2 py-1.5 pr-6 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm text-right"
                          placeholder="100"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 text-sm">
                          %
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                )
              })}
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-3 flex justify-end gap-3 mt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving || isLoading || items.every(item => isNaN(parseFloat(item.amount)) || parseFloat(item.amount) === 0)}
              className="px-4 py-2 text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2 text-sm"
              style={{ backgroundColor: 'var(--crud-create)' }}
            >
              {isSaving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Criando Lançamentos...
                </>
              ) : (
                (() => {
                  const count = items.filter(item => !isNaN(parseFloat(item.amount)) && parseFloat(item.amount) !== 0).length
                  return `Criar ${count} ${count === 1 ? 'Lançamento' : 'Lançamentos'}`
                })()
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Dialog de Período Fechado */}
      {showClosedPeriodDialog && closedPeriodItems.length > 0 && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-yellow-100 dark:bg-yellow-900/30">
                  <AlertTriangle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    Itens em Período Fechado
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {closedPeriodItems.length} {closedPeriodItems.length === 1 ? 'item está' : 'itens estão'} em período fechado
                  </p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4 max-h-[50vh] overflow-y-auto">
              {closedPeriodItems.map((item, idx) => (
                <div key={idx} className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Lock className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-yellow-800 dark:text-yellow-200">
                      <p className="font-medium mb-1">
                        #{item.itemIndex + 1}: {item.description}
                      </p>
                      <p className="text-xs">
                        Data: {new Date(item.date + 'T12:00:00').toLocaleDateString('pt-BR')} •
                        Fechamento: {item.validation.closure_month && getMonthName(item.validation.closure_month)}/{item.validation.closure_year}
                        {item.validation.is_settled && (
                          <span className="text-green-600 dark:text-green-400 ml-2">(Quitado)</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400">
                <p className="font-medium text-gray-900 dark:text-white mb-2">O que deseja fazer?</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Alterar as datas para o próximo período aberto</li>
                  <li>Reabrir os períodos fechados na tela de Balanço</li>
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowClosedPeriodDialog(false)
                  setClosedPeriodItems([])
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleUseNextOpenDates}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
                style={{ backgroundColor: 'var(--color-1)' }}
              >
                Usar Próximas Datas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ApplyTemplateModal


