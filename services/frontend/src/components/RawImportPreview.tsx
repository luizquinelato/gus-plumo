import {
  CollapsiblePreviewSection,
  ImportPreviewIssuesSection,
  PreviewDataTable,
  PreviewEmptyState,
  previewAmountCell,
  previewFieldValueCell,
  previewPercentCell,
} from './ImportPreviewShared'
import { formatCurrency, formatCurrencyWithColor } from '../utils/currency'
import type { ImportConflict } from '../types/importConflict'
import type { WizardKind } from '../utils/importWizard'

export interface RawPreviewChange {
  field: string
  before: string
  after: string
}

export interface RawMappingHint {
  subtag_id: number
  label: string
  type: string
}

export interface RawPreviewCreate {
  row: number
  /** Índice da linha em `rows` do processamento (para o override de classificação). */
  row_index?: number | null
  /** Mapeamento que casa a descrição só no tipo oposto: precisa de ajuste nos Ajustes. */
  mapping_hint?: RawMappingHint | null
  date: string
  description: string
  amount: number
  classification: string
  sharing: string
  /** Parte da conta logada (%); nulo quando não há compartilhamento. */
  ownership?: number | null
  card: string
  year_month: string
  installments: string
  category: string
  transaction: string
  payment_method: string
}

export interface RawPreviewUpdate {
  row: number
  record_id: number
  date: string
  description: string
  amount: number
  card: string
  changes: RawPreviewChange[]
}

export interface RawImportPreviewData {
  summary: {
    creates: number
    updates: number
    unchanged: number
    conflicts: number
    unmapped: number
    needs_mapping?: number
    issues: number
    ignored: number
  }
  creates: RawPreviewCreate[]
  updates: RawPreviewUpdate[]
  conflicts: ImportConflict[]
  issues: Array<{ row: number; description: string; reason: string }>
  ignored: Array<{ row: number; date: string; description: string; transaction: string; amount: number; reason: string }>
  warnings?: string[]
}

export interface RawPayrollPreview {
  action: 'created' | 'updated'
  summary: string
  netAmount?: number | null
  grossEarnings?: number | null
  totalDeductions?: number | null
  lineCount?: number | null
}

export interface RawFilePreview {
  fileId: string
  fileName: string
  error?: string
  preview?: RawImportPreviewData
  payroll?: RawPayrollPreview
}

export interface RawKindPreviewData {
  summary: { creates: number; updates: number; unchanged: number }
  files: RawFilePreview[]
}

export function summarizeRawKind(files: RawFilePreview[]): RawKindPreviewData {
  const summary = { creates: 0, updates: 0, unchanged: 0 }
  for (const file of files) {
    if (file.preview) {
      summary.creates += file.preview.summary.creates
      summary.updates += file.preview.summary.updates
      summary.unchanged += file.preview.summary.unchanged
    } else if (file.payroll) {
      if (file.payroll.action === 'updated') summary.updates += 1
      else summary.creates += 1
    }
  }
  return { summary, files }
}

export function previewDateMs(date: string): number {
  const m = date.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (!m) return 0
  const t = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0)).getTime()
  return Number.isNaN(t) ? 0 : t
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
}

function byRow<T extends { row: number }>(a: T, b: T) {
  return (a.row ?? 0) - (b.row ?? 0)
}

function CreateTable({ kind, rows }: { kind: WizardKind; rows: RawPreviewCreate[] }) {
  const sorted = [...rows].sort(byRow)
  const isInvoice = kind === 'fatura_bruta'
  return (
    <PreviewDataTable
      columns={[
        { key: 'index', label: '#' },
        { key: 'row', label: 'Linha' },
        { key: 'date', label: 'Data' },
        ...(isInvoice
          ? [
              { key: 'card', label: 'Cartão' },
              { key: 'year_month', label: 'Fatura' },
            ]
          : []),
        { key: 'description', label: 'Descrição' },
        ...(isInvoice ? [{ key: 'installments', label: 'Parcela' }] : []),
        { key: 'amount', label: 'Valor' },
        { key: 'classification', label: 'Classificação' },
        { key: 'sharing', label: 'Compartilhamento' },
        { key: 'ownership', label: 'Minha %' },
      ]}
      rows={sorted.map((row, index) => ({
        index: index + 1,
        row: row.row,
        date: row.date,
        card: row.card ? `final ${String(row.card).slice(-4)}` : '—',
        year_month: row.year_month || '—',
        description: row.description,
        installments: row.installments || '—',
        amount: previewAmountCell(row.amount),
        classification: row.classification || '—',
        sharing: row.sharing || '—',
        ownership: previewPercentCell(row.ownership),
      }))}
      sortValues={sorted.map((row) => ({
        date: previewDateMs(row.date),
        amount: row.amount,
        ownership: row.ownership ?? -1,
      }))}
    />
  )
}

