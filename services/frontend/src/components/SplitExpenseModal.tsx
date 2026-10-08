import { useState, useEffect } from 'react'
import axios from 'axios'
import { Scissors, Tag, DollarSign } from 'lucide-react'
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
  cadastroFieldCls,
  cadastroAccentControlCls,
} from './CadastroFormLayout'
import { useEscapeKey } from '../hooks/useEscapeKey'
import ClosureEditImpactDialog from './ClosureEditImpactDialog'
import type { ClosureEditImpact } from '../types/closureEditImpact'
import {
  buildEditSuccessPayload,
  extractClosureImpactFromResponse,
  parseAxiosClosureConflict,
  type ExpenseEditSuccessPayload,
} from '../utils/closureEditImpact'

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

interface Subtag {
  id: number
  name: string
  tag_id: number
  tag_name: string
  tag_type: string  // "receita" ou "despesa"
}

interface SplitPart {
  id: string
  amount: number
  tag_id: number
  subtag_id: number
}

interface SplitExpenseModalProps {
  isOpen: boolean
  onClose: () => void
  expense: {
    id: number
    source: 'bank' | 'card' | 'cards'
    description: string
    amount: number
    subtag_id: number
    subtag_name: string
  } | null
  onSuccess: (result: ExpenseEditSuccessPayload) => void
}

