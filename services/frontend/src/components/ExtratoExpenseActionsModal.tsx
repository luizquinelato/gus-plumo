import {
  ArrowLeftRight,
  ChevronRight,
  Edit2,
  Link2,
  Split,
  Wallet,
} from 'lucide-react'
import {
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from './CadastroFormLayout'
import { useEscapeKey } from '../hooks/useEscapeKey'

export type ExtratoExpenseHubAction =
  | 'edit'
  | 'split'
  | 'loan'
  | 'invert'
  | 'linked-invoice'

export interface ExtratoExpenseActionsTarget {
  description: string
  amount: number
  date: string
  source: string
  linked_invoice?: { id?: number; match_id?: number; description?: string | null; display_name?: string | null } | null
  shared_partner_id: number | null
  migrated_from_account_id: number | null
}

interface ExtratoExpenseActionsModalProps {
  isOpen: boolean
  onClose: () => void
  expense: ExtratoExpenseActionsTarget | null
  /** Seleção em lote ativa — desabilita ações que exigem linha única. */
  selectionActive?: boolean
  onAction: (action: ExtratoExpenseHubAction) => void
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatDateTime(dateStr: string) {
  const date = new Date(dateStr)
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type ActionRow = {
  id: ExtratoExpenseHubAction
  label: string
  hint: string
  icon: React.ReactNode
  show: boolean
  disabled: boolean
  disabledReason?: string
}

function hubRowBtnCls(enabled: boolean) {
  return enabled
    ? 'flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-[var(--color-1)] hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700/50'
    : 'flex w-full cursor-not-allowed items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-left opacity-60 dark:border-gray-700 dark:bg-gray-900/40'
}

export default function ExtratoExpenseActionsModal({
  isOpen,
  onClose,
  expense,
  selectionActive = false,
  onAction,
}: ExtratoExpenseActionsModalProps) {
  useEscapeKey(onClose, isOpen)

  if (!isOpen || !expense) return null

  const invertDisabled =
    selectionActive ||
    !expense.shared_partner_id ||
    !!expense.migrated_from_account_id

  const rows: ActionRow[] = [
    {
      id: 'edit',
      label: 'Editar lançamento',
      hint: 'Data, descrição, tags e compartilhamento',
      icon: <Edit2 size={18} className="shrink-0 text-[var(--color-1)]" />,
      show: true,
      disabled: selectionActive,
      disabledReason: selectionActive ? 'Limpe a seleção em lote' : undefined,
    },
    {
      id: 'split',
      label: 'Dividir',
      hint: 'Separar o valor em vários lançamentos',
      icon: <Split size={18} className="shrink-0 text-[var(--color-1)]" />,
      show: true,
      disabled: selectionActive,
      disabledReason: selectionActive ? 'Limpe a seleção em lote' : undefined,
    },
    {
      id: 'loan',
      label: 'Enviar para empréstimo',
      hint: 'Registrar como movimentação de empréstimo',
      icon: <Wallet size={18} className="shrink-0 text-[var(--color-1)]" />,
      show: true,
      disabled: selectionActive,
      disabledReason: selectionActive ? 'Limpe a seleção em lote' : undefined,
    },
    {
      id: 'invert',
      label: 'Inverter compartilhamento',
      hint: 'Migrar o lançamento para a conta parceira',
      icon: <ArrowLeftRight size={18} className="shrink-0 text-[var(--color-1)]" />,
      show: true,
      disabled: invertDisabled,
      disabledReason: selectionActive
        ? 'Limpe a seleção em lote'
        : expense.migrated_from_account_id
          ? 'Item já foi invertido'
          : !expense.shared_partner_id
            ? 'Lançamento sem compartilhamento'
            : undefined,
    },
    {
      id: 'linked-invoice',
      label: 'Ver itens da fatura vinculada',
      hint: 'Abrir a fatura de cartão relacionada',
      icon: <Link2 size={18} className="shrink-0 text-[var(--color-1)]" />,
      show: expense.source === 'bank' && !!expense.linked_invoice,
      disabled: selectionActive,
      disabledReason: selectionActive ? 'Limpe a seleção em lote' : undefined,
    },
  ]

  const visibleRows = rows.filter((r) => r.show)

  return (
    <CadastroModalShell maxWidth="max-w-md" onBackdropClick={onClose}>
      <CadastroModalHeader isEdit={false} title="Ações do lançamento" onClose={onClose} />
      <CadastroModalBody>
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-900/50">
          <p className="text-sm font-medium text-gray-900 dark:text-white break-words">
            {expense.description}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {formatDateTime(expense.date)} · {formatCurrency(expense.amount)}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {visibleRows.map((row) => (
            <button
              key={row.id}
              type="button"
              disabled={row.disabled}
              title={row.disabled ? row.disabledReason : row.hint}
              className={hubRowBtnCls(!row.disabled)}
              onClick={() => {
                if (row.disabled) return
                onAction(row.id)
              }}
            >
              {row.icon}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 dark:text-white">
                  {row.label}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{row.hint}</span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-gray-400" />
            </button>
          ))}
        </div>
      </CadastroModalBody>
      <CadastroModalFooter onClose={onClose} closeLabel="Fechar" hideSave />
    </CadastroModalShell>
  )
}