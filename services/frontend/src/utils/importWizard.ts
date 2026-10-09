/**
 * Fila, classificação e DE-PARA do wizard único de importação.
 * Cada tipo continua no endpoint que já existe; aqui só encaminhamos o arquivo
 * e reescrevemos tag, subtag e compartilhamento ausentes antes do preview.
 */
import * as XLSX from 'xlsx'
import type { MappingImportLookup } from './mappingImportCorrections'
import { parseMappingRowTipo, sharingResolved, subtagResolved, tagIdFromName } from './mappingImportCorrections'
import { detectFileType, fileExtension, isSupportedImportFileName } from './fileTypeDetector'
import { parseMappingExportWorkbook, type ParsedMappingImportRow } from './parseMappingExportWorkbook'
import { parseExtratoExportWorkbook, type ParsedExtratoWorkbook, type ParsedImportRow } from './parseExtratoExportWorkbook'
import { parseFaturaExportWorkbook, type ParsedFaturaRow, type ParsedFaturaWorkbook, FATURA_SHEET_NAMES } from './parseFaturaExportWorkbook'
import {
  parseCartoesWorkbook,
  parseCompartilhamentosWorkbook,
  parseContasWorkbook,
  parseTagsSubtagsWorkbook,
  parseTemplatesWorkbook,
} from './parseCadastroImportWorkbook'

export type WizardKind =
  | 'extrato_bruto'
  | 'fatura_bruta'
  | 'beneficio_csv'
  | 'holerite'
  | 'informe'
  | 'extrato_export'
  | 'fatura_export'
  | 'mapeamentos'
  | 'tags'
  | 'templates'
  | 'contas'
  | 'compartilhamentos'
  | 'cartoes'
  | 'blocked'

export const KIND_LABEL: Record<WizardKind, string> = {
  extrato_bruto: 'Extrato do banco',
  fatura_bruta: 'Fatura',
  beneficio_csv: 'Benefício',
  holerite: 'Holerite',
  informe: 'Informe',
  extrato_export: 'Extrato',
  fatura_export: 'Faturas',
  mapeamentos: 'Mapeamentos',
  tags: 'Tag/Subtag',
  templates: 'Templates',
  contas: 'Contas',
  compartilhamentos: 'Compartilhamentos',
  cartoes: 'Cartões',
  blocked: 'Não reconhecido',
}

export const KIND_ORDER: WizardKind[] = [
  'contas',
  'tags',
  'compartilhamentos',
  'cartoes',
  'mapeamentos',
  'templates',
  'extrato_export',
  'fatura_export',
  'extrato_bruto',
  'fatura_bruta',
  'beneficio_csv',
  'holerite',
  'informe',
  'blocked',
]

const KIND_RANK = new Map(KIND_ORDER.map((kind, index) => [kind, index]))

export function sortWizardFiles<T extends { kind: WizardKind }>(items: T[]): T[] {
  return [...items].sort((a, b) => (KIND_RANK.get(a.kind) ?? 99) - (KIND_RANK.get(b.kind) ?? 99))
}

const EXCEL_KINDS = new Set<WizardKind>([
  'extrato_export',
  'fatura_export',
  'mapeamentos',
  'tags',
  'templates',
  'contas',
  'compartilhamentos',
  'cartoes',
])

const REF_KINDS = new Set<WizardKind>(['extrato_export', 'fatura_export', 'mapeamentos', 'templates', 'cartoes'])

export function isExcelKind(kind: WizardKind): boolean {
  return EXCEL_KINDS.has(kind)
}

export function kindUsesReferences(kind: WizardKind): boolean {
  return REF_KINDS.has(kind)
}

export function isRawKind(kind: WizardKind): boolean {
  return (
    kind === 'extrato_bruto' ||
    kind === 'fatura_bruta' ||
    kind === 'beneficio_csv' ||
    kind === 'holerite' ||
    kind === 'informe'
  )
}

export type WizardParsed =
  | { kind: 'mapeamentos'; rows: ParsedMappingImportRow[] }
  | { kind: 'extrato_export'; data: ParsedExtratoWorkbook }
  | { kind: 'fatura_export'; data: ParsedFaturaWorkbook }
  | { kind: 'tags'; data: Awaited<ReturnType<typeof parseTagsSubtagsWorkbook>> }
  | { kind: 'templates'; data: Awaited<ReturnType<typeof parseTemplatesWorkbook>> }
  | { kind: 'contas'; data: Awaited<ReturnType<typeof parseContasWorkbook>> }
  | { kind: 'compartilhamentos'; data: Awaited<ReturnType<typeof parseCompartilhamentosWorkbook>> }
  | { kind: 'cartoes'; data: Awaited<ReturnType<typeof parseCartoesWorkbook>> }

