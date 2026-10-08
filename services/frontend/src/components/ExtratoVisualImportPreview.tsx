import { useMemo, useState, type ReactNode } from 'react'
import { CadastroFormSection, cadastroFieldCls, cadastroSectionsStackCls } from './CadastroFormLayout'
import { CadastroListPageTabs, listPageTableRowHoverCls, listPageTableSectionCls } from './CadastroListPageLayout'
import type { ListTableSortDirection } from './ListTableSelectColumns'
import { Calendar, Eye, PlusCircle, Pencil, AlertTriangle } from 'lucide-react'
import { formatCurrency, parseLocaleAmount } from '../utils/currency'

export interface VisualImportPreviewNullField {
  field: string
  file_value: string | null
  reason: string
}

export interface VisualImportPreviewRow {
  source: string
  row: number
  action: string
  date: string
  description: string
  amount: number
  record_id?: number | null
  classification_file?: string | null
  classification_after?: string | null
  sharing_file?: string | null
  sharing_after?: string | null
  ownership_after?: number
  null_fields?: VisualImportPreviewNullField[]
  changes?: { field: string; before: unknown; after: unknown }[]
}

export interface VisualImportPreviewData {
  summary: {
    creates: number
    updates: number
    unchanged: number
    skipped_invalid: number
    issues: number
  }
  creates: VisualImportPreviewRow[]
  updates: VisualImportPreviewRow[]
  issues: { source: string; row: number; reason: string }[]
}

type PreviewTab = 'updates' | 'creates'
type UpdatesSortKey = 'source' | 'row' | 'record_id' | 'date' | 'description' | 'amount'
type CreatesSortKey = 'source' | 'row' | 'date' | 'description' | 'amount' | 'classification' | 'sharing'

const previewCardCls =
  'rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 border-l-4'
const previewUpdateCardCls = `${previewCardCls} border-l-[var(--color-1)]`
const previewCreateCardCls = `${previewCardCls} border-l-green-500`

const UPDATES_SORT_OPTIONS: { key: UpdatesSortKey; label: string }[] = [
  { key: 'date', label: 'Data' },
  { key: 'description', label: 'Descrição' },
  { key: 'amount', label: 'Valor' },
  { key: 'source', label: 'Origem' },
  { key: 'row', label: 'Linha planilha' },
  { key: 'record_id', label: 'ID' },
]

const CREATES_SORT_OPTIONS: { key: CreatesSortKey; label: string }[] = [
  { key: 'date', label: 'Data' },
  { key: 'description', label: 'Descrição' },
  { key: 'amount', label: 'Valor' },
  { key: 'classification', label: 'Classificação' },
  { key: 'sharing', label: 'Compartilhamento' },
  { key: 'source', label: 'Origem' },
  { key: 'row', label: 'Linha planilha' },
]

const headCls =
  'bg-gray-100 dark:bg-gray-800/80 [&_th]:border-b-2 [&_th]:border-gray-200 dark:[&_th]:border-gray-600'
const thCls =
  'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
const tdCls = 'border-b border-gray-200 px-3 py-2 align-top dark:border-gray-600'
const tdMutedCls = `${tdCls} text-xs text-gray-600 dark:text-gray-300`

const CHANGE_FIELD_LABELS: Record<string, string> = {
  amount: 'Valor',
  date: 'Data',
  subtag: 'Tag/Subtag',
  sharing: 'Compartilhamento',
  ownership_pct: '% titularidade',
}

function sourceLabel(source: string) {
  return source === 'bank' ? 'Extrato' : 'Benefício'
}

function previewDateMs(date: string): number {
  const m = date.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (!m) return 0
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0))
  const t = d.getTime()
  return Number.isNaN(t) ? 0 : t
}

function toggleSortDirection(direction: ListTableSortDirection): ListTableSortDirection {
  return direction === 'asc' ? 'desc' : 'asc'
}

