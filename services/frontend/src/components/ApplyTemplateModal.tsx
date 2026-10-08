import { useState, useEffect, useCallback, useMemo } from 'react'
import { GripVertical, AlertTriangle, ArrowDownCircle, ArrowUpCircle, FileText, Lock, Repeat } from 'lucide-react'
import axios from 'axios'
import { sharingPartnerLabel, sharingPercentForKind } from '../utils/accountFormatter'
import { useAlert } from '../hooks/useAlert'
import type { ExpenseTemplate, ApplyTemplateRequest } from '../types/expenseTemplate'
import { updateTemplateItemsDisplayOrder } from '../services/expenseTemplatesApi'
import { dateToLocalString } from '../utils/dateUtils'
import {
  buildExpandedTemplateLaunches,
  countExpandedTemplateLaunches,
  type RecurrenceUnit,
  type TemplateRecurrenceSettings,
} from '../utils/applyTemplateRecurrence'
import { validateAccountPeriodDate } from '../services/accountPeriodClosuresApi'
import { DateField } from './date'
import OwnershipPercentField from './OwnershipPercentField'
import { maskPercentInput, finalizePercentInput } from '../utils/percentInput'
import {
  CadastroModalShell,
  CadastroModalHeader,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroFormSection,
  cadastroAccentControlCls,
  cadastroFieldCls,
} from './CadastroFormLayout'

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
  launchKey: string
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
  amount: string      // valor numérico com sinal para submissão (ex: "-150.00")
  amountCents: string // dígitos brutos para máscara direita→esquerda (ex: "15000")
  tag_id: number
  subtag_id: number
  ownership_percentage: string
  expense_sharing_id: number | null
  applyRecurrence: boolean
}

const RECURRENCE_UNIT_LABELS: Record<RecurrenceUnit, string> = {
  days: 'dias',
  weeks: 'semanas',
  months: 'meses',
  years: 'anos',
}

/** Grip + recorrência + # + campos */
const applyTemplateItemGridCls =
  'grid grid-cols-[14px_1.75rem_minmax(2.25rem,3.25rem)_minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(6.5rem,7rem)] gap-x-2 gap-y-2 items-center'

const applyTemplateRowCls = (isDragging: boolean, isDragOver: boolean) => {
  const base = `${applyTemplateItemGridCls} min-w-[960px] rounded-md py-0.5 transition-colors`
  if (isDragging) return `${base} opacity-50`
  if (isDragOver) return `${base} bg-blue-50 ring-1 ring-blue-300 dark:bg-blue-900/20 dark:ring-blue-700`
  return base
}