export interface WizardFile {
  id: string
  file: File
  kind: WizardKind
  error?: string
  parsed?: WizardParsed
  /** Planilha como lida, antes do DE-PARA. */
  parsedOriginal?: WizardParsed
  year?: string
  month?: string
  pdfPassword?: string
  needsPassword?: boolean
  creditCardId?: number
  payrollPreview?: string
  issuer?: string
  issuerLabel?: string
  cardLast4?: string
}

export type AdjustmentKind = 'tag' | 'subtag' | 'sharing'

export interface AdjustmentOccurrence {
  fileId: string
  fileName: string
  count: number
}

export interface AdjustmentRow {
  key: string
  kind: AdjustmentKind
  tagName: string
  subtagName: string
  subtagType: string
  partnerName: string
  occurrences: AdjustmentOccurrence[]
  total: number
  /** Tag ou compartilhamento escolhido. Na classificação, a tag fica em replacementTagId. */
  replacementId: number | null
  replacementTagId: number | null
  replacementSubtagId: number | null
}

function norm(value: string): string {
  return value.trim().toLowerCase()
}

function subtagKey(tag: string, subtag: string, type: string): string {
  const typed = type.trim() ? parseMappingRowTipo(type) : ''
  return `${norm(tag)}|${norm(subtag)}|${typed}`
}

const EXTRATO_SHEET_NAMES = ['Extratos Bancários', 'Extratos Bancarios', 'Extratos', 'Benefícios', 'Beneficios']

function sheetHeaders(sheet: XLSX.WorkSheet): string[] {
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' }) as string[][]
  return (rows[0] || []).map((cell) => String(cell).trim().toLowerCase())
}

function headersHave(headers: string[], columns: string[]): boolean {
  return columns.every((column) => headers.includes(column))
}

async function kindsFromWorkbookSheets(file: File): Promise<WizardKind[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const names = new Set(wb.SheetNames)
  if (names.has('Mapeamentos')) return ['mapeamentos']
  if (names.has('Tags') || names.has('Subtags')) return ['tags']
  if (names.has('Templates') || names.has('Itens')) return ['templates']
  if (names.has('Compartilhamentos')) return ['compartilhamentos']
  if (names.has('Cartões') || names.has('Cartoes') || names.has('Grupos')) return ['cartoes']
  if (names.has('Contas')) return ['contas']

  let extrato = EXTRATO_SHEET_NAMES.some((name) => names.has(name))
  let fatura = FATURA_SHEET_NAMES.some((name) => names.has(name))
  if (!extrato || !fatura) {
    for (const name of wb.SheetNames) {
      const headers = sheetHeaders(wb.Sheets[name])
      if (
        !extrato &&
        (headersHave(headers, ['data e hora', 'descrição', 'valor']) ||
          headersHave(headers, ['movimentação', 'meio de pagamento', 'valor']))
      ) {
        extrato = true
      }
      if (!fatura && headersHave(headers, ['descrição limpa', 'titular', 'valor'])) {
        fatura = true
      }
    }
  }
  const kinds: WizardKind[] = []
  if (extrato) kinds.push('extrato_export')
  if (fatura) kinds.push('fatura_export')
  return kinds
}

export async function parseForKind(kind: WizardKind, file: File): Promise<WizardParsed> {
  switch (kind) {
    case 'mapeamentos':
      return { kind, rows: await parseMappingExportWorkbook(file) }
    case 'extrato_export':
      return { kind, data: await parseExtratoExportWorkbook(file) }
    case 'fatura_export':
      return { kind, data: await parseFaturaExportWorkbook(file) }
    case 'tags':
      return { kind, data: await parseTagsSubtagsWorkbook(file) }
    case 'templates':
      return { kind, data: await parseTemplatesWorkbook(file) }
    case 'contas':
      return { kind, data: await parseContasWorkbook(file) }
    case 'compartilhamentos':
      return { kind, data: await parseCompartilhamentosWorkbook(file) }
    case 'cartoes':
      return { kind, data: await parseCartoesWorkbook(file) }
    default:
      throw new Error('Este arquivo não tem pré-visualização em planilha.')
  }
}

export async function classifySpreadsheet(file: File): Promise<{ kind: WizardKind; error?: string }> {
  const kinds = await classifySpreadsheetKinds(file)
  return kinds[0] ?? { kind: 'blocked', error: 'Planilha não reconhecida.' }
}