function sortPreviewRows<T extends VisualImportPreviewRow>(
  rows: T[],
  key: string,
  direction: ListTableSortDirection,
  getExtra?: (row: T, field: string) => string | number,
): T[] {
  const dirMul = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    let cmp = 0
    switch (key) {
      case 'source':
        cmp = a.source.localeCompare(b.source)
        break
      case 'row':
        cmp = a.row - b.row
        break
      case 'record_id':
        cmp = (a.record_id ?? 0) - (b.record_id ?? 0)
        break
      case 'date':
        cmp = previewDateMs(a.date) - previewDateMs(b.date)
        break
      case 'description':
        cmp = a.description.localeCompare(b.description, 'pt-BR', { sensitivity: 'base' })
        break
      case 'amount':
        cmp = a.amount - b.amount
        break
      case 'classification':
        cmp = (a.classification_after ?? '').localeCompare(b.classification_after ?? '', 'pt-BR', {
          sensitivity: 'base',
        })
        break
      case 'sharing':
        cmp = (a.sharing_after ?? '').localeCompare(b.sharing_after ?? '', 'pt-BR', { sensitivity: 'base' })
        break
      default:
        if (getExtra) {
          const av = getExtra(a, key)
          const bv = getExtra(b, key)
          cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'pt-BR')
        }
    }
    if (cmp === 0) cmp = a.row - b.row
    if (cmp === 0) cmp = a.source.localeCompare(b.source)
    return cmp * dirMul
  })
}

function useColumnSort<K extends string>(defaultKey: K, defaultDir: ListTableSortDirection = 'desc') {
  const [sortKey, setSortKey] = useState<K>(defaultKey)
  const [sortDir, setSortDir] = useState<ListTableSortDirection>(defaultDir)

  const onSort = (key: K) => {
    if (key === sortKey) {
      setSortDir(toggleSortDirection(sortDir))
    } else {
      setSortKey(key)
      setSortDir(key === 'date' || key === 'amount' || key === 'row' || key === 'record_id' ? 'desc' : 'asc')
    }
  }

  return { sortKey, sortDir, onSort }
}

function fieldLabel(field: string) {
  return CHANGE_FIELD_LABELS[field] ?? field
}

function formatChangeDisplay(field: string, value: unknown): string {
  if (value == null || value === '') return '—'
  if (field === 'amount') {
    const n = parseLocaleAmount(value)
    if (n != null) return formatCurrency(n)
  }
  if (field === 'ownership_pct') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
    if (!Number.isNaN(n)) {
      return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`
    }
  }
  return String(value)
}

function NullWarningsInline({ items }: { items: VisualImportPreviewNullField[] }) {
  if (!items.length) return null
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-amber-800 dark:text-amber-200">
      {items.map((n, i) => (
        <li key={i}>
          <AlertTriangle size={12} className="mr-1 inline shrink-0" aria-hidden />
          <span className="font-medium">{n.field === 'subtag' ? 'Tag/Subtag' : 'Compart.'}</span>: {n.reason}
          {n.file_value ? ` (${n.file_value})` : ''}
        </li>
      ))}
    </ul>
  )
}

function PreviewSortBar<K extends string>({
  options,
  sortKey,
  sortDir,
  onSortKey,
  onToggleDir,
}: {
  options: { key: K; label: string }[]
  sortKey: K
  sortDir: ListTableSortDirection
  onSortKey: (key: K) => void
  onToggleDir: () => void
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Ordenar</span>
      <select
        className={`${cadastroFieldCls} max-w-[12rem] py-1.5 text-sm`}
        value={sortKey}
        onChange={(e) => onSortKey(e.target.value as K)}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onToggleDir}
        className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        title={sortDir === 'asc' ? 'Crescente' : 'Decrescente'}
      >
        {sortDir === 'asc' ? '↑ Crescente' : '↓ Decrescente'}
      </button>
    </div>
  )
}

/** Divisor vertical entre blocos de métricas (estilo empréstimos). */
function MetricDivider() {
  return <div className="mx-1 hidden w-px shrink-0 self-stretch min-h-[2.75rem] bg-gray-200 dark:bg-gray-600 sm:block" />
}

function PreviewCardLayout({ info, metrics }: { info: ReactNode; metrics: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
      <div className="min-w-0 sm:max-w-[min(100%,30rem)]">{info}</div>
      <div
        className="hidden w-px shrink-0 self-stretch bg-gray-200 dark:bg-gray-600 sm:block"
        aria-hidden
      />
      <div className="flex shrink-0 flex-wrap items-start gap-x-1">{metrics}</div>
    </div>
  )
}

function MetricColumn({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-[88px] max-w-[180px] shrink-0 self-start text-left ${className}`}>
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <div className="mt-0.5 text-sm font-bold tabular-nums text-gray-900 dark:text-white">{children}</div>
    </div>
  )
}

function changeColumnWidthCls(field: string) {
  if (field === 'subtag') return 'min-w-[10rem] max-w-[22rem] sm:max-w-[26rem]'
  return 'min-w-[5.5rem] max-w-[11rem]'
}

