import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { cadastroSectionsStackCls } from './CadastroFormLayout'
import { CadastroListPageTabs } from './CadastroListPageLayout'
import {
  ImportPreviewIssuesSection,
  MetricColumn,
  MetricDivider,
  PreviewCardLayout,
  PreviewRowMeta,
  importPreviewCreateCardCls,
  importPreviewUpdateCardCls,
} from './ImportPreviewShared'
import MappingImportCorrectionsTable, {
  type MappingImportCorrectionRow,
} from './MappingImportCorrectionsTable'
import type { ParsedMappingImportRow } from '../utils/parseMappingExportWorkbook'
import { Eye, Pencil, PlusCircle, Wrench } from 'lucide-react'

export interface MappingImportPreviewData {
  summary: {
    creates: number
    updates: number
    unchanged: number
    skipped_invalid: number
    issues: number
    corrections?: number
  }
  creates: Array<{ row: number; mapping_id?: number | null; fields?: Record<string, unknown> }>
  updates: Array<{
    row: number
    mapping_id?: number | null
    changes?: string[]
    fields?: Record<string, unknown>
  }>
  issues: Array<{ row: number; reason: string }>
  corrections?: MappingImportCorrectionRow[]
}

type PreviewTab = 'corrections' | 'updates' | 'creates'

import type { MappingImportLookup } from '../utils/mappingImportCorrections'

const CHANGE_LABELS: Record<string, string> = {
  subtag: 'Tag/Subtag',
  prioridade: 'Prioridade',
  compartilhamento: 'Compart.',
  sensível: 'Sensível',
  critério: 'Critério',
  'tipo match': 'Tipo match',
}

function mappingTypeLabel(value: unknown): string {
  if (value === 'exact') return 'Exato'
  if (value === 'pattern') return 'Padrão'
  if (value === 'regex') return 'Regex'
  return value ? String(value) : '—'
}

function mappingTitle(fields?: Record<string, unknown>): string {
  if (!fields) return 'Mapeamento'
  const mapped = fields.mapped_description
  if (typeof mapped === 'string' && mapped.trim()) return mapped
  const crit =
    fields.original_description || fields.pattern || fields.regex_pattern
  if (typeof crit === 'string' && crit.trim()) return crit
  return 'Mapeamento'
}

function mappingCriterion(fields?: Record<string, unknown>): string | null {
  if (!fields) return null
  const crit = fields.original_description || fields.pattern || fields.regex_pattern
  if (typeof crit === 'string' && crit.trim()) return crit
  return null
}

function formatChanges(changes?: string[]): string {
  if (!changes?.length) return '—'
  return changes.map((c) => CHANGE_LABELS[c] ?? c).join(', ')
}

function mappingMetrics(fields?: Record<string, unknown>, changes?: string[]): ReactNode {
  const nodes: ReactNode[] = []
  let n = 0

  const push = (node: ReactNode) => {
    if (n > 0) nodes.push(<MetricDivider key={`div-${n}`} />)
    nodes.push(node)
    n += 1
  }

  if (changes?.length) {
    push(
      <MetricColumn key="changes" label="Alterações" className="min-w-[6rem] max-w-[14rem]">
        <span className="whitespace-normal break-words font-bold normal-case">{formatChanges(changes)}</span>
      </MetricColumn>,
    )
  }

  if (fields?.mapping_type != null) {
    push(
      <MetricColumn key="type" label="Match">
        {mappingTypeLabel(fields.mapping_type)}
      </MetricColumn>,
    )
  }

  const criterion = mappingCriterion(fields)
  if (criterion) {
    push(
      <MetricColumn key="crit" label="Critério" className="min-w-[8rem] max-w-[20rem]">
        <span className="block whitespace-normal break-words font-bold normal-case" title={criterion}>
          {criterion}
        </span>
      </MetricColumn>,
    )
  }

  if (fields?.priority != null && fields.priority !== '') {
    push(
      <MetricColumn key="prio" label="Prioridade">
        {String(fields.priority)}
      </MetricColumn>,
    )
  }

  return nodes.length ? nodes : <MetricColumn label="Dados">conforme planilha</MetricColumn>
}

