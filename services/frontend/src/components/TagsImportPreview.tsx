import { useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Tag as TagIcon,
} from 'lucide-react'
import Badge, { type BadgeTone } from './Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import { CollapsiblePreviewSection, ImportPreviewIssuesSection, PreviewDataTable } from './ImportPreviewShared'
import { TagIconCell, type IconChoices } from './ImportTagIcon'
import type {
  CadastroImportChange,
  CadastroImportPreviewData,
  CadastroImportPreviewRow,
  TagGroupPreviewMeta,
} from './CadastroImportPreview'

type Mode = 'create' | 'update'

const TAG_STATUS: Record<TagGroupPreviewMeta['status'], { label: string; tone: BadgeTone }> = {
  create: { label: 'Nova tag', tone: 'success' },
  update: { label: 'Tag alterada', tone: 'info' },
  unchanged: { label: 'Tag existente', tone: 'neutral' },
}

const tagCardCls =
  'rounded-lg border border-gray-200 border-l-4 border-l-[var(--color-1)] bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800'

function isIconChange(change: CadastroImportChange) {
  return change.field === 'icon' || change.label === 'Ícone'
}

function subtypeLabel(row: CadastroImportPreviewRow) {
  const raw = (row.subtype || row.fields_after?.Tipo || '').toLowerCase()
  if (raw === 'receita') return 'Receita'
  if (raw === 'despesa') return 'Despesa'
  return raw || '—'
}

function SubtypeIcon({ row }: { row: CadastroImportPreviewRow }) {
  const label = subtypeLabel(row)
  if (label === 'Receita') {
    return (
      <span title="Receita" className="inline-flex">
        <ArrowUp size={16} className="text-[var(--color-success)]" aria-label="Receita" />
      </span>
    )
  }
  if (label === 'Despesa') {
    return (
      <span title="Despesa" className="inline-flex">
        <ArrowDown size={16} className="text-[var(--color-danger)]" aria-label="Despesa" />
      </span>
    )
  }
  return <>{label}</>
}

function subtagName(row: CadastroImportPreviewRow) {
  return row.name || row.fields_after?.Nome || row.label?.split('/').slice(1).join('/') || row.label || '—'
}

function SubtagCreateTable({ rows, icons }: { rows: CadastroImportPreviewRow[]; icons: IconChoices }) {
  const sorted = [...rows].sort((a, b) => subtagName(a).localeCompare(subtagName(b), 'pt-BR'))
  return (
    <PreviewDataTable
      columns={[
        { key: 'name', label: 'Subtag' },
        { key: 'type', label: 'Tipo' },
        { key: 'description', label: 'Descrição' },
        { key: 'icon', label: 'Ícone' },
      ]}
      rows={sorted.map((row) => ({
        name: subtagName(row),
        type: <SubtypeIcon row={row} />,
        description: row.fields_after?.['Descrição'] || '—',
        icon: <TagIconCell raw={row.fields_after?.['Ícone'] || '—'} row={row} editable {...icons} />,
      }))}
      sortValues={sorted.map((row) => ({ type: subtypeLabel(row), icon: row.fields_after?.['Ícone'] || '' }))}
    />
  )
}

function SubtagUpdateTable({ rows, icons }: { rows: CadastroImportPreviewRow[]; icons: IconChoices }) {
  const sorted = [...rows].sort((a, b) => subtagName(a).localeCompare(subtagName(b), 'pt-BR'))
  const pairs = sorted.flatMap((row) => (row.changes ?? []).map((change) => ({ row, change })))
  return (
    <PreviewDataTable
      columns={[
        { key: 'name', label: 'Subtag' },
        { key: 'type', label: 'Tipo' },
        { key: 'campo', label: 'Campo' },
        { key: 'de', label: 'De' },
        { key: 'para', label: 'Para' },
      ]}
      rows={pairs.map(({ row, change }) => ({
        name: subtagName(row),
        type: <SubtypeIcon row={row} />,
        campo: change.label || change.field,
        de: isIconChange(change) ? (
          <TagIconCell raw={change.before || '—'} row={row} editable={false} {...icons} />
        ) : (
          change.before || '—'
        ),
        para: isIconChange(change) ? (
          <TagIconCell raw={change.after || '—'} row={row} editable {...icons} />
        ) : (
          change.after || '—'
        ),
      }))}
      sortValues={pairs.map(({ row, change }) => ({
        type: subtypeLabel(row),
        de: change.before || '',
        para: change.after || '',
      }))}
    />
  )
}