/** Um Excel do relatório pode trazer extrato e faturas; cada um vira um passo da fila. */
export async function classifySpreadsheetKinds(file: File): Promise<Array<{ kind: WizardKind; error?: string }>> {
  const ext = fileExtension(file.name)
  if (!isSupportedImportFileName(file.name)) {
    return [{ kind: 'blocked', error: 'Use PDF, XLSX, XLS ou CSV.' }]
  }
  if (ext === '.csv') {
    try {
      const detected = await detectFileType(file)
      if (detected.detectedType === 'beneficio_csv') return [{ kind: 'beneficio_csv' }]
      return [{ kind: 'blocked', error: detected.detectionError || 'CSV não reconhecido.' }]
    } catch (error) {
      return [{ kind: 'blocked', error: error instanceof Error ? error.message : 'CSV inválido.' }]
    }
  }
  if (ext === '.xlsx' || ext === '.xls') {
    try {
      const fromSheets = await kindsFromWorkbookSheets(file)
      if (fromSheets.length) return fromSheets.map((kind) => ({ kind }))
      const detected = await detectFileType(file)
      if (detected.detectedType === 'extrato_bruto') return [{ kind: 'extrato_bruto' }]
      return [{ kind: 'blocked', error: detected.detectionError || 'Planilha não reconhecida.' }]
    } catch (error) {
      return [{ kind: 'blocked', error: error instanceof Error ? error.message : 'Não foi possível ler a planilha.' }]
    }
  }
  return [{ kind: 'blocked', error: 'PDF aguardando identificação.' }]
}

function bump(map: Map<string, AdjustmentOccurrence>, fileId: string, fileName: string) {
  const current = map.get(fileId)
  if (current) current.count += 1
  else map.set(fileId, { fileId, fileName, count: 1 })
}

interface PendingBucket {
  kind: AdjustmentKind
  tagName: string
  subtagName: string
  subtagType: string
  partnerName: string
  files: Map<string, AdjustmentOccurrence>
}

function bucketOf(map: Map<string, PendingBucket>, key: string, seed: Omit<PendingBucket, 'files'>): PendingBucket {
  const found = map.get(key)
  if (found) return found
  const created: PendingBucket = { ...seed, files: new Map() }
  map.set(key, created)
  return created
}

function tagKnown(name: string, lookup: MappingImportLookup, batchTags: Set<string>): boolean {
  const n = norm(name)
  if (!n) return true
  if (batchTags.has(n)) return true
  return lookup.tags.some((tag) => norm(tag.name) === n)
}

function subtagKnown(
  tag: string,
  subtag: string,
  type: string,
  lookup: MappingImportLookup,
  batchSubtags: Set<string>,
): boolean {
  const name = subtag.trim()
  if (!name) return true
  if (type.trim()) {
    if (batchSubtags.has(subtagKey(tag, subtag, type))) return true
    return subtagResolved(lookup, fakeMapping(tag, subtag, type))
  }
  const prefix = `${norm(tag)}|${norm(subtag)}|`
  for (const key of batchSubtags) {
    if (key.startsWith(prefix)) return true
  }
  return (
    subtagResolved(lookup, fakeMapping(tag, subtag, 'despesa')) ||
    subtagResolved(lookup, fakeMapping(tag, subtag, 'receita'))
  )
}

function partnerKnown(name: string, lookup: MappingImportLookup, batchPartners: Set<string>): boolean {
  const n = name.trim()
  if (!n) return true
  if (batchPartners.has(norm(n))) return true
  return sharingResolved(lookup, fakeMapping('', '', '', n))
}

function fakeMapping(tag: string, subtag: string, type: string, partner = ''): ParsedMappingImportRow {
  return {
    row_index: 0,
    mapping_id: null,
    match: '',
    criterion: '',
    priority: null,
    mapped_description: '',
    subtag_type: type,
    tag_name: tag,
    subtag_name: subtag,
    partner_name: partner,
    contribution_pct: null,
    is_sensitive: '',
  }
}

function noteTag(
  buckets: Map<string, PendingBucket>,
  file: WizardFile,
  tag: string,
  lookup: MappingImportLookup,
  batchTags: Set<string>,
) {
  const name = tag.trim()
  if (!name || tagKnown(name, lookup, batchTags)) return
  const key = `tag:${norm(name)}`
  const bucket = bucketOf(buckets, key, {
    kind: 'tag',
    tagName: name,
    subtagName: '',
    subtagType: '',
    partnerName: '',
  })
  bump(bucket.files, file.id, file.file.name)
}

function noteSubtag(
  buckets: Map<string, PendingBucket>,
  file: WizardFile,
  tag: string,
  subtag: string,
  type: string,
  lookup: MappingImportLookup,
  batchSubtags: Set<string>,
) {
  const name = subtag.trim()
  if (!name || subtagKnown(tag, name, type, lookup, batchSubtags)) return
  const typed = type.trim() ? parseMappingRowTipo(type) : ''
  const key = `subtag:${subtagKey(tag, name, typed)}`
  const bucket = bucketOf(buckets, key, {
    kind: 'subtag',
    tagName: tag.trim(),
    subtagName: name,
    subtagType: typed,
    partnerName: '',
  })
  bump(bucket.files, file.id, file.file.name)
}

function amountTipo(amount: number): string {
  return amount >= 0 ? 'receita' : 'despesa'
}