function MappingUpdateCard({
  row,
}: {
  row: MappingImportPreviewData['updates'][number]
}) {
  const title = mappingTitle(row.fields)
  return (
    <article className={importPreviewUpdateCardCls}>
      <PreviewCardLayout
        info={
          <>
            <p className="truncate font-medium text-gray-900 dark:text-white" title={title}>
              {title}
            </p>
            <PreviewRowMeta row={row.row} entity="mapeamento" recordId={row.mapping_id} />
          </>
        }
        metrics={mappingMetrics(row.fields, row.changes)}
      />
    </article>
  )
}

function MappingCreateCard({
  row,
}: {
  row: MappingImportPreviewData['creates'][number]
}) {
  const title = mappingTitle(row.fields)
  return (
    <article className={importPreviewCreateCardCls}>
      <PreviewCardLayout
        info={
          <>
            <p className="truncate font-medium text-gray-900 dark:text-white" title={title}>
              {title}
            </p>
            <PreviewRowMeta row={row.row} entity="mapeamento" recordId={row.mapping_id} />
          </>
        }
        metrics={mappingMetrics(row.fields)}
      />
    </article>
  )
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
  const { creates, updates, issues } = data
  const corrections = manualTabRows
  const correctionRowSet = useMemo(() => new Set(corrections.map((c) => c.row)), [corrections])
  const issuesOutsideCorrections = useMemo(
    () => issues.filter((i) => !correctionRowSet.has(i.row)),
    [issues, correctionRowSet],
  )

  const [tab, setTab] = useState<PreviewTab>(() =>
    corrections.length > 0 ? 'corrections' : updates.length > 0 ? 'updates' : 'creates',
  )

  useEffect(() => {
    if (corrections.length > 0) {
      setTab('corrections')
    }
  }, [corrections.length])

  const tabs = useMemo(() => {
    const items = [
      { key: 'updates' as const, label: 'Alterações', icon: <Pencil size={15} />, count: updates.length },
      { key: 'creates' as const, label: 'Adições', icon: <PlusCircle size={15} />, count: creates.length },
    ]
    if (corrections.length > 0) {
      items.unshift({
        key: 'corrections' as const,
        label: 'Preencher manual',
        icon: <Wrench size={15} />,
        count: corrections.length,
      })
    }
    return items
  }, [updates.length, creates.length, corrections.length])

  const list = tab === 'updates' ? updates : tab === 'creates' ? creates : []

  const rowsByIndex = useMemo(() => {
    const m = new Map<number, ParsedMappingImportRow>()
    for (const r of parsedRows) m.set(r.row_index, r)
    return m
  }, [parsedRows])

  return (
    <div className={cadastroSectionsStackCls}>
      <CadastroListPageTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as PreviewTab)} />

      <div className="min-h-[min(52vh,420px)] max-h-[min(72vh,680px)] overflow-y-auto">
        {tab === 'corrections' ? (
          lookup ? (
            <MappingImportCorrectionsTable
              corrections={corrections}
              rowsByIndex={rowsByIndex}
              tags={lookup.tags}
              subtags={lookup.subtags}
              partners={lookup.partners}
              onPatchRow={onPatchManualRow}
            />
          ) : (
            <p className="py-6 text-center text-sm text-gray-600 dark:text-gray-300">
              Carregando tags e compartilhamentos…
            </p>
          )
        ) : !list.length ? (
          <p className="py-6 text-center text-sm text-gray-600 dark:text-gray-300">
            {tab === 'updates'
              ? 'Nenhuma alteração em mapeamentos existentes.'
              : 'Nenhum mapeamento novo será criado.'}
          </p>
        ) : (
          <div className="space-y-3">
            {[...list]
              .sort((a, b) => a.row - b.row)
              .map((row) =>
                tab === 'updates' ? (
                  <MappingUpdateCard key={`u-${row.row}-${row.mapping_id ?? ''}`} row={row} />
                ) : (
                  <MappingCreateCard key={`c-${row.row}`} row={row} />
                ),
              )}
          </div>
        )}
      </div>

      <ImportPreviewIssuesSection issues={issuesOutsideCorrections} />

      {creates.length === 0 && updates.length === 0 && corrections.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <Eye size={16} />
          Nenhuma alteração detectada nas linhas válidas.
        </p>
      ) : null}
    </div>
  )
}
