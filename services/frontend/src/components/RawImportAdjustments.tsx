import { CollapsiblePreviewSection, PreviewDataTable } from './ImportPreviewShared'
import { cadastroFilterFieldCls } from './CadastroListPageLayout'
import { conflictChange, previewDateMs } from './RawImportPreview'
import { fieldLabel, formatChangeDisplay, type VisualImportPreviewRow } from './ExtratoVisualImportPreview'
import { formatCurrency } from '../utils/currency'
import type { ConflictResolution, ImportConflict } from '../types/importConflict'

export type ConflictChoice = 'atual' | 'novo'

export interface ConflictDecision {
  choice: ConflictChoice
  /** Registro escolhido quando o conflito tem vários candidatos. */
  matchId?: number
}

export interface RawFixGroup {
  fileId: string
  fileName: string
  /** Aba dos Ajustes (extrato_bruto, beneficio_csv, fatura_bruta). */
  kind: string
  warnings: string[]
  conflicts: ImportConflict[]
  /** Alterações de registros existentes vindas da planilha exportada pelo Plumo. */
  updates: VisualImportPreviewRow[]
}

export function rawConflictKey(fileId: string, conflict: ImportConflict): string {
  return [
    fileId,
    conflict.record_type,
    conflict.existing_id ?? '',
    conflict.source_line ?? '',
    String(conflict.date || ''),
    conflict.description,
  ].join('|')
}

export function exportUpdateKey(fileId: string, source: string, row: number): string {
  return `${fileId}|export|${source}|${row}`
}

/** Sem decisão explícita vale "Atual" (manter o registro como está). */
export function effectiveDecision(decision: ConflictDecision | undefined): ConflictDecision {
  return decision ?? { choice: 'atual' }
}

export function conflictDecisionComplete(conflict: ImportConflict, decision: ConflictDecision | undefined): boolean {
  const effective = effectiveDecision(decision)
  if (effective.choice === 'atual') return true
  return !conflict.multiple_matches?.length || effective.matchId != null
}

/** Conflitos marcados como Atualizar que ainda precisam do registro a atualizar. */
export function pendingRawFixes(groups: RawFixGroup[], decisions: Record<string, ConflictDecision>): number {
  let conflicts = 0
  for (const group of groups) {
    for (const conflict of group.conflicts) {
      if (!conflictDecisionComplete(conflict, decisions[rawConflictKey(group.fileId, conflict)])) conflicts += 1
    }
  }
  return conflicts
}

/** Resolução enviada a /api/import/resolve-conflicts para quem escolheu "Novo". */
export function resolutionForDecision(conflict: ImportConflict, decision: ConflictDecision): ConflictResolution | null {
  if (decision.choice !== 'novo') return null
  const isMultiple = !!conflict.multiple_matches?.length
  const existingId = isMultiple ? decision.matchId : conflict.existing_id
  if (!existingId) return null
  return {
    existing_id: existingId,
    record_type: conflict.record_type,
    accept_tag_change: !!conflict.tag_conflict || (isMultiple && conflict.new_subtag_id != null),
    accept_amount_change: !!conflict.amount_conflict || isMultiple,
    new_subtag_id: conflict.new_subtag_id ?? conflict.tag_conflict?.new_subtag_id,
    clear_subtag: !!conflict.tag_conflict && conflict.tag_conflict.new_subtag_id == null,
    new_amount: conflict.new_amount ?? conflict.amount_conflict?.new_amount,
    selected_from_multiple: isMultiple,
  }
}

function conflictDate(value: string): string {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/)
  if (!m) return String(value || '')
  return m[4] ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : `${m[3]}/${m[2]}/${m[1]}`
}

const pendingSelectCls = `${cadastroFilterFieldCls} ring-1 ring-amber-400/80`

const CHOICE_OPTIONS = [
  { value: 'atual', label: 'Manter' },
  { value: 'novo', label: 'Atualizar' },
] as const

