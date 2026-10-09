import { useState } from 'react'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import Badge, { type BadgeTone } from './Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import { findIconComponent } from '../utils/iconMapper'
import { CollapsiblePreviewSection, ImportPreviewIssuesSection, PreviewDataTable } from './ImportPreviewShared'
import type {
  CadastroImportPreviewData,
  CadastroImportPreviewRow,
  TemplateGroupPreviewMeta,
} from './CadastroImportPreview'

type Mode = 'create' | 'update'

const ITEM_CREATE_FIELDS = ['Descrição', 'Valor', 'Dia', 'Classificação', 'Compartilhamento', 'Parte (%)']

const TEMPLATE_STATUS: Record<TemplateGroupPreviewMeta['status'], { label: string; tone: BadgeTone }> = {
  create: { label: 'Novo template', tone: 'success' },
  update: { label: 'Template alterado', tone: 'info' },
  unchanged: { label: 'Template existente', tone: 'neutral' },
}

const templateBlockCls =
  'rounded-lg border border-gray-200 border-l-4 border-l-[var(--color-1)] bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800'

const subtitleCls = 'mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400'

function hasValue(value: string | null | undefined) {
  return Boolean(value && value !== '—')
}

function itemName(row: CadastroImportPreviewRow) {
  return row.name || row.fields_after?.['Descrição'] || row.label || '—'
}

function TemplateIcon({ name }: { name?: string | null }) {
  const Icon = (name && findIconComponent(name)) || FileText
  return <Icon size={18} className="shrink-0" style={{ color: 'var(--color-1)' }} />
}

function ItemCreateTable({ rows }: { rows: CadastroImportPreviewRow[] }) {
  const sorted = [...rows].sort((a, b) => a.row - b.row)
  const fields = ITEM_CREATE_FIELDS.filter((field) => sorted.some((row) => hasValue(row.fields_after?.[field])))
  return (
    <PreviewDataTable
      columns={[{ key: 'row', label: '#' }, ...fields.map((field) => ({ key: field, label: field }))]}
      rows={sorted.map((row) => {
        const cells: Record<string, string | number> = { row: row.row }
        for (const field of fields) cells[field] = row.fields_after?.[field] || '—'
        return cells
      })}
    />
  )
}

function ChangesTable({ rows, withItem }: { rows: CadastroImportPreviewRow[]; withItem: boolean }) {
  const sorted = [...rows].sort((a, b) => a.row - b.row)
  return (
    <PreviewDataTable
      columns={[
        { key: 'row', label: '#' },
        ...(withItem ? [{ key: 'item', label: 'Item' }] : []),
        { key: 'campo', label: 'Campo' },
        { key: 'de', label: 'De' },
        { key: 'para', label: 'Para' },
      ]}
      rows={sorted.flatMap((row) =>
        (row.changes ?? []).map((change) => ({
          row: row.row,
          item: itemName(row),
          campo: change.label || change.field,
          de: change.before || '—',
          para: change.after || '—',
        })),
      )}
    />
  )
}

function TemplateBlock({
  name,
  meta,
  templateRow,
  items,
  mode,
}: {
  name: string
  meta?: TemplateGroupPreviewMeta
  templateRow?: CadastroImportPreviewRow
  items: CadastroImportPreviewRow[]
  mode: Mode
}) {
  const [open, setOpen] = useState(true)
  const status = TEMPLATE_STATUS[meta?.status ?? (templateRow ? mode : 'unchanged')]
  const icon = meta?.icon || templateRow?.fields_after?.['Ícone']
  const description = meta?.description || templateRow?.fields_after?.['Descrição']

  return (
    <div className={templateBlockCls}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 text-left"
        aria-expanded={open}
      >
        <span className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700">
          {open ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 items-center gap-2">
            <TemplateIcon name={icon} />
            <span className="truncate font-medium text-gray-900 dark:text-white" title={name}>
              {name}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
            <Badge variant={badgeVariantForColumnRole('scope')} tone={status.tone} label={status.label} />
            {hasValue(description) ? <span className="truncate">{description}</span> : null}
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
              {items.length} {items.length === 1 ? 'item' : 'itens'}
            </span>
          </div>
        </div>
      </button>

      {open ? (
        <div className="mt-4 ml-10 space-y-4">
          {mode === 'update' && templateRow?.changes?.length ? (
            <div>
              <p className={subtitleCls}>Alterações do template</p>
              <ChangesTable rows={[templateRow]} withItem={false} />
            </div>
          ) : null}
          {items.length > 0 ? (
            <div>
              <p className={subtitleCls}>Itens do template</p>
              {mode === 'create' ? <ItemCreateTable rows={items} /> : <ChangesTable rows={items} withItem />}
            </div>
          ) : (
            <p className="text-sm italic text-gray-500 dark:text-gray-400">
              {mode === 'create' ? 'Nenhum item novo neste template.' : 'Nenhum item alterado neste template.'}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function TemplatesByGroup({
  rows,
  mode,
  meta,
}: {
  rows: CadastroImportPreviewRow[]
  mode: Mode
  meta: Map<string, TemplateGroupPreviewMeta>
}) {
  const groups = new Map<string, { name: string; templateRow?: CadastroImportPreviewRow; items: CadastroImportPreviewRow[] }>()
  for (const row of rows) {
    const name =
      row.group ||
      (row.entity === 'template' ? row.label : row.fields_after?.Template || row.label?.split(' · ')[0]) ||
      '—'
    const key = name.toLowerCase()
    const entry = groups.get(key) ?? { name, items: [] }
    if (row.entity === 'template') entry.templateRow = row
    else entry.items.push(row)
    groups.set(key, entry)
  }
  const ordered = [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'pt-BR'))

  return (
    <div className="space-y-3">
      {ordered.map(([key, entry]) => (
        <TemplateBlock
          key={key}
          name={meta.get(key)?.name || entry.name}
          meta={meta.get(key)}
          templateRow={entry.templateRow}
          items={entry.items}
          mode={mode}
        />
      ))}
    </div>
  )
}

export default function TemplatesImportPreview({ data }: { data: CadastroImportPreviewData }) {
  const { creates, updates, issues } = data
  const meta = new Map((data.template_groups ?? []).map((group) => [group.name.toLowerCase(), group]))

  return (
    <div className="space-y-4">
      {updates.length > 0 ? (
        <CollapsiblePreviewSection title={`Alterações (${updates.length})`}>
          <TemplatesByGroup rows={updates} mode="update" meta={meta} />
        </CollapsiblePreviewSection>
      ) : null}
      {creates.length > 0 ? (
        <CollapsiblePreviewSection title={`Adições (${creates.length})`}>
          <TemplatesByGroup rows={creates} mode="create" meta={meta} />
        </CollapsiblePreviewSection>
      ) : null}
      <ImportPreviewIssuesSection issues={issues} />
    </div>
  )
}
