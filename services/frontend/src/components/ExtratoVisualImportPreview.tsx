import {
  CollapsiblePreviewSection,
  ImportPreviewIssuesSection,
  PreviewDataTable,
  PreviewEmptyState,
  previewAmountCell,
  previewFieldValueCell,
  previewPercentCell,
  type ImportPreviewIssue,
} from './ImportPreviewShared'
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
  /** Parte da conta logada (%); nulo quando não há compartilhamento. */
  ownership_after?: number | null
  null_fields?: VisualImportPreviewNullField[]
  changes?: { field: string; before: unknown; after: unknown }[]
}

export interface VisualImportPreviewData {
  summary: {
    creates: number
    updates: number
    unchanged: number
    /** Registros existentes mantidos como estão por decisão nos Ajustes. */
    kept?: number
    skipped_invalid: number
    issues: number
  }
  creates: VisualImportPreviewRow[]
  updates: VisualImportPreviewRow[]
  issues: Array<ImportPreviewIssue & { source: string }>
}

const CHANGE_FIELD_LABELS: Record<string, string> = {
  amount: 'Valor',
  date: 'Data',
  subtag: 'Tag/Subtag',
  sharing: 'Compartilhamento',
  ownership_pct: 'Minha %',
  year_month: 'Ano/mês',
  description: 'Descrição',
  issuer: 'Emissor',
}

function sourceLabel(source: string) {
  if (source === 'bank') return 'Extrato'
  if (source === 'invoice') return 'Fatura'
  return 'Benefício'
}

function previewDateMs(date: string): number {
  const m = date.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (!m) return 0
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0))
  const t = d.getTime()
  return Number.isNaN(t) ? 0 : t
}

export function fieldLabel(field: string) {
  return CHANGE_FIELD_LABELS[field] ?? field
}

export function formatChangeDisplay(field: string, value: unknown): string {
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

export function formatChangeCell(field: string, value: unknown) {
  return previewFieldValueCell(field, value)
}

function bySourceAndRow(a: VisualImportPreviewRow, b: VisualImportPreviewRow) {
  return String(a.source).localeCompare(String(b.source)) || a.row - b.row
}

function ExtratoCreateTable({ rows }: { rows: VisualImportPreviewRow[] }) {
  const sorted = [...rows].sort(bySourceAndRow)
  return (
    <PreviewDataTable
      columns={[
        { key: 'index', label: '#' },
        { key: 'source', label: 'Origem' },
        { key: 'row', label: 'Linha' },
        { key: 'date', label: 'Data' },
        { key: 'description', label: 'Descrição' },
        { key: 'amount', label: 'Valor' },
        { key: 'classification', label: 'Classificação' },
        { key: 'sharing', label: 'Compartilhamento' },
        { key: 'ownership', label: 'Minha %' },
      ]}
      rows={sorted.map((row, index) => ({
        index: index + 1,
        row: row.row,
        source: sourceLabel(row.source),
        date: row.date,
        description: row.description,
        amount: previewAmountCell(row.amount),
        classification: row.classification_after || row.classification_file || '—',
        sharing: row.sharing_after || row.sharing_file || '—',
        ownership: previewPercentCell(row.ownership_after),
      }))}
      sortValues={sorted.map((row) => ({
        date: previewDateMs(row.date),
        amount: row.amount,
        ownership: row.ownership_after ?? -1,
      }))}
    />
  )
}

function ExtratoUpdateTable({ rows }: { rows: VisualImportPreviewRow[] }) {
  const tableRows = [...rows]
    .sort(bySourceAndRow)
    .flatMap((row) =>
      (row.changes ?? []).map((change) => ({
        row: row.row,
        source: sourceLabel(row.source),
        date: row.date,
        description: row.description,
        campo: fieldLabel(change.field),
        de: formatChangeCell(change.field, change.before),
        para: formatChangeCell(change.field, change.after),
      })),
    )
    .map((row, index) => ({ index: index + 1, ...row }))
  return (
    <PreviewDataTable
      columns={[
        { key: 'index', label: '#' },
        { key: 'source', label: 'Origem' },
        { key: 'row', label: 'Linha' },
        { key: 'date', label: 'Data' },
        { key: 'description', label: 'Descrição' },
        { key: 'campo', label: 'Campo' },
        { key: 'de', label: 'De' },
        { key: 'para', label: 'Para' },
      ]}
      rows={tableRows}
      sortValues={tableRows.map((row) => ({ date: previewDateMs(row.date) }))}
    />
  )
}

export default function ExtratoVisualImportPreview({
  data,
  notes = [],
}: {
  data: VisualImportPreviewData
  notes?: string[]
}) {
  const { creates, updates, issues, summary } = data
  const changed = updates.filter((row) => (row.changes?.length ?? 0) > 0)

  return (
    <div className="space-y-4">
      {notes.map((note) => (
        <p
          key={note}
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100"
        >
          {note}
        </p>
      ))}
      {!creates.length && !changed.length ? <PreviewEmptyState unchanged={summary.unchanged} /> : null}
      {changed.length > 0 ? (
        <CollapsiblePreviewSection title={`Alterações (${changed.length})`}>
          <ExtratoUpdateTable rows={changed} />
        </CollapsiblePreviewSection>
      ) : null}
      {creates.length > 0 ? (
        <CollapsiblePreviewSection title={`Adições (${creates.length})`}>
          <ExtratoCreateTable rows={creates} />
        </CollapsiblePreviewSection>
      ) : null}
      <ImportPreviewIssuesSection issues={issues} sourceLabel={sourceLabel} />
    </div>
  )
}