/** Linha sem tipo é a mesma classificação quando já existe uma linha com tipo. */
function mergeBareSubtagBuckets(buckets: Map<string, PendingBucket>) {
  const byPair = new Map<string, PendingBucket[]>()
  for (const bucket of buckets.values()) {
    if (bucket.kind !== 'subtag') continue
    const pair = `${norm(bucket.tagName)}|${norm(bucket.subtagName)}`
    const list = byPair.get(pair) ?? []
    list.push(bucket)
    byPair.set(pair, list)
  }
  for (const list of byPair.values()) {
    const bare = list.filter((bucket) => !bucket.subtagType)
    const typed = list.filter((bucket) => bucket.subtagType)
    if (!bare.length || typed.length !== 1) continue
    const target = typed[0]
    for (const extra of bare) {
      for (const [fileId, occurrence] of extra.files) {
        const current = target.files.get(fileId)
        if (current) current.count += occurrence.count
        else target.files.set(fileId, { ...occurrence })
      }
      buckets.delete(`subtag:${subtagKey(extra.tagName, extra.subtagName, '')}`)
    }
  }
}

function noteClassOrTag(
  buckets: Map<string, PendingBucket>,
  file: WizardFile,
  tag: string,
  subtag: string,
  type: string,
  lookup: MappingImportLookup,
  batch: { tags: Set<string>; subtags: Set<string> },
) {
  if (subtag.trim()) {
    noteSubtag(buckets, file, tag, subtag, type, lookup, batch.subtags)
    return
  }
  noteTag(buckets, file, tag, lookup, batch.tags)
}

function notePartner(
  buckets: Map<string, PendingBucket>,
  file: WizardFile,
  partner: string,
  lookup: MappingImportLookup,
  batchPartners: Set<string>,
) {
  const name = partner.trim()
  if (!name || partnerKnown(name, lookup, batchPartners)) return
  const key = `share:${norm(name)}`
  const bucket = bucketOf(buckets, key, {
    kind: 'sharing',
    tagName: '',
    subtagName: '',
    subtagType: '',
    partnerName: name,
  })
  bump(bucket.files, file.id, file.file.name)
}

function batchCatalog(files: WizardFile[]) {
  const tags = new Set<string>()
  const subtags = new Set<string>()
  const partners = new Set<string>()
  for (const file of files) {
    const parsed = file.parsedOriginal
    if (!parsed) continue
    if (parsed.kind === 'tags') {
      for (const row of parsed.data.tags) {
        if (row.name.trim()) tags.add(norm(row.name))
      }
      for (const row of parsed.data.subtags) {
        if (row.name.trim()) subtags.add(subtagKey(row.tag_name, row.name, row.type))
      }
    }
    if (parsed.kind === 'compartilhamentos') {
      for (const row of parsed.data.rows) {
        if (row.partner_name.trim()) partners.add(norm(row.partner_name))
      }
    }
  }
  return { tags, subtags, partners }
}

/** Junta o cadastro da conta com a planilha de tags/subtags da mesma leva. */
export function lookupWithBatchTags(files: WizardFile[], lookup: MappingImportLookup): MappingImportLookup {
  const tags = [...lookup.tags]
  const subtags = [...lookup.subtags]
  const tagIdByName = new Map(tags.map((tag) => [norm(tag.name), tag.id]))
  let nextId = -1
  for (const file of files) {
    const parsed = file.parsedOriginal
    if (!parsed || parsed.kind !== 'tags') continue
    for (const row of parsed.data.tags) {
      const name = row.name.trim()
      if (!name || tagIdByName.has(norm(name))) continue
      const id = nextId
      nextId -= 1
      tags.push({ id, name })
      tagIdByName.set(norm(name), id)
    }
    for (const row of parsed.data.subtags) {
      const name = row.name.trim()
      const tagName = row.tag_name.trim()
      if (!name || !tagName) continue
      const tagId = tagIdByName.get(norm(tagName))
      if (tagId == null) continue
      const type = row.type.trim() ? parseMappingRowTipo(row.type) : 'despesa'
      const exists = subtags.some(
        (subtag) => subtag.tag_id === tagId && norm(subtag.name) === norm(name) && subtag.type === type,
      )
      if (exists) continue
      subtags.push({
        id: nextId,
        tag_id: tagId,
        name,
        type,
        tag_name: tags.find((tag) => tag.id === tagId)?.name || tagName,
      })
      nextId -= 1
    }
  }
  const partners = [...lookup.partners]
  const partnerNames = new Set(
    partners.map((partner) => norm(partner.shared_account?.name || partner.shared_account?.description || '')),
  )
  for (const file of files) {
    const parsed = file.parsedOriginal
    if (!parsed || parsed.kind !== 'compartilhamentos') continue
    for (const row of parsed.data.rows) {
      const name = row.partner_name.trim()
      if (!name || partnerNames.has(norm(name))) continue
      partners.push({ id: nextId, shared_account: { name } })
      partnerNames.add(norm(name))
      nextId -= 1
    }
  }
  return { tags, subtags, partners }
}

