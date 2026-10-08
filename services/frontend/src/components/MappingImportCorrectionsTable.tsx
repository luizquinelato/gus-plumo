import { useMemo } from 'react'
import {
  cadastroFilterFieldCls,
  listPageTableRowHoverCls,
  listPageTableTdCls,
  listPageTableThCls,
} from './CadastroListPageLayout'
import { ListPageTable } from './ListPageTable'
import {
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCol,
  ListTableSpacerHeader,
} from './ListTableSelectColumns'
import { sharingPartnerLabel } from '../utils/accountFormatter'
import type { ParsedMappingImportRow } from '../utils/parseMappingExportWorkbook'

export interface MappingImportCorrectionRow {
  row: number
  reason: string
  problems: string[]
  row_data?: ParsedMappingImportRow
  saveError?: string | null
}

interface TagOption {
  id: number
  name: string
}

interface SubtagOption {
  id: number
  tag_id: number
  name: string
  type: string
  tag_name: string | null
}

interface PartnerOption {
  id: number
  shared_account?: {
    name?: string | null
    description?: string | null
  } | null
}

function parseRowTipo(label: string): 'receita' | 'despesa' {
  const t = label.trim().toLowerCase()
  if (t.startsWith('rec')) return 'receita'
  return 'despesa'
}

function partnerNameFromId(partners: PartnerOption[], sharingId: number): string {
  if (!sharingId) return ''
  const p = partners.find((x) => x.id === sharingId)
  if (!p?.shared_account) return ''
  return (p.shared_account.name || p.shared_account.description || '').trim()
}

function sharingIdFromPartnerName(partners: PartnerOption[], name: string): number {
  const n = name.trim().toLowerCase()
  if (!n) return 0
  const found = partners.find((p) => {
    const acc = p.shared_account
    if (!acc) return false
    return (
      (acc.name?.trim().toLowerCase() === n) ||
      (acc.description?.trim().toLowerCase() === n)
    )
  })
  return found?.id ?? 0
}

function tagIdFromName(tags: TagOption[], name: string): number {
  const n = name.trim().toLowerCase()
  if (!n) return 0
  return tags.find((t) => t.name.trim().toLowerCase() === n)?.id ?? 0
}

function criterionPreview(row: ParsedMappingImportRow): string {
  const c = row.criterion?.trim()
  if (!c) return '—'
  if (c.length > 48) return `${c.slice(0, 45)}…`
  return c
}

