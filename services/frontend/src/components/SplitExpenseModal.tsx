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
  CadastroFieldLabel,
  cadastroFieldCls,
  cadastroAccentControlCls,
} from './CadastroFormLayout'
import { useEscapeKey } from '../hooks/useEscapeKey'

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
    source: 'bank' | 'cards'
    description: string
    amount: number
    subtag_id: number
    subtag_name: string
  } | null
  onSuccess: () => void
}

const SplitExpenseModal = ({ isOpen, onClose, expense, onSuccess }: SplitExpenseModalProps) => {
  const [subtags, setSubtags] = useState<Subtag[]>([])
  const [parts, setParts] = useState<SplitPart[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })
  const [originalTagType, setOriginalTagType] = useState<string | null>(null)

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!expense) return

    // Validações
    const total = getTotalAmount()
    if (Math.abs(total - expense.amount) > 0.01) {
      showToast(
        `A soma das partes (${formatCurrency(total)}) deve ser igual ao valor original (${formatCurrency(expense.amount)})`,
        'warning'
      )
      return
    }

    if (parts.some(p => p.subtag_id === 0)) {
      showToast('Todas as partes devem ter uma subtag selecionada', 'warning')
      return
    }

    // Validação de valores: para despesas (negativo), não pode ser >= 0; para receitas (positivo), não pode ser <= 0
    if (expense.amount < 0) {
      if (parts.some(p => p.amount >= 0)) {
        showToast('Todas as partes de uma despesa devem ter valores negativos', 'warning')
        return
      }
    } else {
      if (parts.some(p => p.amount <= 0)) {
        showToast('Todas as partes de uma receita devem ter valores positivos', 'warning')
        return
      }
    }

    try {
      setIsLoading(true)
      const endpoint = expense.source === 'bank'
        ? `/api/expenses/bank-statements/${expense.id}/split`
        : `/api/expenses/credit-card-invoices/${expense.id}/split`

      await axios.post(endpoint, {
        parts: parts.map(p => ({
          amount: p.amount,
          subtag_id: p.subtag_id
        }))
      })

      showToast('Despesa dividida com sucesso!', 'success')

      // Aguarda um pouco para o usuário ver o toast antes de fechar
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 1500)
    } catch (error: any) {
      console.error('Erro ao dividir despesa:', error)
      showToast(
        error.response?.data?.detail || 'Erro ao dividir despesa. Tente novamente.',
        'error'
      )
    } finally {
      setIsLoading(false)
    }
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
      <CadastroModalShell maxWidth="max-w-5xl" onBackdropClick={onClose}>
        <CadastroModalHeader
          isEdit
          title="Dividir Despesa"
          subtitle={expense.description}
          onClose={onClose}
          icon={<Scissors size={18} />}
        />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" id="split-expense-form">
          <CadastroModalBody>
            <CadastroFormSection title="Valores" icon={<DollarSign size={14} />}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Valor original</span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(expense.amount)}</span>
              </div>
              {expense && parts.length === 2 && parts[0] && parts[1] && (
                <div className="mt-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-gradient-to-r from-[var(--color-1)] to-[var(--color-2)]"></div>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">Minha Parte</span>
                      <span className="text-lg font-bold text-[var(--color-1)]">{getSliderPercentage()}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-[var(--color-3)]">{100 - getSliderPercentage()}%</span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">Outra Parte</span>
                      <div className="h-3 w-3 rounded-full bg-gradient-to-r from-[var(--color-3)] to-[var(--color-4)]"></div>
                    </div>
                  </div>
                  <div className="relative mb-2 h-8 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className="absolute left-0 top-0 flex h-full items-center justify-center bg-gradient-to-r from-[var(--color-1)] to-[var(--color-2)] transition-all duration-300 ease-out"
                      style={{ width: `${getSliderPercentage()}%` }}
                    >
                      {getSliderPercentage() > 15 && (
                        <span className="text-xs font-bold text-white drop-shadow-md">
                          {formatCurrency(parts[0].amount)}
                        </span>
                      )}
                    </div>
                    <div
                      className="absolute right-0 top-0 flex h-full items-center justify-center bg-gradient-to-r from-[var(--color-3)] to-[var(--color-4)] transition-all duration-300 ease-out"
                      style={{ width: `${100 - getSliderPercentage()}%` }}
                    >
                      {(100 - getSliderPercentage()) > 15 && (
                        <span className="text-xs font-bold text-white drop-shadow-md">
                          {formatCurrency(parts[1].amount)}
                        </span>
                      )}
                    </div>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={getSliderPercentage()}
                    onChange={(e) => handleSliderChange(parseInt(e.target.value))}
                    className={`${cadastroAccentControlCls} slider-modern h-2 w-full cursor-pointer appearance-none rounded-lg bg-transparent`}
                  />
                </div>
              )}
            </CadastroFormSection>

            <CadastroFormSection title="Partes" icon={<Tag size={14} />}>
              <div className="space-y-3">
                {parts.map((part, index) => (
                  <div key={part.id} className="flex items-end gap-3">
                    <div className={`mb-1.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-lg font-bold text-white ${
                      index === 0
                        ? 'bg-gradient-to-r from-[var(--color-1)] to-[var(--color-2)]'
                        : 'bg-gradient-to-r from-[var(--color-3)] to-[var(--color-4)]'
                    }`}>
                      {index + 1}
                    </div>
                    <label className="block w-40 min-w-0">
                      <CadastroFieldLabel required>Valor</CadastroFieldLabel>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={part.amount || ''}
                        onChange={(e) => updatePart(part.id, 'amount', parseFloat(e.target.value) || 0)}
                        className={`${cadastroFieldCls} mt-0.5 font-semibold`}
                        placeholder="0.00"
                      />
                    </label>
                    <label className="block min-w-0 flex-1">
                      <CadastroFieldLabel required>Tag</CadastroFieldLabel>
                      <select
                        required
                        value={part.tag_id || ''}
                        onChange={(e) => updatePart(part.id, 'tag_id', parseInt(e.target.value))}
                        className={`${cadastroFieldCls} mt-0.5`}
                      >
                        <option value="">Selecione a tag...</option>
                        {Array.from(new Set(subtags
                          .filter(subtag => !originalTagType || subtag.tag_type === originalTagType)
                          .map(s => JSON.stringify({ id: s.tag_id, name: s.tag_name }))))
                          .map(tagStr => {
                            const tag = JSON.parse(tagStr)
                            return (
                              <option key={tag.id} value={tag.id}>
                                {tag.name}
                              </option>
                            )
                          })}
                      </select>
                    </label>
                    <label className="block min-w-0 flex-1">
                      <CadastroFieldLabel required>Subtag</CadastroFieldLabel>
                      <select
                        required
                        value={part.subtag_id || ''}
                        onChange={(e) => updatePart(part.id, 'subtag_id', parseInt(e.target.value))}
                        className={`${cadastroFieldCls} mt-0.5`}
                        disabled={!part.tag_id}
                      >
                        <option value="">Selecione a subtag...</option>
                        {subtags
                          .filter(subtag =>
                            (!originalTagType || subtag.tag_type === originalTagType) &&
                            (part.tag_id === 0 || subtag.tag_id === part.tag_id)
                          )
                          .map(subtag => (
                            <option key={subtag.id} value={subtag.id}>
                              {subtag.name}
                            </option>
                          ))}
                      </select>
                    </label>
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
            saveLabel="Dividir Despesa"
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
    </>
  )
}

export default SplitExpenseModal

