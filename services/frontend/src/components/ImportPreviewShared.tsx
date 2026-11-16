import { useState, type ReactNode } from 'react'
import { formatCurrencyWithColor, parseLocaleAmount } from '../utils/currency'
import { CadastroListPageEmptyCard, listPageTableRowHoverCls, listPageTableSectionCls } from './CadastroListPageLayout'
import { AlertCircle, AlertTriangle, ChevronDown, Inbox, Info, X } from 'lucide-react'
import { ListTableSortableHeader, type ListTableSortDirection } from './ListTableSelectColumns'
import Badge from './Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'

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

function signedNumberColorClass(n: number): string {
  if (n < 0) return 'text-red-600 dark:text-red-400'
  if (n > 0) return 'text-green-600 dark:text-green-400'
  return 'text-gray-600 dark:text-gray-400'
}

function parsePreviewNumeric(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  const fromLocale = parseLocaleAmount(value)
  if (fromLocale != null) return fromLocale
  const text = String(value).trim().replace(/%/g, '')
  if (!text || text === '—') return null
  const n = Number(text.replace(/\s/g, '').replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

export function isPreviewAmountFieldLabel(label: string): boolean {
  const f = label.trim().toLowerCase()
  return f === 'valor' || f === 'amount'
}

export function isPreviewPercentFieldLabel(label: string): boolean {
  const f = label.trim().toLowerCase()
  return (
    f === 'ownership_pct' ||
    f === 'ownership' ||
    f === 'minha %' ||
    f === 'parte (%)' ||
    f === 'contrib.' ||
    f === 'contribution' ||
    f.startsWith('contribuição') ||
    f.startsWith('parte ') ||
    f.includes('(%)')
  )
}

export function previewAmountCell(value: number | null | undefined): ReactNode {
  if (value == null || Number.isNaN(value)) return '—'
  return formatCurrencyWithColor(value)
}

export function previewPercentCell(value: number | null | undefined): ReactNode {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const n = Number(value)
  return (
    <span className={signedNumberColorClass(n)}>
      {`${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`}
    </span>
  )
}

export function previewFieldValueCell(fieldLabel: string, value: unknown): ReactNode {
  if (value == null || value === '') return '—'
  if (isPreviewAmountFieldLabel(fieldLabel)) {
    const n = parsePreviewNumeric(value)
    if (n != null) return formatCurrencyWithColor(n)
  }
  if (isPreviewPercentFieldLabel(fieldLabel)) {
    const n = parsePreviewNumeric(value)
    if (n != null) return previewPercentCell(n)
  }
  return String(value)
}

/** Célula de coluna dinâmica (cabeçalho = nome do campo na planilha). */
export function previewTableColumnCell(columnLabel: string, value: unknown): ReactNode {
  if (value == null || value === '' || value === '—') return '—'
  return previewFieldValueCell(columnLabel, value)
}

function looksLikeCurrencyText(text: string): boolean {
  const t = text.trim()
  return t.includes('R$') || /^-?[\d.,]+$/.test(t)
}

/** Valores compostos “A · B” (ex.: conflito tag + valor). */
export function previewCompoundFieldValueCell(fieldLabel: string, text: string): ReactNode {
  if (!text || text === '—') return text || '—'
  const amountField = isPreviewAmountFieldLabel(fieldLabel) || fieldLabel.toLowerCase().includes('valor')
  const parts = text.split(' · ')
  if (parts.length === 1) {
    if (amountField) {
      const n = parsePreviewNumeric(parts[0])
      if (n != null && looksLikeCurrencyText(parts[0])) return formatCurrencyWithColor(n)
    }
    return text
  }
  return (
    <>
      {parts.map((part, index) => {
        const n = parsePreviewNumeric(part)
        const colored = amountField && n != null && looksLikeCurrencyText(part)
        return (
          <span key={`${index}-${part}`}>
            {index > 0 ? ' · ' : null}
            {colored ? formatCurrencyWithColor(n) : part}
          </span>
        )
      })}
    </>
  )
}

export const importPreviewCardCls =
  'rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 border-l-4'
export const importPreviewUpdateCardCls = `${importPreviewCardCls} border-l-[var(--color-1)]`
export const importPreviewCreateCardCls = `${importPreviewCardCls} border-l-green-500`

const headCls =
  'bg-gray-100 dark:bg-gray-800/80 [&_th]:border-b-2 [&_th]:border-gray-200 dark:[&_th]:border-gray-600'
const tdCls = 'border-b border-gray-200 px-3 py-2 dark:border-gray-600'
const tdWrapCls = 'border-b border-gray-200 px-2 py-2 break-words [overflow-wrap:anywhere] dark:border-gray-600'

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

const sectionToneCls = {
  default: {
    box: 'border-gray-200 dark:border-gray-700',
    header: 'text-gray-900 dark:text-gray-100',
    chevron: 'text-gray-500',
    divider: 'border-gray-200 dark:border-gray-700',
  },
  warning: {
    box: 'border-amber-300 border-l-4 border-l-amber-500 dark:border-amber-700 dark:border-l-amber-500',
    header: 'bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-100',
    chevron: 'text-amber-600 dark:text-amber-300',
    divider: 'border-amber-200 dark:border-amber-800',
  },
}

export function CollapsiblePreviewSection({
  title,
  children,
  defaultOpen = false,
  tone = 'default',
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  tone?: keyof typeof sectionToneCls
}) {
  const [open, setOpen] = useState(defaultOpen)
  const cls = sectionToneCls[tone]
  return (
    <section className={`overflow-hidden rounded-xl border bg-white dark:bg-gray-800 ${cls.box}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium ${cls.header}`}
      >
        <ChevronDown size={16} className={`shrink-0 transition-transform ${cls.chevron} ${open ? '' : '-rotate-90'}`} />
        {tone === 'warning' ? <AlertTriangle size={16} className={`shrink-0 ${cls.chevron}`} /> : null}
        {title}
      </button>
      {open ? <div className={`border-t px-4 py-3 ${cls.divider}`}>{children}</div> : null}
    </section>
  )
}

const SKIPPED_ISSUE_ACTIONS = new Set(['Não será criado', 'Não será alterado', 'Linha ignorada'])

export function IssueActionBadge({ action }: { action?: string | null }) {
  if (!action) return <>—</>
  return (
    <Badge
      variant={badgeVariantForColumnRole('scope')}
      tone={SKIPPED_ISSUE_ACTIONS.has(action) ? 'danger' : 'warning'}
      label={action}
    />
  )
}

export function PreviewEmptyState({ unchanged = 0 }: { unchanged?: number }) {
  const description = unchanged
    ? `${unchanged} ${unchanged === 1 ? 'registro já está igual' : 'registros já estão iguais'}.`
    : 'Nenhuma adição ou alteração neste arquivo.'
  return (
    <CadastroListPageEmptyCard
      icon={<Inbox size={32} className="text-gray-400" />}
      title="Nada para gravar"
      description={description}
    />
  )
}

export type PreviewSortValue = string | number | null | undefined

function sortableNumber(text: string): number | null {
  const date = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (date) {
    return new Date(
      Number(date[3]),
      Number(date[2]) - 1,
      Number(date[1]),
      Number(date[4] ?? 0),
      Number(date[5] ?? 0),
    ).getTime()
  }
  const cleaned = text.replace(/R\$\s?/, '').replace(/%$/, '').trim()
  if (!/^-?[\d.,]+$/.test(cleaned)) return null
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

const PREVIEW_PAGE_SIZE = 200

function compareSortValues(a: PreviewSortValue, b: PreviewSortValue): number {
  const emptyA = a == null || a === '' || a === '—'
  const emptyB = b == null || b === '' || b === '—'
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const textA = String(a)
  const textB = String(b)
  const numA = typeof a === 'number' ? a : sortableNumber(textA)
  const numB = typeof b === 'number' ? b : sortableNumber(textB)
  if (numA != null && numB != null) return numA - numB
  return textA.localeCompare(textB, 'pt-BR', { numeric: true, sensitivity: 'base' })
}

function cellSortValue(cell: ReactNode): PreviewSortValue {
  if (typeof cell === 'string' || typeof cell === 'number') return cell
  return null
}

export function PreviewDataTable({
  columns,
  rows,
  sortValues,
  wrap = false,
  verticalAlign = 'top',
}: {
  columns: Array<{ key: string; label: string; width?: string }>
  rows: Array<Record<string, ReactNode>>
  /** Valores de ordenação por linha quando a célula não é texto simples. */
  sortValues?: Array<Record<string, PreviewSortValue>>
  /** Cabe na largura disponível (sem scroll horizontal), quebrando texto nas células. */
  wrap?: boolean
  /** `middle` centraliza o texto quando a linha tem controles (botões, selects). */
  verticalAlign?: 'top' | 'middle'
}) {
  const [sort, setSort] = useState<{ key: string; direction: ListTableSortDirection } | null>(null)
  const [limit, setLimit] = useState(PREVIEW_PAGE_SIZE)

  const order = rows.map((_, index) => index)
  if (sort) {
    const valueAt = (index: number) =>
      sortValues?.[index]?.[sort.key] !== undefined
        ? sortValues[index][sort.key]
        : cellSortValue(rows[index][sort.key])
    const factor = sort.direction === 'asc' ? 1 : -1
    order.sort((a, b) => {
      const cmp = compareSortValues(valueAt(a), valueAt(b))
      return cmp === 0 ? a - b : cmp * factor
    })
  }

  return (
    <div className={`${listPageTableSectionCls} ${wrap ? 'overflow-hidden' : 'overflow-x-auto'}`}>
      <table className={`w-full text-sm ${wrap ? 'table-fixed' : ''}`}>
        {wrap ? (
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={column.width ? { width: column.width } : undefined} />
            ))}
          </colgroup>
        ) : null}
        <thead className={headCls}>
          <tr>
            {columns.map((column) =>
              column.label === '#' ? (
                <th
                  key={column.key}
                  scope="col"
                  className={`${wrap ? 'px-2 py-2' : 'px-3 py-2'} text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300`}
                >
                  #
                </th>
              ) : (
                <ListTableSortableHeader
                  key={column.key}
                  label={column.label}
                  className={wrap ? 'px-2 py-2 [&>span]:flex-wrap' : 'px-3 py-2'}
                  active={sort?.key === column.key}
                  direction={sort?.key === column.key ? sort.direction : 'asc'}
                  onToggle={() =>
                    setSort((current) =>
                      current?.key === column.key
                        ? { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
                        : { key: column.key, direction: 'asc' },
                    )
                  }
                />
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {order.slice(0, limit).map((index) => (
            <tr key={index} className={listPageTableRowHoverCls}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`${wrap ? tdWrapCls : tdCls} ${verticalAlign === 'middle' ? 'align-middle' : 'align-top'}`}
                >
                  {rows[index][column.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit ? (
        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          <span className="tabular-nums">
            Exibindo {limit.toLocaleString('pt-BR')} de {rows.length.toLocaleString('pt-BR')}
          </span>
          <button
            type="button"
            className="font-medium text-[var(--color-1)] hover:underline"
            onClick={() => setLimit((current) => current + PREVIEW_PAGE_SIZE)}
          >
            Mostrar mais {Math.min(PREVIEW_PAGE_SIZE, rows.length - limit).toLocaleString('pt-BR')}
          </button>
          <button
            type="button"
            className="font-medium text-[var(--color-1)] hover:underline"
            onClick={() => setLimit(rows.length)}
          >
            Mostrar todos
          </button>
        </div>
      ) : null}
    </div>
  )
}

export interface ImportPreviewIssue {
  row: number
  reason: string
  source?: string
  detail?: string | null
  action?: string | null
}

export function ImportPreviewIssuesSection({
  issues,
  sourceLabel,
}: {
  issues: ImportPreviewIssue[]
  sourceLabel?: (source: string) => string
}) {
  if (!issues.length) return null
  const withSource = Boolean(sourceLabel) && issues.some((issue) => issue.source)
  const withDetail = issues.some((issue) => issue.detail)
  const withAction = issues.some((issue) => issue.action)
  return (
    <CollapsiblePreviewSection title={`Problemas (${issues.length})`} tone="warning">
      <PreviewDataTable
        columns={[
          { key: 'index', label: '#' },
          ...(withSource ? [{ key: 'source', label: 'Origem' }] : []),
          { key: 'row', label: 'Linha' },
          ...(withDetail ? [{ key: 'detail', label: 'Registro' }] : []),
          { key: 'reason', label: 'Motivo' },
          ...(withAction ? [{ key: 'action', label: 'Situação' }] : []),
        ]}
        rows={issues.map((issue, index) => ({
          index: index + 1,
          source: issue.source && sourceLabel ? sourceLabel(issue.source) : '—',
          row: issue.row || '—',
          detail: issue.detail || '—',
          reason: issue.reason,
          action: <IssueActionBadge action={issue.action} />,
        }))}
        sortValues={issues.map((issue) => ({ action: issue.action || '' }))}
      />
    </CollapsiblePreviewSection>
  )
}