export default function MappingImportCorrectionsTable({
  corrections,
  rowsByIndex,
  tags,
  subtags,
  partners,
  onPatchRow,
}: {
  corrections: MappingImportCorrectionRow[]
  rowsByIndex: Map<number, ParsedMappingImportRow>
  tags: TagOption[]
  subtags: SubtagOption[]
  partners: PartnerOption[]
  onPatchRow: (rowIndex: number, patch: Partial<ParsedMappingImportRow>) => void
}) {
  const sorted = useMemo(
    () => [...corrections].sort((a, b) => a.row - b.row),
    [corrections],
  )

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Ajuste tag, subtag ou compartilhamento quando a planilha referencia cadastro inexistente nesta conta.
        Preenchimentos válidos entram na importação; incompletos ficam de fora e aparecem no resumo final.
      </p>
      <ListPageTable
        leadingMode="index-only"
        minWidth={1100}
        framed
        colsRest={
          <>
            <ListTableSpacerCol />
            <col style={{ width: 72, minWidth: 64 }} />
            <col style={{ width: '18%', minWidth: 140 }} />
            <col style={{ width: 64, minWidth: 56 }} />
            <col style={{ width: '14%', minWidth: 120 }} />
            <col style={{ width: '14%', minWidth: 120 }} />
            <col style={{ width: '16%', minWidth: 140 }} />
            <col style={{ width: '22%', minWidth: 180 }} />
          </>
        }
        head={
          <tr>
            <ListTableIndexHeader />
            <ListTableSpacerHeader />
            <th className={listPageTableThCls}>Match</th>
            <th className={listPageTableThCls}>Critério</th>
            <th className={listPageTableThCls}>Tipo</th>
            <th className={listPageTableThCls}>Tag</th>
            <th className={listPageTableThCls}>Subtag</th>
            <th className={listPageTableThCls}>Compart.</th>
            <th className={listPageTableThCls}>Motivo</th>
          </tr>
        }
      >
        {sorted.map((item) => {
          const row = item.row_data ?? rowsByIndex.get(item.row)
          if (!row) return null
          const tipo = parseRowTipo(row.subtag_type)
          const tagId = tagIdFromName(tags, row.tag_name)
          const sharingId = sharingIdFromPartnerName(partners, row.partner_name)
          const subtagOptions = subtags.filter(
            (s) => s.tag_id === tagId && s.type === tipo,
          )
          const needsSubtag = item.problems.includes('subtag')
          const needsSharing = item.problems.includes('sharing')

          return (
            <tr key={`corr-${item.row}`} className={listPageTableRowHoverCls}>
              <ListTableIndexCell index={item.row} />
              <td className="list-page-table-spacer-col" aria-hidden />
              <td className={`${listPageTableTdCls} text-center`}>{row.match || '—'}</td>
              <td className={listPageTableTdCls} title={row.criterion}>
                {criterionPreview(row)}
              </td>
              <td className={`${listPageTableTdCls} text-center capitalize`}>{tipo}</td>
              <td className={listPageTableTdCls}>
                {needsSubtag ? (
                  <select
                    className={`${cadastroFilterFieldCls} ring-1 ring-amber-400/80`}
                    value={tagId}
                    onChange={(e) => {
                      const id = Number(e.target.value)
                      const tag = tags.find((t) => t.id === id)
                      onPatchRow(item.row, {
                        tag_name: tag?.name ?? '',
                        subtag_name: '',
                      })
                    }}
                  >
                    <option value={0}>Selecione…</option>
                    {[...tags]
                      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  <span className="text-gray-500 dark:text-gray-400">{row.tag_name || '—'}</span>
                )}
              </td>
              <td className={listPageTableTdCls}>
                {needsSubtag ? (
                  <select
                    className={`${cadastroFilterFieldCls} ring-1 ring-amber-400/80`}
                    value={
                      subtags.find(
                        (s) =>
                          s.name.trim().toLowerCase() === row.subtag_name.trim().toLowerCase() &&
                          s.tag_id === tagId &&
                          s.type === tipo,
                      )?.id ?? 0
                    }
                    disabled={!tagId}
                    onChange={(e) => {
                      const id = Number(e.target.value)
                      const st = subtags.find((s) => s.id === id)
                      onPatchRow(item.row, {
                        subtag_name: st?.name ?? '',
                        tag_name: st?.tag_name ?? row.tag_name,
                      })
                    }}
                  >
                    <option value={0}>Selecione…</option>
                    {subtagOptions
                      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  <span className="text-gray-500 dark:text-gray-400">{row.subtag_name || '—'}</span>
                )}
              </td>
              <td className={listPageTableTdCls}>
                {needsSharing ? (
                  <select
                    className={`${cadastroFilterFieldCls} ring-1 ring-amber-400/80`}
                    value={sharingId}
                    onChange={(e) => {
                      const id = Number(e.target.value)
                      onPatchRow(item.row, {
                        partner_name: partnerNameFromId(partners, id),
                      })
                    }}
                  >
                    <option value={0}>Nenhum (limpar parceiro)</option>
                    {[...partners]
                      .sort((a, b) =>
                        sharingPartnerLabel(a).localeCompare(sharingPartnerLabel(b), 'pt-BR'),
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {sharingPartnerLabel(p)}
                        </option>
                      ))}
                  </select>
                ) : (
                  <span className="text-gray-500 dark:text-gray-400">{row.partner_name || '—'}</span>
                )}
              </td>
              <td className={`${listPageTableTdCls} text-xs text-amber-800 dark:text-amber-200`}>
                {item.saveError || item.reason || '—'}
              </td>
            </tr>
          )
        })}
      </ListPageTable>
    </div>
  )
}
