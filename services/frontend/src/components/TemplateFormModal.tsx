import { useState, useEffect } from 'react'
import { X, Plus, Trash2, GripVertical, ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import axios from 'axios'
import IconPicker from './IconPicker'
import { formatSharedAccountDisplay } from '../utils/accountFormatter'
import { useAlert } from '../hooks/useAlert'
import type { ExpenseTemplate, ExpenseTemplateCreate, ExpenseTemplateUpdate } from '../types/expenseTemplate'

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

interface TemplateItem {
  id?: number
  description: string
  amount: string
  day_of_month: string
  tag_id: number
  subtag_id: number | null
  ownership_percentage: string
  expense_sharing_id: number | null
  display_order: number
}

interface TemplateFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  template?: ExpenseTemplate | null
  availableIcons: string[]
  iconNamesPt: Record<string, string>
}

const TemplateFormModal = ({ isOpen, onClose, onSuccess, template, availableIcons, iconNamesPt }: TemplateFormModalProps) => {
  const { showError, showSuccess } = useAlert()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('FileText')
  const [items, setItems] = useState<TemplateItem[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [subtags, setSubtags] = useState<Subtag[]>([])
  const [sharings, setSharings] = useState<ExpenseSharingSetting[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      loadData()
      if (template) {
        // Modo edição
        setName(template.name)
        setDescription(template.description || '')
        setIcon(template.icon)
        setItems(template.items.map(item => ({
          id: item.id,
          description: item.description,
          amount: item.amount?.toString() || '',
          day_of_month: item.day_of_month?.toString() || '',
          tag_id: item.subtag?.tag_id || 0,
          subtag_id: item.subtag_id,
          ownership_percentage: item.ownership_percentage?.toString() || '100.00',
          expense_sharing_id: item.expense_sharing_id,
          display_order: item.display_order
        })))
      } else {
        // Modo criação
        resetForm()
      }
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

  const resetForm = () => {
    setName('')
    setDescription('')
    setIcon('FileText')
    setItems([{
      description: '',
      amount: '',
      day_of_month: '',
      tag_id: 0,
      subtag_id: 0,
      ownership_percentage: '100.00',
      expense_sharing_id: null,
      display_order: 0
    }])
  }

  const addItem = () => {
    setItems([...items, {
      description: '',
      amount: '',
      day_of_month: '',
      tag_id: 0,
      subtag_id: 0,
      ownership_percentage: '100.00',
      expense_sharing_id: null,
      display_order: items.length
    }])
  }

  const removeItem = (index: number) => {
    if (items.length <= 1) return
    setItems(items.filter((_, i) => i !== index))
  }

  const updateItem = (index: number, field: keyof TemplateItem, value: any) => {
    const updated = [...items]
    updated[index] = { ...updated[index], [field]: value }
    setItems(updated)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validações
    if (!name.trim()) {
      showError('Erro de Validação', 'Nome do template é obrigatório')
      return
    }

    if (items.length === 0) {
      showError('Erro de Validação', 'Adicione pelo menos um item ao template')
      return
    }

    // Valida itens
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item.description.trim()) {
        showError('Erro de Validação', `Item ${i + 1}: Descrição é obrigatória`)
        return
      }

      // Valida valor (DECIMAL(10,2) = máximo ±99.999.999,99)
      if (item.amount) {
        const amount = parseFloat(item.amount)
        if (isNaN(amount)) {
          showError('Erro de Validação', `Item ${i + 1}: Valor inválido`)
          return
        }
        if (Math.abs(amount) > 99999999.99) {
          showError('Erro de Validação', `Item ${i + 1}: Valor máximo é ±R$ 99.999.999,99`)
          return
        }
        // Valida casas decimais
        const decimalPlaces = (item.amount.split('.')[1] || '').length
        if (decimalPlaces > 2) {
          showError('Erro de Validação', `Item ${i + 1}: Valor pode ter no máximo 2 casas decimais`)
          return
        }
      }

      // Valida dia do mês
      if (item.day_of_month) {
        const day = parseInt(item.day_of_month)
        if (isNaN(day) || day < 1 || day > 31) {
          showError('Erro de Validação', `Item ${i + 1}: Dia do mês deve estar entre 1 e 31`)
          return
        }
      }

      // Valida tipo de subtag vs valor (se ambos estiverem preenchidos)
      if (item.subtag_id && item.subtag_id > 0 && item.amount) {
        const subtag = subtags.find(s => s.id === item.subtag_id)
        const amount = parseFloat(item.amount)

        if (subtag && !isNaN(amount)) {
          if (subtag.type === 'receita' && amount < 0) {
            showError('Erro de Validação', `Item ${i + 1}: Não é possível lançar valor negativo em subtag de RECEITA (${subtag.name})`)
            return
          }
          if (subtag.type === 'despesa' && amount > 0) {
            showError('Erro de Validação', `Item ${i + 1}: Não é possível lançar valor positivo em subtag de DESPESA (${subtag.name})`)
            return
          }
        }
      }

      // Tag e Subtag são opcionais
    }

    setIsSaving(true)

    try {
      const templateData: ExpenseTemplateCreate | ExpenseTemplateUpdate = {
        name: name.trim(),
        description: description.trim() || undefined,
        icon,
        items: items.map((item, index) => ({
          description: item.description.trim(),
          amount: item.amount ? parseFloat(item.amount) : undefined,
          day_of_month: item.day_of_month ? parseInt(item.day_of_month) : undefined,
          subtag_id: item.subtag_id && item.subtag_id > 0 ? item.subtag_id : undefined,
          ownership_percentage: parseFloat(item.ownership_percentage),
          expense_sharing_id: item.expense_sharing_id || undefined,
          display_order: index
        }))
      }

      if (template) {
        // Atualizar template existente
        await axios.put(`/api/expense-templates/${template.id}`, {
          name: templateData.name,
          description: templateData.description,
          icon: templateData.icon
        })

        // Deletar itens antigos e criar novos
        for (const oldItem of template.items) {
          await axios.delete(`/api/expense-templates/${template.id}/items/${oldItem.id}`)
        }

        for (const newItem of templateData.items ?? []) {
          await axios.post(`/api/expense-templates/${template.id}/items`, newItem)
        }

        showSuccess('Sucesso', 'Template atualizado com sucesso!')
      } else {
        // Criar novo template
        await axios.post('/api/expense-templates', templateData)
        showSuccess('Sucesso', 'Template criado com sucesso!')
      }

      onSuccess()
      onClose()
    } catch (error: any) {
      console.error('Erro ao salvar template:', error)
      showError('Erro', error.response?.data?.detail || 'Erro ao salvar template')
    } finally {
      setIsSaving(false)
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return

      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[95vw] max-w-[1600px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {template ? 'Editar Template' : 'Novo Template'}
            </h2>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              Configure um template reutilizável para lançamentos recorrentes
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            title="Fechar (ESC)"
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
            <div className="space-y-4">
              {/* Informações do Template */}
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Informações do Template</h3>

                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Nome *
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      placeholder="Ex: Contas Fixas Mensais"
                    />
                  </div>

                  <IconPicker
                    value={icon}
                    onChange={setIcon}
                    availableIcons={availableIcons}
                    iconNamesPt={iconNamesPt}
                  />

                  <div className="md:col-span-4">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Descrição
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm resize-y min-h-[34px]"
                      placeholder="Opcional"
                      rows={1}
                    />
                  </div>
                </div>
              </div>

              {/* Itens do Template */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Itens do Template</h3>
                  <button
                    type="button"
                    onClick={addItem}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    <Plus size={14} />
                    Adicionar Item
                  </button>
                </div>

                {items.map((item, index) => (
                    <div key={index} className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                      <div className="flex items-end gap-2">
                        {/* Número do item - alinhado ao bottom dos inputs */}
                        <div className="flex items-center gap-1 pb-1.5">
                          <GripVertical size={14} className="text-gray-400" />
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            #{index + 1}
                            {(() => {
                              const subtag = subtags.find(s => s.id === item.subtag_id)
                              if (!subtag) return null
                              return subtag.type === 'receita'
                                ? <ArrowUpCircle size={14} className="text-green-600 dark:text-green-400" title="Receita" />
                                : <ArrowDownCircle size={14} className="text-red-600 dark:text-red-400" title="Despesa" />
                            })()}
                          </span>
                        </div>

                        {/* Campos do item em grid horizontal - forçar uma linha */}
                        <div className="flex-1 grid grid-cols-[2fr_1.2fr_0.5fr_1fr_1.3fr_0.5fr_1.5fr] gap-2">
                          {/* Descrição */}
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Descrição *
                            </label>
                            <input
                              type="text"
                              required
                              value={item.description}
                              onChange={(e) => updateItem(index, 'description', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                              placeholder="Ex: Aluguel"
                            />
                          </div>

                          {/* Valor com prefixo R$ */}
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Valor
                            </label>
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
                                  const sanitized = value.replace(',', '.')
                                  const subtag = subtags.find(s => s.id === item.subtag_id)
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

                          {/* Dia */}
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Dia
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={item.day_of_month}
                              onChange={(e) => {
                                const value = e.target.value
                                if (value === '') {
                                  updateItem(index, 'day_of_month', '')
                                  return
                                }
                                if (/^\d{0,2}$/.test(value)) {
                                  const numValue = parseInt(value)
                                  if (!isNaN(numValue) && numValue >= 1 && numValue <= 31) {
                                    updateItem(index, 'day_of_month', value)
                                  } else if (value.length === 1) {
                                    updateItem(index, 'day_of_month', value)
                                  }
                                }
                              }}
                              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                              placeholder="1-31"
                            />
                          </div>

                          {/* Tag */}
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Tag
                            </label>
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
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Subtag
                            </label>
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

                          {/* % (Ownership Percentage) */}
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Minha %
                            </label>
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
                                  if (!isNaN(numValue) && numValue >= 0 && numValue <= 100) {
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
                              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                              placeholder="100"
                            />
                          </div>

                          {/* Compartilhamento */}
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Compartilhamento
                            </label>
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
                        </div>

                        {/* Botão remover - alinhado ao bottom */}
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(index)}
                            className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors mb-1.5"
                            title="Remover item"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                ))}
              </div>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-3 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={isSaving || isLoading}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Salvando...
              </>
            ) : (
              template ? 'Atualizar Template' : 'Criar Template'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TemplateFormModal