export function filesCarryClassification(files: WizardFile[]): boolean {
  for (const file of files) {
    const parsed = file.parsedOriginal
    if (!parsed || !kindUsesReferences(file.kind)) continue
    if (parsed.kind === 'mapeamentos' && parsed.rows.some((row) => row.tag_name.trim() || row.subtag_name.trim())) {
      return true
    }
    if (parsed.kind === 'extrato_export') {
      const rows = [...parsed.data.bank_rows, ...parsed.data.benefit_rows]
      if (rows.some((row) => (row.tag || '').trim() || (row.subtag || '').trim())) return true
    }
    if (parsed.kind === 'fatura_export' && parsed.data.rows.some((row) => (row.tag || '').trim() || (row.subtag || '').trim())) {
      return true
    }
    if (parsed.kind === 'templates' && parsed.data.items.some((row) => row.tag_name.trim() || row.subtag_name.trim())) {
      return true
    }
  }
  return false
}

export function collectAdjustments(
  files: WizardFile[],
  lookup: MappingImportLookup,
  options?: { skipClass?: boolean },
): AdjustmentRow[] {
  const batch = batchCatalog(files)
  const buckets = new Map<string, PendingBucket>()

  for (const file of files) {
    const parsed = file.parsedOriginal
    if (!parsed || !kindUsesReferences(file.kind)) continue
    if (parsed.kind === 'mapeamentos') {
      for (const row of parsed.rows) {
        if (!options?.skipClass) {
          noteClassOrTag(buckets, file, row.tag_name, row.subtag_name, row.subtag_type, lookup, batch)
        }
        notePartner(buckets, file, row.partner_name, lookup, batch.partners)
      }
    } else if (parsed.kind === 'extrato_export' || parsed.kind === 'fatura_export') {
      const rows =
        parsed.kind === 'extrato_export'
          ? [...parsed.data.bank_rows, ...parsed.data.benefit_rows]
          : parsed.data.rows
      for (const row of rows) {
        if (!options?.skipClass) {
          noteClassOrTag(buckets, file, row.tag || '', row.subtag || '', amountTipo(row.amount), lookup, batch)
        }
        notePartner(buckets, file, row.partner_name || '', lookup, batch.partners)
      }
    } else if (parsed.kind === 'templates') {
      for (const row of parsed.data.items) {
        if (!options?.skipClass) {
          noteClassOrTag(buckets, file, row.tag_name, row.subtag_name, row.subtag_type, lookup, batch)
        }
        notePartner(buckets, file, row.partner_name || '', lookup, batch.partners)
      }
    } else if (parsed.kind === 'cartoes') {
      for (const row of parsed.data.cards) {
        notePartner(buckets, file, row.partner_name || '', lookup, batch.partners)
      }
    }
  }

  mergeBareSubtagBuckets(buckets)

  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const occurrences = [...bucket.files.values()]
      return {
        key,
        kind: bucket.kind,
        tagName: bucket.tagName,
        subtagName: bucket.subtagName,
        subtagType: bucket.subtagType,
        partnerName: bucket.partnerName,
        occurrences,
        total: occurrences.reduce((sum, item) => sum + item.count, 0),
        replacementId: null,
        replacementTagId:
          bucket.kind === 'subtag' ? tagIdFromName(lookup, bucket.tagName) || null : null,
        replacementSubtagId: null,
      }
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.tagName.localeCompare(b.tagName) || a.subtagName.localeCompare(b.subtagName))
}

interface RewriteMaps {
  tags: Map<string, string>
  subtags: Map<string, { tag: string; subtag: string; type: string }>
  partners: Map<string, string>
}

