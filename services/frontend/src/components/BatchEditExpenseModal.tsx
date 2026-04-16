import { useState, useEffect } from 'react'
import axios from 'axios'
import { X, Users, Tag as TagIcon, Percent } from 'lucide-react'
import Toast from './Toast'
import { useEscapeKey } from '../hooks/useEscapeKey'

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
  tag_type: string
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

interface SelectedItem {
  id: number
  source: 'bank' | 'card' | 'benefit'
}

interface BatchEditExpenseModalProps {
  isOpen: boolean
  onClose: () => void
  selectedItems: SelectedItem[]
  expenseType: 'despesa' | 'receita'
  onSuccess: (message?: string) => void
}

const BatchEditExpenseModal = ({ isOpen, onClose, selectedItems, expenseType, onSuccess }: BatchEditExpenseModalProps) => {
  const [tags, setTags] = useState<Tag[]>([])
  const [subtags, setSubtags] = useState<Subtag[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(true) // ✅ Inicia como true para evitar flash de conteúdo
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })

  // Form state - todos opcionais
  const [formData, setFormData] = useState({
    tag_id: 0,
    subtag_id: 0,
    adjustment_type: '' as '' | 'proprio' | 'compartilhado',
    shared_partner_id: null as number | null,
    ownership_percentage: ''
  })

  // Checkboxes para limpar valores
  const [clearSubtag, setClearSubtag] = useState(false)
  const [clearSharing, setClearSharing] = useState(false)

  useEscapeKey(onClose, isOpen)

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  // Carregar dados quando modal abre
  useEffect(() => {
    if (isOpen) {
      setIsLoadingData(true)
      // Reset form
      setFormData({
        tag_id: 0,
        subtag_id: 0,
        adjustment_type: '',
        shared_partner_id: null,
        ownership_percentage: ''
      })
      // Reset checkboxes de limpar
      setClearSubtag(false)
      setClearSharing(false)
      // Reset toast
      setToast({ show: false, message: '', type: 'success' })

      const loadAllData = async () => {
        try {
          await Promise.all([
            loadTags(),
            loadSubtags(),
            loadPartners()
          ])
        } finally {
          setIsLoadingData(false)
        }
      }

      loadAllData()
    } else {
      // Reset ao fechar
      setIsLoadingData(false)
      setToast({ show: false, message: '', type: 'success' })
    }
  }, [isOpen])

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

  const loadPartners = async () => {
    try {
      const response = await axios.get('/api/expense-sharing')
      setPartners(response.data)
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Verificar se pelo menos um campo foi preenchido ou marcado para limpar
    const hasSubtag = formData.subtag_id > 0
    const hasAdjustment = formData.adjustment_type !== ''

    if (!hasSubtag && !hasAdjustment && !clearSubtag && !clearSharing) {
      showToast('Preencha pelo menos um campo para atualizar ou marque para limpar', 'warning')
      return
    }

    setIsLoading(true)

    try {
      const payload: any = {
        items: selectedItems.map(item => ({ id: item.id, source: item.source }))
      }

      // Limpar subtag tem prioridade sobre definir subtag
      if (clearSubtag) {
        payload.clear_subtag = true  // Flag explícita para limpar subtag
      } else if (hasSubtag) {
        payload.subtag_id = formData.subtag_id
      }

      // Limpar compartilhamento tem prioridade sobre definir compartilhamento
      if (clearSharing) {
        payload.expense_sharing_id = 0  // 0 = remover compartilhamento
        payload.ownership_percentage = 100
      } else if (hasAdjustment) {
        if (formData.adjustment_type === 'proprio') {
          payload.expense_sharing_id = 0  // 0 = remover compartilhamento
          payload.ownership_percentage = 100
        } else if (formData.adjustment_type === 'compartilhado' && formData.shared_partner_id) {
          payload.expense_sharing_id = formData.shared_partner_id
          // Usar ?? ao invés de || para permitir 0 como valor válido
          const parsedPercentage = parseFloat(formData.ownership_percentage)
          payload.ownership_percentage = !isNaN(parsedPercentage) ? parsedPercentage : 50
        }
      }

      await axios.patch('/api/expenses/batch-update', payload)
      const successMessage = `${selectedItems.length} registro(s) atualizado(s) com sucesso!`
      // Fecha o modal primeiro, depois mostra o toast na página pai
      onClose()
      onSuccess(successMessage)
    } catch (error: any) {
      console.error('Erro ao atualizar em lote:', error)
      showToast(error.response?.data?.detail || 'Erro ao atualizar registros', 'error')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Toast só aparece se show=true E não estiver carregando dados */}
      {toast.show && !isLoadingData && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}

      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div
          className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative"
          data-modal="batch-edit-expense"
        >
          {/* ✅ Loading overlay cobrindo todo o modal */}
          {isLoadingData && (
            <div className="absolute inset-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm z-50 rounded-xl flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mx-auto mb-3"></div>
                <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Carregando dados...</p>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Editar em Lote
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {selectedItems.length} {expenseType === 'despesa' ? 'despesa(s)' : 'receita(s)'} selecionada(s)
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X size={20} className="text-gray-500" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Tag e Subtag */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <TagIcon size={16} />
                Tag / Subtag
              </label>

              <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${clearSubtag ? 'opacity-50 pointer-events-none' : ''}`}>
                {/* Tag */}
                <div>
                  <select
                    value={formData.tag_id || ''}
                    onChange={(e) => {
                      const newTagId = parseInt(e.target.value) || 0
                      setFormData({ ...formData, tag_id: newTagId, subtag_id: 0 })
                    }}
                    disabled={isLoading || clearSubtag}
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
                  <select
                    value={formData.subtag_id || ''}
                    onChange={(e) => setFormData({ ...formData, subtag_id: parseInt(e.target.value) || 0 })}
                    disabled={isLoading || !formData.tag_id || clearSubtag}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                  >
                    <option value="">
                      {formData.tag_id === 0 ? 'Selecione uma tag primeiro' : 'Selecione uma subtag...'}
                    </option>
                    {subtags
                      .filter(subtag => {
                        if (subtag.tag_id !== formData.tag_id) return false
                        return subtag.tag_type === expenseType
                      })
                      .map(subtag => (
                        <option key={subtag.id} value={subtag.id}>
                          {subtag.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Checkbox limpar - abaixo dos campos */}
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={clearSubtag}
                  onChange={(e) => {
                    setClearSubtag(e.target.checked)
                    if (e.target.checked) {
                      setFormData({ ...formData, tag_id: 0, subtag_id: 0 })
                    }
                  }}
                  disabled={isLoading}
                  className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                />
                <span className="text-xs text-red-600 dark:text-red-400 font-medium">Limpar categoria</span>
              </label>
            </div>

            {/* Compartilhamento */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Users size={16} />
                Compartilhamento
              </label>

              {/* Tipo de Ajuste e Parceiro - desabilitado se clearSharing */}
              <div className={`space-y-3 ${clearSharing ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="proprio"
                      checked={formData.adjustment_type === 'proprio'}
                      onChange={() => setFormData({
                        ...formData,
                        adjustment_type: 'proprio',
                        shared_partner_id: null,
                        ownership_percentage: '100.00'
                      })}
                      disabled={isLoading || clearSharing}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Próprio (100%)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="compartilhado"
                      checked={formData.adjustment_type === 'compartilhado'}
                      onChange={() => setFormData({
                        ...formData,
                        adjustment_type: 'compartilhado'
                      })}
                      disabled={isLoading || clearSharing}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Compartilhado</span>
                  </label>
                </div>

                {/* Parceiro Compartilhado (condicional) */}
                {formData.adjustment_type === 'compartilhado' && !clearSharing && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2">
                      <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                        Parceiro *
                      </label>
                      <select
                        value={formData.shared_partner_id || 0}
                        onChange={(e) => {
                          const partnerId = Number(e.target.value) || null
                          const selectedPartner = partners.find(p => p.id === partnerId)
                          setFormData({
                            ...formData,
                            shared_partner_id: partnerId,
                            ownership_percentage: selectedPartner ? selectedPartner.my_contribution_percentage.toString() : '50.00'
                          })
                        }}
                        disabled={isLoading}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                        required
                      >
                        <option value={0}>Selecione um compartilhamento</option>
                        {[...partners]
                          .sort((a, b) => {
                            const nameA = a.shared_account?.name || a.shared_account?.description || ''
                            const nameB = b.shared_account?.name || b.shared_account?.description || ''
                            return nameA.localeCompare(nameB, 'pt-BR')
                          })
                          .map(partner => (
                            <option key={partner.id} value={partner.id}>
                              {getPartnerLabel(partner)}
                            </option>
                          ))
                        }
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                        Minha Contribuição (%)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={formData.ownership_percentage}
                        onChange={(e) => setFormData({ ...formData, ownership_percentage: e.target.value })}
                        disabled={isLoading || isLoadingData}
                        placeholder="0.00"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Checkbox limpar - abaixo dos campos */}
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={clearSharing}
                  onChange={(e) => {
                    setClearSharing(e.target.checked)
                    if (e.target.checked) {
                      setFormData({ ...formData, adjustment_type: '', shared_partner_id: null, ownership_percentage: '' })
                    }
                  }}
                  disabled={isLoading}
                  className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                />
                <span className="text-xs text-red-600 dark:text-red-400 font-medium">Limpar compartilhamento</span>
              </label>
            </div>

            {/* Botões */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Atualizando...
                  </>
                ) : (
                  `Atualizar ${selectedItems.length} registro(s)`
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

export default BatchEditExpenseModal

