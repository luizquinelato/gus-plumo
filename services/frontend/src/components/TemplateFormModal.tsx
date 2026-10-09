import { useState, useEffect } from 'react'
import { Plus, Trash2, GripVertical, ArrowDown, ArrowUp, FileText } from 'lucide-react'
import axios from 'axios'
import IconPicker from './IconPicker'
import { sharingPartnerLabel, sharingPercentForKind } from '../utils/accountFormatter'
import { useAlert } from '../hooks/useAlert'
import type { ExpenseTemplate, ExpenseTemplateCreate, ExpenseTemplateUpdate } from '../types/expenseTemplate'
import OwnershipPercentField from './OwnershipPercentField'
import { maskPercentInput, finalizePercentInput } from '../utils/percentInput'
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
} from './CadastroFormLayout'
import { listPageTableRowHoverCls, listPageTableTdCls } from './CadastroListPageLayout'
import { ListPageTable } from './ListPageTable'
import {
  ListTableDragCell,
  ListTableDragHeader,
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableStaticHeader,
} from './ListTableSelectColumns'

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
    <CadastroModalShell maxWidth="max-w-[1600px]">
      <CadastroModalHeader
        isEdit={!!template}
        title={template ? 'Editar Template' : 'Novo Template'}
        subtitle="Configure um template reutilizável para lançamentos recorrentes"
        onClose={onClose}
        icon={<FileText size={18} />}
      />
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" id="template-form">
        <CadastroModalBody>
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Carregando...</p>
            </div>
          ) : (
            <div className="space-y-4">
              <CadastroFormSection title="Identificação" icon={<FileText size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow cols={2}>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Nome</CadastroFieldLabel>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={`${cadastroFieldCls} mt-0.5`}
                        placeholder="Ex: Contas Fixas Mensais"
                      />
                    </label>
                    <IconPicker
                      value={icon}
                      onChange={setIcon}
                      availableIcons={availableIcons}
                      iconNamesPt={iconNamesPt}
                    />
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel>Descrição</CadastroFieldLabel>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className={`${cadastroFieldCls} mt-0.5 resize-y min-h-[34px]`}
                        placeholder="Opcional"
                        rows={1}
                      />
                    </label>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>

              <CadastroFormSection
                title="Itens do Template"
                icon={<Plus size={14} />}
                trailing={
                  <button
                    type="button"
                    onClick={addItem}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                    style={{ background: 'var(--color-create)', color: 'var(--on-color-create)' }}
                  >
                    <Plus size={14} />
                    Adicionar Item
                  </button>
                }
              >
                <ListPageTable
                  leadingMode="index-only"
                  leadingPrefixCol
                  minWidth={1280}
                  colsRest={
                    <>
                      <ListTableSpacerCol />
                      <col style={{ width: 48, minWidth: 44 }} />
                      <col style={{ width: '18%', minWidth: 160 }} />
                      <col style={{ width: 112, minWidth: 100 }} />
                      <col style={{ width: 64, minWidth: 56 }} />
                      <col style={{ width: '12%', minWidth: 120 }} />
                      <col style={{ width: '14%', minWidth: 130 }} />
                      <col style={{ width: 88, minWidth: 80 }} />
                      <col style={{ width: '16%', minWidth: 140 }} />
                      <col style={{ width: 56, minWidth: 48 }} />
                    </>
                  }
                  head={
                    <tr>
                      <ListTableDragHeader />
                      <ListTableIndexHeader />
                      <ListTableSpacerHeader />
                      <ListTableStaticHeader label="Tipo" className="text-center" />
                      <ListTableStaticHeader label="Descrição *" />
                      <ListTableStaticHeader label="Valor" />
                      <ListTableStaticHeader label="Dia" />
                      <ListTableStaticHeader label="Tag" />
                      <ListTableStaticHeader label="Subtag" />
                      <ListTableStaticHeader label="Minha %" />
                      <ListTableStaticHeader label="Compart." />
                      <ListTableStaticHeader label="Ação" className="text-center" />
                    </tr>
                  }
                >
                  {items.map((item, index) => {
                    const selectedSubtag = item.subtag_id
                      ? subtags.find((s) => s.id === item.subtag_id)
                      : null
                    const fieldCompactCls = `${cadastroFieldCls} min-w-0 py-1.5 text-xs`

                    return (
                      <tr key={index} className={listPageTableRowHoverCls}>
                        <ListTableDragCell>
                          <GripVertical
                            size={14}
                            className="text-gray-400 dark:text-gray-500"
                            aria-hidden
                          />
                        </ListTableDragCell>
                        <ListTableIndexCell index={index + 1} />
                        <ListTableSpacerCell />
                        <td className={`${listPageTableTdCls} text-center`}>
                          {selectedSubtag ? (
                            selectedSubtag.type === 'receita' ? (
                              <ArrowUp
                                size={16}
                                className="inline text-[var(--color-success)]"
                                aria-label="Receita"
                              />
                            ) : (
                              <ArrowDown
                                size={16}
                                className="inline text-[var(--color-danger)]"
                                aria-label="Despesa"
                              />
                            )
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className={listPageTableTdCls}>
                          <input
                            type="text"
                            required
                            value={item.description}
                            onChange={(e) => updateItem(index, 'description', e.target.value)}
                            className={fieldCompactCls}
                            placeholder="Ex: Aluguel"
                          />
                        </td>
                        <td className={listPageTableTdCls}>
                          <div className="relative min-w-0">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 dark:text-gray-400">
                              R$
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={item.amount}
                              onChange={(e) => {
                                const value = e.target.value
                                if (value === '') {
                                  updateItem(index, 'amount', '')
                                  return
                                }
                                const sanitized = value.replace(',', '.')
                                const subtag = subtags.find((s) => s.id === item.subtag_id)
                                if (
                                  !/^-?\d{0,8}(\.\d{0,2})?$/.test(sanitized) &&
                                  !sanitized.match(/^-?\d{0,8}\.$/)
                                ) {
                                  return
                                }
                                if (sanitized.endsWith('.')) {
                                  let stored = sanitized
                                  if (subtag?.type === 'despesa' && !sanitized.startsWith('-')) {
                                    stored = `-${sanitized}`
                                  } else if (subtag?.type === 'receita' && sanitized.startsWith('-')) {
                                    stored = sanitized.slice(1)
                                  }
                                  updateItem(index, 'amount', stored)
                                  return
                                }
                                if (sanitized === '-' && subtag?.type !== 'receita') {
                                  updateItem(index, 'amount', '-')
                                  return
                                }
                                let numValue = parseFloat(sanitized)
                                if (!isNaN(numValue)) {
                                  if (subtag?.type === 'despesa' && numValue > 0) numValue = -numValue
                                  else if (subtag?.type === 'receita' && numValue < 0) {
                                    numValue = Math.abs(numValue)
                                  }
                                  if (Math.abs(numValue) <= 99999999.99) {
                                    updateItem(index, 'amount', numValue.toString())
                                  }
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
                              className={`${fieldCompactCls} pl-7 font-semibold tabular-nums ${
                                item.amount && parseFloat(item.amount) >= 0
                                  ? 'text-green-600 dark:text-green-400'
                                  : item.amount && parseFloat(item.amount) < 0
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-gray-900 dark:text-white'
                              }`}
                              placeholder="0,00"
                            />
                          </div>
                        </td>
                        <td className={listPageTableTdCls}>
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
                                const numValue = parseInt(value, 10)
                                if (!isNaN(numValue) && numValue >= 1 && numValue <= 31) {
                                  updateItem(index, 'day_of_month', value)
                                } else if (value.length === 1) {
                                  updateItem(index, 'day_of_month', value)
                                }
                              }
                            }}
                            className={`${fieldCompactCls} text-center`}
                            placeholder="1–31"
                          />
                        </td>
                        <td className={listPageTableTdCls}>
                          <select
                            value={item.tag_id || 0}
                            onChange={(e) => {
                              const tagId = parseInt(e.target.value, 10)
                              const updated = [...items]
                              updated[index] = {
                                ...updated[index],
                                tag_id: tagId,
                                subtag_id: 0,
                              }
                              setItems(updated)
                            }}
                            className={fieldCompactCls}
                          >
                            <option value={0}>Selecione...</option>
                            {tags.map((tag) => (
                              <option key={tag.id} value={tag.id}>
                                {tag.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className={listPageTableTdCls}>
                          <select
                            value={item.subtag_id || 0}
                            onChange={(e) => {
                              const subtagId = parseInt(e.target.value, 10)
                              const newSubtag = subtags.find((s) => s.id === subtagId)
                              const updated = [...items]
                              let newAmount = updated[index].amount
                              if (newSubtag && newAmount && newAmount !== '-') {
                                const num = parseFloat(newAmount)
                                if (!isNaN(num) && num !== 0) {
                                  if (newSubtag.type === 'despesa' && num > 0) {
                                    newAmount = (-num).toFixed(2)
                                  } else if (newSubtag.type === 'receita' && num < 0) {
                                    newAmount = Math.abs(num).toFixed(2)
                                  }
                                }
                              }
                              updated[index] = {
                                ...updated[index],
                                subtag_id: subtagId,
                                amount: newAmount,
                              }
                              setItems(updated)
                            }}
                            className={fieldCompactCls}
                            disabled={!item.tag_id || item.tag_id === 0}
                          >
                            <option value={0}>Selecione...</option>
                            {subtags
                              .filter((s) => s.tag_id === item.tag_id)
                              .map((subtag) => (
                                <option key={subtag.id} value={subtag.id}>
                                  {subtag.type === 'receita' ? '↑ ' : '↓ '}
                                  {subtag.name}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className={listPageTableTdCls}>
                          <OwnershipPercentField
                            compact
                            hideLabel
                            context="transaction"
                            value={item.ownership_percentage}
                            onChange={(raw) =>
                              updateItem(index, 'ownership_percentage', maskPercentInput(raw))
                            }
                            onBlur={() => {
                              const v = finalizePercentInput(item.ownership_percentage)
                              updateItem(
                                index,
                                'ownership_percentage',
                                v ? parseFloat(v).toFixed(2) : '100.00',
                              )
                            }}
                            placeholder="100"
                          />
                        </td>
                        <td className={listPageTableTdCls}>
                          <select
                            value={item.expense_sharing_id || ''}
                            onChange={(e) => {
                              const sharingId = e.target.value ? parseInt(e.target.value, 10) : null
                              const updated = [...items]
                              const itemSubtag = subtags.find((s) => s.id === updated[index].subtag_id)

                              if (sharingId) {
                                const sharing = sharings.find((s) => s.id === sharingId)
                                updated[index] = {
                                  ...updated[index],
                                  expense_sharing_id: sharingId,
                                  ownership_percentage: sharing
                                    ? sharingPercentForKind(
                                        sharing,
                                        itemSubtag?.type === 'receita' ? 'revenue' : 'expense',
                                      ).toString()
                                    : '100.00',
                                }
                              } else {
                                updated[index] = {
                                  ...updated[index],
                                  expense_sharing_id: null,
                                  ownership_percentage: '100.00',
                                }
                              }

                              setItems(updated)
                            }}
                            className={fieldCompactCls}
                          >
                            <option value="">Sem</option>
                            {sharings.map((sharing) => (
                              <option key={sharing.id} value={sharing.id}>
                                {sharingPartnerLabel(sharing)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className={`${listPageTableTdCls} text-center`}>
                          {items.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => removeItem(index)}
                              className="rounded p-1.5 text-[var(--crud-delete)] transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                              title="Remover item"
                            >
                              <Trash2 size={16} />
                            </button>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </ListPageTable>
              </CadastroFormSection>
            </div>
          )}
        </CadastroModalBody>
        <CadastroModalFooter
          onClose={onClose}
          onSave={() => {
            const form = document.getElementById('template-form') as HTMLFormElement | null
            form?.requestSubmit()
          }}
          saving={isSaving}
          disabled={isSaving || isLoading}
          saveLabel={template ? 'Atualizar Template' : 'Criar Template'}
        />
      </form>
    </CadastroModalShell>
  )
}

export default TemplateFormModal