function UpdateTable({ rows }: { rows: RawPreviewUpdate[] }) {
  const tableRows = [...rows]
    .sort(byRow)
    .flatMap((row) =>
      row.changes.map((change) => ({
        row: row.row,
        date: row.date,
        description: row.description,
        campo: change.field,
        de: previewFieldValueCell(change.field, change.before || '—'),
        para: previewFieldValueCell(change.field, change.after || '—'),
      })),
    )
    .map((row, index) => ({ index: index + 1, ...row }))
  return (
    <PreviewDataTable
      columns={[
        { key: 'index', label: '#' },
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

export function conflictChange(conflict: ImportConflict): { campo: string; de: string; para: string } {
  if (conflict.multiple_matches?.length) {
    return {
      campo: 'Registro',
      de: `${conflict.multiple_matches.length} candidatos`,
      para: formatCurrency(conflict.new_amount ?? 0),
    }
  }
  const parts: Array<{ campo: string; de: string; para: string }> = []
  if (conflict.tag_conflict) {
    const tc = conflict.tag_conflict
    parts.push({
      campo: 'Classificação',
      de: [tc.original_tag_name, tc.original_subtag_name].filter(Boolean).join(' / ') || '—',
      para:
        tc.new_subtag_id == null
          ? 'Sem classificação'
          : [tc.new_tag_name, tc.new_subtag_name].filter(Boolean).join(' / ') || '—',
    })
  }
  if (conflict.amount_conflict) {
    parts.push({
      campo: 'Valor',
      de: formatCurrency(conflict.amount_conflict.original_amount),
      para: formatCurrency(conflict.amount_conflict.new_amount),
    })
  }
  return {
    campo: parts.map((part) => part.campo).join(' + ') || '—',
    de: parts.map((part) => part.de).join(' · ') || '—',
    para: parts.map((part) => part.para).join(' · ') || '—',
  }
}

function IgnoredTable({ rows }: { rows: RawImportPreviewData['ignored'] }) {
  return (
    <PreviewDataTable
      columns={[
        { key: 'index', label: '#' },
        { key: 'date', label: 'Data' },
        { key: 'transaction', label: 'Transação' },
        { key: 'description', label: 'Descrição' },
        { key: 'amount', label: 'Valor' },
        { key: 'reason', label: 'Motivo' },
      ]}
      rows={rows.map((row, index) => ({
        index: index + 1,
        date: row.date,
        transaction: row.transaction || '—',
        description: row.description,
        amount: previewAmountCell(row.amount ?? 0),
        reason: row.reason || '—',
      }))}
      sortValues={rows.map((row) => ({ date: previewDateMs(row.date), amount: row.amount }))}
    />
  )
}

function money(value: number | null | undefined) {
  return value == null ? '—' : formatCurrencyWithColor(Number(value))
}

function PayrollCard({ payroll }: { payroll: RawPayrollPreview }) {
  const updated = payroll.action === 'updated'
  return (
    <div
      className={`rounded-lg border border-l-4 border-gray-200 bg-white p-4 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800 ${
        updated ? 'border-l-[var(--color-1)]' : 'border-l-green-500'
      }`}
    >
      <p className="font-medium text-gray-900 dark:text-gray-100">
        {updated ? 'Atualiza o registro existente' : 'Cria um registro novo'}
      </p>
      <p className="mt-1 text-gray-600 dark:text-gray-300">{payroll.summary || '—'}</p>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        {payroll.grossEarnings != null ? (
          <div>
            <dt className="inline">Proventos: </dt>
            <dd className="inline font-semibold text-gray-800 dark:text-gray-100">{money(payroll.grossEarnings)}</dd>
          </div>
        ) : null}
        {payroll.totalDeductions != null ? (
          <div>
            <dt className="inline">Descontos: </dt>
            <dd className="inline font-semibold text-gray-800 dark:text-gray-100">{money(payroll.totalDeductions)}</dd>
          </div>
        ) : null}
        {payroll.netAmount != null ? (
          <div>
            <dt className="inline">Líquido: </dt>
            <dd className="inline font-semibold text-gray-800 dark:text-gray-100">{money(payroll.netAmount)}</dd>
          </div>
        ) : null}
        {payroll.lineCount != null ? (
          <div>
            <dt className="inline">Linhas: </dt>
            <dd className="inline font-semibold text-gray-800 dark:text-gray-100">{payroll.lineCount}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}

function FilePreview({ kind, file }: { kind: WizardKind; file: RawFilePreview }) {
  if (file.error) {
    return <p className="text-sm text-red-600 dark:text-red-300">{file.error}</p>
  }
  if (file.payroll) return <PayrollCard payroll={file.payroll} />
  const preview = file.preview
  if (!preview) return null
  const empty = !preview.creates.length && !preview.updates.length
  return (
    <div className="space-y-4">
      {(preview.warnings ?? []).map((warning) => (
        <p
          key={warning}
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200"
        >
          {warning}
        </p>
      ))}
      {empty ? <PreviewEmptyState unchanged={preview.summary.unchanged} /> : null}
      {preview.updates.length > 0 ? (
        <CollapsiblePreviewSection title={`Alterações (${preview.updates.length})`}>
          <UpdateTable rows={preview.updates} />
        </CollapsiblePreviewSection>
      ) : null}
      {preview.creates.length > 0 ? (
        <CollapsiblePreviewSection title={`Adições (${preview.creates.length})`}>
          <CreateTable kind={kind} rows={preview.creates} />
        </CollapsiblePreviewSection>
      ) : null}
      <ImportPreviewIssuesSection
        issues={preview.issues.map((issue) => ({
          row: issue.row,
          reason: issue.reason,
          detail: issue.description || null,
          action: 'Linha ignorada',
        }))}
      />
      {preview.ignored.length > 0 ? (
        <CollapsiblePreviewSection title={`Ignoradas pela política (${preview.ignored.length})`}>
          <IgnoredTable rows={preview.ignored} />
        </CollapsiblePreviewSection>
      ) : null}
    </div>
  )
}

export default function RawImportPreview({
  kind,
  data,
  notes = [],
}: {
  kind: WizardKind
  data: RawKindPreviewData
  notes?: string[]
}) {
  const multiple = data.files.length > 1
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
      {data.files.map((file) =>
        multiple ? (
          <section key={file.fileId} className="space-y-2">
            <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100" title={file.fileName}>
              {file.fileName}
            </h3>
            <FilePreview kind={kind} file={file} />
          </section>
        ) : (
          <FilePreview key={file.fileId} kind={kind} file={file} />
        ),
      )}
    </div>
  )
}