function ChangeMetricColumn({ field, before, after }: { field: string; before: unknown; after: unknown }) {
  const beforeText = formatChangeDisplay(field, before)
  const afterText = formatChangeDisplay(field, after)
  const wideText = field === 'subtag'
  const valueCls = wideText ? 'whitespace-normal break-words' : 'truncate'
  return (
    <div className={`shrink-0 self-start text-left ${changeColumnWidthCls(field)}`}>
      <p className="text-sm text-gray-500 dark:text-gray-400">{fieldLabel(field)}</p>
      <p
        className={`text-xs tabular-nums text-gray-500 line-through dark:text-gray-400 ${valueCls} ${field === 'amount' || field === 'ownership_pct' ? 'tabular-nums' : ''}`}
        title={beforeText}
      >
        {beforeText}
      </p>
      <p
        className={`font-bold text-gray-900 dark:text-white ${valueCls} ${field === 'amount' || field === 'ownership_pct' ? 'tabular-nums' : 'normal-case'}`}
        title={afterText}
      >
        {afterText}
      </p>
    </div>
  )
}

const UPDATE_CHANGE_GROUPS: string[][] = [
  ['amount', 'date'],
  ['subtag'],
  ['sharing', 'ownership_pct'],
]

function UpdateChangeMetrics({ changes }: { changes: NonNullable<VisualImportPreviewRow['changes']> }) {
  const byField = new Map(changes.map((c) => [c.field, c]))
  const nodes: ReactNode[] = []
  let firstGroup = true

  for (const fields of UPDATE_CHANGE_GROUPS) {
    const items = fields.map((f) => byField.get(f)).filter((c): c is NonNullable<typeof c> => c != null)
    if (!items.length) continue
    if (!firstGroup) {
      nodes.push(<MetricDivider key={`sep-${fields[0]}`} />)
    }
    firstGroup = false
    for (const c of items) {
      nodes.push(<ChangeMetricColumn key={c.field} field={c.field} before={c.before} after={c.after} />)
    }
  }

  return <>{nodes}</>
}

function PreviewRowMeta({ row }: { row: VisualImportPreviewRow }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
      <span
        className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium text-[var(--on-color-1)]"
        style={{ background: 'var(--color-1)' }}
      >
        {sourceLabel(row.source)}
      </span>
      <span className="tabular-nums">Linha {row.row}</span>
      {row.record_id != null ? <span className="tabular-nums">#{row.record_id}</span> : null}
      <span className="inline-flex items-center gap-1 tabular-nums">
        <Calendar size={14} className="shrink-0" aria-hidden />
        {row.date}
      </span>
    </div>
  )
}

function UpdatePreviewCard({ row }: { row: VisualImportPreviewRow }) {
  const changes = row.changes ?? []
  const hasGroupedChanges = changes.some((c) =>
    UPDATE_CHANGE_GROUPS.some((g) => g.includes(c.field)),
  )

  return (
    <article className={previewUpdateCardCls}>
      <PreviewCardLayout
        info={
          <>
            <p className="truncate font-medium text-gray-900 dark:text-white" title={row.description}>
              {row.description}
            </p>
            <PreviewRowMeta row={row} />
            <NullWarningsInline items={row.null_fields ?? []} />
          </>
        }
        metrics={
          <>
            <MetricColumn label="Valor planilha">{formatCurrency(row.amount)}</MetricColumn>
            {hasGroupedChanges ? (
              <>
                <MetricDivider />
                <UpdateChangeMetrics changes={changes} />
              </>
            ) : null}
          </>
        }
      />
    </article>
  )
}

function CreatePreviewCard({ row }: { row: VisualImportPreviewRow }) {
  const classification = row.classification_after
  const sharing = row.sharing_after
  return (
    <article className={previewCreateCardCls}>
      <PreviewCardLayout
        info={
          <>
            <p className="truncate font-medium text-gray-900 dark:text-white" title={row.description}>
              {row.description}
            </p>
            <PreviewRowMeta row={row} />
            <NullWarningsInline items={row.null_fields ?? []} />
          </>
        }
        metrics={
          <>
            <MetricColumn label="Valor">{formatCurrency(row.amount)}</MetricColumn>
            <MetricDivider />
            <MetricColumn
              label="Classificação"
              className="min-w-[10rem] max-w-[22rem] sm:max-w-[26rem]"
            >
              {classification ? (
                <span className="block whitespace-normal break-words font-bold normal-case" title={classification}>
                  {classification}
                </span>
              ) : (
                <span className="font-bold normal-case text-amber-700 dark:text-amber-300">vazio</span>
              )}
            </MetricColumn>
            <MetricDivider />
            <MetricColumn label="Compartilhamento">
              {sharing ? (
                <span className="block truncate font-bold normal-case" title={sharing}>
                  {sharing}
                </span>
              ) : (
                <span className="font-bold normal-case text-gray-600 dark:text-gray-300">próprio (100%)</span>
              )}
            </MetricColumn>
          </>
        }
      />
    </article>
  )
}

