import { useState } from 'react'
import { ChevronDown, ChevronRight, CreditCard, Layers } from 'lucide-react'
import Badge, { type BadgeTone } from './Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import { CollapsiblePreviewSection, ImportPreviewIssuesSection, PreviewDataTable } from './ImportPreviewShared'
import type { CadastroImportPreviewData, CadastroImportPreviewRow, CardGroupPreviewMeta } from './CadastroImportPreview'

type Mode = 'create' | 'update'

const CARD_CREATE_FIELDS = [
  'Nome',
  'Final',
  'Tipo',
  'Compartilhamento',
  'Parte despesa (%)',
  'Parte receita (%)',
  'Fechamento',
  'Vencimento',
  'Ativo',
]

const GROUP_STATUS: Record<CardGroupPreviewMeta['status'], { label: string; tone: BadgeTone }> = {
  create: { label: 'Novo grupo', tone: 'success' },
  update: { label: 'Grupo alterado', tone: 'info' },
  unchanged: { label: 'Grupo existente', tone: 'neutral' },
}

const groupBlockCls =
  'rounded-lg border border-gray-200 border-l-4 border-l-[var(--color-1)] bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800'

const subtitleCls = 'mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400'

function hasValue(value: string | undefined) {
  return Boolean(value && value !== '—')
}

function CardCreateTable({ rows }: { rows: CadastroImportPreviewRow[] }) {
  const sorted = [...rows].sort((a, b) => a.row - b.row)
  const fields = CARD_CREATE_FIELDS.filter((field) => sorted.some((row) => hasValue(row.fields_after?.[field])))
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

function ChangesTable({ rows, withRecord }: { rows: CadastroImportPreviewRow[]; withRecord: boolean }) {
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
        ...(withRecord ? [{ key: 'registro', label: 'Cartão' }] : []),
        { key: 'campo', label: 'Campo' },
        { key: 'de', label: 'De' },
        { key: 'para', label: 'Para' },
      ]}
      rows={tableRows}
    />
  )
}

function CardsTable({ rows, mode }: { rows: CadastroImportPreviewRow[]; mode: Mode }) {
  return mode === 'create' ? <CardCreateTable rows={rows} /> : <ChangesTable rows={rows} withRecord />
}

function GroupBlock({
  name,
  meta,
  groupRow,
  cards,
  mode,
}: {
  name: string
  meta?: CardGroupPreviewMeta
  groupRow?: CadastroImportPreviewRow
  cards: CadastroImportPreviewRow[]
  mode: Mode
}) {
  const [open, setOpen] = useState(true)
  const status = GROUP_STATUS[meta?.status ?? (mode === 'create' && groupRow ? 'create' : 'unchanged')]
  const closing = meta?.closing_day ?? groupRow?.fields_after?.Fechamento
  const due = meta?.due_day ?? groupRow?.fields_after?.Vencimento
  const linkedCards = mode === 'create' ? groupRow?.fields_after?.['Cartões'] : undefined

  return (
    <div className={groupBlockCls}>
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
            <Layers size={18} className="shrink-0" style={{ color: 'var(--color-1)' }} />
            <span className="truncate font-medium text-gray-900 dark:text-white" title={name}>
              {name}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
            <Badge variant={badgeVariantForColumnRole('scope')} tone={status.tone} label={status.label} />
            <Badge variant={badgeVariantForColumnRole('scope')} tone="brand4" label="Fatura conjunta" />
            {closing != null && closing !== '' ? <span className="tabular-nums">Fech. {closing}</span> : null}
            {due != null && due !== '' ? <span className="tabular-nums">Venc. {due}</span> : null}
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
              {cards.length} {cards.length === 1 ? 'cartão' : 'cartões'}
            </span>
          </div>
        </div>
      </button>

      {open ? (
        <div className="mt-4 ml-10 space-y-4">
          {mode === 'update' && groupRow?.changes?.length ? (
            <div>
              <p className={subtitleCls}>Alterações do grupo</p>
              <ChangesTable rows={[groupRow]} withRecord={false} />
            </div>
          ) : null}
          {hasValue(linkedCards) ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              <span className="font-medium">Cartões já cadastrados que entram no grupo:</span> {linkedCards}
            </p>
          ) : null}
          {cards.length > 0 ? (
            <div>
              <p className={subtitleCls}>Cartões do grupo</p>
              <CardsTable rows={cards} mode={mode} />
            </div>
          ) : (
            <p className="text-sm italic text-gray-500 dark:text-gray-400">
              {mode === 'create' ? 'Nenhum cartão novo neste grupo.' : 'Nenhum cartão alterado neste grupo.'}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function CardsByGroup({
  rows,
  mode,
  groupsMeta,
}: {
  rows: CadastroImportPreviewRow[]
  mode: Mode
  groupsMeta: Map<string, CardGroupPreviewMeta>
}) {
  const groupRows = new Map<string, CadastroImportPreviewRow>()
  const cardsByGroup = new Map<string, CadastroImportPreviewRow[]>()
  const ungrouped: CadastroImportPreviewRow[] = []

  for (const row of rows) {
    if (row.entity === 'grupo_fatura') {
      groupRows.set(row.group || row.label || '', row)
      continue
    }
    if (!row.group) {
      ungrouped.push(row)
      continue
    }
    const list = cardsByGroup.get(row.group) ?? []
    list.push(row)
    cardsByGroup.set(row.group, list)
  }

  const names = [...new Set([...groupRows.keys(), ...cardsByGroup.keys()])].sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
  )

  return (
    <div className="space-y-3">
      {names.map((name) => (
        <GroupBlock
          key={name}
          name={name}
          meta={groupsMeta.get(name)}
          groupRow={groupRows.get(name)}
          cards={cardsByGroup.get(name) ?? []}
          mode={mode}
        />
      ))}
      {ungrouped.length > 0 ? (
        <div className="space-y-2">
          {names.length > 0 ? (
            <p className="flex items-center gap-2 pt-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <CreditCard size={14} />
              Cartões avulsos
            </p>
          ) : null}
          <CardsTable rows={ungrouped} mode={mode} />
        </div>
      ) : null}
    </div>
  )
}

export default function CartoesImportPreview({ data }: { data: CadastroImportPreviewData }) {
  const { creates, updates, issues } = data
  const groupsMeta = new Map((data.card_groups ?? []).map((group) => [group.name, group]))

  return (
    <div className="space-y-4">
      {updates.length > 0 ? (
        <CollapsiblePreviewSection title={`Alterações (${updates.length})`}>
          <CardsByGroup rows={updates} mode="update" groupsMeta={groupsMeta} />
        </CollapsiblePreviewSection>
      ) : null}
      {creates.length > 0 ? (
        <CollapsiblePreviewSection title={`Adições (${creates.length})`}>
          <CardsByGroup rows={creates} mode="create" groupsMeta={groupsMeta} />
        </CollapsiblePreviewSection>
      ) : null}
      <ImportPreviewIssuesSection issues={issues} />
    </div>
  )
}
