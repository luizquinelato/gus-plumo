import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConfirm } from '../hooks/useConfirm'
import { useAuth } from '../contexts/AuthContext'
import { Link, useLocation } from 'react-router-dom'
import axios from 'axios'
import { ArrowUp, Check, ChevronLeft, ChevronsRight, FileSpreadsheet, FileText, FileUp, Trash2, Upload } from 'lucide-react'
import FloatingFooterBar from '../components/FloatingFooterBar'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageShell,
  CadastroListPageTabs,
  CadastroListPrimaryButton,
  CadastroListSecondaryButton,
  cadastroFilterFieldCls,
  listPageTableRowHoverCls,
  listPageTableTdCls,
  listPageTableThCls,
} from '../components/CadastroListPageLayout'
import { CadastroFormSection } from '../components/CadastroFormLayout'
import { ListPageTable } from '../components/ListPageTable'
import {
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCol,
  ListTableSpacerHeader,
} from '../components/ListTableSelectColumns'
import CadastroImportPreview, {
  type CadastroImportPreviewData,
  type CadastroImportPreviewRow,
} from '../components/CadastroImportPreview'
import ExtratoVisualImportPreview, {
  type VisualImportPreviewData,
  type VisualImportPreviewRow,
} from '../components/ExtratoVisualImportPreview'
import MappingVisualImportPreview, { type MappingImportPreviewData } from '../components/MappingVisualImportPreview'
import RawImportPreview, {
  summarizeRawKind,
  type RawFilePreview,
  type RawImportPreviewData,
  type RawKindPreviewData,
} from '../components/RawImportPreview'
import RawImportAdjustments, {
  conflictDecisionComplete,
  effectiveDecision,
  exportUpdateKey,
  pendingRawFixes,
  rawConflictKey,
  resolutionForDecision,
  type ConflictDecision,
  type RawFixGroup,
} from '../components/RawImportAdjustments'
import { KindBadge, KindIcon } from '../components/ImportFileKindBadge'
import ClosureEditImpactDialog from '../components/ClosureEditImpactDialog'
import ConflictReviewModal from '../components/ConflictReviewModal'
import { matchBenefitCardIdFromFileName, type BenefitCardForMatch } from '../utils/benefitCardFileMatch'
import { isPdfFileName, isSupportedImportFileName } from '../utils/fileTypeDetector'
import type { MappingImportLookup } from '../utils/mappingImportCorrections'
import { parseAxiosClosureConflict } from '../utils/closureEditImpact'
import type { ClosureEditImpact } from '../types/closureEditImpact'
import type { ConflictResolution, ImportConflict } from '../types/importConflict'
import {
  KIND_LABEL,
  KIND_ORDER,
  sortWizardFiles,
  adjustmentComplete,
  adjustmentLabel,
  applyAdjustments,
  applyBody,
  applyUrl,
  classifySpreadsheetKinds,
  collectAdjustments,
  filesCarryClassification,
  lookupWithBatchTags,
  stripClassification,
  countParsedRows,
  isExcelKind,
  isRawKind,
  kindUsesReferences,
  mergeParsed,
  parseForKind,
  previewBody,
  previewUrl,
  type AdjustmentRow,
  type WizardFile,
  type WizardKind,
  type WizardParsed,
} from '../utils/importWizard'

type StepId = 'arquivos' | 'ajustes' | 'preview' | 'executar' | 'resultado'

const ALL_STEPS: StepId[] = ['arquivos', 'ajustes', 'preview', 'executar', 'resultado']

const STEP_LABEL: Record<StepId, string> = {
  arquivos: 'Arquivos',
  ajustes: 'Ajustes',
  preview: 'Preview',
  executar: 'Executar',
  resultado: 'Resultado',
}

