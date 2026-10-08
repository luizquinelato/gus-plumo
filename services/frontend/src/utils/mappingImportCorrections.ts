import type { MappingImportCorrectionRow } from '../components/MappingImportCorrectionsTable'
import type { ParsedMappingImportRow } from './parseMappingExportWorkbook'

export interface MappingImportLookup {
  tags: Array<{ id: number; name: string }>
  subtags: Array<{ id: number; tag_id: number; name: string; type: string; tag_name: string | null }>
  partners: Array<{
    id: number
    shared_account?: { name?: string | null; description?: string | null } | null
  }>
}

export type ManualRowProblem = 'subtag' | 'sharing'

export type ManualMappingRowEntry = {
  problems: ManualRowProblem[]
  initialReason: string
  draft: ParsedMappingImportRow
  saved: ParsedMappingImportRow | null
  saveError: string | null
}

const SUBTAG_ISSUE =
  /subtag não encontrada|subtag é obrigatória|tag não encontrada/i
const SHARING_ISSUE =
  /compartilhamento não|conta parceira não encontrada|compartilhamento não configurado/i

export function parseMappingRowTipo(label: string): 'receita' | 'despesa' {
  const t = label.trim().toLowerCase()
  if (t.startsWith('rec')) return 'receita'
  return 'despesa'
}

export function tagIdFromName(lookup: MappingImportLookup, name: string): number {
  const n = name.trim().toLowerCase()
  if (!n) return 0
  return lookup.tags.find((t) => t.name.trim().toLowerCase() === n)?.id ?? 0
}

export function subtagResolved(lookup: MappingImportLookup, row: ParsedMappingImportRow): boolean {
  const name = row.subtag_name.trim()
  if (!name) return false
  const tipo = parseMappingRowTipo(row.subtag_type)
  const tagLower = row.tag_name.trim().toLowerCase()
  return lookup.subtags.some((s) => {
    if (s.type !== tipo) return false
    if (s.name.trim().toLowerCase() !== name.toLowerCase()) return false
    if (!tagLower) return true
    const stTag = (s.tag_name ?? '').trim().toLowerCase()
    if (stTag === tagLower) return true
    const tag = lookup.tags.find((t) => t.id === s.tag_id)
    return tag?.name.trim().toLowerCase() === tagLower
  })
}

export function sharingResolved(lookup: MappingImportLookup, row: ParsedMappingImportRow): boolean {
  const partner = row.partner_name.trim()
  if (!partner) return true
  const n = partner.toLowerCase()
  return lookup.partners.some((p) => {
    const acc = p.shared_account
    if (!acc) return false
    return (
      (acc.name?.trim().toLowerCase() === n) ||
      (acc.description?.trim().toLowerCase() === n)
    )
  })
}

/** Valida rascunho antes de gravar na planilha de importação. */
export function validateManualRowSave(
  entry: ManualMappingRowEntry,
  lookup: MappingImportLookup | null,
): string | null {
  if (!lookup) return 'Aguarde o carregamento de tags e compartilhamentos.'
  const row = entry.draft
  const needsSubtag = entry.problems.includes('subtag')
  const needsSharing = entry.problems.includes('sharing')

  const tagId = tagIdFromName(lookup, row.tag_name)
  const hasSubtagName = Boolean(row.subtag_name.trim())
  const subtagOk = hasSubtagName && subtagResolved(lookup, row)

  if (needsSubtag) {
    if (!tagId && !hasSubtagName) {
      return 'Informe tag e subtag.'
    }
    if (tagId && !hasSubtagName) {
      return 'Tag selecionada sem subtag — selecione a subtag.'
    }
    if (hasSubtagName && !subtagOk) {
      return 'Subtag ainda não encontrada no cadastro desta conta.'
    }
  }

  if (needsSharing && row.partner_name.trim() && !sharingResolved(lookup, row)) {
    return 'Compartilhamento / conta parceira não encontrado (escolha um parceiro válido ou Nenhum).'
  }

  if (needsSubtag && !subtagOk) {
    return 'Informe tag e subtag válidas.'
  }

  return null
}

export function deriveInitialManualCorrections(
  issues: Array<{ row: number; reason: string }>,
  parsedRows: ParsedMappingImportRow[],
  fromApi: MappingImportCorrectionRow[] | undefined,
): MappingImportCorrectionRow[] {
  if (fromApi?.length) return fromApi

  const byRow = new Map<number, MappingImportCorrectionRow>()
  for (const issue of issues) {
    const problems: ManualRowProblem[] = []
    if (SUBTAG_ISSUE.test(issue.reason)) problems.push('subtag')
    if (SHARING_ISSUE.test(issue.reason)) problems.push('sharing')
    if (!problems.length) continue

    const row = parsedRows.find((p) => p.row_index === issue.row)
    if (!row) continue

    const prev = byRow.get(issue.row)
    if (prev) {
      for (const p of problems) {
        if (!prev.problems.includes(p)) prev.problems.push(p)
      }
      if (!prev.reason.includes(issue.reason)) {
        prev.reason = `${prev.reason}; ${issue.reason}`
      }
    } else {
      byRow.set(issue.row, {
        row: issue.row,
        reason: issue.reason,
        problems: [...problems],
        row_data: row,
      })
    }
  }
  return [...byRow.values()].sort((a, b) => a.row - b.row)
}

export function manualEntriesToTabRows(
  manualEntries: Record<number, ManualMappingRowEntry>,
): MappingImportCorrectionRow[] {
  return Object.entries(manualEntries)
    .map(([row, entry]) => ({
      row: Number(row),
      reason:
        entry.saveError ??
        (entry.saved && !entry.saveError ? '' : entry.initialReason),
      problems: entry.problems,
      row_data: entry.draft,
      saveError: entry.saveError,
    }))
    .sort((a, b) => a.row - b.row)
}

export function mergeManualEntriesFromPreview(
  prev: Record<number, ManualMappingRowEntry>,
  issues: Array<{ row: number; reason: string }>,
  parsedRows: ParsedMappingImportRow[],
  fromApi: MappingImportCorrectionRow[] | undefined,
): Record<number, ManualMappingRowEntry> {
  const initial = deriveInitialManualCorrections(issues, parsedRows, fromApi)
  const next = { ...prev }
  for (const c of initial) {
    if (next[c.row]) continue
    const row = parsedRows.find((p) => p.row_index === c.row) ?? c.row_data
    if (!row) continue
    const problems = c.problems.filter(
      (p): p is ManualRowProblem => p === 'subtag' || p === 'sharing',
    )
    next[c.row] = {
      problems,
      initialReason: c.reason,
      draft: { ...row },
      saved: null,
      saveError: null,
    }
  }
  return next
}

export function collectUnsavedManualRows(
  manualEntries: Record<number, ManualMappingRowEntry>,
  lookup: MappingImportLookup | null,
): Array<{ row: number; reason: string }> {
  const out: Array<{ row: number; reason: string }> = []
  for (const [rowKey, entry] of Object.entries(manualEntries)) {
    const row = Number(rowKey)
    const validation = validateManualRowSave(entry, lookup)
    if (validation) {
      out.push({ row, reason: `Correção manual não salva: ${validation}` })
      continue
    }
    if (!entry.saved) {
      out.push({
        row,
        reason: 'Correção manual não salva: preencha e aguarde o salvamento automático.',
      })
    }
  }
  return out.sort((a, b) => a.row - b.row)
}