function UpdatesList({ rows }: { rows: VisualImportPreviewRow[] }) {
  const { sortKey, sortDir, onSort } = useColumnSort<UpdatesSortKey>('date', 'desc')
  const sortedRows = useMemo(() => sortPreviewRows(rows, sortKey, sortDir), [rows, sortKey, sortDir])

  if (!rows.length) {
    return (
      <p className="py-6 text-center text-sm text-gray-600 dark:text-gray-300">
        Nenhuma alteração em lançamentos existentes.
      </p>
    )
  }

  return (
    <>
      <PreviewSortBar
        options={UPDATES_SORT_OPTIONS}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortKey={onSort}
        onToggleDir={() => onSort(sortKey)}
      />
      <div className="space-y-3">
        {sortedRows.map((row) => (
          <UpdatePreviewCard key={`u-${row.source}-${row.row}-${row.record_id}`} row={row} />
        ))}
      </div>
    </>
  )
}

function CreatesList({ rows }: { rows: VisualImportPreviewRow[] }) {
  const { sortKey, sortDir, onSort } = useColumnSort<CreatesSortKey>('date', 'desc')
  const sortedRows = useMemo(() => sortPreviewRows(rows, sortKey, sortDir), [rows, sortKey, sortDir])

  if (!rows.length) {
    return (
      <p className="py-6 text-center text-sm text-gray-600 dark:text-gray-300">Nenhum lançamento novo será criado.</p>
    )
  }

  return (
    <>
      <PreviewSortBar
        options={CREATES_SORT_OPTIONS}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortKey={onSort}
        onToggleDir={() => onSort(sortKey)}
      />
      <div className="space-y-3">
        {sortedRows.map((row) => (
          <CreatePreviewCard key={`c-${row.source}-${row.row}`} row={row} />
        ))}
      </div>
    </>
  )
}

export default function ExtratoVisualImportPreview({ data }: { data: VisualImportPreviewData }) {
  const { summary, creates, updates, issues } = data
  const [tab, setTab] = useState<PreviewTab>(() => (updates.length > 0 ? 'updates' : 'creates'))

  const tabs = useMemo(
    () => [
      { key: 'updates' as const, label: 'Alterações', icon: <Pencil size={15} />, count: updates.length },
      { key: 'creates' as const, label: 'Adições', icon: <PlusCircle size={15} />, count: creates.length },
    ],
    [updates.length, creates.length],
  )

  return (
    <div className={cadastroSectionsStackCls}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Novos', value: summary.creates },
          { label: 'Atualizações', value: summary.updates },
          { label: 'Sem mudança', value: summary.unchanged },
          { label: 'Inválidos / avisos', value: summary.skipped_invalid + summary.issues },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          >
            <p className="text-xs text-gray-500 dark:text-gray-400">{item.label}</p>
            <p className="text-lg font-semibold tabular-nums">{item.value}</p>
          </div>
        ))}
      </div>

      <CadastroListPageTabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="min-h-[min(58vh,520px)] max-h-[min(72vh,760px)] overflow-y-auto">
        {tab === 'updates' ? <UpdatesList rows={updates} /> : <CreatesList rows={creates} />}
      </div>

      {issues.length > 0 ? (
        <CadastroFormSection title={`Problemas (${issues.length})`} icon={<AlertTriangle size={14} />}>
          <div className={`${listPageTableSectionCls} overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead className={headCls}>
                <tr>
                  <th className={thCls}>Origem</th>
                  <th className={`${thCls} w-20`}>Linha</th>
                  <th className={thCls}>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue, i) => (
                  <tr key={i} className={listPageTableRowHoverCls}>
                    <td className={tdCls}>{sourceLabel(issue.source)}</td>
                    <td className={`${tdCls} tabular-nums`}>{issue.row}</td>
                    <td className={tdMutedCls}>{issue.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CadastroFormSection>
      ) : null}

      {creates.length === 0 && updates.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <Eye size={16} />
          Nenhuma alteração de dados detectada nas linhas válidas.
        </p>
      ) : null}
    </div>
  )
}
