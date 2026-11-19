/**
 * Hub de ações do extrato (editar, dividir, empréstimo, inverter, excluir) reutilizável fora do ExtratoPage.
 */

import { useCallback, useState } from 'react'
import axios from 'axios'
import { AlertTriangle, ArrowLeftRight } from 'lucide-react'
import ExtratoExpenseActionsModal, { type ExtratoExpenseHubAction } from './ExtratoExpenseActionsModal'
import EditExpenseModal, { type ExpenseEditSuccessPayload } from './EditExpenseModal'
import SplitExpenseModal from './SplitExpenseModal'
import SendToLoanModal from './SendToLoanModal'
import LinkedInvoiceItemsModal, { type LinkedInvoiceSummary } from './LinkedInvoiceItemsModal'
import {
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from './CadastroFormLayout'
import { useConfirm } from '../hooks/useConfirm'

export type ExtratoFlowExpense = {
  id: number
  date: string
  description: string
  amount: number
  source: string
  card_number: string | null
  card_name: string | null
  category: string | null
  subtag_id: number | null
  subtag_name: string | null
  tag_name: string | null
  ownership_percentage: number | null
  expense_sharing_id: number | null
  shared_partner_id: number | null
  shared_partner_name: string | null
  migrated_from_account_id: number | null
  linked_invoice?: LinkedInvoiceSummary | null
}

type Props = {
  expense: ExtratoFlowExpense | null
  hubOpen: boolean
  onClose: () => void
  onChanged: () => void
  onToast?: (message: string, type: 'success' | 'error') => void
}

export default function ExtratoExpenseFlowHost({
  expense,
  hubOpen,
  onClose,
  onChanged,
  onToast,
}: Props) {
  const { showConfirm, ConfirmComponent } = useConfirm()
  const [nested, setNested] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [loanOpen, setLoanOpen] = useState(false)
  const [linkedOpen, setLinkedOpen] = useState(false)
  const [linkedSummary, setLinkedSummary] = useState<LinkedInvoiceSummary | null>(null)
  const [invertOpen, setInvertOpen] = useState(false)
  const [invertLoading, setInvertLoading] = useState(false)

  const dismissAll = useCallback(() => {
    setNested(false)
    setEditOpen(false)
    setSplitOpen(false)
    setLoanOpen(false)
    setLinkedOpen(false)
    setInvertOpen(false)
    onClose()
  }, [onClose])

  const backToHub = useCallback(() => {
    setEditOpen(false)
    setSplitOpen(false)
    setLoanOpen(false)
    setInvertOpen(false)
    setNested(false)
  }, [])

  const notify = (msg: string, type: 'success' | 'error') => {
    onToast?.(msg, type)
  }

  const handleEditSuccess = (result: ExpenseEditSuccessPayload) => {
    dismissAll()
    onChanged()
    notify(result.message, 'success')
  }

  const handleDelete = () => {
    if (!expense || expense.source !== 'bank') return
    showConfirm(
      'Deletar lançamento',
      'Excluir este lançamento do extrato? A cópia na projeção também some.',
      async () => {
        try {
          await axios.delete(`/api/expenses/bank-statements/${expense.id}`)
          dismissAll()
          onChanged()
          notify('Lançamento excluído.', 'success')
        } catch (err) {
          console.error(err)
          notify('Erro ao excluir lançamento.', 'error')
        }
      },
      'Deletar',
      'Cancelar',
    )
  }

  const handleHubAction = (action: ExtratoExpenseHubAction) => {
    if (!expense) return
    setNested(true)
    switch (action) {
      case 'edit':
        setEditOpen(true)
        break
      case 'split':
        setSplitOpen(true)
        break
      case 'loan':
        setLoanOpen(true)
        break
      case 'invert':
        setInvertOpen(true)
        break
      case 'linked-invoice':
        setLinkedSummary(expense.linked_invoice ?? null)
        setLinkedOpen(true)
        break
      default:
        break
    }
  }

  const handleInvert = async () => {
    if (!expense?.shared_partner_id) return
    try {
      setInvertLoading(true)
      await axios.post('/api/expenses/batch-invert-sharing', {
        items: [
          {
            id: expense.id,
            source: expense.source === 'transaction' ? 'bank' : expense.source,
            target_account_id: expense.shared_partner_id,
          },
        ],
      })
      dismissAll()
      onChanged()
      notify('Compartilhamento invertido.', 'success')
    } catch (err) {
      console.error(err)
      notify('Erro ao inverter compartilhamento.', 'error')
    } finally {
      setInvertLoading(false)
    }
  }

  if (!expense) return <ConfirmComponent />

  const editExpense = {
    id: expense.id,
    source: 'bank' as const,
    description: expense.description,
    amount: expense.amount,
    date: expense.date,
    subtag_id: expense.subtag_id,
    subtag_name: expense.subtag_name,
    category: expense.category,
    card_number: expense.card_number,
    ownership_percentage: expense.ownership_percentage,
    shared_partner_id: expense.shared_partner_id,
    expense_sharing_id: expense.expense_sharing_id,
  }

  return (
    <>
      <ExtratoExpenseActionsModal
        isOpen={hubOpen && !nested}
        onClose={dismissAll}
        expense={expense}
        onAction={handleHubAction}
        onDelete={() => void handleDelete()}
      />
      <EditExpenseModal
        isOpen={editOpen}
        onClose={() => (nested ? dismissAll() : setEditOpen(false))}
        onBack={nested ? backToHub : undefined}
        expense={editExpense}
        onSuccess={handleEditSuccess}
      />
      <SplitExpenseModal
        isOpen={splitOpen}
        onClose={() => (nested ? dismissAll() : setSplitOpen(false))}
        onBack={nested ? backToHub : undefined}
        expense={editExpense}
        onSuccess={handleEditSuccess}
      />
      <SendToLoanModal
        isOpen={loanOpen}
        onClose={() => (nested ? dismissAll() : setLoanOpen(false))}
        onBack={nested ? backToHub : undefined}
        expense={editExpense}
        onSuccess={(msg) => {
          dismissAll()
          onChanged()
          if (msg) notify(msg, 'success')
        }}
      />
      <LinkedInvoiceItemsModal
        isOpen={linkedOpen}
        onClose={() => {
          setLinkedOpen(false)
          if (nested) backToHub()
        }}
        bankStatementId={expense.id}
        linkedSummary={linkedSummary}
      />
      {invertOpen && (
        <CadastroModalShell
          maxWidth="max-w-md"
          onBackdropClick={dismissAll}
          zClass="z-[60]"
        >
          <CadastroModalHeader
            isEdit={false}
            title="Inverter compartilhamento"
            onClose={dismissAll}
            icon={<ArrowLeftRight size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Aviso" icon={<AlertTriangle size={14} />}>
              <p className="text-sm text-amber-800 dark:text-amber-200">
                O lançamento será migrado para a conta parceira. Esta ação não pode ser desfeita.
              </p>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={dismissAll}
            onBack={backToHub}
            closeLabel="Fechar"
            onSave={() => void handleInvert()}
            saveLabel="Confirmar"
            saving={invertLoading}
          />
        </CadastroModalShell>
      )}
      <ConfirmComponent />
    </>
  )
}