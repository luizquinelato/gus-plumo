import { useMemo, useState, type ReactNode } from 'react'
import { cadastroSectionsStackCls } from './CadastroFormLayout'
import { CadastroListPageTabs } from './CadastroListPageLayout'
import {
  ImportPreviewIssuesSection,
  MetricColumn,
  MetricDivider,
  PreviewCardLayout,
  PreviewRowMeta,
  StringChangeMetricColumn,
  importPreviewCreateCardCls,
  importPreviewUpdateCardCls,
} from './ImportPreviewShared'
import { Eye, Pencil, PlusCircle } from 'lucide-react'

export interface CadastroImportChange {
  field: string
  label?: string
  before: string
  after: string
}

export interface CadastroImportPreviewRow {
  row: number
  label?: string
  record_id?: number | null
  entity?: string | null
  fields_after?: Record<string, string>
  changes?: CadastroImportChange[]
}

export interface CadastroImportPreviewData {
  summary: {
    creates: number
    updates: number
    unchanged: number
    skipped_invalid: number
    issues: number
  }
  creates: CadastroImportPreviewRow[]
  updates: CadastroImportPreviewRow[]
  issues: Array<{ row: number; reason: string }>
}

type PreviewTab = 'updates' | 'creates'

const FIELD_DISPLAY_ORDER = [
  'Tag',
  'Nome',
  'Tipo',
  'Descrição',
  'Banco (código)',
  'Agência',
  'Conta',
  'Ícone',
  'Ativo',
  'Template',
  'Valor',
  'Dia',
  'Classificação',
  'Conta parceira',
  'Contribuição despesa (%)',
  'Contribuição receita (%)',
  'Parte despesa (%)',
  'Parte receita (%)',
  'Final',
  'Grupo',
  'Fechamento',
  'Vencimento',
  'Conta parceira (cartão)',
  'Parte despesa (%)',
  'IDs cartões',
  'Cartões',
]

const WIDE_FIELD_LABELS = new Set(['Descrição', 'Classificação', 'Conta parceira', 'Cartões'])

function fieldOrderIndex(label: string): number {
  const i = FIELD_DISPLAY_ORDER.indexOf(label)
  return i === -1 ? 999 : i
}

function fieldsForCreateMetrics(
  fields: Record<string, string> | undefined,
  title: string | undefined,
): Array<[string, string]> {
  if (!fields) return []
  return Object.entries(fields)
    .filter(([k, v]) => Boolean(v) && v !== '—' && k !== 'Nome' && v !== title)
    .sort((a, b) => fieldOrderIndex(a[0]) - fieldOrderIndex(b[0]))
}

function isWideChangeLabel(label: string): boolean {
  return WIDE_FIELD_LABELS.has(label) || label.includes('Descrição')
}

function UpdatePreviewCard({ row }: { row: CadastroImportPreviewRow }) {
  const changes = row.changes ?? []
  const metrics: ReactNode[] = []

  changes.forEach((c, i) => {
    if (i > 0) metrics.push(<MetricDivider key={`d-${c.field}-${i}`} />)
    metrics.push(
      <StringChangeMetricColumn
        key={c.field}
        label={c.label || c.field}
        before={c.before}
        after={c.after}
        wide={isWideChangeLabel(c.label || c.field)}
      />,
    )
  })

  return (
    <article className={importPreviewUpdateCardCls}>
      <PreviewCardLayout
        info={
          <>
            <p className="truncate font-medium text-gray-900 dark:text-white" title={row.label || '—'}>
              {row.label || '—'}
            </p>
            <PreviewRowMeta row={row.row} entity={row.entity} recordId={row.record_id} />
          </>
        }
        metrics={metrics.length ? metrics : <MetricColumn label="Alteração">—</MetricColumn>}
      />
    </article>
  )
}

function CreatePreviewCard({ row }: { row: CadastroImportPreviewRow }) {
  const entries = fieldsForCreateMetrics(row.fields_after, row.label)
  const metrics: ReactNode[] = []

  entries.forEach(([label, value], i) => {
    if (i > 0) metrics.push(<MetricDivider key={`d-${label}-${i}`} />)
    const wide = WIDE_FIELD_LABELS.has(label)
    metrics.push(
      <MetricColumn key={label} label={label} className={wide ? 'min-w-[8rem] max-w-[18rem]' : undefined}>
        <span className={`block ${wide ? 'whitespace-normal break-words' : 'truncate'}`} title={value}>
          {value}
        </span>
      </MetricColumn>,
    )
  })

  return (
    <article className={importPreviewCreateCardCls}>
      <PreviewCardLayout
        info={
          <>
            <p className="truncate font-medium text-gray-900 dark:text-white" title={row.label || '—'}>
              {row.label || '—'}
            </p>
            <PreviewRowMeta row={row.row} entity={row.entity} recordId={row.record_id} />
          </>
        }
        metrics={
          metrics.length ? (
            metrics
          ) : (
            <MetricColumn label="Dados">
              <span className="font-normal text-gray-600 dark:text-gray-300">conforme planilha</span>
            </MetricColumn>
          )
        }
      />
    </article>
  )
}

function PreviewList({
  rows,
  variant,
  emptyMessage,
}: {
  rows: CadastroImportPreviewRow[]
  variant: 'update' | 'create'
  emptyMessage: string
}) {
  if (!rows.length) {
    return <p className="py-6 text-center text-sm text-gray-600 dark:text-gray-300">{emptyMessage}</p>
  }

  const sorted = [...rows].sort((a, b) => a.row - b.row)

  return (
    <div className="space-y-3">
      {sorted.map((row) =>
        variant === 'update' ? (
          <UpdatePreviewCard key={`u-${row.row}-${row.record_id ?? row.label}`} row={row} />
        ) : (
          <CreatePreviewCard key={`c-${row.row}-${row.record_id ?? row.label}`} row={row} />
        ),
      )}
    </div>
  )
}

export default function CadastroImportPreview({ data }: { data: CadastroImportPreviewData }) {
  const { creates, updates, issues } = data
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
      <CadastroListPageTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as PreviewTab)} />

      <div className="min-h-[min(52vh,420px)] max-h-[min(72vh,680px)] overflow-y-auto">
        {tab === 'updates' ? (
          <PreviewList
            rows={updates}
            variant="update"
            emptyMessage="Nenhuma alteração em registros existentes."
          />
        ) : (
          <PreviewList rows={creates} variant="create" emptyMessage="Nenhum registro novo será criado." />
        )}
      </div>

      <ImportPreviewIssuesSection issues={issues} />

      {creates.length === 0 && updates.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <Eye size={16} />
          Nenhuma alteração detectada nas linhas válidas.
        </p>
      ) : null}
    </div>
  )
}