function rewriteMaps(rows: AdjustmentRow[], lookup: MappingImportLookup): RewriteMaps {
  const tags = new Map<string, string>()
  const subtags = new Map<string, { tag: string; subtag: string; type: string }>()
  const partners = new Map<string, string>()
  const typedPairs = new Map<string, number>()
  for (const row of rows) {
    if (row.kind !== 'subtag' || !row.subtagType) continue
    const pair = `${norm(row.tagName)}|${norm(row.subtagName)}`
    typedPairs.set(pair, (typedPairs.get(pair) ?? 0) + 1)
  }
  const rememberSubtag = (row: AdjustmentRow, replacement: { tag: string; subtag: string; type: string }) => {
    subtags.set(subtagKey(row.tagName, row.subtagName, row.subtagType), replacement)
    const pair = `${norm(row.tagName)}|${norm(row.subtagName)}`
    if (!row.subtagType || typedPairs.get(pair) === 1) {
      subtags.set(subtagKey(row.tagName, row.subtagName, ''), replacement)
    }
  }
  for (const row of rows) {
    if (row.kind === 'tag') {
      if (row.replacementId == null) {
        tags.set(norm(row.tagName), '')
        continue
      }
      const tag = lookup.tags.find((item) => item.id === row.replacementId)
      if (tag) tags.set(norm(row.tagName), tag.name)
    } else if (row.kind === 'subtag') {
      if (row.replacementTagId == null || row.replacementSubtagId == null) {
        rememberSubtag(row, { tag: '', subtag: '', type: '' })
        continue
      }
      const subtag = lookup.subtags.find((item) => item.id === row.replacementSubtagId)
      if (!subtag || subtag.tag_id !== row.replacementTagId) {
        rememberSubtag(row, { tag: '', subtag: '', type: '' })
        continue
      }
      const tagName =
        lookup.tags.find((tag) => tag.id === subtag.tag_id)?.name ||
        subtag.tag_name?.trim() ||
        row.tagName
      rememberSubtag(row, { tag: tagName, subtag: subtag.name, type: subtag.type })
    } else if (row.kind === 'sharing') {
      if (row.replacementId == null) continue
      const partner = lookup.partners.find((item) => item.id === row.replacementId)
      const name = partner?.shared_account?.name?.trim() || partner?.shared_account?.description?.trim()
      if (name) partners.set(norm(row.partnerName), name)
    }
  }
  return { tags, subtags, partners }
}

function rewriteClass(
  tag: string,
  subtag: string,
  type: string,
  partner: string,
  maps: RewriteMaps,
): { tag: string; subtag: string; type: string; partner: string } {
  let nextTag = tag
  let nextSubtag = subtag
  let nextType = type
  const sub = subtag.trim() ? maps.subtags.get(subtagKey(tag, subtag, type)) : undefined
  if (sub) {
    nextTag = sub.tag
    nextSubtag = sub.subtag
    nextType = sub.type
  } else if (tag.trim() && maps.tags.has(norm(tag))) {
    nextTag = maps.tags.get(norm(tag)) ?? tag
  }
  let nextPartner = partner
  if (partner.trim() && maps.partners.has(norm(partner))) {
    nextPartner = maps.partners.get(norm(partner)) || partner
  }
  return { tag: nextTag, subtag: nextSubtag, type: nextType, partner: nextPartner }
}

function rewriteExtratoRow(row: ParsedImportRow, maps: RewriteMaps): ParsedImportRow {
  const next = rewriteClass(row.tag || '', row.subtag || '', amountTipo(row.amount), row.partner_name || '', maps)
  return {
    ...row,
    tag: next.tag || undefined,
    subtag: next.subtag || undefined,
    partner_name: next.partner || undefined,
  }
}

function rewriteFaturaRow(row: ParsedFaturaRow, maps: RewriteMaps): ParsedFaturaRow {
  const next = rewriteClass(row.tag || '', row.subtag || '', amountTipo(row.amount), row.partner_name || '', maps)
  return {
    ...row,
    tag: next.tag || undefined,
    subtag: next.subtag || undefined,
    partner_name: next.partner || undefined,
  }
}

export function stripClassification(parsed: WizardParsed): WizardParsed {
  if (parsed.kind === 'mapeamentos') {
    return {
      kind: 'mapeamentos',
      rows: parsed.rows.map((row) => ({ ...row, tag_name: '', subtag_name: '' })),
    }
  }
  if (parsed.kind === 'extrato_export') {
    const clear = (row: ParsedImportRow): ParsedImportRow => ({ ...row, tag: undefined, subtag: undefined })
    return {
      kind: 'extrato_export',
      data: {
        ...parsed.data,
        bank_rows: parsed.data.bank_rows.map(clear),
        benefit_rows: parsed.data.benefit_rows.map(clear),
      },
    }
  }
  if (parsed.kind === 'fatura_export') {
    return {
      kind: 'fatura_export',
      data: {
        rows: parsed.data.rows.map((row) => ({ ...row, tag: undefined, subtag: undefined })),
      },
    }
  }
  if (parsed.kind === 'templates') {
    return {
      kind: 'templates',
      data: {
        ...parsed.data,
        items: parsed.data.items.map((row) => ({ ...row, tag_name: '', subtag_name: '', subtag_type: '' })),
      },
    }
  }
  return parsed
}

