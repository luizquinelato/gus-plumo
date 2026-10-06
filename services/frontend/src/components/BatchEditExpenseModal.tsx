import { useState, useEffect } from 'react'
import axios from 'axios'
import { Users, Tag as TagIcon, Pencil } from 'lucide-react'
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
  cadastroOptionLabelCls,
  cadastroAccentControlCls,
} from './CadastroFormLayout'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { sharingPartnerLabel, sharingPercentForKind } from '../utils/accountFormatter'
import OwnershipPercentField from './OwnershipPercentField'
import { finalizePercentInput, maskPercentInput } from '../utils/percentInput'

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
  revenue_contribution_percentage?: number
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

  const getPartnerLabel = (partner: Partner): string => sharingPartnerLabel(partner)

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
      {toast.show && !isLoadingData && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}

      <CadastroModalShell maxWidth="max-w-2xl">
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
            title="Editar em Lote"
            subtitle={`${selectedItems.length} ${expenseType === 'despesa' ? 'despesa(s)' : 'receita(s)'} selecionada(s)`}
            onClose={onClose}
            icon={<Pencil size={18} />}
          />
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" id="batch-edit-expense-form">
            <CadastroModalBody>
              <CadastroFormSection title="Classificação" icon={<TagIcon size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow cols={2}>
                    <label className={`block min-w-0 ${clearSubtag ? 'opacity-50 pointer-events-none' : ''}`}>
                      <CadastroFieldLabel>Tag</CadastroFieldLabel>
                      <select
                        value={formData.tag_id || ''}
                        onChange={(e) => {
                          const newTagId = parseInt(e.target.value) || 0
                          setFormData({ ...formData, tag_id: newTagId, subtag_id: 0 })
                        }}
                        disabled={isLoading || clearSubtag}
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
                    <label className={`block min-w-0 ${clearSubtag ? 'opacity-50 pointer-events-none' : ''}`}>
                      <CadastroFieldLabel>Subtag</CadastroFieldLabel>
                      <select
                        value={formData.subtag_id || ''}
                        onChange={(e) => setFormData({ ...formData, subtag_id: parseInt(e.target.value) || 0 })}
                        disabled={isLoading || !formData.tag_id || clearSubtag}
                        className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
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
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className={cadastroOptionLabelCls}>
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
                        className={`${cadastroAccentControlCls} h-4 w-4 rounded border-gray-300`}
                      />
                      <span className="text-xs font-medium text-red-600 dark:text-red-400">Limpar categoria</span>
                    </label>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>

              <CadastroFormSection title="Compartilhamento" icon={<Users size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow>
                    <div className={`flex flex-wrap gap-4 ${clearSharing ? 'opacity-50 pointer-events-none' : ''}`}>
                      <label className={cadastroOptionLabelCls}>
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
                          className={cadastroAccentControlCls}
                        />
                        Próprio (100%)
                      </label>
                      <label className={cadastroOptionLabelCls}>
                        <input
                          type="radio"
                          value="compartilhado"
                          checked={formData.adjustment_type === 'compartilhado'}
                          onChange={() => setFormData({
                            ...formData,
                            adjustment_type: 'compartilhado'
                          })}
                          disabled={isLoading || clearSharing}
                          className={cadastroAccentControlCls}
                        />
                        Compartilhado
                      </label>
                    </div>
                  </CadastroModalFieldsRow>
                  {formData.adjustment_type === 'compartilhado' && !clearSharing ? (
                    <CadastroModalFieldsRow cols={2}>
                      <label className="block min-w-0">
                        <CadastroFieldLabel required>Parceiro</CadastroFieldLabel>
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
                                    expenseType === 'receita' ? 'revenue' : 'expense'
                                  ).toString()
                                : '50.00'
                            })
                          }}
                          disabled={isLoading}
                          className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
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
                            ownership_percentage: finalizePercentInput(prev.ownership_percentage),
                          }))
                        }
                        disabled={isLoading || isLoadingData}
                      />
                    </CadastroModalFieldsRow>
                  ) : null}
                  <CadastroModalFieldsRow>
                    <label className={cadastroOptionLabelCls}>
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
                        className={`${cadastroAccentControlCls} h-4 w-4 rounded border-gray-300`}
                      />
                      <span className="text-xs font-medium text-red-600 dark:text-red-400">Limpar compartilhamento</span>
                    </label>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={onClose}
              onSave={() => {
                const form = document.getElementById('batch-edit-expense-form') as HTMLFormElement | null
                form?.requestSubmit()
              }}
              saving={isLoading}
              disabled={isLoading}
              saveLabel={`Atualizar ${selectedItems.length} registro(s)`}
            />
          </form>
        </div>
      </CadastroModalShell>
    </>
  )
}

export default BatchEditExpenseModal

