import {
  Banknote,
  Braces,
  ChevronRight,
  Download,
  Edit2,
  Eye,
  Landmark,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import {
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from './CadastroFormLayout'
import { useEscapeKey } from '../hooks/useEscapeKey'

export type SharedBalanceClosureHubAction =
  | 'view'
  | 'edit-notes'
  | 'delete'
  | 'recalc'
  | 'json'
  | 'export'
  | 'payment'
  | 'unsettle'
  | 'settle-loan'
  | 'view-loan'

export type ClosureSettlementStatus = 'pending' | 'settled' | 'loan_open' | 'settled_via_loan'

export interface SharedBalanceClosureActionsTarget {
  id: number
  month: number
  year: number
  settlement_status?: ClosureSettlementStatus | string | null
  is_settled: boolean
  remaining_balance?: number
  settlement_loan_id?: number | null
  partner_label?: string | null
}

interface SharedBalanceClosureActionsModalProps {
  isOpen: boolean
  onClose: () => void
  closure: SharedBalanceClosureActionsTarget | null
  onAction: (action: SharedBalanceClosureHubAction) => void
  /** `edit`: só ações de gestão (abre pelo lápis na lista). `all`: hub completo. */
  menuScope?: 'edit' | 'all'
}

function effectiveStatus(c: SharedBalanceClosureActionsTarget): ClosureSettlementStatus {
  if (c.settlement_status) return c.settlement_status as ClosureSettlementStatus
  return c.is_settled ? 'settled' : 'pending'
}

type ActionRow = {
  id: SharedBalanceClosureHubAction
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

export default function SharedBalanceClosureActionsModal({
  isOpen,
  onClose,
  closure,
  onAction,
  menuScope = 'edit',
}: SharedBalanceClosureActionsModalProps) {
  useEscapeKey(onClose, isOpen)

  if (!isOpen || !closure) return null

  const status = effectiveStatus(closure)
  const remaining = Math.max(0, parseFloat(String(closure.remaining_balance ?? 0)))
  const canPix = status === 'pending'
  const canSettleLoan = canPix && remaining > 0.01
  const canPayment = canPix
  const canUnsettle = status === 'settled'
  const canDelete = status === 'pending' || status === 'loan_open'

  const rows: ActionRow[] = [
    {
      id: 'view',
      label: 'Visualizar',
      hint: 'Detalhes, itens e totais do período',
      icon: <Eye size={18} className="shrink-0 text-[var(--color-1)]" />,
      show: true,
      disabled: false,
    },
    {
      id: 'edit-notes',
      label: 'Notas do fechamento',
      hint: 'Observações gerais do fechamento',
      icon: <Edit2 size={18} className="shrink-0 text-[var(--color-1)]" />,
      show: true,
      disabled: false,
    },
    {
      id: 'delete',
      label: 'Excluir fechamento',
      hint: 'Reabre o período para novo fechamento',
      icon: <Trash2 size={18} className="shrink-0 text-red-600" />,
      show: true,
      disabled: !canDelete,
      disabledReason:
        status === 'settled_via_loan'
          ? 'Quitado via empréstimo — reabra o empréstimo antes'
          : status === 'settled'
            ? 'Remova a quitação antes de excluir'
            : undefined,
    },
    {
      id: 'payment',
      label: 'Pagamento / quitar (PIX)',
      hint: 'Registrar pagamento parcial ou quitação em dinheiro',
      icon: <Plus size={18} className="shrink-0 text-[var(--color-1)]" />,
      show: true,
      disabled: !canPayment,
      disabledReason: status === 'loan_open' ? 'Dívida está no empréstimo vinculado' : undefined,
    },
    {
      id: 'settle-loan',
      label: 'Gerar empréstimo e encerrar acerto',
      hint: 'Transfere o saldo restante para Empréstimos',
      icon: <Landmark size={18} className="shrink-0 text-amber-600" />,
      show: true,
      disabled: !canSettleLoan,
      disabledReason: !canPix ? 'Disponível apenas para fechamentos pendentes' : 'Sem saldo restante',
    },
    {
      id: 'view-loan',
      label: 'Ver empréstimo vinculado',
      hint: closure.settlement_loan_id ? `Empréstimo #${closure.settlement_loan_id}` : '',
      icon: <Landmark size={18} className="shrink-0 text-amber-600" />,
      show: Boolean(closure.settlement_loan_id),
      disabled: !closure.settlement_loan_id,
    },
    {
      id: 'unsettle',
      label: 'Remover quitação',
      hint: 'Volta o fechamento para pendente',
      icon: <Lock size={18} className="shrink-0 text-green-600" />,
      show: canUnsettle,
      disabled: !canUnsettle,
    },
    {
      id: 'recalc',
      label: 'Recalcular',
      hint: 'Comparar snapshot com lançamentos atuais',
      icon: <RefreshCw size={18} className="shrink-0 text-[var(--color-1)]" />,
      show: true,
      disabled: false,
    },
    {
      id: 'json',
      label: 'Ver JSON',
      hint: 'Snapshot completo do fechamento',
      icon: <Braces size={18} className="shrink-0 text-[var(--color-1)]" />,
      show: true,
      disabled: false,
    },
    {
      id: 'export',
      label: 'Exportar',
      hint: 'Planilha ou relatório do fechamento',
      icon: <Download size={18} className="shrink-0 text-[var(--color-1)]" />,
      show: true,
      disabled: false,
    },
  ]

  const rowList =
    menuScope === 'edit'
      ? rows.filter((r) => r.show && r.id !== 'view' && r.id !== 'delete')
      : rows.filter((r) => r.show)

  const primaryIds = new Set<SharedBalanceClosureHubAction>(['view', 'edit-notes', 'delete'])
  const primary = menuScope === 'all' ? rowList.filter((r) => primaryIds.has(r.id)) : []
  const secondary = menuScope === 'all' ? rowList.filter((r) => !primaryIds.has(r.id)) : rowList

  const periodLabel = `${String(closure.month).padStart(2, '0')}/${closure.year}`

  const renderRow = (row: ActionRow) => (
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
        <span className="block text-sm font-medium text-gray-900 dark:text-white">{row.label}</span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">{row.hint}</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-gray-400" />
    </button>
  )

  return (
    <CadastroModalShell maxWidth="max-w-md" onBackdropClick={onClose}>
      <CadastroModalHeader
        isEdit={menuScope === 'edit'}
        title={menuScope === 'edit' ? 'Editar fechamento' : 'Ações do fechamento'}
        onClose={onClose}
        icon={menuScope === 'edit' ? <Edit2 size={18} /> : <Banknote size={18} />}
      />
      <CadastroModalBody>
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-900/50">
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            Fechamento {periodLabel}
            {closure.partner_label ? ` · ${closure.partner_label}` : ''}
          </p>
        </div>
        {menuScope === 'all' && (
          <>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Principais
            </p>
            <div className="flex flex-col gap-2">{primary.map(renderRow)}</div>
            <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Mais ações
            </p>
          </>
        )}
        <div className="flex flex-col gap-2">{secondary.map(renderRow)}</div>
      </CadastroModalBody>
      <CadastroModalFooter onClose={onClose} closeLabel="Fechar" hideSave />
    </CadastroModalShell>
  )
}