export function applyAdjustments(
  parsed: WizardParsed,
  rows: AdjustmentRow[],
  lookup: MappingImportLookup,
): WizardParsed {
  const maps = rewriteMaps(rows, lookup)
  if (parsed.kind === 'mapeamentos') {
    return {
      kind: 'mapeamentos',
      rows: parsed.rows.map((row) => {
        const next = rewriteClass(row.tag_name, row.subtag_name, row.subtag_type, row.partner_name, maps)
        return {
          ...row,
          tag_name: next.tag,
          subtag_name: next.subtag,
          subtag_type: next.type || row.subtag_type,
          partner_name: next.partner,
        }
      }),
    }
  }
  if (parsed.kind === 'extrato_export') {
    return {
      kind: 'extrato_export',
      data: {
        ...parsed.data,
        bank_rows: parsed.data.bank_rows.map((row) => rewriteExtratoRow(row, maps)),
        benefit_rows: parsed.data.benefit_rows.map((row) => rewriteExtratoRow(row, maps)),
      },
    }
  }
  if (parsed.kind === 'fatura_export') {
    return {
      kind: 'fatura_export',
      data: { rows: parsed.data.rows.map((row) => rewriteFaturaRow(row, maps)) },
    }
  }
  if (parsed.kind === 'templates') {
    return {
      kind: 'templates',
      data: {
        ...parsed.data,
        items: parsed.data.items.map((row) => {
          const next = rewriteClass(row.tag_name, row.subtag_name, row.subtag_type, row.partner_name || '', maps)
          return {
            ...row,
            tag_name: next.tag,
            subtag_name: next.subtag,
            subtag_type: next.type,
            partner_name: next.partner || null,
          }
        }),
      },
    }
  }
  if (parsed.kind === 'cartoes') {
    return {
      kind: 'cartoes',
      data: {
        ...parsed.data,
        cards: parsed.data.cards.map((row) => {
          const next = rewriteClass('', '', '', row.partner_name || '', maps)
          return { ...row, partner_name: next.partner || null }
        }),
      },
    }
  }
  return parsed
}

export function importBatchFromFiles(files: WizardFile[]) {
  const subtags: { tag_name: string; name: string; type: string }[] = []
  const accounts: string[] = []
  const sharings: string[] = []
  const cards: { name: string; number: string; type: string }[] = []
  for (const file of files) {
    const parsed = file.parsed ?? file.parsedOriginal
    if (!parsed) continue
    if (parsed.kind === 'tags') {
      for (const row of parsed.data.subtags) {
        if (row.name.trim()) subtags.push({ tag_name: row.tag_name, name: row.name, type: row.type })
      }
    } else if (parsed.kind === 'contas') {
      for (const row of parsed.data.rows) {
        if (row.name.trim()) accounts.push(row.name.trim())
      }
    } else if (parsed.kind === 'compartilhamentos') {
      for (const row of parsed.data.rows) {
        if (row.partner_name.trim()) sharings.push(row.partner_name.trim())
      }
    } else if (parsed.kind === 'cartoes') {
      for (const row of parsed.data.cards) {
        if (row.name.trim() || row.number.trim()) {
          cards.push({ name: row.name.trim(), number: row.number.trim(), type: row.type.trim() })
        }
      }
    }
  }
  return { subtags, accounts, sharings, cards }
}

export function previewBody(parsed: WizardParsed, files: WizardFile[] = []): Record<string, unknown> {
  const batch = importBatchFromFiles(files)
  switch (parsed.kind) {
    case 'mapeamentos':
      return { rows: parsed.rows, batch }
    case 'extrato_export':
      return { bank_rows: parsed.data.bank_rows, benefit_rows: parsed.data.benefit_rows, batch }
    case 'fatura_export':
      return { rows: parsed.data.rows, batch }
    case 'tags':
      return parsed.data
    case 'templates':
      return { ...parsed.data, batch }
    case 'contas':
      return parsed.data
    case 'compartilhamentos':
      return { ...parsed.data, batch }
    case 'cartoes':
      return { ...parsed.data, batch }
  }
}

export function previewUrl(kind: WizardKind): string | null {
  switch (kind) {
    case 'mapeamentos':
      return '/api/expenses/mappings/visual-import/preview'
    case 'extrato_export':
      return '/api/expenses/visual-import/preview'
    case 'fatura_export':
      return '/api/expenses/invoices/visual-import/preview'
    case 'tags':
      return '/api/cadastro-import/tags-subtags/preview'
    case 'templates':
      return '/api/cadastro-import/templates/preview'
    case 'contas':
      return '/api/cadastro-import/contas/preview'
    case 'compartilhamentos':
      return '/api/cadastro-import/compartilhamentos/preview'
    case 'cartoes':
      return '/api/cadastro-import/cartoes/preview'
    default:
      return null
  }
}

export function applyUrl(kind: WizardKind): string | null {
  switch (kind) {
    case 'mapeamentos':
      return '/api/expenses/mappings/visual-import'
    case 'extrato_export':
      return '/api/expenses/visual-import'
    case 'fatura_export':
      return '/api/expenses/invoices/visual-import'
    case 'tags':
      return '/api/cadastro-import/tags-subtags'
    case 'templates':
      return '/api/cadastro-import/templates'
    case 'contas':
      return '/api/cadastro-import/contas'
    case 'compartilhamentos':
      return '/api/cadastro-import/compartilhamentos'
    case 'cartoes':
      return '/api/cadastro-import/cartoes'
    default:
      return null
  }
}