function TagChangeList({
  row,
  icons,
}: {
  row: CadastroImportPreviewRow
  icons: IconChoices
}) {
  return (
    <ul className="space-y-1.5 text-sm">
      {(row.changes ?? []).map((change) => (
        <li key={change.field} className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-700 dark:text-gray-200">{change.label || change.field}:</span>
          <span className="text-gray-500 line-through decoration-gray-400 dark:text-gray-400">
            {isIconChange(change) ? (
              <TagIconCell raw={change.before || '—'} row={row} editable={false} {...icons} />
            ) : (
              change.before || '—'
            )}
          </span>
          <ArrowRight size={14} className="text-gray-400" />
          <span className="text-gray-900 dark:text-gray-100">
            {isIconChange(change) ? (
              <TagIconCell raw={change.after || '—'} row={row} editable {...icons} />
            ) : (
              change.after || '—'
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

function TagHeaderIcon({
  tagRow,
  meta,
  mode,
  icons,
}: {
  tagRow?: CadastroImportPreviewRow
  meta?: TagGroupPreviewMeta
  mode: Mode
  icons: IconChoices
}) {
  let node: ReactNode = null
  if (tagRow && mode === 'create') {
    const raw = tagRow.fields_after?.['Ícone'] || ''
    if (raw && raw !== '—') node = <TagIconCell raw={raw} row={tagRow} editable size={18} {...icons} />
  } else if (meta?.icon) {
    node = (
      <TagIconCell
        raw={meta.icon}
        row={tagRow ?? { row: 0, entity: 'tag' }}
        editable={false}
        size={18}
        {...icons}
      />
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center" style={{ color: 'var(--color-1)' }}>
      {node ?? <TagIcon size={18} />}
    </span>
  )
}

function TagGroupCard({
  name,
  meta,
  tagRow,
  subtags,
  mode,
  icons,
}: {
  name: string
  meta?: TagGroupPreviewMeta
  tagRow?: CadastroImportPreviewRow
  subtags: CadastroImportPreviewRow[]
  mode: Mode
  icons: IconChoices
}) {
  const [open, setOpen] = useState(false)
  const status = TAG_STATUS[meta?.status ?? (tagRow ? mode : 'unchanged')]
  const description =
    (mode === 'create' ? tagRow?.fields_after?.['Descrição'] : undefined) || meta?.description || ''
  const hasSubtags = subtags.length > 0
  const tagChanges = mode === 'update' && tagRow?.changes?.length ? tagRow : null

  return (
    <div className={tagCardCls}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={!hasSubtags}
          className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:invisible dark:text-gray-400 dark:hover:bg-gray-700"
          title={open ? 'Recolher subtags' : 'Ver subtags'}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <TagHeaderIcon tagRow={tagRow} meta={meta} mode={mode} icons={icons} />
            <span className="truncate font-medium text-gray-900 dark:text-white" title={name}>
              {name}
            </span>
            <Badge variant={badgeVariantForColumnRole('scope')} tone={status.tone} label={status.label} />
            {hasSubtags ? (
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                {subtags.length}{' '}
                {mode === 'create'
                  ? subtags.length === 1 ? 'subtag nova' : 'subtags novas'
                  : subtags.length === 1 ? 'subtag alterada' : 'subtags alteradas'}
              </span>
            ) : null}
          </div>
          {description && description !== '—' ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
          ) : null}
          {tagChanges ? <TagChangeList row={tagChanges} icons={icons} /> : null}
        </div>
      </div>

      {open && hasSubtags ? (
        <div className="mt-4 ml-10">
          {mode === 'create' ? (
            <SubtagCreateTable rows={subtags} icons={icons} />
          ) : (
            <SubtagUpdateTable rows={subtags} icons={icons} />
          )}
        </div>
      ) : null}
    </div>
  )
}

function TagsByGroup({
  rows,
  mode,
  meta,
  icons,
}: {
  rows: CadastroImportPreviewRow[]
  mode: Mode
  meta: Map<string, TagGroupPreviewMeta>
  icons: IconChoices
}) {
  const groups = new Map<string, { name: string; tagRow?: CadastroImportPreviewRow; subtags: CadastroImportPreviewRow[] }>()
  for (const row of rows) {
    const name =
      row.group || (row.entity === 'tag' ? row.label : row.fields_after?.Tag || row.label?.split('/')[0]) || '—'
    const key = name.toLowerCase()
    const entry = groups.get(key) ?? { name, subtags: [] }
    if (row.entity === 'tag') entry.tagRow = row
    else entry.subtags.push(row)
    groups.set(key, entry)
  }
  const ordered = [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'pt-BR'))

  return (
    <div className="space-y-3">
      {ordered.map(([key, entry]) => (
        <TagGroupCard
          key={key}
          name={meta.get(key)?.name || entry.name}
          meta={meta.get(key)}
          tagRow={entry.tagRow}
          subtags={entry.subtags}
          mode={mode}
          icons={icons}
        />
      ))}
    </div>
  )
}

export default function TagsImportPreview({
  data,
  iconChoices,
}: {
  data: CadastroImportPreviewData
  iconChoices: IconChoices
}) {
  const { creates, updates, issues } = data
  const meta = new Map((data.tag_groups ?? []).map((group) => [group.name.toLowerCase(), group]))

  return (
    <div className="space-y-4">
      {updates.length > 0 ? (
        <CollapsiblePreviewSection title={`Alterações (${updates.length})`}>
          <TagsByGroup rows={updates} mode="update" meta={meta} icons={iconChoices} />
        </CollapsiblePreviewSection>
      ) : null}
      {creates.length > 0 ? (
        <CollapsiblePreviewSection title={`Adições (${creates.length})`}>
          <TagsByGroup rows={creates} mode="create" meta={meta} icons={iconChoices} />
        </CollapsiblePreviewSection>
      ) : null}
      <ImportPreviewIssuesSection issues={issues} />
    </div>
  )
}
