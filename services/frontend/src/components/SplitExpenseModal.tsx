import { useState, useEffect } from 'react'
import axios from 'axios'
import { X } from 'lucide-react'
import Toast from './Toast'
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
          const form = document.querySelector('form')
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              Dividir Despesa
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {expense.description}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {/* Valor Original */}
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Valor Original:
              </span>
              <span className="text-lg font-bold text-gray-900 dark:text-white">
                {formatCurrency(expense.amount)}
              </span>
            </div>
          </div>

          {/* Partes */}
          <div className="space-y-4 mb-6">
            {/* Slider de porcentagem - UX Moderna */}
            {expense && parts.length === 2 && parts[0] && parts[1] && (
              <div className="mb-6">
                {/* Barra de Progresso Visual Dual-Color */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-[var(--color-1)] to-[var(--color-2)]"></div>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        Minha Parte
                      </span>
                      <span className="text-lg font-bold text-[var(--color-1)]">
                        {getSliderPercentage()}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-[var(--color-3)]">
                        {100 - getSliderPercentage()}%
                      </span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        Outra Parte
                      </span>
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-[var(--color-3)] to-[var(--color-4)]"></div>
                    </div>
                  </div>

                  {/* Barra Visual Dual-Color */}
                  <div className="relative h-8 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
                    <div
                      className="absolute left-0 top-0 h-full bg-gradient-to-r from-[var(--color-1)] to-[var(--color-2)] transition-all duration-300 ease-out flex items-center justify-center"
                      style={{ width: `${getSliderPercentage()}%` }}
                    >
                      {getSliderPercentage() > 15 && (
                        <span className="text-xs font-bold text-white drop-shadow-md">
                          {formatCurrency(parts[0].amount)}
                        </span>
                      )}
                    </div>
                    <div
                      className="absolute right-0 top-0 h-full bg-gradient-to-r from-[var(--color-3)] to-[var(--color-4)] transition-all duration-300 ease-out flex items-center justify-center"
                      style={{ width: `${100 - getSliderPercentage()}%` }}
                    >
                      {(100 - getSliderPercentage()) > 15 && (
                        <span className="text-xs font-bold text-white drop-shadow-md">
                          {formatCurrency(parts[1].amount)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Slider */}
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={getSliderPercentage()}
                    onChange={(e) => handleSliderChange(parseInt(e.target.value))}
                    className="w-full h-2 bg-transparent rounded-lg appearance-none cursor-pointer slider-modern"
                    style={{
                      background: 'transparent',
                    }}
                  />
                </div>
              </div>
            )}

            {parts.map((part, index) => (
              <div
                key={part.id}
                className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600"
              >
                <div className="flex items-end gap-4">
                  {/* Número da parte */}
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg mb-2 ${
                    index === 0
                      ? 'bg-gradient-to-r from-[var(--color-1)] to-[var(--color-2)]'
                      : 'bg-gradient-to-r from-[var(--color-3)] to-[var(--color-4)]'
                  }`}>
                    {index + 1}
                  </div>

                  {/* Valor */}
                  <div className="w-40">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Valor
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={part.amount || ''}
                      onChange={(e) => updatePart(part.id, 'amount', parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-semibold"
                      placeholder="0.00"
                    />
                  </div>

                  {/* Tag */}
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Tag
                    </label>
                    <select
                      required
                      value={part.tag_id || ''}
                      onChange={(e) => updatePart(part.id, 'tag_id', parseInt(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    >
                      <option value="">Selecione a tag...</option>
                      {/* Extrai tags únicas */}
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
                  </div>

                  {/* Subtag */}
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Subtag
                    </label>
                    <select
                      required
                      value={part.subtag_id || ''}
                      onChange={(e) => updatePart(part.id, 'subtag_id', parseInt(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
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
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Botões */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 px-4 py-2 rounded-md text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: 'var(--crud-cancel)' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={
                isLoading ||
                Math.abs(remaining) >= 0.01 ||
                parts.some(p => p.subtag_id === 0) ||
                (expense && expense.amount < 0 && parts.some(p => p.amount >= 0)) ||
                (expense && expense.amount > 0 && parts.some(p => p.amount <= 0))
              }
              className="flex-1 px-4 py-2 text-white rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              style={{ backgroundColor: 'var(--crud-edit)' }}
            >
              {isLoading ? 'Dividindo...' : 'Dividir Despesa'}
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

export default SplitExpenseModal