const MONTHS = [
  { value: '01', label: 'Janeiro' },
  { value: '02', label: 'Fevereiro' },
  { value: '03', label: 'Março' },
  { value: '04', label: 'Abril' },
  { value: '05', label: 'Maio' },
  { value: '06', label: 'Junho' },
  { value: '07', label: 'Julho' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Setembro' },
  { value: '10', label: 'Outubro' },
  { value: '11', label: 'Novembro' },
  { value: '12', label: 'Dezembro' },
]

interface PreviewSlot {
  loading: boolean
  error?: string
  progress?: string
  data?: CadastroImportPreviewData | MappingImportPreviewData | VisualImportPreviewData | RawKindPreviewData
}

type PreviewTabId = WizardKind | 'beneficios'

interface PreviewTabEntry {
  id: PreviewTabId
  label: string
  /** `source` separa as linhas de banco e de benefício da planilha de extrato exportada. */
  parts: Array<{ kind: WizardKind; slot: PreviewSlot | undefined; source?: 'bank' | 'benefit' }>
}

/** Separa o preview do Excel exportado entre extrato (banco) e benefícios. */
function visualSlotBySource(slot: PreviewSlot | undefined, benefit: boolean): PreviewSlot | undefined {
  if (!slot || slot.loading || slot.error || !slot.data) return slot
  const data = slot.data as VisualImportPreviewData
  const keep = (source: string) => (source === 'benefit') === benefit
  const creates = data.creates.filter((row) => keep(row.source))
  const updates = data.updates.filter((row) => keep(row.source))
  const issues = data.issues.filter((issue) => keep(issue.source))
  return {
    ...slot,
    data: {
      ...data,
      creates,
      updates,
      issues,
      summary: {
        ...data.summary,
        creates: creates.length,
        updates: updates.length,
        issues: issues.length,
        unchanged: benefit ? 0 : data.summary.unchanged,
      },
    },
  }
}

function exportSheetRows(files: WizardFile[]): { bank: number; benefit: number } {
  let bank = 0
  let benefit = 0
  for (const file of files) {
    const parsed = file.parsed ?? file.parsedOriginal
    if (parsed?.kind !== 'extrato_export') continue
    bank += parsed.data.bank_rows.length
    benefit += parsed.data.benefit_rows.length
  }
  return { bank, benefit }
}

function buildPreviewTabs(
  kinds: WizardKind[],
  previews: Partial<Record<WizardKind, PreviewSlot>>,
  files: WizardFile[],
): PreviewTabEntry[] {
  const sheet = exportSheetRows(files)
  const benefitParts: PreviewTabEntry['parts'] = []
  if (kinds.includes('extrato_export') && sheet.benefit > 0) {
    benefitParts.push({
      kind: 'extrato_export',
      slot: visualSlotBySource(previews.extrato_export, true),
      source: 'benefit',
    })
  }
  if (kinds.includes('beneficio_csv')) benefitParts.push({ kind: 'beneficio_csv', slot: previews.beneficio_csv })
  const benefitTab: PreviewTabEntry | null = benefitParts.length
    ? { id: 'beneficios', label: 'Benefícios', parts: benefitParts }
    : null

  const tabs: PreviewTabEntry[] = []
  for (const kind of kinds) {
    if (kind === 'extrato_export') {
      if (sheet.bank > 0 || sheet.benefit === 0) {
        tabs.push({
          id: kind,
          label: KIND_LABEL[kind],
          parts: [
            sheet.benefit > 0
              ? { kind, slot: visualSlotBySource(previews[kind], false), source: 'bank' }
              : { kind, slot: previews[kind] },
          ],
        })
      }
      if (benefitTab && !tabs.includes(benefitTab)) tabs.push(benefitTab)
      continue
    }
    if (kind === 'beneficio_csv') {
      if (benefitTab && !tabs.includes(benefitTab)) tabs.push(benefitTab)
      continue
    }
    tabs.push({ id: kind, label: KIND_LABEL[kind], parts: [{ kind, slot: previews[kind] }] })
  }
  return tabs
}

function previewPartLabel(kind: WizardKind): string {
  if (kind === 'extrato_export') return 'Planilha exportada'
  if (kind === 'beneficio_csv') return 'Arquivo do cartão de benefícios'
  return KIND_LABEL[kind]
}

/** Resultado do processamento (sem gravar) de um arquivo bruto, reaproveitado na gravação. */
interface RawProcessed {
  key: string
  rows: Array<Record<string, unknown>>
  ignoredRows: Array<Record<string, unknown>>
  preview: RawFilePreview
}

function hasPreviewKind(kind: WizardKind): boolean {
  return isExcelKind(kind) || isRawKind(kind)
}

function rawProcessKey(file: WizardFile): string {
  return [file.id, file.kind, file.year ?? '', file.month ?? '', file.creditCardId ?? '', file.pdfPassword ?? ''].join('|')
}

interface WizardFileResult {
  fileId: string
  fileName: string
  kind: WizardKind
  success: boolean
  message: string
  issues: Array<{ row?: number; reason: string }>
  conflicts: ImportConflict[]
  unmapped: number
}

interface ProgressState {
  jobId: string
  fileIndex: number
  fileCount: number
  fileName: string
  processed: number
  total: number
  fraction: number
}

type RawLoadStatus = Omit<ProgressState, 'jobId'> & { detail?: string }

type AdjustTabId = 'classificacao' | 'compartilhamento' | 'extrato_bruto' | 'beneficio_csv' | 'fatura_bruta'

const ADJUST_TAB_LABEL: Record<AdjustTabId, string> = {
  classificacao: 'Tag/Subtag',
  compartilhamento: 'Compartilhamento',
  extrato_bruto: 'Extrato',
  beneficio_csv: 'Benefícios',
  fatura_bruta: 'Cartão',
}

const RAW_ADJUST_TABS = ['extrato_bruto', 'beneficio_csv', 'fatura_bruta'] as const

function isRawAdjustTab(tab: AdjustTabId): tab is (typeof RAW_ADJUST_TABS)[number] {
  return (RAW_ADJUST_TABS as readonly string[]).includes(tab)
}

interface AdjustTabInfo {
  id: AdjustTabId
  count: number
  pending: boolean
}

function buildAdjustTabs(
  adjustments: AdjustmentRow[],
  omit: boolean,
  groups: RawFixGroup[],
  decisions: Record<string, ConflictDecision> = {},
): AdjustTabInfo[] {
  const tabs: AdjustTabInfo[] = []
  const classRows = adjustments.filter((row) => row.kind !== 'sharing')
  const sharingRows = adjustments.filter((row) => row.kind === 'sharing')
  if (classRows.length || omit) {
    tabs.push({
      id: 'classificacao',
      count: classRows.length,
      pending: classRows.some((row) => !adjustmentComplete(row)),
    })
  }
  if (sharingRows.length) {
    tabs.push({
      id: 'compartilhamento',
      count: sharingRows.length,
      pending: sharingRows.some((row) => !adjustmentComplete(row)),
    })
  }
  for (const id of RAW_ADJUST_TABS) {
    const kindGroups = groups.filter((group) => group.kind === id)
    if (!kindGroups.length) continue
    tabs.push({
      id,
      count: kindGroups.reduce((sum, group) => sum + group.conflicts.length + group.updates.length, 0),
      pending: pendingRawFixes(kindGroups, decisions) > 0,
    })
  }
  return tabs
}

function firstAdjustTab(adjustments: AdjustmentRow[], omit: boolean, groups: RawFixGroup[]): AdjustTabId {
  return buildAdjustTabs(adjustments, omit, groups)[0]?.id ?? 'classificacao'
}

function isExportKind(kind: WizardKind): kind is 'extrato_export' | 'fatura_export' {
  return kind === 'extrato_export' || kind === 'fatura_export'
}

/** Alterações de registros existentes que a planilha exportada traria (sem gravar). */
async function exportFileUpdates(file: WizardFile, files: WizardFile[]): Promise<VisualImportPreviewRow[]> {
  const url = previewUrl(file.kind)
  if (!url || !file.parsedOriginal) return []
  try {
    const response = await axios.post<VisualImportPreviewData>(url, previewBody(file.parsedOriginal, files))
    return response.data.updates.filter((row) => (row.changes?.length ?? 0) > 0)
  } catch {
    // O erro reaparece na pré-visualização, que chama o mesmo endpoint.
    return []
  }
}

function exportFixGroups(file: WizardFile, updates: VisualImportPreviewRow[]): RawFixGroup[] {
  const group = (kind: string, rows: VisualImportPreviewRow[]): RawFixGroup => ({
    fileId: file.id,
    fileName: file.file.name,
    kind,
    warnings: [],
    conflicts: [],
    updates: rows,
  })
  if (file.kind === 'fatura_export') return updates.length ? [group('fatura_bruta', updates)] : []
  const bank = updates.filter((row) => row.source === 'bank')
  const benefit = updates.filter((row) => row.source === 'benefit')
  return [
    ...(bank.length ? [group('extrato_bruto', bank)] : []),
    ...(benefit.length ? [group('beneficio_csv', benefit)] : []),
  ]
}

/** Chaves das alterações da planilha exportada que ficaram em "Manter" (padrão). */
function keptExportKeys(groups: RawFixGroup[], decisions: Record<string, ConflictDecision>): Set<string> {
  const keys = new Set<string>()
  for (const group of groups) {
    for (const update of group.updates) {
      const key = exportUpdateKey(group.fileId, update.source, update.row)
      if (effectiveDecision(decisions[key]).choice === 'atual') keys.add(key)
    }
  }
  return keys
}

function withKeptRows(fileId: string, parsed: WizardParsed, keep: Set<string>): WizardParsed {
  if (!keep.size) return parsed
  const mark = <T extends { row_index: number }>(rows: T[], source: string): T[] =>
    rows.map((row) => (keep.has(exportUpdateKey(fileId, source, row.row_index)) ? { ...row, keep_existing: true } : row))
  if (parsed.kind === 'extrato_export') {
    return {
      kind: 'extrato_export',
      data: {
        ...parsed.data,
        bank_rows: mark(parsed.data.bank_rows, 'bank'),
        benefit_rows: mark(parsed.data.benefit_rows, 'benefit'),
      },
    }
  }
  if (parsed.kind === 'fatura_export') {
    return { kind: 'fatura_export', data: { ...parsed.data, rows: mark(parsed.data.rows, 'invoice') } }
  }
  return parsed
}

function exportDecisionNotes(
  kind: WizardKind,
  source: 'bank' | 'benefit' | undefined,
  files: WizardFile[],
  groups: RawFixGroup[],
  decisions: Record<string, ConflictDecision>,
): string[] {
  if (!isExportKind(kind)) return []
  const kindIds = new Set(files.filter((file) => file.kind === kind).map((file) => file.id))
  let keep = 0
  let replace = 0
  for (const group of groups) {
    if (!kindIds.has(group.fileId)) continue
    for (const update of group.updates) {
      if (source && update.source !== source) continue
      const decision = effectiveDecision(decisions[exportUpdateKey(group.fileId, update.source, update.row)])
      if (decision.choice === 'novo') replace += 1
      else keep += 1
    }
  }
  if (!keep && !replace) return []
  return [
    `Alterações decididas nos Ajustes: ${keep} ficam como estão e ${replace} recebem a versão da planilha (só estas aparecem abaixo).`,
  ]
}

function errorText(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string' && detail.trim()) return detail
    if (Array.isArray(detail)) {
      return detail
        .map((item) => (typeof item === 'string' ? item : item?.msg || ''))
        .filter(Boolean)
        .join(' ')
    }
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function importBatchPercent(fileIndex: number, fileCount: number, fraction: number): number {
  if (fileCount <= 0) return 0
  const within = Math.min(Math.max(fraction, 0), 1)
  return Math.min(100, ((fileIndex + within) / fileCount) * 100)
}

async function postImportWithProgress<T>(
  url: string,
  body: FormData | Record<string, unknown>,
  jobId: string,
  onProgress: (update: { processed: number; total: number; fraction: number }) => void,
) {
  const isForm = body instanceof FormData
  if (isForm) body.append('progress_job_id', jobId)
  const payload = isForm ? body : { ...body, progress_job_id: jobId }
  let stopped = false
  const poll = async () => {
    if (stopped) return
    try {
      const { data } = await axios.get<{ processed: number; total: number; fraction?: number }>(
        `/api/import/progress/${jobId}`,
      )
      if (stopped) return
      const processed = Number(data.processed) || 0
      const total = Number(data.total) || 0
      const fraction = Number.isFinite(data.fraction) ? Number(data.fraction) : total > 0 ? processed / total : 0
      onProgress({ processed, total, fraction })
    } catch {
      // O job só existe enquanto o POST está processando.
    }
  }
  const timer = window.setInterval(() => {
    void poll()
  }, 200)
  void poll()
  try {
    return await axios.post<T>(
      url,
      payload,
      isForm ? { headers: { 'Content-Type': 'multipart/form-data' } } : undefined,
    )
  } finally {
    stopped = true
    window.clearInterval(timer)
  }
}

async function processRawFile(
  file: WizardFile,
  cache: Map<string, RawProcessed>,
  onProgress: (update: { processed: number; total: number; fraction: number }) => void,
): Promise<RawFilePreview> {
  const key = rawProcessKey(file)
  const cached = cache.get(file.id)
  if (cached && cached.key === key) return cached.preview
  const base = { fileId: file.id, fileName: file.file.name }
  const store = (
    rows: RawProcessed['rows'],
    ignoredRows: RawProcessed['ignoredRows'],
    preview: RawFilePreview,
  ): RawFilePreview => {
    cache.set(file.id, { key, rows, ignoredRows, preview })
    return preview
  }
  try {
    if (file.kind === 'consorcio') {
      const form = new FormData()
      form.append('files', file.file)
      form.append('passwords', file.pdfPassword ?? '')
      const response = await axios.post<{ results: ConsortiumClassifyResult[] }>('/api/consortiums/classify-pdfs', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const hit = response.data.results?.[0]
      if (!hit || hit.status !== 'ok') return { ...base, error: hit?.message || 'Não foi possível ler o PDF.' }
      return store([], [], {
        ...base,
        payroll: {
          action: hit.action === 'updated' ? 'updated' : 'created',
          summary: consortiumSummary(hit),
          lineCount: hit.installment_count ?? null,
        },
      })
    }
    if (file.kind === 'holerite' || file.kind === 'informe') {
      const form = new FormData()
      form.append('files', file.file)
      form.append('passwords', file.pdfPassword ?? '')
      const response = await axios.post<{ results: PayrollClassifyResult[] }>('/api/payroll/classify-pdfs', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const hit = response.data.results?.[0]
      if (!hit || hit.status !== 'ok') return { ...base, error: hit?.message || 'Não foi possível ler o PDF.' }
      return store([], [], {
        ...base,
        payroll: {
          action: hit.action === 'updated' ? 'updated' : 'created',
          summary: payrollSummary(hit),
          netAmount: optionalNumber(hit.net_amount),
          grossEarnings: optionalNumber(hit.gross_earnings),
          totalDeductions: optionalNumber(hit.total_deductions),
          lineCount: hit.line_count ?? null,
        },
      })
    }

    const form = new FormData()
    let url: string
    if (file.kind === 'extrato_bruto') {
      url = '/api/import/extrato/process'
      form.append('files', file.file)
      form.append('passwords', file.pdfPassword ?? '')
    } else if (file.kind === 'fatura_bruta') {
      url = '/api/import/cartao/process'
      form.append('files', file.file)
      form.append('years', file.year || '')
      form.append('months', file.month || '')
      form.append('passwords', file.pdfPassword ?? '')
    } else if (file.kind === 'beneficio_csv') {
      if (!file.creditCardId) return { ...base, error: 'Selecione um cartão de benefícios.' }
      url = '/api/benefit-card-statements/csv/process'
      form.append('credit_card_id', String(file.creditCardId))
      form.append('file', file.file)
    } else {
      return { ...base, error: 'Tipo de arquivo sem pré-visualização.' }
    }
    const response = await postImportWithProgress<{
      rows?: RawProcessed['rows']
      ignored_rows?: RawProcessed['ignoredRows']
      preview: RawImportPreviewData
    }>(url, form, crypto.randomUUID(), onProgress)
    const data = response.data
    return store(data.rows ?? [], data.ignored_rows ?? [], { ...base, preview: data.preview })
  } catch (error) {
    return { ...base, error: errorText(error, 'Erro ao processar o arquivo.') }
  }
}

function rawPreviewNotes(kind: WizardKind, files: WizardFile[]): string[] {
  const notes: string[] = []
  const has = (target: WizardKind) => files.some((file) => file.kind === target)
  if (has('mapeamentos')) {
    notes.push(
      'Esta leva traz mapeamentos. Eles são gravados antes e reaplicados na gravação, então a classificação final pode diferir desta prévia.',
    )
  }
  if (kind === 'fatura_bruta' && has('cartoes')) {
    notes.push(
      'Esta leva traz cartões. Eles são cadastrados antes da fatura, então linhas de cartão ainda não cadastrado podem entrar na gravação.',
    )
  }
  return notes
}

function pendingRawMessage(pending: number): string {
  return `Para continuar, escolha qual registro atualizar em ${pending} conflito(s) marcado(s) como Atualizar.`
}

function rawDecisionNotes(
  kind: WizardKind,
  files: WizardFile[],
  groups: RawFixGroup[],
  decisions: Record<string, ConflictDecision>,
): string[] {
  const kindIds = new Set(files.filter((file) => file.kind === kind).map((file) => file.id))
  let keep = 0
  let replace = 0
  for (const group of groups) {
    if (!kindIds.has(group.fileId)) continue
    for (const conflict of group.conflicts) {
      if (effectiveDecision(decisions[rawConflictKey(group.fileId, conflict)]).choice === 'novo') replace += 1
      else keep += 1
    }
  }
  if (!keep && !replace) return []
  return [
    `Conflitos decididos nos Ajustes: ${keep} mantêm a versão atual e ${replace} recebem a versão do arquivo (aplicado logo após a gravação).`,
  ]
}

/**
 * Aplica as decisões de conflito tomadas nos Ajustes (sem decisão explícita = manter o atual).
 * Conflitos que não apareceram nos Ajustes seguem para o modal.
 */
async function applyConflictDecisions(
  fileId: string,
  result: WizardFileResult,
  decisions: Record<string, ConflictDecision>,
  reviewedKeys: Set<string>,
): Promise<WizardFileResult> {
  if (!result.conflicts.length) return result
  const resolutions: ConflictResolution[] = []
  const remaining: ImportConflict[] = []
  let kept = 0
  for (const conflict of result.conflicts) {
    const key = rawConflictKey(fileId, conflict)
    if (!reviewedKeys.has(key) || !conflictDecisionComplete(conflict, decisions[key])) {
      remaining.push(conflict)
      continue
    }
    const resolution = resolutionForDecision(conflict, effectiveDecision(decisions[key]))
    if (resolution) resolutions.push(resolution)
    else kept += 1
  }
  if (resolutions.length) {
    try {
      await axios.post('/api/import/resolve-conflicts', { resolutions })
    } catch (error) {
      return {
        ...result,
        message: `${result.message} Não foi possível aplicar as decisões de conflito: ${errorText(error, 'erro desconhecido')}.`,
      }
    }
  }
  const parts: string[] = []
  if (resolutions.length) parts.push(`${resolutions.length} conflito(s) com a versão do arquivo`)
  if (kept) parts.push(`${kept} mantido(s) como estava`)
  return {
    ...result,
    conflicts: remaining,
    message: parts.length ? `${result.message} ${parts.join(', ')}.` : result.message,
  }
}

async function loadLookup(): Promise<MappingImportLookup> {
  const [tagsRes, subtagsRes, partnersRes] = await Promise.all([
    axios.get<MappingImportLookup['tags']>('/api/expenses/tags'),
    axios.get<MappingImportLookup['subtags']>('/api/expenses/subtags'),
    axios.get<MappingImportLookup['partners']>('/api/expense-sharing/'),
  ])
  return { tags: tagsRes.data, subtags: subtagsRes.data, partners: partnersRes.data }
}

function issuesFromPayload(data: unknown): Array<{ row?: number; reason: string }> {
  if (!data || typeof data !== 'object') return []
  const issues = (data as { issues?: unknown }).issues
  if (!Array.isArray(issues)) return []
  return issues.map((issue) => {
    const row = issue && typeof issue === 'object' ? (issue as { row?: unknown; reason?: unknown }) : {}
    return {
      row: typeof row.row === 'number' ? row.row : undefined,
      reason: typeof row.reason === 'string' ? row.reason : 'Pendência na gravação',
    }
  })
}

function cloneParsed(parsed: WizardParsed): WizardParsed {
  return structuredClone(parsed)
}

interface PayrollClassifyResult {
  filename: string
  status: string
  doc_type?: string | null
  message?: string | null
  employer_name?: string | null
  payer_name?: string | null
  beneficiary_name?: string | null
  calendar_year?: number | null
  payslip_kind?: string | null
  year?: number | null
  month?: number | null
  reference_label?: string | null
  action?: 'created' | 'updated' | null
  net_amount?: number | string | null
  gross_earnings?: number | string | null
  total_deductions?: number | string | null
  line_count?: number | null
}

function payslipKindLabel(kind?: string | null): string | null {
  if (kind === 'advance') return 'Adiantamento'
  if (kind === 'final') return 'Folha final'
  if (kind === 'regular') return 'Mensal'
  if (kind === 'profit_share') return 'Participação nos lucros'
  return null
}

function payrollSummary(hit: PayrollClassifyResult): string {
  if (hit.doc_type === 'income_report') {
    return [hit.payer_name, hit.calendar_year ? `Ano-calendário ${hit.calendar_year}` : null, hit.beneficiary_name]
      .filter(Boolean)
      .join(' · ')
  }
  const month = hit.month ? MONTHS[hit.month - 1]?.label : null
  const period = hit.year && month ? `${month} ${hit.year}` : hit.reference_label
  return [hit.employer_name, payslipKindLabel(hit.payslip_kind), period].filter(Boolean).join(' · ')
}

function optionalNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const PDF_PASSWORD_MESSAGES = new Set(['PDF protegido por senha', 'Senha do PDF incorreta'])

async function markPasswordProtected(items: WizardFile[]): Promise<void> {
  if (!items.length) return
  try {
    const form = new FormData()
    items.forEach((item) => form.append('files', item.file))
    const response = await axios.post<{ results: Array<{ filename: string; requires_password: boolean }> }>(
      '/api/import/pdf/check-passwords',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    const results = response.data.results || []
    items.forEach((item, index) => {
      if (results[index]?.requires_password) {
        item.needsPassword = true
        item.error =
          'PDF protegido: informe a senha aqui ou cadastre a "Senha padrão para PDFs" da conta em Contas.'
      }
    })
  } catch {
    // Sem a checagem, a identificação abaixo devolve o erro de senha.
  }
}

interface ConsortiumClassifyResult {
  filename: string
  status: string
  message?: string | null
  company_label?: string | null
  group_code?: string | null
  quota?: string | null
  installment_count?: number | null
  action?: 'created' | 'updated' | null
}

function consortiumSummary(hit: ConsortiumClassifyResult): string {
  return [hit.group_code ? `Grupo ${hit.group_code}` : null, hit.quota ? `Cota ${hit.quota}` : null]
    .filter(Boolean)
    .join(' · ')
}

/** Marca como consórcio os PDFs reconhecidos; devolve os que continuam sem classificação. */
async function identifyConsortiumPdfs(items: WizardFile[], all: WizardFile[]): Promise<WizardFile[]> {
  if (!items.length) return items
  let results: ConsortiumClassifyResult[] = []
  try {
    const form = new FormData()
    items.forEach((item) => form.append('files', item.file))
    items.forEach((item) => form.append('passwords', item.pdfPassword ?? ''))
    const response = await axios.post<{ results: ConsortiumClassifyResult[] }>('/api/consortiums/classify-pdfs', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    results = response.data.results || []
  } catch {
    return items
  }
  const rest: WizardFile[] = []
  items.forEach((item, index) => {
    const hit = results.find((row) => row.filename === item.file.name) || results[index]
    if (hit?.status !== 'ok') {
      rest.push(item)
      return
    }
    const target = all.find((row) => row.id === item.id) ?? item
    target.kind = 'consorcio'
    target.issuerLabel = hit.company_label ?? undefined
    target.error = undefined
    target.needsPassword = false
    target.payrollPreview = consortiumSummary(hit)
  })
  return rest
}

async function identifyPdfs(items: WizardFile[]): Promise<WizardFile[]> {
  const pdfs = items.filter((item) => isPdfFileName(item.file.name))
  if (!pdfs.length) return items
  let next = items.map((item) => ({ ...item }))
  const unlocked = next.filter((item) => isPdfFileName(item.file.name) && !(item.needsPassword && !item.pdfPassword))
  if (!unlocked.length) return next

  let classified: PayrollClassifyResult[] = []
  try {
    const form = new FormData()
    unlocked.forEach((item) => form.append('files', item.file))
    unlocked.forEach((item) => form.append('passwords', item.pdfPassword ?? ''))
    const response = await axios.post<{ results: typeof classified }>('/api/payroll/classify-pdfs', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    classified = response.data.results || []
  } catch {
    classified = []
  }

  const remaining: WizardFile[] = []
  unlocked.forEach((item, index) => {
    const hit = classified.find((row) => row.filename === item.file.name) || classified[index]
    const target = next.find((row) => row.id === item.id)
    if (!target) return
    if (hit?.status === 'ok' && (hit.doc_type === 'payslip' || hit.doc_type === 'income_report')) {
      target.kind = hit.doc_type === 'payslip' ? 'holerite' : 'informe'
      target.error = undefined
      target.needsPassword = false
      target.payrollPreview = payrollSummary(hit)
      return
    }
    if (hit?.message && PDF_PASSWORD_MESSAGES.has(hit.message)) target.needsPassword = true
    remaining.push(target)
  })

  const afterConsortium = await identifyConsortiumPdfs(remaining, next)
  remaining.length = 0
  remaining.push(...afterConsortium)

  if (!remaining.length) return next
  try {
    const form = new FormData()
    remaining.forEach((item) => form.append('files', item.file))
    remaining.forEach((item) => form.append('passwords', item.pdfPassword ?? ''))
    const response = await axios.post<{
      results: Array<{
        filename: string
        status: string
        issuer?: string | null
        issuer_label?: string | null
        card_last4?: string | null
        year?: string
        month?: string
        message?: string
      }>
    }>('/api/import/cartao/detect', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    const results = response.data.results || []
    remaining.forEach((item, index) => {
      const hit = results.find((row) => row.filename === item.file.name) || results[index]
      if (!hit || hit.status !== 'ok') {
        item.kind = 'blocked'
        item.error = hit?.message || 'PDF não reconhecido como fatura, holerite ou informe.'
        if (hit?.message && PDF_PASSWORD_MESSAGES.has(hit.message)) item.needsPassword = true
        return
      }
      item.kind = hit.issuer === 'itau_extrato' ? 'extrato_bruto' : 'fatura_bruta'
      item.error = undefined
      item.needsPassword = false
      item.issuer = hit.issuer ?? undefined
      item.issuerLabel = hit.issuer_label ?? undefined
      item.cardLast4 = hit.card_last4 ?? undefined
      if (hit.year) item.year = String(hit.year)
      if (hit.month) item.month = String(hit.month).padStart(2, '0')
    })
  } catch {
    remaining.forEach((item) => {
      item.kind = 'blocked'
      item.error = 'Não foi possível identificar o PDF.'
    })
  }
  return next
}

const UNSUPPORTED_FILE = 'Use PDF (fatura, holerite ou informe), Excel (.xlsx, .xls) ou CSV de benefício.'

async function prepareIncoming(files: File[], benefitCards: BenefitCardForMatch[]): Promise<WizardFile[]> {
  const drafted: WizardFile[] = []
  const pdfs: WizardFile[] = []
  for (const file of files) {
    if (isPdfFileName(file.name)) {
      const item: WizardFile = { id: crypto.randomUUID(), file, kind: 'blocked', error: 'PDF aguardando identificação.' }
      drafted.push(item)
      pdfs.push(item)
      continue
    }
    const classified = await classifySpreadsheetKinds(file)
    for (const entry of classified) {
      const next: WizardFile = { id: crypto.randomUUID(), file, kind: entry.kind, error: entry.error }
      if (entry.kind === 'beneficio_csv') {
        next.creditCardId = matchBenefitCardIdFromFileName(file.name, benefitCards)
      }
      if (isExcelKind(entry.kind)) {
        try {
          const parsed = await parseForKind(entry.kind, file)
          next.parsedOriginal = parsed
          next.parsed = cloneParsed(parsed)
        } catch (error) {
          next.kind = 'blocked'
          next.error = errorText(error, 'Arquivo inválido.')
        }
      }
      drafted.push(next)
    }
  }
  if (!pdfs.length) return drafted
  await markPasswordProtected(pdfs)
  return identifyPdfs(drafted)
}

function arquivosBlock(files: WizardFile[], detecting: boolean): string | null {
  if (detecting) return 'Identificando arquivos…'
  if (!files.length) return 'Adicione pelo menos um arquivo.'
  const blocked = files.find((file) => file.kind === 'blocked')
  if (blocked) return blocked.error || 'Remova os arquivos não reconhecidos para continuar.'
  if (files.some((file) => file.kind === 'fatura_bruta' && (!file.year || !file.month))) {
    return 'Preencha ano e mês de cada fatura.'
  }
  if (files.some((file) => file.kind === 'beneficio_csv' && !file.creditCardId)) {
    return 'Selecione o cartão de cada CSV de benefício.'
  }
  return null
}

function cachedAccountName(accountId?: number): string | null {
  if (!accountId) return null
  try {
    const cached = localStorage.getItem(`account_${accountId}`)
    return cached ? (JSON.parse(cached) as { name?: string }).name || null : null
  } catch {
    return null
  }
}

export default function ImportWizardPage() {
  const { showConfirm, ConfirmComponent } = useConfirm()
  const { user } = useAuth()
  const targetAccountName = useMemo(() => cachedAccountName(user?.account_id), [user?.account_id])
  const [step, setStep] = useState<StepId>('arquivos')
  const [files, setFiles] = useState<WizardFile[]>([])
  const [fileVersion, setFileVersion] = useState(0)
  const [adjustVersion, setAdjustVersion] = useState(-1)
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([])
  const [lookup, setLookup] = useState<MappingImportLookup | null>(null)
  const [classLookup, setClassLookup] = useState<MappingImportLookup | null>(null)
  const [omitClassification, setOmitClassification] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [benefitCards, setBenefitCards] = useState<BenefitCardForMatch[]>([])
  const [previews, setPreviews] = useState<Partial<Record<WizardKind, PreviewSlot>>>({})
  const [previewToken, setPreviewToken] = useState(0)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [results, setResults] = useState<WizardFileResult[]>([])
  const [autoRunRemap, setAutoRunRemap] = useState(true)
  const [overwriteSharing, setOverwriteSharing] = useState(true)
  const [closureHold, setClosureHold] = useState<{ index: number; impact: ClosureEditImpact } | null>(null)
  const [conflicts, setConflicts] = useState<ImportConflict[]>([])
  const [showConflicts, setShowConflicts] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [tagIconOverrides, setTagIconOverrides] = useState<Record<string, string>>({})
  const [rawStatus, setRawStatus] = useState<RawLoadStatus | null>(null)
  const [rawReadyVersion, setRawReadyVersion] = useState(-1)
  const [rawFixGroups, setRawFixGroups] = useState<RawFixGroup[]>([])
  const [conflictDecisions, setConflictDecisions] = useState<Record<string, ConflictDecision>>({})
  const [adjustTab, setAdjustTab] = useState<AdjustTabId>('classificacao')
  const rawRunRef = useRef(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const orderedFiles = useMemo(() => sortWizardFiles(files), [files])

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 11 }, (_, index) => String(currentYear + 1 - index))

  useEffect(() => {
    axios
      .get<Array<BenefitCardForMatch & { type?: string; active?: boolean }>>('/api/cartoes/')
      .then((response) => {
        setBenefitCards(
          response.data
            .filter((card) => card.type === 'beneficios' && card.active)
            .map((card) => ({ id: card.id, name: card.name, number: card.number })),
        )
      })
      .catch(() => setBenefitCards([]))
  }, [])

  useEffect(() => {
    if (!benefitCards.length) return
    setFiles((prev) => {
      let changed = false
      const next = prev.map((file) => {
        if (file.kind !== 'beneficio_csv' || file.creditCardId) return file
        const creditCardId = matchBenefitCardIdFromFileName(file.file.name, benefitCards)
        if (!creditCardId) return file
        changed = true
        return { ...file, creditCardId }
      })
      return changed ? next : prev
    })
  }, [benefitCards])

  const skippedSteps = useMemo(() => {
    const skipped = new Set<StepId>()
    const rawClean =
      rawReadyVersion === fileVersion
        ? rawFixGroups.length === 0
        : !files.some((file) => isRawKind(file.kind) || isExportKind(file.kind))
    if (adjustVersion === fileVersion && adjustments.length === 0 && !omitClassification && rawClean) {
      skipped.add('ajustes')
    }
    if (files.length > 0 && !files.some((file) => hasPreviewKind(file.kind))) skipped.add('preview')
    return skipped
  }, [adjustVersion, adjustments.length, fileVersion, files, omitClassification, rawReadyVersion, rawFixGroups.length])

  const flowSteps = useMemo(
    () => ALL_STEPS.filter((id) => !skippedSteps.has(id)),
    [skippedSteps],
  )

  const presentKinds = useMemo(
    () => KIND_ORDER.filter((kind) => kind !== 'blocked' && files.some((file) => file.kind === kind)),
    [files],
  )
  const previewKinds = useMemo(() => presentKinds.filter((kind) => hasPreviewKind(kind)), [presentKinds])
  const rawProcessedRef = useRef<Map<string, RawProcessed>>(new Map())
  const [previewTab, setPreviewTab] = useState<PreviewTabId | null>(null)
  const previewTabs = useMemo(
    () => buildPreviewTabs(previewKinds, previews, orderedFiles),
    [previewKinds, previews, orderedFiles],
  )
  const previewTabIds = previewTabs.map((tab) => tab.id).join('|')

  useEffect(() => {
    const ids = previewTabIds ? (previewTabIds.split('|') as PreviewTabId[]) : []
    setPreviewTab((current) => (current && ids.includes(current) ? current : ids[0] ?? null))
  }, [previewTabIds])

  const scrollToTop = useCallback(() => {
    setShowBackToTop(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const handleScroll = () => setShowBackToTop(container.scrollTop > 300)
    handleScroll()
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [step])

  useEffect(() => {
    if (step !== 'preview') return
    const kinds = previewKinds
    if (!kinds.length) return
    let cancel = false
    setPreviews(Object.fromEntries(kinds.map((kind) => [kind, { loading: true }])))
    void (async () => {
      for (const kind of kinds) {
        if (cancel) return
        if (isRawKind(kind)) {
          const kindFiles = orderedFiles.filter((file) => file.kind === kind)
          const processed: RawFilePreview[] = []
          for (const [index, file] of kindFiles.entries()) {
            if (cancel) return
            const onProgress = (update: { processed: number; total: number }) => {
              if (cancel) return
              const line = update.total > 0
                ? ` · linha ${update.processed.toLocaleString('pt-BR')} de ${update.total.toLocaleString('pt-BR')}`
                : ''
              setPreviews((prev) => ({
                ...prev,
                [kind]: { loading: true, progress: `Arquivo ${index + 1} de ${kindFiles.length}${line}` },
              }))
            }
            processed.push(await processRawFile(file, rawProcessedRef.current, onProgress))
          }
          if (cancel) return
          setPreviews((prev) => ({ ...prev, [kind]: { loading: false, data: summarizeRawKind(processed) } }))
          continue
        }
        try {
          const merged = mergeParsed(kind, orderedFiles)
          const url = previewUrl(kind)
          if (!merged || !url) throw new Error('Nada para pré-visualizar.')
          const response = await axios.post(url, previewBody(merged, orderedFiles))
          if (cancel) return
          setPreviews((prev) => ({ ...prev, [kind]: { loading: false, data: response.data } }))
        } catch (error) {
          if (cancel) return
          setPreviews((prev) => ({
            ...prev,
            [kind]: { loading: false, error: errorText(error, 'Erro ao gerar pré-visualização.') },
          }))
        }
      }
    })()
    return () => {
      cancel = true
    }
  }, [step, previewToken, orderedFiles, previewKinds])

  const addFiles = async (list: FileList | File[]) => {
    const incoming = [...list]
    if (!incoming.length) return
    const supported = incoming.filter((file) => isSupportedImportFileName(file.name))
    setPageError(supported.length === incoming.length ? null : UNSUPPORTED_FILE)
    if (!supported.length) return
    setDetecting(true)
    try {
      const prepared = await prepareIncoming(supported, benefitCards)
      const sameFile = (a: File, b: File) =>
        a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
      setFiles((prev) =>
        sortWizardFiles([
          ...prev.filter((old) => !prepared.some((item) => sameFile(old.file, item.file))),
          ...prepared,
        ]),
      )
      setFileVersion((version) => version + 1)
      setAdjustVersion(-1)
    } catch (error) {
      setPageError(errorText(error, 'Erro ao ler os arquivos.'))
    } finally {
      setDetecting(false)
    }
  }

  const commitPdfPassword = async (fileId: string, password: string) => {
    const current = files.find((file) => file.id === fileId)
    if (!current || !password.trim()) return
    setDetecting(true)
    try {
      const [refined] = await identifyPdfs([{ ...current, pdfPassword: password, needsPassword: true }])
      setFiles((prev) =>
        prev.map((file) => (file.id === fileId ? { ...refined, pdfPassword: password } : file)),
      )
      setFileVersion((version) => version + 1)
      setAdjustVersion(-1)
    } finally {
      setDetecting(false)
    }
  }

  const cancelRawLoad = () => {
    rawRunRef.current += 1
    setRawStatus(null)
  }

  /**
   * Processa os arquivos brutos e compara as planilhas exportadas com o banco (sem gravar),
   * separando o que precisa de decisão nos Ajustes.
   */
  const loadRawFixes = async (
    source: WizardFile[],
    version: number,
    runId: number,
    stepOffset: number,
    stepCount: number,
  ): Promise<RawFixGroup[] | null> => {
    const fixFiles = sortWizardFiles(source).filter((file) => isRawKind(file.kind) || isExportKind(file.kind))
    const groups: RawFixGroup[] = []
    for (const [index, file] of fixFiles.entries()) {
      if (rawRunRef.current !== runId) return null
      const stepIndex = stepOffset + index
      const exportFile = isExportKind(file.kind)
      setRawStatus({
        fileIndex: stepIndex,
        fileCount: stepCount,
        fileName: file.file.name,
        processed: 0,
        total: 0,
        fraction: 0,
        detail: exportFile ? 'Comparando a planilha com o que já está gravado…' : undefined,
      })
      if (exportFile) {
        const updates = await exportFileUpdates(file, source)
        if (rawRunRef.current !== runId) return null
        groups.push(...exportFixGroups(file, updates))
        continue
      }
      const result = await processRawFile(file, rawProcessedRef.current, (update) => {
        if (rawRunRef.current !== runId) return
        setRawStatus((current) =>
          current && current.fileIndex === stepIndex && update.fraction + 1e-6 >= current.fraction
            ? { ...current, ...update }
            : current,
        )
      })
      const preview = result.preview
      if (!preview) continue
      if (preview.conflicts.length) {
        groups.push({
          fileId: file.id,
          fileName: file.file.name,
          kind: file.kind,
          warnings: preview.warnings ?? [],
          conflicts: preview.conflicts,
          updates: [],
        })
      }
    }
    if (rawRunRef.current !== runId) return null
    setRawFixGroups(groups)
    setRawReadyVersion(version)
    return groups
  }

  const goNext = async () => {
    setPageError(null)
    if (step === 'arquivos') {
      const block = arquivosBlock(files, detecting)
      if (block) {
        setPageError(block)
        return
      }
      const hasRaw = files.some((file) => isRawKind(file.kind))
      const hasRefs = files.some((file) => kindUsesReferences(file.kind))
      if (!hasRaw && !hasRefs) {
        publishParsed(files, [], lookup)
        if (files.some((file) => hasPreviewKind(file.kind))) {
          setPreviewToken((token) => token + 1)
          setStep('preview')
        } else {
          setStep('executar')
        }
        return
      }

      const runId = ++rawRunRef.current
      const fixFileCount = files.filter((file) => isRawKind(file.kind) || isExportKind(file.kind)).length
      const stepCount = 1 + fixFileCount
      setStep('ajustes')
      setRawStatus({
        fileIndex: 0,
        fileCount: stepCount,
        fileName: 'Tags, subtags e compartilhamentos da conta',
        processed: 0,
        total: 0,
        fraction: 0,
      })
      let nextLookup: MappingImportLookup
      try {
        nextLookup = await loadLookup()
      } catch (error) {
        if (rawRunRef.current !== runId) return
        setRawStatus(null)
        setStep('arquivos')
        setPageError(errorText(error, 'Não foi possível carregar tags e compartilhamentos.'))
        return
      }
      if (rawRunRef.current !== runId) return
      setLookup(nextLookup)
      const merged = lookupWithBatchTags(files, nextLookup)
      setClassLookup(merged)
      const omit = Boolean(
        merged && !merged.tags.length && !merged.subtags.length && filesCarryClassification(files),
      )
      setOmitClassification(omit)
      const found = merged ? collectAdjustments(files, merged, { skipClass: omit }) : []
      setAdjustments((prev) =>
        found.map((row) => {
          const previous = prev.find((item) => item.key === row.key)
          if (!previous) return row
          return {
            ...row,
            replacementId: previous.replacementId,
            replacementTagId: previous.replacementTagId,
            replacementSubtagId: previous.replacementSubtagId,
          }
        }),
      )
      setAdjustVersion(fileVersion)
      if (!fixFileCount) setRawFixGroups([])
      const groups = fixFileCount ? await loadRawFixes(files, fileVersion, runId, 1, stepCount) : []
      if (!groups || rawRunRef.current !== runId) return
      setRawStatus(null)
      if (groups.length || found.length || omit) {
        setAdjustTab(firstAdjustTab(found, omit, groups))
        return
      }
      publishParsed(files, [], nextLookup)
      if (files.some((file) => hasPreviewKind(file.kind))) {
        setPreviewToken((token) => token + 1)
        setStep('preview')
      } else {
        setStep('executar')
      }
      return
    }
    if (step === 'ajustes') {
      if (rawStatus) return
      const pendingRaw = pendingRawFixes(rawFixGroups, conflictDecisions)
      if (pendingRaw) {
        setPageError(pendingRawMessage(pendingRaw))
        return
      }
      if (adjustments.some((row) => row.kind === 'sharing' && !adjustmentComplete(row))) {
        setPageError('Escolha um compartilhamento existente para cada nome ausente.')
        return
      }
      const pendingClass = adjustments.filter((row) => row.kind !== 'sharing' && !adjustmentComplete(row))
      if (pendingClass.length) {
        const confirmed = await showConfirm({
          title: 'Tags e subtags sem ajuste',
          message: unadjustedClassMessage(pendingClass),
          confirmText: 'Continuar',
          cancelText: 'Voltar',
          type: 'warning',
        })
        if (!confirmed) return
      }
      const rewrite = adjustments.length > 0 || omitClassification
      const activeLookup = classLookup ?? lookup
      if (rewrite && !activeLookup) return
      const kept = keptExportKeys(rawFixGroups, conflictDecisions)
      setFiles(
        files.map((file) => {
          if (!file.parsedOriginal) return file
          let parsed = rewrite
            ? applyAdjustments(file.parsedOriginal, adjustments, activeLookup!)
            : cloneParsed(file.parsedOriginal)
          if (rewrite && omitClassification) parsed = stripClassification(parsed)
          return { ...file, parsed: withKeptRows(file.id, parsed, kept) }
        }),
      )
      if (files.some((file) => hasPreviewKind(file.kind))) {
        setPreviewToken((token) => token + 1)
        setStep('preview')
      } else {
        setStep('executar')
      }
      return
    }
    if (step === 'preview') {
      if (previewKinds.some((kind) => !previews[kind] || previews[kind]?.loading)) return
      setStep('executar')
    }
  }

  const publishParsed = (source: WizardFile[], rows: AdjustmentRow[], activeLookup: MappingImportLookup | null) => {
    if (!rows.length || !activeLookup) {
      setFiles(
        source.map((file) =>
          file.parsedOriginal ? { ...file, parsed: cloneParsed(file.parsedOriginal) } : file,
        ),
      )
      return
    }
    setFiles(
      source.map((file) =>
        file.parsedOriginal
          ? { ...file, parsed: applyAdjustments(file.parsedOriginal, rows, activeLookup) }
          : file,
      ),
    )
  }

  const goBack = () => {
    const index = flowSteps.indexOf(step)
    if (index <= 0 || running) return
    setPageError(null)
    cancelRawLoad()
    setStep(flowSteps[index - 1])
  }

  const runFrom = async (startIndex: number, confirmedIds: Set<string>, acc: WizardFileResult[]) => {
    const reviewedConflictKeys = new Set(
      rawFixGroups.flatMap((group) => group.conflicts.map((conflict) => rawConflictKey(group.fileId, conflict))),
    )
    setRunning(true)
    setClosureHold(null)
    for (let index = startIndex; index < orderedFiles.length; index += 1) {
      const file = withTagIcons(orderedFiles[index], tagIconOverrides)
      const jobId = crypto.randomUUID()
      setProgress({
        jobId,
        fileIndex: index,
        fileCount: orderedFiles.length,
        fileName: file.file.name,
        processed: 0,
        total: 0,
        fraction: 0,
      })
      const onProgress = (update: { processed: number; total: number; fraction: number }) => {
        setProgress((current) => {
          if (!current || current.jobId !== jobId) return current
          if (update.fraction + 1e-6 < current.fraction) return current
          return { ...current, ...update }
        })
      }
      try {
        const outcome = await importFile(file, confirmedIds.has(file.id), jobId, onProgress, {
          autoRunRemap,
          overwriteSharing,
          processed: rawProcessedRef.current.get(file.id),
          conflictDecisions,
          reviewedConflictKeys,
        })
        if (outcome.closure) {
          setResults([...acc])
          setClosureHold({ index, impact: outcome.closure })
          setRunning(false)
          setProgress(null)
          return
        }
        acc.push(outcome.result)
        setResults([...acc])
      } catch (error) {
        const closure = parseAxiosClosureConflict(error)
        if (closure && !confirmedIds.has(file.id)) {
          setResults([...acc])
          setClosureHold({ index, impact: closure })
          setRunning(false)
          setProgress(null)
          return
        }
        acc.push({
          fileId: file.id,
          fileName: file.file.name,
          kind: file.kind,
          success: false,
          message: errorText(error, 'Erro ao importar.'),
          issues: [],
          conflicts: [],
          unmapped: 0,
        })
        setResults([...acc])
      }
    }
    setProgress(null)
    setRunning(false)
    const allConflicts = acc.flatMap((result) => result.conflicts)
    setConflicts(allConflicts)
    setShowConflicts(allConflicts.length > 0)
    setStep('resultado')
  }

  const startRun = () => {
    setResults([])
    setConflicts([])
    setShowConflicts(false)
    void runFrom(0, new Set(), [])
  }

  const resetWizard = () => {
    setStep('arquivos')
    setFiles([])
    setFileVersion((version) => version + 1)
    setAdjustVersion(-1)
    setAdjustments([])
    setClassLookup(null)
    setOmitClassification(false)
    setPreviews({})
    rawProcessedRef.current.clear()
    cancelRawLoad()
    setRawReadyVersion(-1)
    setRawFixGroups([])
    setConflictDecisions({})
    setTagIconOverrides({})
    setResults([])
    setConflicts([])
    setShowConflicts(false)
    setPageError(null)
    setProgress(null)
    setClosureHold(null)
    setPreviewTab(null)
    scrollContainerRef.current?.scrollTo({ top: 0 })
  }

  const locationKey = useLocation().key
  const lastLocationKey = useRef(locationKey)
  useEffect(() => {
    if (lastLocationKey.current === locationKey) return
    lastLocationKey.current = locationKey
    if (running) return
    resetWizard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationKey])

  const block = step === 'arquivos' ? arquivosBlock(files, detecting) : null
  const previewLoading =
    step === 'preview' && previewKinds.some((kind) => !previews[kind] || previews[kind]?.loading)
  const nothingToImport =
    step === 'preview' &&
    !previewLoading &&
    previewKinds.length > 0 &&
    previewKinds.every((kind) => previewTabCount(previews[kind]) === 0) &&
    !rawFixGroups.some((group) =>
      group.conflicts.some((conflict) => conflictDecisions[rawConflictKey(group.fileId, conflict)]?.choice === 'novo'),
    )
  const percent = progress ? importBatchPercent(progress.fileIndex, progress.fileCount, progress.fraction) : 0
  const rawLoading = step === 'ajustes' && rawStatus != null
  const rawPercent = rawStatus ? importBatchPercent(rawStatus.fileIndex, rawStatus.fileCount, rawStatus.fraction) : 0
  const rawPending = pendingRawFixes(rawFixGroups, conflictDecisions)
  const rawPendingText = step === 'ajustes' && rawPending ? pendingRawMessage(rawPending) : null
  const adjustTabs = buildAdjustTabs(adjustments, omitClassification, rawFixGroups, conflictDecisions)
  const activeAdjustTab: AdjustTabId = adjustTabs.some((tab) => tab.id === adjustTab)
    ? adjustTab
    : adjustTabs[0]?.id ?? 'classificacao'
  const visibleAdjustments = adjustments.filter((row) =>
    activeAdjustTab === 'compartilhamento' ? row.kind === 'sharing' : row.kind !== 'sharing',
  )
  const unmappedTotal = results.reduce((sum, result) => sum + result.unmapped, 0)

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <CadastroListPageShell>
        <CadastroListPageBody
          scrollRef={scrollContainerRef}
          header={
            <CadastroListPageHero
              icon={<FileUp className="h-8 w-8" />}
              title="Importar"
              subtitle={
                targetAccountName
                  ? `Destino: conta “${targetAccountName}”. Uma leva, vários tipos. O ajuste de tag, subtag ou compartilhamento vale para todos os arquivos.`
                  : 'Uma leva, vários tipos. O ajuste de tag, subtag ou compartilhamento vale para todos os arquivos.'
              }
              actions={
                <>
                  {step !== 'arquivos' && step !== 'resultado' ? (
                    <CadastroListSecondaryButton
                      label="Voltar"
                      onClick={goBack}
                      disabled={running}
                      icon={<ChevronLeft size={18} />}
                    />
                  ) : null}
                  {step === 'resultado' || nothingToImport ? (
                    <CadastroListPrimaryButton
                      label="Finalizar"
                      onClick={resetWizard}
                      icon={<Check size={18} />}
                    />
                  ) : step === 'executar' ? (
                    <CadastroListPrimaryButton
                      label={running ? 'Importando…' : 'Importar'}
                      onClick={startRun}
                      disabled={running || files.length === 0}
                      icon={<Upload size={18} />}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => void goNext()}
                      disabled={Boolean(block) || running || previewLoading || rawLoading || Boolean(rawPendingText)}
                      title={
                        previewLoading
                          ? 'Aguarde o fim da pré-visualização'
                          : rawLoading
                            ? 'Aguarde a análise dos arquivos'
                            : rawPendingText ?? undefined
                      }
                      className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ background: 'var(--color-create)', color: 'var(--on-color-create)' }}
                    >
                      Próximo
                      <ChevronsRight size={18} aria-hidden />
                    </button>
                  )}
                </>
              }
            />
          }
        >
          <nav
            aria-label="Etapas da importação"
            className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-[0_2px_10px_rgba(15,23,42,0.1),0_1px_4px_rgba(15,23,42,0.06)] dark:border-gray-600 dark:bg-gray-800 dark:shadow-[0_4px_18px_rgba(0,0,0,0.45)]"
          >
            <ol className="flex items-stretch divide-x divide-gray-200 dark:divide-gray-600">
              {ALL_STEPS.map((id, index) => {
                const active = id === step
                const skipped = skippedSteps.has(id)
                const done = !skipped && flowSteps.indexOf(id) < flowSteps.indexOf(step)
                return (
                  <li key={id} className="flex min-w-0 flex-1">
                    <button
                      type="button"
                      disabled={!done || running}
                      onClick={() => {
                        if (!done) return
                        cancelRawLoad()
                        setStep(id)
                      }}
                      aria-current={active ? 'step' : undefined}
                      title={skipped ? 'Esta etapa não se aplica a esta leva' : undefined}
                      className={`flex w-full items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors disabled:cursor-default ${
                        active
                          ? 'bg-[color-mix(in_srgb,var(--color-1)_12%,transparent)] text-[var(--color-1)]'
                          : done
                            ? 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/40'
                            : skipped
                              ? 'text-gray-300 dark:text-gray-600'
                              : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
                          active
                            ? 'bg-[var(--color-1)] text-white'
                            : done
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : skipped
                                ? 'bg-gray-50 text-gray-300 dark:bg-gray-800 dark:text-gray-600'
                                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {done ? <Check size={12} /> : index + 1}
                      </span>
                      <span className={`hidden truncate sm:inline ${skipped ? 'line-through' : ''}`}>
                        {STEP_LABEL[id]}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </nav>

          {pageError ? (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {pageError}
            </p>
          ) : null}

          {step === 'arquivos' ? (
            <div className="space-y-4">
              <div
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 ${
                  dragOver
                    ? 'border-[var(--color-1)] bg-[color-mix(in_srgb,var(--color-1)_8%,transparent)]'
                    : 'border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-900/40'
                }`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragOver(false)
                  if (!event.dataTransfer.files?.length) return
                  void addFiles(event.dataTransfer.files)
                }}
              >
                <Upload size={32} className="text-gray-400" />
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Arraste um ou mais arquivos ou clique para selecionar
                </p>
                <p className="text-xs text-gray-500">
                  PDF (fatura, holerite ou informe), Excel (.xlsx, .xls), CSV de benefício ou planilhas do Plumo
                </p>
                <label
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
                    detecting ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                  }`}
                  style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}
                >
                  <FileUp size={18} />
                  {detecting ? 'Identificando…' : 'Selecionar arquivos'}
                  <input
                    type="file"
                    multiple
                    accept=".xlsx,.xls,.pdf,.csv,application/pdf"
                    disabled={detecting}
                    className="hidden"
                    onChange={(event) => {
                      if (event.target.files) void addFiles(event.target.files)
                      event.target.value = ''
                    }}
                  />
                </label>
              </div>

              <CadastroFormSection
                title={`Arquivos${orderedFiles.length > 0 ? ` (${orderedFiles.length})` : ''}`}
                icon={<Upload size={13} />}
              >
                {orderedFiles.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Nenhum arquivo na fila. Use a área acima para adicionar extratos, faturas, CSVs de benefício,
                    holerites, informes ou as planilhas exportadas pelo Plumo.
                  </p>
                ) : (
                  <>
                    <p className="mb-2 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
                      A fila entra nesta ordem: contas, tags, compartilhamentos, cartões, mapeamentos, templates, extrato
                      e faturas do Plumo, extrato do banco, faturas PDF, benefícios, holerites e informes.
                    </p>
                    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[52rem] table-fixed border-separate border-spacing-0 text-sm">
                          <colgroup>
                            <col className="w-10" />
                            <col />
                            <col className="w-[150px]" />
                            <col className="w-[84px]" />
                            <col className="w-[260px]" />
                            <col className="w-14" />
                          </colgroup>
                          <thead>
                            <tr className="bg-gray-50 dark:bg-gray-800/60 [&>th]:border-b-2 [&>th]:border-gray-200 dark:[&>th]:border-gray-600">
                              <th className="px-3 py-3 text-left text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                                #
                              </th>
                              <th className="px-3 py-3 text-left text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                                Arquivo
                              </th>
                              <th className="px-3 py-3 text-center text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                                Tipo
                              </th>
                              <th className="px-3 py-3 text-center text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                                Importar
                              </th>
                              <th className="px-3 py-3 text-center text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                                Config
                              </th>
                              <th className="px-2 py-3 text-center text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                                Ação
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {orderedFiles.map((file, index) => (
                              <tr
                                key={file.id}
                                className={`${listPageTableRowHoverCls} [&>td]:border-b [&>td]:border-gray-100 dark:[&>td]:border-gray-700/50`}
                              >
                                <td className="px-3 py-2.5 text-xs font-mono tabular-nums text-gray-500 dark:text-gray-400">
                                  {index + 1}
                                </td>
                                <td className="px-3 py-2.5">
                                  <div className="flex min-w-0 items-center gap-2">
                                    {isPdfFileName(file.file.name) ? (
                                      <FileText className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-400" aria-hidden />
                                    ) : (
                                      <FileSpreadsheet className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-400" aria-hidden />
                                    )}
                                    <span
                                      className="truncate font-medium text-gray-800 dark:text-gray-100"
                                      title={file.file.name}
                                    >
                                      {file.file.name}
                                    </span>
                                  </div>
                                  {file.error && file.kind === 'blocked' ? (
                                    <p className="mt-1 text-xs text-red-600 dark:text-red-300">{file.error}</p>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  <KindBadge
                                    kind={file.kind}
                                    info={{ issuer: file.issuer, issuerLabel: file.issuerLabel, cardLast4: file.cardLast4 }}
                                  />
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  <div className="flex justify-center">
                                    <KindIcon kind={file.kind} />
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  {isExcelKind(file.kind) ? (
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                      {countParsedRows(file.parsedOriginal)} linhas
                                    </p>
                                  ) : null}
                                  {file.payrollPreview ? (
                                    <p
                                      className="truncate text-xs text-gray-600 dark:text-gray-300"
                                      title={file.payrollPreview}
                                    >
                                      {file.payrollPreview}
                                    </p>
                                  ) : null}
                                  {!isExcelKind(file.kind) &&
                                  !file.payrollPreview &&
                                  !file.needsPassword &&
                                  file.kind !== 'fatura_bruta' &&
                                  file.kind !== 'beneficio_csv' ? (
                                    <span className="text-xs text-gray-400">—</span>
                                  ) : null}
                                  {file.needsPassword ? (
                                    <input
                                      type="password"
                                      value={file.pdfPassword || ''}
                                      placeholder="Senha do PDF"
                                      className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
                                      onChange={(event) =>
                                        setFiles((prev) =>
                                          prev.map((item) =>
                                            item.id === file.id ? { ...item, pdfPassword: event.target.value } : item,
                                          ),
                                        )
                                      }
                                      onBlur={(event) => void commitPdfPassword(file.id, event.target.value)}
                                    />
                                  ) : null}
                                  {file.kind === 'fatura_bruta' ? (
                                    <div className="flex justify-center gap-1.5">
                                      <select
                                        value={file.year || ''}
                                        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
                                        onChange={(event) =>
                                          setFiles((prev) =>
                                            prev.map((item) =>
                                              item.id === file.id ? { ...item, year: event.target.value } : item,
                                            ),
                                          )
                                        }
                                      >
                                        <option value="">Ano</option>
                                        {years.map((year) => (
                                          <option key={year} value={year}>
                                            {year}
                                          </option>
                                        ))}
                                      </select>
                                      <select
                                        value={file.month || ''}
                                        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
                                        onChange={(event) =>
                                          setFiles((prev) =>
                                            prev.map((item) =>
                                              item.id === file.id ? { ...item, month: event.target.value } : item,
                                            ),
                                          )
                                        }
                                      >
                                        <option value="">Mês</option>
                                        {MONTHS.map((month) => (
                                          <option key={month.value} value={month.value}>
                                            {month.label}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  ) : null}
                                  {file.kind === 'beneficio_csv' ? (
                                    <select
                                      value={file.creditCardId || ''}
                                      className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
                                      onChange={(event) =>
                                        setFiles((prev) =>
                                          prev.map((item) =>
                                            item.id === file.id
                                              ? { ...item, creditCardId: Number(event.target.value) || undefined }
                                              : item,
                                          ),
                                        )
                                      }
                                    >
                                      <option value="">Cartão de benefício</option>
                                      {benefitCards.map((card) => (
                                        <option key={card.id} value={card.id}>
                                          {card.name} ({card.number})
                                        </option>
                                      ))}
                                    </select>
                                  ) : null}
                                </td>
                                <td className="px-2 py-2.5 text-center">
                                  <button
                                    type="button"
                                    className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                                    onClick={() => {
                                      setFiles((prev) => prev.filter((item) => item.id !== file.id))
                                      setFileVersion((version) => version + 1)
                                      setAdjustVersion(-1)
                                    }}
                                    aria-label="Remover arquivo"
                                    title="Remover arquivo"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </>
                )}
              </CadastroFormSection>
            </div>
          ) : null}

          {step === 'ajustes' ? (
            <div className="space-y-3">
              {rawStatus ? (
                <div
                  role="progressbar"
                  aria-valuenow={Math.round(rawPercent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="mb-1.5 flex justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      Carregando ajustes · etapa {rawStatus.fileIndex + 1} de {rawStatus.fileCount} ·{' '}
                      {rawStatus.fileName}
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--color-1)]">
                      {rawPercent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className="h-full rounded-full bg-[var(--color-1)] transition-[width]"
                      style={{ width: `${rawPercent}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-gray-500">
                    {rawStatus.detail
                      ? rawStatus.detail
                      : rawStatus.fileIndex === 0
                        ? 'Conferindo as referências das planilhas…'
                        : rawStatus.total > 0
                          ? `Linha ${rawStatus.processed.toLocaleString('pt-BR')} de ${rawStatus.total.toLocaleString('pt-BR')} · comparando com o que já está gravado`
                          : 'Lendo arquivo…'}
                  </p>
                </div>
              ) : null}
              {!rawStatus && adjustTabs.length > 0 ? (
                <>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Revise o que precisa de ajuste antes da pré-visualização.
                    {rawPendingText ? (
                      <span className="font-medium text-amber-700 dark:text-amber-300"> {rawPendingText}</span>
                    ) : null}
                  </p>
                  <CadastroListPageTabs
                    tabs={adjustTabs.map((tab) => ({
                      key: tab.id,
                      label: ADJUST_TAB_LABEL[tab.id],
                      count: tab.count,
                      icon: tab.pending ? (
                        <span className="h-2 w-2 rounded-full bg-amber-400" aria-label="Pendente" />
                      ) : undefined,
                    }))}
                    active={activeAdjustTab}
                    onChange={setAdjustTab}
                  />
                </>
              ) : null}
              {!rawStatus && isRawAdjustTab(activeAdjustTab) ? (
                <RawImportAdjustments
                  groups={rawFixGroups.filter((group) => group.kind === activeAdjustTab)}
                  decisions={conflictDecisions}
                  onDecide={(updates) => setConflictDecisions((prev) => ({ ...prev, ...updates }))}
                />
              ) : null}
              {!rawStatus && activeAdjustTab === 'classificacao' ? (
                omitClassification ? (
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    Não há tags nem subtags na conta e nenhum arquivo de cadastro nesta leva. Os registros serão
                    inseridos sem esses valores.
                  </p>
                ) : (
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Ajuste tag e subtag juntas quando a planilha referencia um cadastro inexistente nesta conta.
                    {files.some((file) => file.kind === 'tags')
                      ? ' As opções vêm da conta e do arquivo de tags e subtags desta leva.'
                      : ' As opções são as tags e subtags já cadastradas na conta.'}
                  </p>
                )
              ) : null}
              {!rawStatus && activeAdjustTab === 'compartilhamento' ? (
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Escolha um compartilhamento existente para cada conta parceira que a planilha cita e que não existe
                  nesta conta.
                </p>
              ) : null}
              {!rawStatus &&
              (activeAdjustTab === 'classificacao' || activeAdjustTab === 'compartilhamento') &&
              visibleAdjustments.length > 0 &&
              (classLookup ?? lookup) ? (
                <AdjustmentsTable
                  rows={visibleAdjustments}
                  lookup={(classLookup ?? lookup)!}
                  onChange={(key, patch) =>
                    setAdjustments((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)))
                  }
                />
              ) : null}
            </div>
          ) : null}

          {step === 'preview' && previewTab ? (
            <div>
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                A pré-visualização e a gravação seguem a ordem da fila: contas, tags, compartilhamentos, cartões,
                mapeamentos, templates, extrato e faturas.
              </p>
              {nothingToImport ? (
                <p className="mb-4 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  Nada a importar: nenhuma aba traz registros novos ou alterados. Clique em Finalizar para encerrar.
                </p>
              ) : null}
              <CadastroListPageTabs
                tabs={previewTabs.map((tab) => {
                  const loading = tab.parts.some((part) => !part.slot || part.slot.loading)
                  return {
                    key: tab.id,
                    label: tab.label,
                    count: loading
                      ? undefined
                      : tab.parts.reduce((sum, part) => sum + (previewTabCount(part.slot) ?? 0), 0),
                    icon: loading ? <PreviewTabSpinner /> : undefined,
                  }
                })}
                active={previewTab}
                onChange={setPreviewTab}
              />
              {(previewTabs.find((tab) => tab.id === previewTab)?.parts ?? []).map((part, index, parts) => (
                <section key={part.kind} className={index > 0 ? 'mt-6' : undefined}>
                  {parts.length > 1 ? (
                    <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">
                      {previewPartLabel(part.kind)}
                    </h3>
                  ) : null}
                  {!part.slot || part.slot.loading ? (
                    <div className="flex items-center gap-3 py-8 text-sm text-gray-500 dark:text-gray-400">
                      <PreviewTabSpinner />
                      Gerando pré-visualização…
                      {part.slot?.progress ? <span className="tabular-nums">{part.slot.progress}</span> : null}
                    </div>
                  ) : part.slot.error ? (
                    <p className="mb-4 text-sm text-red-600 dark:text-red-300">{part.slot.error}</p>
                  ) : (
                    <PreviewPane
                      kind={part.kind}
                      slot={part.slot}
                      files={orderedFiles}
                      lookup={lookup}
                      tagIconOverrides={tagIconOverrides}
                      onTagIconChange={(row, icon) => {
                        const key = `${row.entity ?? ''}:${row.row}`
                        setTagIconOverrides((prev) => (prev[key] === icon ? prev : { ...prev, [key]: icon }))
                      }}
                      decisionNotes={[
                        ...rawDecisionNotes(part.kind, orderedFiles, rawFixGroups, conflictDecisions),
                        ...exportDecisionNotes(part.kind, part.source, orderedFiles, rawFixGroups, conflictDecisions),
                      ]}
                    />
                  )}
                </section>
              ))}
            </div>
          ) : null}

          {step === 'executar' ? (
            <section className="space-y-4">
              <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
                {orderedFiles.map((file, index) => {
                  const rows = isRawKind(file.kind)
                    ? rawProcessedRef.current.get(file.id)?.rows.length ?? 0
                    : countParsedRows(file.parsed)
                  return (
                    <li key={file.id} className="px-4 py-3 text-sm text-gray-800 dark:text-gray-100">
                      <span className="font-medium tabular-nums text-gray-500">{index + 1}.</span>{' '}
                      <span className="font-medium">{file.file.name}</span>
                      <span className="text-gray-500">
                        {' '}
                        · {KIND_LABEL[file.kind]}
                        {rows ? ` · ${rows} linha(s)` : ''}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {files.some((file) => file.kind === 'mapeamentos') ? (
                <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-700 dark:bg-gray-800">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={autoRunRemap}
                      onChange={(event) => setAutoRunRemap(event.target.checked)}
                    />
                    <span>Remapear lançamentos já existentes com os mapeamentos desta leva.</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={overwriteSharing}
                      onChange={(event) => setOverwriteSharing(event.target.checked)}
                    />
                    <span>Sobrescrever compartilhamento quando a planilha trouxer um parceiro.</span>
                  </label>
                </div>
              ) : null}
              {progress ? (
                <div role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span>
                      Arquivo {progress.fileIndex + 1} de {progress.fileCount} · {progress.fileName}
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--color-1)]">
                      {percent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div className="h-full rounded-full bg-[var(--color-1)]" style={{ width: `${percent}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-gray-500">
                    {progress.total > 0
                      ? `Linha ${progress.processed.toLocaleString('pt-BR')} de ${progress.total.toLocaleString('pt-BR')}`
                      : 'Preparando arquivo…'}
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}

          {step === 'resultado' ? (
            <section className="space-y-3">
              {results.map((result) => (
                <article
                  key={result.fileId}
                  className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
                >
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {result.fileName}
                    <span className="font-normal text-gray-500"> · {KIND_LABEL[result.kind]}</span>
                  </p>
                  <p className={`mt-1 text-sm ${result.success ? 'text-gray-700 dark:text-gray-200' : 'text-red-600 dark:text-red-300'}`}>
                    {result.message}
                  </p>
                  {result.issues.length > 0 ? (
                    <ul className="mt-2 list-disc pl-5 text-xs text-gray-600 dark:text-gray-300">
                      {result.issues.slice(0, 8).map((issue, index) => (
                        <li key={`${result.fileId}-${index}`}>
                          {issue.row ? `Linha ${issue.row}: ` : ''}
                          {issue.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
              {unmappedTotal > 0 ? (
                <p className="text-sm text-gray-700 dark:text-gray-200">
                  {unmappedTotal} lançamento(s) ficaram sem mapeamento.{' '}
                  <Link to="/curadoria" className="font-medium text-[var(--color-1)]">
                    Abrir Curadoria
                  </Link>
                </p>
              ) : null}
              {conflicts.length > 0 ? (
                <button
                  type="button"
                  className="text-sm font-medium text-[var(--color-1)]"
                  onClick={() => setShowConflicts(true)}
                >
                  Revisar {conflicts.length} conflito(s) de valor ou tag
                </button>
              ) : null}
            </section>
          ) : null}

        </CadastroListPageBody>
      </CadastroListPageShell>

      {showBackToTop ? (
        <FloatingFooterBar>
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={scrollToTop}
              className="flex items-center gap-1.5 rounded-lg bg-color-primary px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
              title="Voltar ao topo"
            >
              <ArrowUp size={14} />
              Voltar ao Topo
            </button>
          </div>
        </FloatingFooterBar>
      ) : null}

      <ClosureEditImpactDialog
        isOpen={closureHold != null}
        impact={closureHold?.impact ?? null}
        confirmText="Gravar mesmo assim"
        onClose={() => {
          if (!closureHold) return
          const file = orderedFiles[closureHold.index]
          const acc = [
            ...results,
            {
              fileId: file.id,
              fileName: file.file.name,
              kind: file.kind,
              success: false,
              message: 'Gravação interrompida: o período está fechado.',
              issues: [],
              conflicts: [],
              unmapped: 0,
            },
          ]
          setClosureHold(null)
          void runFrom(closureHold.index + 1, new Set(), acc)
        }}
        onConfirm={() => {
          if (!closureHold) return
          const confirmed = new Set([orderedFiles[closureHold.index].id])
          void runFrom(closureHold.index, confirmed, [...results])
        }}
      />
      <ConflictReviewModal
        isOpen={showConflicts}
        conflicts={conflicts}
        onClose={() => setShowConflicts(false)}
        onResolve={async (resolutions) => {
          await axios.post('/api/import/resolve-conflicts', { resolutions })
          setConflicts([])
          setShowConflicts(false)
        }}
      />
      <ConfirmComponent />
    </div>
  )
}

const adjustmentSelectCls = `${cadastroFilterFieldCls} ring-1 ring-amber-400/80`

function AdjustmentsTable({
  rows,
  lookup,
  onChange,
}: {
  rows: AdjustmentRow[]
  lookup: MappingImportLookup
  onChange: (
    key: string,
    patch: Partial<Pick<AdjustmentRow, 'replacementId' | 'replacementTagId' | 'replacementSubtagId'>>,
  ) => void
}) {
  return (
    <ListPageTable
      leadingMode="index-only"
      minWidth={1180}
      framed
      colsRest={
        <>
          <ListTableSpacerCol />
          <col style={{ width: '12%', minWidth: 110 }} />
          <col style={{ width: '12%', minWidth: 110 }} />
          <col style={{ width: '14%', minWidth: 130 }} />
          <col style={{ width: 88, minWidth: 72 }} />
          <col style={{ width: '16%', minWidth: 150 }} />
          <col style={{ width: '16%', minWidth: 150 }} />
          <col style={{ width: '18%', minWidth: 170 }} />
        </>
      }
      head={
        <tr>
          <ListTableIndexHeader />
          <ListTableSpacerHeader />
          <th className={listPageTableThCls}>Tag</th>
          <th className={listPageTableThCls}>Subtag</th>
          <th className={listPageTableThCls}>Compartilhamento</th>
          <th className={listPageTableThCls}>Tipo</th>
          <th className={listPageTableThCls}>Nova tag</th>
          <th className={listPageTableThCls}>Nova subtag</th>
          <th className={listPageTableThCls}>Novo compartilhamento</th>
        </tr>
      }
    >
      {rows.map((row, index) => {
        const tagId = row.replacementTagId
        const subtags = lookup.subtags.filter((subtag) => {
          if (tagId == null || subtag.tag_id !== tagId) return false
          if (row.subtagType && subtag.type !== row.subtagType) return false
          return true
        })
        return (
          <tr key={row.key} className={listPageTableRowHoverCls}>
            <ListTableIndexCell index={index + 1} />
            <td className="list-page-table-spacer-col" aria-hidden />
            <td className={listPageTableTdCls}>{row.tagName || '—'}</td>
            <td className={listPageTableTdCls}>{row.subtagName || '—'}</td>
            <td className={listPageTableTdCls}>{row.partnerName || '—'}</td>
            <td className={`${listPageTableTdCls} capitalize`}>{row.subtagType || '—'}</td>
            <td className={listPageTableTdCls}>
              {row.kind === 'subtag' ? (
                <select
                  className={adjustmentSelectCls}
                  value={tagId ?? ''}
                  onChange={(event) => {
                    const nextTagId = event.target.value ? Number(event.target.value) : null
                    const stillValid =
                      nextTagId != null &&
                      row.replacementSubtagId != null &&
                      lookup.subtags.some(
                        (subtag) => subtag.id === row.replacementSubtagId && subtag.tag_id === nextTagId,
                      )
                    onChange(row.key, {
                      replacementTagId: nextTagId,
                      replacementSubtagId: stillValid ? row.replacementSubtagId : null,
                    })
                  }}
                >
                  <option value="">Selecione…</option>
                  {lookup.tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.id < 0 ? `${tag.name} · nesta leva` : tag.name}
                    </option>
                  ))}
                </select>
              ) : row.kind === 'tag' ? (
                <select
                  className={adjustmentSelectCls}
                  value={row.replacementId ?? ''}
                  onChange={(event) =>
                    onChange(row.key, { replacementId: event.target.value ? Number(event.target.value) : null })
                  }
                >
                  <option value="">Selecione…</option>
                  {lookup.tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.id < 0 ? `${tag.name} · nesta leva` : tag.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-gray-500 dark:text-gray-400">—</span>
              )}
            </td>
            <td className={listPageTableTdCls}>
              {row.kind === 'subtag' ? (
                <select
                  className={adjustmentSelectCls}
                  value={row.replacementSubtagId ?? ''}
                  disabled={tagId == null}
                  onChange={(event) =>
                    onChange(row.key, {
                      replacementSubtagId: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                >
                  <option value="">{tagId == null ? 'Tag primeiro' : 'Selecione…'}</option>
                  {subtags.map((subtag) => (
                    <option key={subtag.id} value={subtag.id}>
                      {`${row.subtagType ? subtag.name : `${subtag.name} · ${subtag.type}`}${subtag.id < 0 ? ' · nesta leva' : ''}`}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-gray-500 dark:text-gray-400">—</span>
              )}
            </td>
            <td className={listPageTableTdCls}>
              {row.kind === 'sharing' ? (
                <select
                  className={adjustmentSelectCls}
                  value={row.replacementId ?? ''}
                  onChange={(event) =>
                    onChange(row.key, { replacementId: event.target.value ? Number(event.target.value) : null })
                  }
                >
                  <option value="">Selecione…</option>
                  {lookup.partners.map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.shared_account?.name || partner.shared_account?.description || `Parceiro ${partner.id}`}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-gray-500 dark:text-gray-400">—</span>
              )}
            </td>
          </tr>
        )
      })}
    </ListPageTable>
  )
}

function unadjustedClassMessage(rows: AdjustmentRow[]): string {
  const items = rows.reduce((sum, row) => sum + row.total, 0)
  const shown = rows.slice(0, 8).map((row) => `· ${adjustmentLabel(row)}`)
  const hidden = rows.length - shown.length
  if (hidden > 0) {
    shown.push(`· e mais ${hidden} ${hidden === 1 ? 'classificação' : 'classificações'}`)
  }
  const intro =
    rows.length === 1
      ? 'Esta classificação ficou sem nova tag e nova subtag no passo Ajustes:'
      : 'Estas classificações ficaram sem nova tag e nova subtag no passo Ajustes:'
  const outcome =
    items === 1
      ? 'O item que usa essa classificação será salvo vazio.'
      : `Os ${items} itens que usam ${rows.length === 1 ? 'essa classificação' : 'essas classificações'} serão salvos vazios.`
  return `${intro}\n${shown.join('\n')}\n\n${outcome}`
}

function PreviewTabSpinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden
    />
  )
}

function previewTabCount(slot: PreviewSlot | undefined): number | undefined {
  if (!slot || slot.loading || slot.error || !slot.data) return undefined
  return slot.data.summary.creates + slot.data.summary.updates
}

function patchTagIcon(parsed: WizardParsed, entity: string | null | undefined, line: number, icon: string): WizardParsed {
  if (parsed.kind !== 'tags') return parsed
  if (entity === 'subtag') {
    return {
      ...parsed,
      data: {
        ...parsed.data,
        subtags: parsed.data.subtags.map((item) => (item.row_index === line ? { ...item, icon } : item)),
      },
    }
  }
  return {
    ...parsed,
    data: {
      ...parsed.data,
      tags: parsed.data.tags.map((item) => (item.row_index === line ? { ...item, icon } : item)),
    },
  }
}

function withTagIcons(file: WizardFile, overrides: Record<string, string>): WizardFile {
  if (file.kind !== 'tags' || !file.parsed || !Object.keys(overrides).length) return file
  let parsed = file.parsed
  for (const [key, icon] of Object.entries(overrides)) {
    const split = key.indexOf(':')
    const entity = key.slice(0, split)
    const line = Number(key.slice(split + 1))
    if (!Number.isFinite(line)) continue
    parsed = patchTagIcon(parsed, entity, line, icon)
  }
  return parsed === file.parsed ? file : { ...file, parsed }
}

function PreviewPane({
  kind,
  slot,
  files,
  lookup,
  tagIconOverrides,
  onTagIconChange,
  decisionNotes,
}: {
  kind: WizardKind
  slot: PreviewSlot | undefined
  files: WizardFile[]
  lookup: MappingImportLookup | null
  tagIconOverrides: Record<string, string>
  onTagIconChange: (row: CadastroImportPreviewRow, icon: string) => void
  decisionNotes: string[]
}) {
  if (!slot || slot.loading || slot.error || !slot.data) return null
  if (isRawKind(kind)) {
    return (
      <RawImportPreview
        kind={kind}
        data={slot.data as RawKindPreviewData}
        notes={[...decisionNotes, ...rawPreviewNotes(kind, files)]}
      />
    )
  }
  if (kind === 'mapeamentos') {
    const merged = mergeParsed(kind, files)
    return (
      <MappingVisualImportPreview
        data={slot.data as MappingImportPreviewData}
        parsedRows={merged?.kind === 'mapeamentos' ? merged.rows : []}
        lookup={lookup}
        manualTabRows={[]}
        onPatchManualRow={() => undefined}
      />
    )
  }
  if (kind === 'extrato_export' || kind === 'fatura_export') {
    return <ExtratoVisualImportPreview data={slot.data as VisualImportPreviewData} notes={decisionNotes} />
  }
  return (
    <CadastroImportPreview
      data={slot.data as CadastroImportPreviewData}
      tagIconOverrides={kind === 'tags' ? tagIconOverrides : undefined}
      onTagIconChange={kind === 'tags' ? onTagIconChange : undefined}
    />
  )
}

async function importFile(
  file: WizardFile,
  confirmClosed: boolean,
  jobId: string,
  onProgress: (update: { processed: number; total: number; fraction: number }) => void,
  options: {
    autoRunRemap: boolean
    overwriteSharing: boolean
    processed?: RawProcessed
    conflictDecisions: Record<string, ConflictDecision>
    reviewedConflictKeys: Set<string>
  },
): Promise<{ result: WizardFileResult; closure?: undefined } | { result?: undefined; closure: ClosureEditImpact }> {
  if (isExcelKind(file.kind)) {
    if (!file.parsed) throw new Error('Planilha sem dados.')
    const url = applyUrl(file.kind)
    if (!url) throw new Error('Tipo sem gravação.')
    try {
      onProgress({ processed: 0, total: 1, fraction: 0.05 })
      const response = await axios.post(
        url,
        applyBody(file.parsed, {
          confirmClosed,
          autoRunRemap: options.autoRunRemap,
          overwriteSharing: options.overwriteSharing,
        }),
      )
      onProgress({ processed: 1, total: 1, fraction: 1 })
      const issues = issuesFromPayload(response.data)
      const message =
        typeof response.data?.message === 'string' && response.data.message
          ? response.data.message
          : 'Importação concluída.'
      return {
        result: {
          fileId: file.id,
          fileName: file.file.name,
          kind: file.kind,
          success: true,
          message,
          issues,
          conflicts: [],
          unmapped: 0,
        },
      }
    } catch (error) {
      const closure = parseAxiosClosureConflict(error)
      if (closure && !confirmClosed) return { closure }
      throw error
    }
  }

  if (!isRawKind(file.kind)) throw new Error(file.error || 'Arquivo não reconhecido.')

  if (file.kind === 'holerite' || file.kind === 'informe' || file.kind === 'consorcio') {
    const form = new FormData()
    form.append('files', file.file)
    form.append('passwords', file.pdfPassword ?? '')
    const response = await postImportWithProgress<{ results: Array<{ status: string; message?: string | null; action?: string | null }> }>(
      file.kind === 'consorcio' ? '/api/consortiums/import-pdfs' : '/api/payroll/import-pdfs',
      form,
      jobId,
      onProgress,
    )
    const hit = response.data.results?.[0]
    if (!hit || hit.status !== 'ok') {
      return {
        result: {
          fileId: file.id,
          fileName: file.file.name,
          kind: file.kind,
          success: false,
          message: hit?.message || 'Erro ao importar PDF.',
          issues: [],
          conflicts: [],
          unmapped: 0,
        },
      }
    }
    return {
      result: {
        fileId: file.id,
        fileName: file.file.name,
        kind: file.kind,
        success: true,
        message: hit.action === 'updated' ? 'Registro atualizado.' : 'Registro importado.',
        issues: [],
        conflicts: [],
        unmapped: 0,
      },
    }
  }

  const processed = options.processed
  if (!processed || processed.key !== rawProcessKey(file) || processed.preview.error) {
    throw new Error('Arquivo sem processamento válido. Volte ao Preview para processá-lo de novo.')
  }

  const rows = processed.rows
  const finish = async (result: WizardFileResult) => ({
    result: await applyConflictDecisions(file.id, result, options.conflictDecisions, options.reviewedConflictKeys),
  })

  if (file.kind === 'extrato_bruto') {
    const response = await postImportWithProgress<Record<string, unknown>>(
      '/api/import/extrato/persist',
      { rows, ignored_rows: processed.ignoredRows },
      jobId,
      onProgress,
    )
    return finish(rawResult(file, response.data))
  }

  if (file.kind === 'fatura_bruta') {
    const response = await postImportWithProgress<Record<string, unknown>>(
      '/api/import/cartao/persist',
      { rows },
      jobId,
      onProgress,
    )
    return finish(rawResult(file, response.data, true))
  }

  if (file.kind === 'beneficio_csv') {
    if (!file.creditCardId) throw new Error('Selecione um cartão de benefícios.')
    const response = await postImportWithProgress<Record<string, unknown>>(
      '/api/benefit-card-statements/csv/persist',
      { credit_card_id: file.creditCardId, rows },
      jobId,
      onProgress,
    )
    return finish(rawResult(file, response.data))
  }

  throw new Error('Tipo de arquivo sem gravação.')
}

function rawIssues(data: Record<string, unknown>): Array<{ row?: number; reason: string }> {
  const skipped = Array.isArray(data.linhas_ignoradas_detalhe) ? data.linhas_ignoradas_detalhe : []
  return skipped.map((item) => {
    const row = item && typeof item === 'object' ? (item as { Linha?: unknown; Erro?: unknown }) : {}
    return {
      row: typeof row.Linha === 'number' ? row.Linha : undefined,
      reason: typeof row.Erro === 'string' ? row.Erro.replace(/^Linha \d+:\s*/, '') : 'Linha ignorada',
    }
  })
}

function rawResult(file: WizardFile, data: Record<string, unknown>, pdf = false): WizardFileResult {
  const conflicts = Array.isArray(data.conflicts)
    ? (data.conflicts as ImportConflict[]).map((conflict) => ({ ...conflict, source_file: file.file.name }))
    : []
  const created = Number(data.linhas_salvas ?? data.registros_importados ?? 0) || 0
  const updated = Number(data.linhas_atualizadas ?? data.registros_atualizados ?? data.registros_duplicados ?? 0) || 0
  const unmapped = Number(data.linhas_nao_mapeadas ?? data.unmapped ?? 0) || 0
  const failed = pdf ? false : data.success === false
  const message =
    typeof data.message === 'string' && data.message
      ? data.message
      : failed
        ? 'A importação não foi concluída.'
        : `${created} incluído(s), ${updated} atualizado(s).`
  return {
    fileId: file.id,
    fileName: file.file.name,
    kind: file.kind,
    success: !failed,
    message,
    issues: rawIssues(data),
    conflicts,
    unmapped,
  }
}