function ChoiceToggle({
  value,
  onChange,
}: {
  value: ConflictChoice
  onChange: (choice: ConflictChoice) => void
}) {
  return (
    <div role="radiogroup" className="flex w-36 rounded-lg bg-gray-200 p-0.5 dark:bg-black/40">
      {CHOICE_OPTIONS.map(({ value: choice, label }) => {
        const active = value === choice
        return (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(choice)}
            className={`flex flex-1 items-center justify-center rounded-md py-1.5 text-xs transition-all duration-200 ${
              active
                ? 'bg-[var(--color-1)] font-semibold text-white shadow-[0_1px_4px_rgba(0,0,0,.3)]'
                : 'font-medium text-gray-500 hover:text-gray-800 dark:text-slate-500 dark:hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function ConflictDecisionTable({
  fileId,
  conflicts,
  decisions,
  onDecide,
}: {
  fileId: string
  conflicts: ImportConflict[]
  decisions: Record<string, ConflictDecision>
  onDecide: (key: string, decision: ConflictDecision) => void
}) {
  const rows = conflicts.map((conflict, index) => {
    const key = rawConflictKey(fileId, conflict)
    const decision = decisions[key]
    const change = conflictChange(conflict)
    const candidates = conflict.multiple_matches ?? []
    const date = conflictDate(conflict.date)
    return {
      cells: {
        index: index + 1,
        row: conflict.source_line ?? '—',
        date,
        description: conflict.description,
        campo: change.campo,
        de: change.de,
        para: change.para,
        decision: (
          <div className="flex flex-col items-start gap-1.5">
            <ChoiceToggle
              value={decision?.choice ?? 'atual'}
              onChange={(choice) => onDecide(key, { choice, matchId: decision?.matchId })}
            />
            {candidates.length > 0 && decision?.choice === 'novo' ? (
              <select
                aria-label="Registro a atualizar"
                className={decision.matchId == null ? pendingSelectCls : cadastroFilterFieldCls}
                value={decision.matchId ?? ''}
                onChange={(event) =>
                  onDecide(key, {
                    choice: 'novo',
                    matchId: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              >
                <option value="">Qual registro atualizar?</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {formatCurrency(candidate.amount)}
                    {candidate.tag_name || candidate.subtag_name
                      ? ` · ${[candidate.tag_name, candidate.subtag_name].filter(Boolean).join(' / ')}`
                      : ''}
                    {candidate.total_installments
                      ? ` · ${candidate.current_installment ?? '?'}/${candidate.total_installments}`
                      : ''}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ),
      },
      date,
    }
  })
  return (
    <PreviewDataTable
      columns={[
        { key: 'index', label: '#' },
        { key: 'row', label: 'Linha' },
        { key: 'date', label: 'Data' },
        { key: 'description', label: 'Descrição' },
        { key: 'campo', label: 'Campo' },
        { key: 'de', label: 'Atual' },
        { key: 'para', label: 'Arquivo' },
        { key: 'decision', label: 'Decisão' },
      ]}
      verticalAlign="middle"
      rows={rows.map((row) => row.cells)}
      sortValues={rows.map((row) => ({ date: previewDateMs(row.date) }))}
    />
  )
}

function ChangeLines({ values }: { values: string[] }) {
  return (
    <div className="space-y-1">
      {values.map((value, index) => (
        <div key={index}>{value}</div>
      ))}
    </div>
  )
}

function UpdateDecisionTable({
  fileId,
  updates,
  decisions,
  onDecide,
}: {
  fileId: string
  updates: VisualImportPreviewRow[]
  decisions: Record<string, ConflictDecision>
  onDecide: (key: string, decision: ConflictDecision) => void
}) {
  const rows = [...updates]
    .sort((a, b) => a.row - b.row)
    .map((update, index) => {
      const key = exportUpdateKey(fileId, update.source, update.row)
      const changes = update.changes ?? []
      return {
        cells: {
          index: index + 1,
          row: update.row,
          date: update.date,
          description: update.description,
          amount: formatCurrency(update.amount),
          campo: <ChangeLines values={changes.map((change) => fieldLabel(change.field))} />,
          de: <ChangeLines values={changes.map((change) => formatChangeDisplay(change.field, change.before))} />,
          para: <ChangeLines values={changes.map((change) => formatChangeDisplay(change.field, change.after))} />,
          decision: (
            <ChoiceToggle
              value={decisions[key]?.choice ?? 'atual'}
              onChange={(choice) => onDecide(key, { choice })}
            />
          ),
        },
        date: update.date,
        amount: update.amount,
      }
    })
  return (
    <PreviewDataTable
      columns={[
        { key: 'index', label: '#' },
        { key: 'row', label: 'Linha' },
        { key: 'date', label: 'Data' },
        { key: 'description', label: 'Descrição' },
        { key: 'amount', label: 'Valor' },
        { key: 'campo', label: 'Campo' },
        { key: 'de', label: 'Atual' },
        { key: 'para', label: 'Planilha' },
        { key: 'decision', label: 'Decisão' },
      ]}
      verticalAlign="middle"
      rows={rows.map((row) => row.cells)}
      sortValues={rows.map((row) => ({ date: previewDateMs(row.date), amount: row.amount }))}
    />
  )
}

const bulkBtnCls =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50'

export default function RawImportAdjustments({
  groups,
  decisions,
  onDecide,
}: {
  groups: RawFixGroup[]
  decisions: Record<string, ConflictDecision>
  onDecide: (updates: Record<string, ConflictDecision>) => void
}) {
  const multiple = groups.length > 1
  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const decideAll = (choice: ConflictChoice) =>
          onDecide(
            Object.fromEntries(
              group.conflicts.map((conflict) => {
                const key = rawConflictKey(group.fileId, conflict)
                return [key, { choice, matchId: decisions[key]?.matchId }]
              }),
            ),
          )
        const decideAllUpdates = (choice: ConflictChoice) =>
          onDecide(
            Object.fromEntries(
              group.updates.map((update) => [exportUpdateKey(group.fileId, update.source, update.row), { choice }]),
            ),
          )
        return (
          <section key={group.fileId} className="space-y-3">
            {multiple ? (
              <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100" title={group.fileName}>
                {group.fileName}
              </h3>
            ) : null}
            {group.warnings.map((warning) => (
              <p
                key={warning}
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200"
              >
                {warning}
              </p>
            ))}
            {group.conflicts.length > 0 ? (
              <CollapsiblePreviewSection title={`Conflitos (${group.conflicts.length})`} tone="warning" defaultOpen>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Lançamentos que já existem com valor ou classificação diferente. Por padrão fica a versão atual;
                    marque Atualizar onde o arquivo deve prevalecer.
                  </p>
                  <div className="flex gap-2">
                    <button type="button" className={bulkBtnCls} onClick={() => decideAll('atual')}>
                      Manter todos
                    </button>
                    <button type="button" className={bulkBtnCls} onClick={() => decideAll('novo')}>
                      Atualizar todos
                    </button>
                  </div>
                </div>
                <ConflictDecisionTable
                  fileId={group.fileId}
                  conflicts={group.conflicts}
                  decisions={decisions}
                  onDecide={(key, decision) => onDecide({ [key]: decision })}
                />
              </CollapsiblePreviewSection>
            ) : null}
            {group.updates.length > 0 ? (
              <CollapsiblePreviewSection title={`Alterações (${group.updates.length})`} tone="warning" defaultOpen>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Registros que já existem com dados diferentes da planilha. Por padrão fica a versão atual; marque
                    Atualizar onde a planilha deve prevalecer.
                  </p>
                  <div className="flex gap-2">
                    <button type="button" className={bulkBtnCls} onClick={() => decideAllUpdates('atual')}>
                      Manter todos
                    </button>
                    <button type="button" className={bulkBtnCls} onClick={() => decideAllUpdates('novo')}>
                      Atualizar todos
                    </button>
                  </div>
                </div>
                <UpdateDecisionTable
                  fileId={group.fileId}
                  updates={group.updates}
                  decisions={decisions}
                  onDecide={(key, decision) => onDecide({ [key]: decision })}
                />
              </CollapsiblePreviewSection>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
