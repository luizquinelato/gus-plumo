import {
  CollapsiblePreviewSection,
  ImportPreviewIssuesSection,
  PreviewDataTable,
  PreviewEmptyState,
  type ImportPreviewIssue,
} from './ImportPreviewShared'
import CartoesImportPreview from './CartoesImportPreview'
import TagsImportPreview from './TagsImportPreview'
import TemplatesImportPreview from './TemplatesImportPreview'
import { isTagEntity, useIconCatalog } from './ImportTagIcon'

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
  group?: string | null
  name?: string | null
  subtype?: string | null
  fields_after?: Record<string, string>
  changes?: CadastroImportChange[]
}

export interface CardGroupPreviewMeta {
  name: string
  status: 'create' | 'update' | 'unchanged'
  closing_day?: number | string | null
  due_day?: number | string | null
}

export interface TagGroupPreviewMeta {
  name: string
  status: 'create' | 'update' | 'unchanged'
  icon?: string | null
  description?: string | null
}

export interface TemplateGroupPreviewMeta {
  name: string
  status: 'create' | 'update' | 'unchanged'
  icon?: string | null
  description?: string | null
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
  issues: ImportPreviewIssue[]
  card_groups?: CardGroupPreviewMeta[]
  tag_groups?: TagGroupPreviewMeta[]
  template_groups?: TemplateGroupPreviewMeta[]
}

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

function fieldOrderIndex(label: string): number {
  const i = FIELD_DISPLAY_ORDER.indexOf(label)
  return i === -1 ? 999 : i
}

function createColumns(rows: CadastroImportPreviewRow[]): Array<{ key: string; label: string }> {
  const keys = new Set<string>()
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.fields_after ?? {})) {
      if (value && value !== '—') keys.add(key)
    }
  }
  const ordered = [...keys].sort((a, b) => fieldOrderIndex(a) - fieldOrderIndex(b))
  return [{ key: 'row', label: '#' }, ...ordered.map((key) => ({ key, label: key }))]
}

function CreateTable({ rows }: { rows: CadastroImportPreviewRow[] }) {
  const sorted = [...rows].sort((a, b) => a.row - b.row)
  const columns = createColumns(sorted)
  return (
    <PreviewDataTable
      columns={columns}
      rows={sorted.map((row) => {
        const cells: Record<string, string | number> = { row: row.row }
        for (const column of columns) {
          if (column.key === 'row') continue
          cells[column.key] = row.fields_after?.[column.key] || '—'
        }
        return cells
      })}
    />
  )
}

function UpdateTable({ rows }: { rows: CadastroImportPreviewRow[] }) {
  const sorted = [...rows].sort((a, b) => a.row - b.row)
  const tableRows = sorted.flatMap((row) =>
    (row.changes ?? []).map((change) => ({
      row: row.row,
      registro: row.label || '—',
      campo: change.label || change.field,
      de: change.before || '—',
      para: change.after || '—',
    })),
  )
  return (
    <PreviewDataTable
      columns={[
        { key: 'row', label: '#' },
        { key: 'registro', label: 'Registro' },
        { key: 'campo', label: 'Campo' },
        { key: 'de', label: 'De' },
        { key: 'para', label: 'Para' },
      ]}
      rows={tableRows}
    />
  )
}

export default function CadastroImportPreview({
  data,
  tagIconOverrides = {},
  onTagIconChange,
}: {
  data: CadastroImportPreviewData
  tagIconOverrides?: Record<string, string>
  onTagIconChange?: (row: CadastroImportPreviewRow, icon: string) => void
}) {
  const { creates, updates, issues, summary } = data
  const allRows = [...creates, ...updates]
  const wantsIcons = allRows.some((row) => isTagEntity(row.entity))
  const catalog = useIconCatalog(wantsIcons)
  if (!creates.length && !updates.length) {
    return (
      <div className="space-y-4">
        <PreviewEmptyState unchanged={summary.unchanged} />
        <ImportPreviewIssuesSection issues={issues} />
      </div>
    )
  }

  if (wantsIcons) {
    return (
      <TagsImportPreview
        data={data}
        iconChoices={{ overrides: tagIconOverrides, onChange: onTagIconChange, ...catalog }}
      />
    )
  }

  if (allRows.some((row) => row.entity === 'cartao' || row.entity === 'grupo_fatura')) {
    return <CartoesImportPreview data={data} />
  }

  if (allRows.some((row) => row.entity === 'template' || row.entity === 'template_item')) {
    return <TemplatesImportPreview data={data} />
  }

  return (
    <div className="space-y-4">
      {updates.length > 0 ? (
        <CollapsiblePreviewSection title={`Alterações (${updates.length})`}>
          <UpdateTable rows={updates} />
        </CollapsiblePreviewSection>
      ) : null}
      {creates.length > 0 ? (
        <CollapsiblePreviewSection title={`Adições (${creates.length})`}>
          <CreateTable rows={creates} />
        </CollapsiblePreviewSection>
      ) : null}
      <ImportPreviewIssuesSection issues={issues} />
    </div>
  )
}