export interface ExcelApplyOptions {
  confirmClosed: boolean
  autoRunRemap: boolean
  overwriteSharing: boolean
}

export function applyBody(parsed: WizardParsed, options: ExcelApplyOptions): Record<string, unknown> {
  const confirm = { confirm_closed_closure_impact: options.confirmClosed }
  if (parsed.kind === 'mapeamentos') {
    return {
      rows: parsed.rows,
      auto_run_remap: options.autoRunRemap,
      overwrite_sharing: options.overwriteSharing,
      ...confirm,
    }
  }
  if (parsed.kind === 'extrato_export') {
    return {
      bank_rows: parsed.data.bank_rows,
      benefit_rows: parsed.data.benefit_rows,
      ...confirm,
    }
  }
  if (parsed.kind === 'fatura_export') {
    return { rows: parsed.data.rows, ...confirm }
  }
  return { ...previewBody(parsed), ...confirm }
}

export function mergeParsed(kind: WizardKind, files: WizardFile[]): WizardParsed | null {
  const parts = files
    .map((file) => file.parsed)
    .filter((parsed): parsed is WizardParsed => parsed?.kind === kind)
  if (!parts.length) return null
  if (kind === 'mapeamentos') {
    const rows = parts.flatMap((part) => (part.kind === 'mapeamentos' ? part.rows : []))
    return { kind: 'mapeamentos', rows }
  }
  if (kind === 'extrato_export') {
    return {
      kind: 'extrato_export',
      data: {
        bank_rows: parts.flatMap((part) => (part.kind === 'extrato_export' ? part.data.bank_rows : [])),
        benefit_rows: parts.flatMap((part) => (part.kind === 'extrato_export' ? part.data.benefit_rows : [])),
        skipped_sheets: parts.flatMap((part) => (part.kind === 'extrato_export' ? part.data.skipped_sheets : [])),
      },
    }
  }
  if (kind === 'fatura_export') {
    return {
      kind: 'fatura_export',
      data: { rows: parts.flatMap((part) => (part.kind === 'fatura_export' ? part.data.rows : [])) },
    }
  }
  if (kind === 'tags') {
    return {
      kind: 'tags',
      data: {
        tags: parts.flatMap((part) => (part.kind === 'tags' ? part.data.tags : [])),
        subtags: parts.flatMap((part) => (part.kind === 'tags' ? part.data.subtags : [])),
      },
    }
  }
  if (kind === 'templates') {
    return {
      kind: 'templates',
      data: {
        templates: parts.flatMap((part) => (part.kind === 'templates' ? part.data.templates : [])),
        items: parts.flatMap((part) => (part.kind === 'templates' ? part.data.items : [])),
      },
    }
  }
  if (kind === 'contas') {
    return {
      kind: 'contas',
      data: { rows: parts.flatMap((part) => (part.kind === 'contas' ? part.data.rows : [])) },
    }
  }
  if (kind === 'compartilhamentos') {
    return {
      kind: 'compartilhamentos',
      data: { rows: parts.flatMap((part) => (part.kind === 'compartilhamentos' ? part.data.rows : [])) },
    }
  }
  if (kind === 'cartoes') {
    return {
      kind: 'cartoes',
      data: {
        groups: parts.flatMap((part) => (part.kind === 'cartoes' ? part.data.groups : [])),
        cards: parts.flatMap((part) => (part.kind === 'cartoes' ? part.data.cards : [])),
      },
    }
  }
  return null
}

export function countParsedRows(parsed: WizardParsed | undefined): number {
  if (!parsed) return 0
  switch (parsed.kind) {
    case 'mapeamentos':
      return parsed.rows.length
    case 'extrato_export':
      return parsed.data.bank_rows.length + parsed.data.benefit_rows.length
    case 'fatura_export':
      return parsed.data.rows.length
    case 'tags':
      return parsed.data.tags.length + parsed.data.subtags.length
    case 'templates':
      return parsed.data.templates.length + parsed.data.items.length
    case 'contas':
      return parsed.data.rows.length
    case 'compartilhamentos':
      return parsed.data.rows.length
    case 'cartoes':
      return parsed.data.groups.length + parsed.data.cards.length
  }
}

export function adjustmentComplete(row: AdjustmentRow): boolean {
  if (row.kind === 'subtag') return row.replacementTagId != null && row.replacementSubtagId != null
  return row.replacementId != null
}

export function adjustmentLabel(row: AdjustmentRow): string {
  if (row.kind === 'tag') return `Tag “${row.tagName}”`
  if (row.kind === 'sharing') return `Compartilhamento “${row.partnerName}”`
  const typeLabel = row.subtagType === 'receita' ? 'receita' : row.subtagType === 'despesa' ? 'despesa' : 'sem tipo'
  const tag = row.tagName ? `“${row.tagName}”` : 'sem tag'
  return `Tag ${tag} / Subtag “${row.subtagName}” · ${typeLabel}`
}
