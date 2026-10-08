import type { ReactNode } from 'react'
import { CadastroFormSection } from './CadastroFormLayout'
import { listPageTableRowHoverCls, listPageTableSectionCls } from './CadastroListPageLayout'
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react'

export type ImportModalMessageVariant = 'error' | 'warning' | 'info'

const importModalMessageStyles: Record<
  ImportModalMessageVariant,
  { box: string; title: string; body: string; label: string }
> = {
  error: {
    box: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20',
    title: 'text-red-800 dark:text-red-200',
    body: 'text-red-700 dark:text-red-300',
    label: 'Erro',
  },
  warning: {
    box: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20',
    title: 'text-amber-900 dark:text-amber-100',
    body: 'text-amber-800 dark:text-amber-200',
    label: 'Atenção',
  },
  info: {
    box: 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20',
    title: 'text-blue-900 dark:text-blue-100',
    body: 'text-blue-800 dark:text-blue-200',
    label: 'Informação',
  },
}

export function ImportModalMessageBanner({
  message,
  variant = 'error',
  onDismiss,
}: {
  message: string
  variant?: ImportModalMessageVariant
  onDismiss?: () => void
}) {
  const styles = importModalMessageStyles[variant]
  const Icon = variant === 'info' ? Info : variant === 'warning' ? AlertTriangle : AlertCircle
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-4 ${styles.box}`} role="alert">
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${styles.title}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${styles.title}`}>{styles.label}</p>
        <p className={`mt-1 whitespace-pre-wrap text-sm ${styles.body}`}>{message}</p>
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className={`shrink-0 rounded p-0.5 opacity-70 hover:opacity-100 ${styles.title}`}
          aria-label="Fechar mensagem"
        >
          <X size={16} />
        </button>
      ) : null}
    </div>
  )
}

export const importPreviewCardCls =
  'rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 border-l-4'
export const importPreviewUpdateCardCls = `${importPreviewCardCls} border-l-[var(--color-1)]`
export const importPreviewCreateCardCls = `${importPreviewCardCls} border-l-green-500`

const headCls =
  'bg-gray-100 dark:bg-gray-800/80 [&_th]:border-b-2 [&_th]:border-gray-200 dark:[&_th]:border-gray-600'
const thCls =
  'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
const tdCls = 'border-b border-gray-200 px-3 py-2 align-top dark:border-gray-600'
const tdMutedCls = `${tdCls} text-xs text-gray-600 dark:text-gray-300`

const ENTITY_LABELS: Record<string, string> = {
  conta: 'Conta',
  tag: 'Tag',
  subtag: 'Subtag',
  template: 'Template',
  template_item: 'Item template',
  compartilhamento: 'Compart.',
  cartao: 'Cartão',
  grupo_fatura: 'Grupo',
  mapeamento: 'Mapa',
}

export function entityDisplayLabel(entity: string | null | undefined): string {
  if (!entity) return 'Cadastro'
  return ENTITY_LABELS[entity] ?? entity
}

export function MetricDivider() {
  return (
    <div className="mx-1 hidden w-px shrink-0 self-stretch min-h-[2.75rem] bg-gray-200 dark:bg-gray-600 sm:block" />
  )
}

export function PreviewCardLayout({ info, metrics }: { info: ReactNode; metrics: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
      <div className="min-w-0 flex-1 sm:max-w-[min(100%,22rem)]">{info}</div>
      <div className="hidden w-px shrink-0 self-stretch bg-gray-200 dark:bg-gray-600 sm:block" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-1 gap-y-2">{metrics}</div>
    </div>
  )
}

export function MetricColumn({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`min-w-[4.5rem] max-w-[11rem] shrink-0 self-start text-left ${className}`}>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <div className="mt-0.5 text-sm font-bold normal-case text-gray-900 dark:text-white">{children}</div>
    </div>
  )
}

export function StringChangeMetricColumn({
  label,
  before,
  after,
  wide = false,
}: {
  label: string
  before: string
  after: string
  wide?: boolean
}) {
  const valueCls = wide ? 'whitespace-normal break-words' : 'truncate'
  return (
    <div
      className={`shrink-0 self-start text-left ${wide ? 'min-w-[8rem] max-w-[18rem]' : 'min-w-[4.5rem] max-w-[10rem]'}`}
    >
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-xs text-gray-500 line-through dark:text-gray-400 ${valueCls}`} title={before}>
        {before}
      </p>
      <p className={`text-sm font-bold text-gray-900 dark:text-white ${valueCls}`} title={after}>
        {after}
      </p>
    </div>
  )
}

export function PreviewRowMeta({
  row,
  entity,
  recordId,
}: {
  row: number
  entity?: string | null
  recordId?: number | null
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
      {entity ? (
        <span
          className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--on-color-1)]"
          style={{ background: 'var(--color-1)' }}
        >
          {entityDisplayLabel(entity)}
        </span>
      ) : null}
      <span className="tabular-nums">Linha {row}</span>
      {recordId != null ? <span className="tabular-nums">#{recordId}</span> : null}
    </div>
  )
}

export function ImportPreviewIssuesSection({
  issues,
}: {
  issues: Array<{ row: number; reason: string; source?: string }>
}) {
  if (!issues.length) return null
  return (
    <CadastroFormSection title={`Problemas (${issues.length})`} icon={<AlertTriangle size={14} />}>
      <div className={`${listPageTableSectionCls} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className={headCls}>
            <tr>
              <th className={`${thCls} w-20`}>Linha</th>
              <th className={thCls}>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, i) => (
              <tr key={`${issue.row}-${i}`} className={listPageTableRowHoverCls}>
                <td className={`${tdCls} tabular-nums`}>{issue.row}</td>
                <td className={tdMutedCls}>{issue.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CadastroFormSection>
  )
}