const ApplyTemplateModal = ({ isOpen, onClose, onSuccess, template }: ApplyTemplateModalProps) => {
  const { showError, showSuccess } = useAlert()
  const [items, setItems] = useState<EditableItem[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [subtags, setSubtags] = useState<Subtag[]>([])
  const [sharings, setSharings] = useState<ExpenseSharingSetting[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [recurrenceRounds, setRecurrenceRounds] = useState(1)
  const [recurrenceInterval, setRecurrenceInterval] = useState(1)
  const [recurrenceUnit, setRecurrenceUnit] = useState<RecurrenceUnit>('months')

  // Estados para validação de período fechado
  const [closedPeriodItems, setClosedPeriodItems] = useState<ClosedPeriodItem[]>([])
  const [showClosedPeriodDialog, setShowClosedPeriodDialog] = useState(false)

  useEffect(() => {
    if (isOpen && template) {
      loadData()
      initializeItems()
      setDraggedIndex(null)
      setDragOverIndex(null)
      setRecurrenceRounds(1)
      setRecurrenceInterval(1)
      setRecurrenceUnit('months')
    }
  }, [isOpen, template])

  const recurrenceSettings: TemplateRecurrenceSettings = useMemo(
    () => ({
      rounds: recurrenceRounds,
      interval: recurrenceInterval,
      unit: recurrenceUnit,
    }),
    [recurrenceRounds, recurrenceInterval, recurrenceUnit],
  )

  const totalLaunchCount = useMemo(
    () => countExpandedTemplateLaunches(items, recurrenceSettings),
    [items, recurrenceSettings],
  )

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

    const sortedItems = [...template.items].sort(
      (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0),
    )

    const editableItems = sortedItems.map(item => {
      // Calcula a data baseada no day_of_month
      let dateStr = ''
      if (item.day_of_month) {
        const day = item.day_of_month
        dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      } else {
        // Se não tem dia definido, usa hoje (local, não UTC)
        dateStr = dateToLocalString(now)
      }

      // Converte amount para centavos brutos (ex: -150.00 → "15000")
      const rawAmount = parseFloat(item.amount?.toString() || '0') || 0
      const initialCents = rawAmount !== 0 ? String(Math.round(Math.abs(rawAmount) * 100)) : ''

      return {
        template_item_id: item.id,
        date: dateStr,
        description: item.description,
        amount: item.amount?.toString() || '',
        amountCents: initialCents,
        tag_id: item.subtag?.tag_id || 0,
        subtag_id: item.subtag_id || 0,
        ownership_percentage: item.ownership_percentage?.toString() || '100.00',
        expense_sharing_id: item.expense_sharing_id || null,
        applyRecurrence: false,
      }
    })

    setItems(editableItems)
  }

  const updateItem = (index: number, field: keyof EditableItem, value: any) => {
    const updated = [...items]
    updated[index] = { ...updated[index], [field]: value }
    setItems(updated)
  }

  const persistItemsDisplayOrder = useCallback(
    async (ordered: EditableItem[]) => {
      if (!template) return
      await updateTemplateItemsDisplayOrder(
        template.id,
        ordered.map((item) => item.template_item_id),
      )
    },
    [template],
  )

  const handleItemDragStart = (index: number) => {
    if (isSaving) return
    setDraggedIndex(index)
  }

  const handleItemDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (isSaving) return
    setDragOverIndex(index)
  }

  const handleItemDragLeave = () => {
    setDragOverIndex(null)
  }

  const handleItemDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    if (draggedIndex === null || isSaving) {
      setDraggedIndex(null)
      setDragOverIndex(null)
      return
    }
    if (draggedIndex === dropIndex) {
      setDraggedIndex(null)
      setDragOverIndex(null)
      return
    }

    setItems((prev) => {
      const next = [...prev]
      const [moved] = next.splice(draggedIndex, 1)
      next.splice(dropIndex, 0, moved)
      void persistItemsDisplayOrder(next).catch((error) => {
        console.error('Erro ao salvar ordem dos itens:', error)
        showError('Erro', 'Não foi possível salvar a ordem dos itens do template')
      })
      return next
    })
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleItemDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  // Máscara BRL: dígitos brutos → "1.234,56"
  const formatAmountMask = (cents: string): string => {
    const num = parseInt(cents || '0', 10)
    return (num / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
    const dateOverrides: Record<string, string> = {}
    for (const closedItem of closedPeriodItems) {
      if (closedItem.validation.next_open_date) {
        dateOverrides[closedItem.launchKey] = closedItem.validation.next_open_date
      }
    }

    setShowClosedPeriodDialog(false)
    setClosedPeriodItems([])

    await submitTemplate(items, dateOverrides)
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

      if (recurrenceRounds < 1 || recurrenceInterval < 1) {
        showError('Erro de Validação', 'Recorrência: informe ao menos 1 rodada e intervalo ≥ 1')
        setIsSaving(false)
        return
      }

      const expandedPreview = buildExpandedTemplateLaunches(items, recurrenceSettings)
      if (expandedPreview.length === 0) {
        showError('Erro de Validação', 'Nenhum lançamento a criar com os itens e recorrência atuais')
        setIsSaving(false)
        return
      }

      // Validação de período fechado da conta (extrato)
      const closedAccountItems: ClosedPeriodItem[] = []
      for (const launch of expandedPreview) {
        const dateStr = launch.date.length >= 10 ? launch.date.slice(0, 10) : dateToLocalString(launch.date)
        const validation = await validateAccountPeriodDate(dateStr)
        if (validation?.is_closed) {
          closedAccountItems.push({
            launchKey: launch.key,
            description: launch.description,
            date: launch.date,
            validation: {
              is_closed: true,
              closure_id: validation.closure_id ?? null,
              closure_year: validation.closure_year ?? null,
              closure_month: validation.closure_month ?? null,
              is_settled: false,
              next_open_date: validation.next_open_date ?? null,
              message: validation.message ?? null,
            },
          })
        }
      }
      if (closedAccountItems.length > 0) {
        setClosedPeriodItems(closedAccountItems)
        setShowClosedPeriodDialog(true)
        setIsSaving(false)
        return
      }

      // Validação de período fechado (compartilhamento)
      const closedSharingItems: ClosedPeriodItem[] = []
      for (const launch of expandedPreview) {
        if (!launch.expense_sharing_id) continue
        const validation = await validateDateAgainstClosures(launch.date, launch.expense_sharing_id)
        if (validation?.is_closed) {
          closedSharingItems.push({
            launchKey: launch.key,
            description: launch.description,
            date: launch.date,
            validation,
          })
        }
      }

      if (closedSharingItems.length > 0) {
        setClosedPeriodItems(closedSharingItems)
        setShowClosedPeriodDialog(true)
        setIsSaving(false)
        return
      }

      await submitTemplate()
    } catch (error) {
      console.error('Erro no handleSubmit:', error)
      setIsSaving(false)
    }
  }

  const submitTemplate = async (
    itemsOverride?: EditableItem[],
    dateOverrides: Record<string, string> = {},
  ) => {
    setIsSaving(true)

    const source = itemsOverride ?? items

    try {
      await persistItemsDisplayOrder(source)
    } catch (error) {
      console.error('Erro ao salvar ordem antes de aplicar:', error)
      showError('Erro', 'Não foi possível salvar a ordem dos itens do template')
      setIsSaving(false)
      return
    }

    const expandedLaunches = buildExpandedTemplateLaunches(source, recurrenceSettings, dateOverrides)
    if (expandedLaunches.length === 0) {
      showError('Erro de Validação', 'Nenhum lançamento a criar')
      setIsSaving(false)
      return
    }

    try {
      const request: ApplyTemplateRequest = {
        items: expandedLaunches.map((launch) => ({
          date: launch.date,
          description: launch.description.trim(),
          amount: parseFloat(launch.amount),
          subtag_id: launch.subtag_id && launch.subtag_id !== 0 ? launch.subtag_id : 0,
          ownership_percentage: parseFloat(launch.ownership_percentage),
          expense_sharing_id: launch.expense_sharing_id || undefined,
        })),
      }

      await axios.post(`/api/expense-templates/${template!.id}/apply`, request)

      const count = expandedLaunches.length
      showSuccess(
        'Sucesso',
        `${count} ${count === 1 ? 'lançamento criado' : 'lançamentos criados'} com sucesso!`,
      )
      onSuccess()
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
    <>
      <CadastroModalShell maxWidth="max-w-[1600px]">
        <CadastroModalHeader
          isEdit={false}
          title={`Aplicar Template: ${template.name}`}
          subtitle="Ajuste os itens, marque recorrência (↻) e execute"
          onClose={onClose}
          icon={<FileText size={18} />}
        />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" id="apply-template-form">
          <CadastroModalBody>
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Carregando...</p>
            </div>
          ) : (
            <>
            <CadastroFormSection title="Recorrência" icon={<Repeat size={14} />}>
              <div className="flex flex-wrap items-end gap-3 text-sm">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Rodadas (por item marcado)</span>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={recurrenceRounds}
                    onChange={(e) => setRecurrenceRounds(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className={`${cadastroFieldCls} w-24`}
                    disabled={isSaving}
                  />
                </label>
                <span className="pb-2 text-gray-500 dark:text-gray-400">lançamentos, a cada</span>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Intervalo</span>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={recurrenceInterval}
                    onChange={(e) => setRecurrenceInterval(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className={`${cadastroFieldCls} w-20`}
                    disabled={isSaving}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Unidade</span>
                  <select
                    value={recurrenceUnit}
                    onChange={(e) => setRecurrenceUnit(e.target.value as RecurrenceUnit)}
                    className={`${cadastroFieldCls} min-w-[7.5rem]`}
                    disabled={isSaving}
                  >
                    {(Object.keys(RECURRENCE_UNIT_LABELS) as RecurrenceUnit[]).map((unit) => (
                      <option key={unit} value={unit}>
                        {RECURRENCE_UNIT_LABELS[unit]}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="pb-0.5 text-xs text-gray-500 dark:text-gray-400">
                  Marque ↻ nos itens com valor. Sem marcação: 1 lançamento na data informada.
                  {' '}
                  <span className="font-semibold text-gray-700 dark:text-gray-200">
                    Total ao executar: {totalLaunchCount}
                  </span>
                </p>
              </div>
            </CadastroFormSection>

            <CadastroFormSection title="Lançamentos" icon={<FileText size={14} />}>
              <div className="min-w-0 overflow-x-auto">
              {/* Header dos campos */}
              <div
                className={`${applyTemplateItemGridCls} pb-2 border-b border-gray-200 dark:border-gray-700 min-w-[960px]`}
              >
                <GripVertical size={14} className="invisible shrink-0 justify-self-center" aria-hidden />
                <span className="text-center text-xs font-medium text-gray-500 dark:text-gray-400" title="Gerar recorrência">
                  ↻
                </span>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">#</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Descrição</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Valor</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Data</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Tag</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Subtag</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Compartilhamento</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Minha %</span>
              </div>

              {/* Itens */}
              {items.map((item, index) => {
                const selectedSubtag = item.subtag_id ? subtags.find(s => s.id === item.subtag_id) : null
                const isDragging = draggedIndex === index
                const isDragOver = dragOverIndex === index
                return (
                <div
                  key={item.template_item_id}
                  className={applyTemplateRowCls(isDragging, isDragOver)}
                  onDragOver={(e) => handleItemDragOver(e, index)}
                  onDragLeave={handleItemDragLeave}
                  onDrop={(e) => handleItemDrop(e, index)}
                >
                  <button
                    type="button"
                    draggable={!isSaving}
                    onDragStart={(e) => {
                      e.stopPropagation()
                      handleItemDragStart(index)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', String(index))
                    }}
                    onDragEnd={handleItemDragEnd}
                    disabled={isSaving}
                    className={`flex shrink-0 cursor-grab justify-self-center border-0 bg-transparent p-0 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 ${
                      isSaving ? '' : 'touch-none'
                    }`}
                    title="Arrastar para reordenar"
                    aria-label={`Reordenar item ${index + 1}`}
                  >
                    <GripVertical size={14} className="text-gray-400" aria-hidden />
                  </button>
                  <div className="flex justify-center">
                    <input
                      type="checkbox"
                      checked={item.applyRecurrence}
                      onChange={(e) => updateItem(index, 'applyRecurrence', e.target.checked)}
                      disabled={
                        isSaving ||
                        isNaN(parseFloat(item.amount)) ||
                        parseFloat(item.amount) === 0
                      }
                      className={`h-4 w-4 rounded ${cadastroAccentControlCls}`}
                      title={
                        isNaN(parseFloat(item.amount)) || parseFloat(item.amount) === 0
                          ? 'Preencha o valor para usar recorrência'
                          : 'Gerar lançamentos futuros conforme recorrência'
                      }
                      aria-label={`Recorrência item ${index + 1}`}
                    />
                  </div>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-0.5 whitespace-nowrap">
                    #{index + 1}
                    {selectedSubtag && (
                      selectedSubtag.type === 'receita'
                        ? <ArrowUpCircle size={14} className="text-green-600 dark:text-green-400" aria-label="Receita" />
                        : <ArrowDownCircle size={14} className="text-red-600 dark:text-red-400" aria-label="Despesa" />
                    )}
                  </span>

                    {/* Descrição */}
                    <div className="min-w-0">
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateItem(index, 'description', e.target.value)}
                        className={cadastroFieldCls}
                        placeholder="Ex: Aluguel"
                      />
                    </div>

                    {/* Valor com prefixo R$ */}
                    <div className="min-w-0">
                      <div className="relative">
                        <span className={`absolute left-2 top-1/2 -translate-y-1/2 text-sm font-semibold ${
                          item.amount && parseFloat(item.amount) < 0
                            ? 'text-red-500 dark:text-red-400'
                            : item.amount && parseFloat(item.amount) > 0
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          R$
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={`${parseFloat(item.amount) < 0 ? '-' : ''}${formatAmountMask(item.amountCents)}`}
                          onChange={(e) => {
                            const cents = e.target.value.replace(/\D/g, '')
                            const absValue = parseInt(cents || '0', 10) / 100
                            if (absValue > 99999999.99) return
                            const subtag = subtags.find(s => s.id === item.subtag_id)
                            let signedValue: number
                            if (subtag?.type === 'despesa') signedValue = -absValue
                            else signedValue = absValue
                            const updated = [...items]
                            updated[index] = {
                              ...updated[index],
                              amountCents: cents,
                              amount: signedValue === 0 ? '' : signedValue.toFixed(2)
                            }
                            setItems(updated)
                          }}
                          className={`${cadastroFieldCls} pl-8 font-semibold ${
                            item.amount && parseFloat(item.amount) < 0
                              ? 'text-red-600 dark:text-red-400'
                              : item.amount && parseFloat(item.amount) > 0
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-gray-900 dark:text-white'
                          }`}
                          placeholder="0,00"
                        />
                      </div>
                    </div>

                    {/* Data */}
                    <div className="min-w-0">
                      <DateField
                        value={item.date}
                        onChange={(value) => updateItem(index, 'date', value)}
                        className={cadastroFieldCls}
                      />
                    </div>

                    {/* Tag */}
                    <div className="min-w-0">
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
                        className={cadastroFieldCls}
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
                    <div className="min-w-0">
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
                        className={cadastroFieldCls}
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
                    <div className="min-w-0">
                      <select
                        value={item.expense_sharing_id || ''}
                        onChange={(e) => {
                          const sharingId = e.target.value ? parseInt(e.target.value) : null
                          const updated = [...items]

                          if (sharingId) {
                            const sharing = sharings.find(s => s.id === sharingId)
                            const subtag = subtags.find(s => s.id === updated[index].subtag_id)
                            updated[index] = {
                              ...updated[index],
                              expense_sharing_id: sharingId,
                              ownership_percentage: sharing
                                ? sharingPercentForKind(
                                    sharing,
                                    subtag?.type === 'receita' ? 'revenue' : 'expense'
                                  ).toString()
                                : '100.00'
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
                        className={cadastroFieldCls}
                      >
                        <option value="">Sem</option>
                        {sharings.map(sharing => (
                          <option key={sharing.id} value={sharing.id}>
                            {sharingPartnerLabel(sharing)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="min-w-[6.5rem]">
                      <OwnershipPercentField
                        compact
                        hideLabel
                        context="transaction"
                        value={item.ownership_percentage}
                        onChange={(raw) => updateItem(index, 'ownership_percentage', maskPercentInput(raw))}
                        onBlur={() => {
                          const v = finalizePercentInput(item.ownership_percentage)
                          updateItem(
                            index,
                            'ownership_percentage',
                            v ? parseFloat(v).toFixed(2) : '100.00',
                          )
                        }}
                        placeholder="100"
                        inputClassName="pr-9"
                      />
                    </div>
                </div>
                )
              })}
              </div>
            </CadastroFormSection>
            </>
          )}
        </CadastroModalBody>
        <CadastroModalFooter
          onClose={onClose}
          onSave={() => {
            const form = document.getElementById('apply-template-form') as HTMLFormElement | null
            form?.requestSubmit()
          }}
          saving={isSaving}
          disabled={isSaving || isLoading || totalLaunchCount === 0}
          saveLabel={isSaving ? 'Executando...' : 'Executar'}
        />
      </form>
    </CadastroModalShell>

      {showClosedPeriodDialog && closedPeriodItems.length > 0 && (
        <CadastroModalShell
          maxWidth="max-w-lg"
          zClass="z-[110]"
          onBackdropClick={() => {
            setShowClosedPeriodDialog(false)
            setClosedPeriodItems([])
          }}
        >
          <CadastroModalHeader
            isEdit={false}
            title="Itens em Período Fechado"
            subtitle={`${closedPeriodItems.length} ${closedPeriodItems.length === 1 ? 'item está' : 'itens estão'} em período fechado`}
            onClose={() => {
              setShowClosedPeriodDialog(false)
              setClosedPeriodItems([])
            }}
            icon={<AlertTriangle size={18} />}
            iconStyle={{ backgroundColor: 'var(--color-warning)', color: 'var(--on-color-warning)' }}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Itens" icon={<Lock size={14} />}>
              <div className="space-y-3">
                {closedPeriodItems.map((item, idx) => (
                  <div key={idx} className="text-sm">
                    <p className="font-medium text-gray-900 dark:text-white">
                      {item.description}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Data: {new Date(item.date + 'T12:00:00').toLocaleDateString('pt-BR')} •
                      Fechamento: {item.validation.closure_month && getMonthName(item.validation.closure_month)}/{item.validation.closure_year}
                      {item.validation.is_settled ? (
                        <span className="ml-2 text-green-600 dark:text-green-400">(Quitado)</span>
                      ) : null}
                    </p>
                  </div>
                ))}
                <div>
                  <p className="mb-1 font-medium text-gray-900 dark:text-white">O que deseja fazer?</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600 dark:text-gray-400">
                    <li>Alterar as datas para o próximo período aberto</li>
                    <li>Reabrir os períodos fechados na tela de Balanço</li>
                  </ul>
                </div>
              </div>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={() => {
              setShowClosedPeriodDialog(false)
              setClosedPeriodItems([])
            }}
            onSave={handleUseNextOpenDates}
            saveLabel="Usar Próximas Datas"
          />
        </CadastroModalShell>
      )}
    </>
  )
}

export default ApplyTemplateModal


