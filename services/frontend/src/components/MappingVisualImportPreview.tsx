import { useMemo } from 'react'
import {
  CollapsiblePreviewSection,
  IssueActionBadge,
  PreviewDataTable,
  PreviewEmptyState,
} from './ImportPreviewShared'
import MappingImportCorrectionsTable, {
  type MappingImportCorrectionRow,
} from './MappingImportCorrectionsTable'
import type { ParsedMappingImportRow } from '../utils/parseMappingExportWorkbook'
import type { MappingImportLookup } from '../utils/mappingImportCorrections'

export interface MappingImportPreviewData {
  summary: {
    creates: number
    updates: number
    unchanged: number
    skipped_invalid: number
    issues: number
    corrections?: number
  }
  creates: Array<{ row: number; mapping_id?: number | null; label?: string; fields?: Record<string, string> }>
  updates: Array<{
    row: number
    mapping_id?: number | null
    label?: string
    changes?: Array<{ field: string; label: string; before: string; after: string }>
  }>
  issues: Array<{ row: number; reason: string; action?: string }>
  corrections?: MappingImportCorrectionRow[]
}

const CREATE_COLUMNS = [
  { key: 'row', label: '#', width: '3.5rem' },
  { key: 'match', label: 'Match', width: '6rem' },
  { key: 'criterion', label: 'Critério', width: '22%' },
  { key: 'mapped_description', label: 'Descrição mapeada', width: '18%' },
  { key: 'classification', label: 'Tag/Subtag', width: '16%' },
  { key: 'priority', label: 'Prior.', width: '5.5rem' },
  { key: 'sharing', label: 'Compart.' },
  { key: 'contribution', label: 'Contrib. %', width: '6rem' },
  { key: 'sensitive', label: 'Sensível', width: '5.5rem' },
]

const ISSUE_COLUMNS = [
  { key: 'index', label: '#' },
  { key: 'row', label: 'Linha' },
  { key: 'match', label: 'Match' },
  { key: 'criterion', label: 'Critério' },
  { key: 'mapped_description', label: 'Descrição mapeada' },
  { key: 'classification', label: 'Tag/Subtag' },
  { key: 'reason', label: 'Motivo' },
  { key: 'action', label: 'Situação' },
]

function sourceClassification(row: ParsedMappingImportRow | undefined): string {
  if (!row) return '—'
  const tag = row.tag_name?.trim()
  const subtag = row.subtag_name?.trim()
  if (tag && subtag) return `${tag}/${subtag}`
  return tag || subtag || '—'
}

function cell(fields: Record<string, string> | undefined, key: string): string {
  const value = fields?.[key]
  return value && value !== '' ? value : '—'
}

export default function MappingVisualImportPreview({
  data,
  parsedRows,
  lookup,
  manualTabRows,
  onPatchManualRow,
}: {
  data: MappingImportPreviewData
  parsedRows: ParsedMappingImportRow[]
  lookup: MappingImportLookup | null
  manualTabRows: MappingImportCorrectionRow[]
  onPatchManualRow: (rowIndex: number, patch: Partial<ParsedMappingImportRow>) => void
}) {
  const { creates, updates, issues, summary } = data
  const corrections = manualTabRows
  const correctionRowSet = useMemo(() => new Set(corrections.map((c) => c.row)), [corrections])
  const issuesOutsideCorrections = useMemo(
    () => issues.filter((i) => !correctionRowSet.has(i.row)),
    [issues, correctionRowSet],
  )

  const rowsByIndex = useMemo(() => {
    const m = new Map<number, ParsedMappingImportRow>()
    for (const r of parsedRows) m.set(r.row_index, r)
    return m
  }, [parsedRows])

  const sortedUpdates = [...updates].sort((a, b) => a.row - b.row)
  const sortedCreates = [...creates].sort((a, b) => a.row - b.row)
  const updateRows = sortedUpdates.flatMap((row) =>
    (row.changes ?? []).map((change) => ({
      row: row.row,
      registro: row.label || '—',
      campo: change.label || change.field,
      de: change.before || '—',
      para: change.after || '—',
    })),
  )

  return (
    <div className="space-y-4">
      {!sortedUpdates.length && !sortedCreates.length && !corrections.length ? (
        <PreviewEmptyState unchanged={summary.unchanged} />
      ) : null}
      {corrections.length > 0 ? (
        <CollapsiblePreviewSection title={`Preencher manual (${corrections.length})`}>
          {lookup ? (
            <MappingImportCorrectionsTable
              corrections={corrections}
              rowsByIndex={rowsByIndex}
              tags={lookup.tags}
              subtags={lookup.subtags}
              partners={lookup.partners}
              onPatchRow={onPatchManualRow}
            />
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-300">Carregando tags e compartilhamentos…</p>
          )}
        </CollapsiblePreviewSection>
      ) : null}
      {updateRows.length > 0 ? (
        <CollapsiblePreviewSection title={`Alterações (${sortedUpdates.length})`}>
          <PreviewDataTable
            columns={[
              { key: 'row', label: '#' },
              { key: 'registro', label: 'Mapeamento' },
              { key: 'campo', label: 'Campo' },
              { key: 'de', label: 'De' },
              { key: 'para', label: 'Para' },
            ]}
            rows={updateRows}
          />
        </CollapsiblePreviewSection>
      ) : null}
      {sortedCreates.length > 0 ? (
        <CollapsiblePreviewSection title={`Adições (${sortedCreates.length})`}>
          <PreviewDataTable
            wrap
            columns={CREATE_COLUMNS}
            rows={sortedCreates.map((row) => ({
              row: row.row,
              match: cell(row.fields, 'match'),
              criterion: cell(row.fields, 'criterion'),
              mapped_description: cell(row.fields, 'mapped_description'),
              classification: cell(row.fields, 'classification'),
              priority: cell(row.fields, 'priority'),
              sharing: cell(row.fields, 'sharing'),
              contribution: cell(row.fields, 'contribution'),
              sensitive: cell(row.fields, 'sensitive'),
            }))}
          />
        </CollapsiblePreviewSection>
      ) : null}

      {issuesOutsideCorrections.length > 0 ? (
        <CollapsiblePreviewSection title={`Problemas (${issuesOutsideCorrections.length})`} tone="warning">
          <PreviewDataTable
            columns={ISSUE_COLUMNS}
            rows={issuesOutsideCorrections.map((issue, index) => {
              const source = rowsByIndex.get(issue.row)
              return {
                index: index + 1,
                row: issue.row || '—',
                match: source?.match || '—',
                criterion: source?.criterion || '—',
                mapped_description: source?.mapped_description || '—',
                classification: sourceClassification(source),
                reason: issue.reason,
                action: <IssueActionBadge action={issue.action} />,
              }
            })}
            sortValues={issuesOutsideCorrections.map((issue) => ({ action: issue.action || '' }))}
          />
        </CollapsiblePreviewSection>
      ) : null}
    </div>
  )
}
