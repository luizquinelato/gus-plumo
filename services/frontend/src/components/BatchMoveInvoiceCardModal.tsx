import { useState, useEffect, useMemo } from 'react'
import axios from 'axios'
import { CreditCard } from 'lucide-react'
import Toast from './Toast'
import {
  CadastroModalShell,
  CadastroModalHeader,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroFormSection,
  CadastroFieldLabel,
  cadastroFieldCls,
} from './CadastroFormLayout'
import { useEscapeKey } from '../hooks/useEscapeKey'

interface SelectedItem {
  id: number
  source: 'bank' | 'card' | 'benefit'
}

export interface InvoiceCardMoveOption {
  cardId: number
  cardName: string
  cardNumber: string
}

interface BatchMoveInvoiceCardModalProps {
  isOpen: boolean
  onClose: () => void
  selectedItems: SelectedItem[]
  availableCards: InvoiceCardMoveOption[]
  /** Oculta o cartão de origem (ação por linha). */
  excludeCardId?: number | null
  onSuccess: (message?: string) => void
}

const BatchMoveInvoiceCardModal = ({
  isOpen,
  onClose,
  selectedItems,
  availableCards,
  excludeCardId = null,
  onSuccess,
}: BatchMoveInvoiceCardModalProps) => {
  const destinationCards = useMemo(
    () =>
      excludeCardId != null
        ? availableCards.filter((c) => c.cardId !== excludeCardId)
        : availableCards,
    [availableCards, excludeCardId],
  )
  const [targetCardId, setTargetCardId] = useState<number | ''>('')
  const [isLoading, setIsLoading] = useState(false)
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' | 'warning' }>({
    show: false,
    message: '',
    type: 'error',
  })

  useEscapeKey(onClose, isOpen)

  useEffect(() => {
    if (isOpen) {
      setTargetCardId('')
    }
  }, [isOpen])

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!targetCardId) {
      showToast('Selecione o cartão de destino', 'warning')
      return
    }

    setIsLoading(true)
    try {
      await axios.patch('/api/expenses/batch-update', {
        items: selectedItems.map((item) => ({ id: item.id, source: item.source })),
        target_credit_card_id: targetCardId,
      })
      onClose()
      onSuccess(`${selectedItems.length} lançamento(s) movido(s) com sucesso!`)
    } catch (error: unknown) {
      console.error('Erro ao mover lançamentos:', error)
      const detail = axios.isAxiosError(error) ? error.response?.data?.detail : null
      showToast(typeof detail === 'string' ? detail : 'Erro ao mover lançamentos', 'error')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <>
      {toast.show && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, show: false })} />
      )}

      <CadastroModalShell maxWidth="max-w-lg" onBackdropClick={onClose}>
        <CadastroModalHeader
          isEdit
          title="Mover para outro cartão"
          subtitle={`${selectedItems.length} lançamento(s) selecionado(s) — mesma fatura`}
          onClose={onClose}
          icon={<CreditCard size={18} />}
        />
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" id="batch-move-invoice-card-form">
          <CadastroModalBody>
            <CadastroFormSection title="Cartão de destino" icon={<CreditCard size={14} />}>
              <label className="block min-w-0">
                <CadastroFieldLabel>Cartão</CadastroFieldLabel>
                <select
                  value={targetCardId === '' ? '' : String(targetCardId)}
                  onChange={(e) => {
                    const raw = e.target.value
                    setTargetCardId(raw ? parseInt(raw, 10) : '')
                  }}
                  disabled={isLoading || destinationCards.length === 0}
                  className={`${cadastroFieldCls} mt-0.5 disabled:opacity-50`}
                >
                  <option value="">Selecione o cartão...</option>
                  {destinationCards.map((card) => (
                    <option key={card.cardId} value={card.cardId}>
                      {card.cardName} (•••• {card.cardNumber.slice(-4)})
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Apenas cartões que já possuem lançamentos neste mês da fatura.
              </p>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={onClose}
            onSave={() => void handleSubmit({ preventDefault: () => {} } as React.FormEvent)}
            saveLabel="Mover"
            closeLabel="Cancelar"
            disabled={isLoading}
            saving={isLoading}
          />
        </form>
      </CadastroModalShell>
    </>
  )
}

export default BatchMoveInvoiceCardModal