const SplitExpenseModal = ({ isOpen, onClose, expense, onSuccess }: SplitExpenseModalProps) => {
  const [subtags, setSubtags] = useState<Subtag[]>([])
  const [parts, setParts] = useState<SplitPart[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })
  const [originalTagType, setOriginalTagType] = useState<string | null>(null)
  const [closureImpactOpen, setClosureImpactOpen] = useState(false)
  const [closureImpact, setClosureImpact] = useState<ClosureEditImpact | null>(null)

  // Hook para fechar modal com ESC
  useEscapeKey(onClose, isOpen)

  // Hook para submeter com Enter
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const target = e.target as HTMLElement
        if (target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT' && target.tagName !== 'INPUT') {
          e.preventDefault()
          const form = document.getElementById('split-expense-form') as HTMLFormElement | null
          if (form) {
            form.requestSubmit()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  useEffect(() => {
    if (isOpen && expense) {
      setClosureImpactOpen(false)
      setClosureImpact(null)
      loadSubtags().then(() => {
        // Após carregar subtags, inicializa com 2 partes: a original e uma nova
        // Busca o tag_id da subtag original
        const originalSubtag = subtags.find(s => s.id === expense.subtag_id)
        const originalTagId = originalSubtag?.tag_id || 0

        setParts([
          { id: '1', amount: expense.amount, tag_id: originalTagId, subtag_id: expense.subtag_id },
          { id: '2', amount: 0, tag_id: 0, subtag_id: 0 }
        ])
      })
    }
  }, [isOpen, expense])

  const loadSubtags = async () => {
    try {
      const response = await axios.get('/api/reports/subtags')
      const allSubtags = response.data
      setSubtags(allSubtags)

      // Identifica o tipo da tag original
      if (expense) {
        const originalSubtag = allSubtags.find((s: Subtag) => s.id === expense.subtag_id)
        if (originalSubtag) {
          setOriginalTagType(originalSubtag.tag_type)
        }
      }
    } catch (error) {
      console.error('Erro ao carregar subtags:', error)
    }
  }

  // Calcula o total atual (para validação)
  const getTotalAmount = () => {
    return parts.reduce((sum, part) => sum + part.amount, 0)
  }

  const updatePart = (id: string, field: 'amount' | 'tag_id' | 'subtag_id', value: number) => {
    // Se for atualização de tag, limpa a subtag
    if (field === 'tag_id') {
      setParts(parts.map(p => p.id === id ? { ...p, tag_id: value, subtag_id: 0 } : p))
      return
    }

    // Se for atualização de valor E temos exatamente 2 partes, usa lógica complementar
    if (field === 'amount' && expense && parts.length === 2) {
      const otherPart = parts.find(p => p.id !== id)
      if (otherPart) {
        // Validação: não permite que o valor ultrapasse o limite
        // Para despesas (negativo): não pode ser mais negativo que o original
        // Para receitas (positivo): não pode ser maior que o original
        if (expense.amount < 0) {
          // Despesa: valor não pode ser menor (mais negativo) que o original
          if (value < expense.amount) {
            value = expense.amount
          }
          // Despesa: valor não pode ser positivo
          if (value > 0) {
            value = 0
          }
        } else {
          // Receita: valor não pode ser maior que o original
          if (value > expense.amount) {
            value = expense.amount
          }
          // Receita: valor não pode ser negativo
          if (value < 0) {
            value = 0
          }
        }

        // Calcula o valor complementar
        const complementaryValue = expense.amount - value

        // Atualiza ambas as partes
        setParts(parts.map(p =>
          p.id === id
            ? { ...p, amount: value }
            : { ...p, amount: complementaryValue }
        ))
        return
      }
    }

    // Se for atualização de valor com mais de 2 partes, valida para não ultrapassar o total
    if (field === 'amount' && expense) {
      const otherPartsTotal = parts
        .filter(p => p.id !== id)
        .reduce((sum, p) => sum + p.amount, 0)

      // Para valores negativos (despesas), a lógica é invertida
      if (expense.amount < 0) {
        // Não permite que o valor seja MENOR (mais negativo) que o disponível
        const minAllowed = expense.amount - otherPartsTotal
        if (value < minAllowed) {
          value = minAllowed
        }
        // Não permite valores positivos em despesas
        if (value > 0) {
          value = 0
        }
      } else {
        // Para valores positivos (receitas), mantém lógica original
        const maxAllowed = expense.amount - otherPartsTotal
        if (value > maxAllowed) {
          value = maxAllowed
        }
        // Não permite valores negativos em receitas
        if (value < 0) {
          value = 0
        }
      }
    }

    setParts(parts.map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  // Função para atualizar via slider (apenas para 2 partes)
  const handleSliderChange = (percentage: number) => {
    if (!expense || parts.length !== 2) return

    const part1Amount = (expense.amount * percentage) / 100
    const part2Amount = expense.amount - part1Amount

    setParts([
      { ...parts[0], amount: parseFloat(part1Amount.toFixed(2)) },
      { ...parts[1], amount: parseFloat(part2Amount.toFixed(2)) }
    ])
  }

  // Calcula a porcentagem da primeira parte (para o slider)
  const getSliderPercentage = (): number => {
    if (!expense || parts.length !== 2 || expense.amount === 0) return 50

    const percentage = (parts[0].amount / expense.amount) * 100
    return Math.round(percentage)
  }

  const validateSplit = (): boolean => {
    if (!expense) return false
    const total = getTotalAmount()
    if (Math.abs(total - expense.amount) > 0.01) {
      showToast(
        `A soma das partes (${formatCurrency(total)}) deve ser igual ao valor original (${formatCurrency(expense.amount)})`,
        'warning',
      )
      return false
    }
    if (parts.some((p) => p.subtag_id === 0)) {
      showToast('Todas as partes devem ter uma subtag selecionada', 'warning')
      return false
    }
    if (expense.amount < 0) {
      if (parts.some((p) => p.amount >= 0)) {
        showToast('Todas as partes de uma despesa devem ter valores negativos', 'warning')
        return false
      }
    } else if (parts.some((p) => p.amount <= 0)) {
      showToast('Todas as partes de uma receita devem ter valores positivos', 'warning')
      return false
    }
    return true
  }

  const submitSplit = async (confirmClosedClosureImpact: boolean) => {
    if (!expense || !validateSplit()) return

    try {
      setIsLoading(true)
      const isBank = expense.source === 'bank'
      const endpoint = isBank
        ? `/api/expenses/bank-statements/${expense.id}/split`
        : `/api/expenses/credit-card-invoices/${expense.id}/split`

      const response = await axios.post(endpoint, {
        parts: parts.map((p) => ({ amount: p.amount, subtag_id: p.subtag_id })),
        confirm_closed_closure_impact: confirmClosedClosureImpact,
      })

      const impact = extractClosureImpactFromResponse(response.data)
      onClose()
      onSuccess(buildEditSuccessPayload('Despesa dividida com sucesso!', impact))
    } catch (error: unknown) {
      const conflict = parseAxiosClosureConflict(error)
      if (conflict && !confirmClosedClosureImpact) {
        setClosureImpact(conflict)
        setClosureImpactOpen(true)
        return
      }
      console.error('Erro ao dividir despesa:', error)
      const detail = axios.isAxiosError(error) ? error.response?.data?.detail : null
      showToast(
        typeof detail === 'string' ? detail : 'Erro ao dividir despesa. Tente novamente.',
        'error',
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void submitSplit(false)
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  if (!isOpen || !expense) return null

  const remaining = expense.amount - getTotalAmount()

  return (
    <>
      <CadastroModalShell maxWidth="max-w-3xl" onBackdropClick={onClose}>
        <CadastroModalHeader
          isEdit
          title="Dividir lançamento"
          subtitle={expense.description}
          onClose={onClose}
          icon={<Scissors size={18} />}
        />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" id="split-expense-form">
          <CadastroModalBody>
            <CadastroFormSection title="Referência" icon={<DollarSign size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow cols={3}>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-600 dark:bg-gray-900/40">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Valor original
                    </p>
                    <p className="mt-1 text-base font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      {formatCurrency(expense.amount)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-600 dark:bg-gray-900/40">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Soma das partes
                    </p>
                    <p
                      className={`mt-1 text-base font-semibold tabular-nums ${
                        Math.abs(remaining) < 0.01
                          ? 'text-green-700 dark:text-green-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {formatCurrency(getTotalAmount())}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-600 dark:bg-gray-900/40">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Diferença
                    </p>
                    <p className="mt-1 text-base font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      {formatCurrency(remaining)}
                    </p>
                  </div>
                </CadastroModalFieldsRow>
                {parts.length === 2 ? (
                  <label className="block min-w-0">
                    <CadastroFieldLabel>Proporção da 1ª parte (%)</CadastroFieldLabel>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={getSliderPercentage()}
                      onChange={(e) => handleSliderChange(parseInt(e.target.value, 10))}
                      className={`${cadastroAccentControlCls} mt-1 h-2 w-full cursor-pointer`}
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Parte 1: {getSliderPercentage()}% · Parte 2: {100 - getSliderPercentage()}%
                    </p>
                  </label>
                ) : null}
              </CadastroModalFieldsGrid>
            </CadastroFormSection>

            <CadastroFormSection title="Partes" icon={<Tag size={14} />}>
              <div className="flex flex-col gap-4">
                {parts.map((part, index) => (
                  <div
                    key={part.id}
                    className="rounded-lg border border-gray-200 p-3 dark:border-gray-600"
                  >
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Parte {index + 1}
                    </p>
                    <CadastroModalFieldsGrid>
                      <CadastroModalFieldsRow cols={3}>
                        <label className="block min-w-0">
                          <CadastroFieldLabel required>Valor</CadastroFieldLabel>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={part.amount || ''}
                            onChange={(e) =>
                              updatePart(part.id, 'amount', parseFloat(e.target.value) || 0)
                            }
                            className={`${cadastroFieldCls} mt-0.5 tabular-nums`}
                          />
                        </label>
                        <label className="block min-w-0">
                          <CadastroFieldLabel required>Tag</CadastroFieldLabel>
                          <select
                            required
                            value={part.tag_id || ''}
                            onChange={(e) => updatePart(part.id, 'tag_id', parseInt(e.target.value, 10))}
                            className={`${cadastroFieldCls} mt-0.5`}
                          >
                            <option value="">Selecione...</option>
                            {Array.from(
                              new Set(
                                subtags
                                  .filter(
                                    (subtag) =>
                                      !originalTagType || subtag.tag_type === originalTagType,
                                  )
                                  .map((s) => JSON.stringify({ id: s.tag_id, name: s.tag_name })),
                              ),
                            ).map((tagStr) => {
                              const tag = JSON.parse(tagStr) as { id: number; name: string }
                              return (
                                <option key={tag.id} value={tag.id}>
                                  {tag.name}
                                </option>
                              )
                            })}
                          </select>
                        </label>
                        <label className="block min-w-0">
                          <CadastroFieldLabel required>Subtag</CadastroFieldLabel>
                          <select
                            required
                            value={part.subtag_id || ''}
                            onChange={(e) =>
                              updatePart(part.id, 'subtag_id', parseInt(e.target.value, 10))
                            }
                            className={`${cadastroFieldCls} mt-0.5`}
                            disabled={!part.tag_id}
                          >
                            <option value="">Selecione...</option>
                            {subtags
                              .filter(
                                (subtag) =>
                                  (!originalTagType || subtag.tag_type === originalTagType) &&
                                  (part.tag_id === 0 || subtag.tag_id === part.tag_id),
                              )
                              .map((subtag) => (
                                <option key={subtag.id} value={subtag.id}>
                                  {subtag.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      </CadastroModalFieldsRow>
                    </CadastroModalFieldsGrid>
                  </div>
                ))}
              </div>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={onClose}
            onSave={() => {
              const form = document.getElementById('split-expense-form') as HTMLFormElement | null
              form?.requestSubmit()
            }}
            saving={isLoading}
            disabled={
              isLoading ||
              Math.abs(remaining) >= 0.01 ||
              parts.some(p => p.subtag_id === 0) ||
              (expense.amount < 0 && parts.some(p => p.amount >= 0)) ||
              (expense.amount > 0 && parts.some(p => p.amount <= 0))
            }
            saveLabel="Dividir"
          />
        </form>
      </CadastroModalShell>

      <ClosureEditImpactDialog
        isOpen={isOpen && closureImpactOpen}
        impact={closureImpact}
        onClose={() => setClosureImpactOpen(false)}
        onConfirm={() => {
          setClosureImpactOpen(false)
          void submitSplit(true)
        }}
        confirmText="Confirmar divisão"
        confirming={isLoading}
      />

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

export default SplitExpenseModal

