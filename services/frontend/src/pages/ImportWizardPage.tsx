import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { Check, ChevronLeft, ChevronsRight, FileUp, Upload, X } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageShell,
  CadastroListPageTabs,
  CadastroListPrimaryButton,
  CadastroListSecondaryButton,
} from '../components/CadastroListPageLayout'
import CadastroImportPreview, { type CadastroImportPreviewData } from '../components/CadastroImportPreview'
import ExtratoVisualImportPreview, { type VisualImportPreviewData } from '../components/ExtratoVisualImportPreview'
import MappingVisualImportPreview, { type MappingImportPreviewData } from '../components/MappingVisualImportPreview'
import ClosureEditImpactDialog from '../components/ClosureEditImpactDialog'
import ConflictReviewModal from '../components/ConflictReviewModal'
import type { BenefitCardForMatch } from '../utils/benefitCardFileMatch'
import { fileExtension, isPdfFileName } from '../utils/fileTypeDetector'
import type { MappingImportLookup } from '../utils/mappingImportCorrections'
import { parseAxiosClosureConflict } from '../utils/closureEditImpact'
import type { ClosureEditImpact } from '../types/closureEditImpact'
import type { ImportConflict } from '../types/importConflict'
import {
  KIND_LABEL,
  KIND_ORDER,
  sortWizardFiles,
  adjustmentComplete,
  adjustmentLabel,
  applyAdjustments,
  applyBody,
  applyUrl,
  classifySpreadsheet,
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
  data?: CadastroImportPreviewData | MappingImportPreviewData | VisualImportPreviewData
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
  formData: FormData,
  jobId: string,
  onProgress: (update: { processed: number; total: number; fraction: number }) => void,
) {
  formData.append('progress_job_id', jobId)
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
    return await axios.post<T>(url, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
  } finally {
    stopped = true
    window.clearInterval(timer)
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

async function identifyPdfs(items: WizardFile[]): Promise<WizardFile[]> {
  const pdfs = items.filter((item) => isPdfFileName(item.file.name))
  if (!pdfs.length) return items
  let next = items.map((item) => ({ ...item }))
  const unlocked = next.filter((item) => isPdfFileName(item.file.name) && !(item.needsPassword && !item.pdfPassword))
  if (!unlocked.length) return next

  let classified: Array<{
    filename: string
    status: string
    doc_type?: string | null
    message?: string | null
    employer_name?: string | null
    payer_name?: string | null
    calendar_year?: number | null
    payslip_kind?: string | null
    year?: number | null
    month?: number | null
    reference_label?: string | null
  }> = []
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
      const bits = [hit.employer_name || hit.payer_name, hit.reference_label, hit.calendar_year ? String(hit.calendar_year) : '']
      target.payrollPreview = bits.filter(Boolean).join(' · ')
      return
    }
    remaining.push(target)
  })

  if (!remaining.length) return next
  try {
    const form = new FormData()
    remaining.forEach((item) => form.append('files', item.file))
    remaining.forEach((item) => form.append('passwords', item.pdfPassword ?? ''))
    const response = await axios.post<{
      results: Array<{
        filename: string
        status: string
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
        return
      }
      item.kind = 'fatura_bruta'
      item.error = undefined
      item.needsPassword = false
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

const PLUMO_EXPORT_ONLY =
  'Nesta tela entram as planilhas exportadas pelo Plumo. O arquivo original do banco continua na Home.'

async function prepareIncoming(files: File[]): Promise<WizardFile[]> {
  const drafted: WizardFile[] = []
  for (const file of files) {
    const item: WizardFile = {
      id: crypto.randomUUID(),
      file,
      kind: 'blocked',
    }
    const classified = await classifySpreadsheet(file)
    if (!isExcelKind(classified.kind)) {
      item.error = isRawKind(classified.kind) ? PLUMO_EXPORT_ONLY : classified.error || PLUMO_EXPORT_ONLY
      drafted.push(item)
      continue
    }
    item.kind = classified.kind
    try {
      const parsed = await parseForKind(classified.kind, file)
      item.parsedOriginal = parsed
      item.parsed = cloneParsed(parsed)
    } catch (error) {
      item.kind = 'blocked'
      item.error = errorText(error, 'Arquivo inválido.')
    }
    drafted.push(item)
  }
  return drafted
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

export default function ImportWizardPage() {
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
  const [previewTab, setPreviewTab] = useState<WizardKind | null>(null)
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

  const skippedSteps = useMemo(() => {
    const skipped = new Set<StepId>()
    if (adjustVersion === fileVersion && adjustments.length === 0 && !omitClassification) skipped.add('ajustes')
    if (files.length > 0 && !files.some((file) => isExcelKind(file.kind))) skipped.add('preview')
    return skipped
  }, [adjustVersion, adjustments.length, fileVersion, files, omitClassification])

  const flowSteps = useMemo(
    () => ALL_STEPS.filter((id) => !skippedSteps.has(id)),
    [skippedSteps],
  )

  const presentKinds = useMemo(
    () => KIND_ORDER.filter((kind) => kind !== 'blocked' && files.some((file) => file.kind === kind)),
    [files],
  )
  const excelKinds = useMemo(() => presentKinds.filter((kind) => isExcelKind(kind)), [presentKinds])

  useEffect(() => {
    if (step !== 'preview') return
    const kinds = excelKinds
    if (!kinds.length) return
    setPreviewTab((current) => (current && kinds.includes(current) ? current : kinds[0]))
    let cancel = false
    setPreviews(Object.fromEntries(kinds.map((kind) => [kind, { loading: true }])))
    void (async () => {
      for (const kind of kinds) {
        if (cancel) return
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
  }, [step, previewToken, orderedFiles, excelKinds])

  const addFiles = async (list: FileList | File[]) => {
    const incoming = [...list]
    if (!incoming.length) return
    const spreadsheets = incoming.filter((file) => fileExtension(file.name) === '.xlsx')
    if (spreadsheets.length !== incoming.length) {
      setPageError(PLUMO_EXPORT_ONLY)
    }
    if (!spreadsheets.length) return
    setDetecting(true)
    setPageError(spreadsheets.length === incoming.length ? null : PLUMO_EXPORT_ONLY)
    try {
      const prepared = await prepareIncoming(spreadsheets)
      setFiles((prev) => sortWizardFiles([...prev, ...prepared]))
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

  const goNext = async () => {
    setPageError(null)
    if (step === 'arquivos') {
      const block = arquivosBlock(files, detecting)
      if (block) {
        setPageError(block)
        return
      }
      let nextLookup = lookup
      if (files.some((file) => kindUsesReferences(file.kind))) {
        try {
          nextLookup = await loadLookup()
          setLookup(nextLookup)
        } catch (error) {
          setPageError(errorText(error, 'Não foi possível carregar tags e compartilhamentos.'))
          return
        }
      }
      const merged = nextLookup ? lookupWithBatchTags(files, nextLookup) : null
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
      if (found.length || omit) {
        setStep('ajustes')
        return
      }
      publishParsed(files, [], nextLookup)
      if (files.some((file) => isExcelKind(file.kind))) {
        setPreviewToken((token) => token + 1)
        setStep('preview')
      } else {
        setStep('executar')
      }
      return
    }
    if (step === 'ajustes') {
      if (adjustments.some((row) => !adjustmentComplete(row))) {
        const classPending = adjustments.some((row) => row.kind !== 'sharing' && !adjustmentComplete(row))
        setPageError(
          classPending
            ? 'Escolha a tag e a subtag de cada classificação. Se só a subtag mudou, mantenha a tag.'
            : 'Escolha um compartilhamento existente para cada nome ausente.',
        )
        return
      }
      const activeLookup = classLookup ?? lookup
      if (!activeLookup) return
      const rewritten = files.map((file) => {
        if (!file.parsedOriginal) return file
        const adjusted = applyAdjustments(file.parsedOriginal, adjustments, activeLookup)
        return { ...file, parsed: omitClassification ? stripClassification(adjusted) : adjusted }
      })
      setFiles(rewritten)
      if (rewritten.some((file) => isExcelKind(file.kind))) {
        setPreviewToken((token) => token + 1)
        setStep('preview')
      } else {
        setStep('executar')
      }
      return
    }
    if (step === 'preview') {
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
    setStep(flowSteps[index - 1])
  }

  const runFrom = async (startIndex: number, confirmedIds: Set<string>, acc: WizardFileResult[]) => {
    setRunning(true)
    setClosureHold(null)
    for (let index = startIndex; index < orderedFiles.length; index += 1) {
      const file = orderedFiles[index]
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
    setResults([])
    setConflicts([])
    setShowConflicts(false)
    setPageError(null)
    setProgress(null)
    setClosureHold(null)
  }

  const block = step === 'arquivos' ? arquivosBlock(files, detecting) : null
  const percent = progress ? importBatchPercent(progress.fileIndex, progress.fileCount, progress.fraction) : 0
  const unmappedTotal = results.reduce((sum, result) => sum + result.unmapped, 0)

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <CadastroListPageShell>
        <CadastroListPageBody
          header={
            <CadastroListPageHero
              icon={<FileUp className="h-8 w-8" />}
              title="Importar"
              subtitle="Uma leva, vários tipos. O ajuste de tag, subtag ou compartilhamento vale para todos os arquivos."
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
                  {step === 'resultado' ? (
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
                      disabled={Boolean(block) || running}
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
                      onClick={() => done && setStep(id)}
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
            <section className="space-y-4">
              <label
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center ${
                  dragOver
                    ? 'border-[var(--color-1)] bg-white dark:bg-gray-800'
                    : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'
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
                <Upload className="mb-2 h-6 w-6 text-[var(--color-1)]" />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                  Solte os arquivos ou clique para escolher
                </span>
                <span className="mt-1 text-xs text-gray-500">
                  Planilhas XLSX exportadas pelo Plumo. A fila entra nesta ordem: contas, tags, compartilhamentos,
                  cartões, mapeamentos, templates e extrato.
                </span>
                <input
                  type="file"
                  multiple
                  accept=".xlsx"
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files) void addFiles(event.target.files)
                    event.target.value = ''
                  }}
                />
              </label>

              {orderedFiles.length > 0 ? (
                <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
                  {orderedFiles.map((file) => (
                    <li
                      key={file.id}
                      className="flex flex-wrap items-center gap-3 bg-white px-4 py-3 dark:bg-gray-800"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{file.file.name}</p>
                        <p className="text-xs text-gray-500">
                          {KIND_LABEL[file.kind]}
                          {file.payrollPreview ? ` · ${file.payrollPreview}` : ''}
                          {isExcelKind(file.kind) ? ` · ${countParsedRows(file.parsedOriginal)} linhas` : ''}
                        </p>
                        {file.error && file.kind === 'blocked' ? (
                          <p className="mt-1 text-xs text-red-600 dark:text-red-300">{file.error}</p>
                        ) : null}
                      </div>
                      {file.needsPassword ? (
                        <input
                          type="password"
                          value={file.pdfPassword || ''}
                          placeholder="Senha do PDF"
                          className="w-40 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
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
                        <div className="flex gap-2">
                          <select
                            value={file.year || ''}
                            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
                            onChange={(event) =>
                              setFiles((prev) =>
                                prev.map((item) => (item.id === file.id ? { ...item, year: event.target.value } : item)),
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
                                prev.map((item) => (item.id === file.id ? { ...item, month: event.target.value } : item)),
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
                          className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
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
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                        onClick={() => {
                          setFiles((prev) => prev.filter((item) => item.id !== file.id))
                          setFileVersion((version) => version + 1)
                          setAdjustVersion(-1)
                        }}
                        aria-label="Remover arquivo"
                      >
                        <X size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {step === 'ajustes' ? (
            <section className="space-y-3">
              {omitClassification ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  Não há tags nem subtags na conta e nenhum arquivo de cadastro nesta leva. Os registros serão inseridos
                  sem esses valores.
                </p>
              ) : (
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Tag e subtag são ajustadas juntas.
                  {files.some((file) => file.kind === 'tags')
                    ? ' As opções vêm da conta e do arquivo de tags e subtags desta leva. Um nome que já está nesse arquivo vale como está.'
                    : ' As opções são as tags e subtags já cadastradas na conta.'}{' '}
                  Se só a subtag mudou, mantenha a tag e escolha a nova subtag. Se as duas mudaram, escolha a tag e
                  depois a subtag.
                </p>
              )}
              {adjustments.length > 0 ? (
              <ul className="space-y-3">
                {adjustments.map((row) => (
                  <li
                    key={row.key}
                    className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{adjustmentLabel(row)}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {row.total} registro(s) em {row.occurrences.length} arquivo(s):{' '}
                          {row.occurrences.map((item) => item.fileName).join(', ')}
                        </p>
                      </div>
                      <div className="w-full max-w-xl">
                        <ReplacementSelect
                          row={row}
                          lookup={classLookup ?? lookup}
                          onChange={(patch) =>
                            setAdjustments((prev) =>
                              prev.map((item) => (item.key === row.key ? { ...item, ...patch } : item)),
                            )
                          }
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              ) : null}
            </section>
          ) : null}

          {step === 'preview' ? (
            <section>
              <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
                A pré-visualização e a gravação seguem a ordem da fila: contas, tags, compartilhamentos, cartões,
                mapeamentos, templates e extrato.
              </p>
              {previewTab ? (
                <CadastroListPageTabs
                  tabs={excelKinds.map((kind) => ({
                    key: kind,
                    label: KIND_LABEL[kind],
                    count: files.filter((file) => file.kind === kind).length,
                  }))}
                  active={previewTab}
                  onChange={setPreviewTab}
                />
              ) : null}
              <div className="mt-4">
                {previewTab ? (
                  <PreviewPane kind={previewTab} slot={previews[previewTab]} files={orderedFiles} lookup={lookup} />
                ) : null}
              </div>
            </section>
          ) : null}

          {step === 'executar' ? (
            <section className="space-y-4">
              <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
                {orderedFiles.map((file, index) => {
                  const rows = countParsedRows(file.parsed)
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
    </div>
  )
}

const selectClass =
  'mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900'

function ReplacementSelect({
  row,
  lookup,
  onChange,
}: {
  row: AdjustmentRow
  lookup: MappingImportLookup | null
  onChange: (patch: Partial<Pick<AdjustmentRow, 'replacementId' | 'replacementTagId' | 'replacementSubtagId'>>) => void
}) {
  if (!lookup) return null
  if (row.kind === 'subtag') {
    const tagId = row.replacementTagId
    const subtags = lookup.subtags.filter((subtag) => {
      if (tagId == null || subtag.tag_id !== tagId) return false
      if (row.subtagType && subtag.type !== row.subtagType) return false
      return true
    })
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-gray-500">
          Tag
          <select
            value={tagId ?? ''}
            className={selectClass}
            onChange={(event) => {
              const nextTagId = event.target.value ? Number(event.target.value) : null
              const stillValid =
                nextTagId != null &&
                row.replacementSubtagId != null &&
                lookup.subtags.some(
                  (subtag) => subtag.id === row.replacementSubtagId && subtag.tag_id === nextTagId,
                )
              onChange({
                replacementTagId: nextTagId,
                replacementSubtagId: stillValid ? row.replacementSubtagId : null,
              })
            }}
          >
            <option value="">Escolher tag…</option>
            {lookup.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.id < 0 ? `${tag.name} · nesta leva` : tag.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-gray-500">
          Subtag
          <select
            value={row.replacementSubtagId ?? ''}
            disabled={tagId == null}
            className={selectClass}
            onChange={(event) =>
              onChange({ replacementSubtagId: event.target.value ? Number(event.target.value) : null })
            }
          >
            <option value="">{tagId == null ? 'Escolha a tag primeiro' : 'Escolher subtag…'}</option>
            {subtags.map((subtag) => (
              <option key={subtag.id} value={subtag.id}>
                {`${row.subtagType ? subtag.name : `${subtag.name} · ${subtag.type}`}${subtag.id < 0 ? ' · nesta leva' : ''}`}
              </option>
            ))}
          </select>
          {tagId != null && subtags.length === 0 ? (
            <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">
              Essa tag não tem subtag deste tipo.
            </span>
          ) : null}
        </label>
      </div>
    )
  }
  if (row.kind === 'tag') {
    return (
      <select
        value={row.replacementId ?? ''}
        className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
        onChange={(event) => onChange({ replacementId: event.target.value ? Number(event.target.value) : null })}
      >
        <option value="">Substituir pela tag…</option>
        {lookup.tags.map((tag) => (
          <option key={tag.id} value={tag.id}>
            {tag.id < 0 ? `${tag.name} · nesta leva` : tag.name}
          </option>
        ))}
      </select>
    )
  }
  return (
    <select
      value={row.replacementId ?? ''}
      className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
      onChange={(event) => onChange({ replacementId: event.target.value ? Number(event.target.value) : null })}
    >
      <option value="">Substituir pelo compartilhamento…</option>
      {lookup.partners.map((partner) => (
        <option key={partner.id} value={partner.id}>
          {partner.shared_account?.name || partner.shared_account?.description || `Parceiro ${partner.id}`}
        </option>
      ))}
    </select>
  )
}

function PreviewPane({
  kind,
  slot,
  files,
  lookup,
}: {
  kind: WizardKind
  slot: PreviewSlot | undefined
  files: WizardFile[]
  lookup: MappingImportLookup | null
}) {
  if (!slot || slot.loading) {
    return <p className="text-sm text-gray-500">Gerando pré-visualização…</p>
  }
  if (slot.error) {
    return <p className="text-sm text-red-600 dark:text-red-300">{slot.error}</p>
  }
  if (!slot.data) return null
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
  if (kind === 'extrato_export') {
    return <ExtratoVisualImportPreview data={slot.data as VisualImportPreviewData} />
  }
  return <CadastroImportPreview data={slot.data as CadastroImportPreviewData} />
}

async function importFile(
  file: WizardFile,
  confirmClosed: boolean,
  jobId: string,
  onProgress: (update: { processed: number; total: number; fraction: number }) => void,
  options: { autoRunRemap: boolean; overwriteSharing: boolean },
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

  if (file.kind === 'holerite' || file.kind === 'informe') {
    const form = new FormData()
    form.append('files', file.file)
    form.append('passwords', file.pdfPassword ?? '')
    const response = await postImportWithProgress<{ results: Array<{ status: string; message?: string | null; action?: string | null }> }>(
      '/api/payroll/import-pdfs',
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

  if (file.kind === 'extrato_bruto') {
    const form = new FormData()
    form.append('files', file.file)
    form.append('enable_tracing', 'false')
    const response = await postImportWithProgress<Record<string, unknown>>('/api/import/extrato', form, jobId, onProgress)
    return { result: rawResult(file, response.data) }
  }

  if (file.kind === 'fatura_bruta') {
    const form = new FormData()
    form.append('files', file.file)
    form.append('years', file.year || '')
    form.append('months', file.month || '')
    form.append('passwords', file.pdfPassword ?? '')
    form.append('save_conversion_txt', 'false')
    const response = await postImportWithProgress<Record<string, unknown>>('/api/import/cartao', form, jobId, onProgress)
    return { result: rawResult(file, response.data, true) }
  }

  if (file.kind === 'beneficio_csv') {
    if (!file.creditCardId) throw new Error('Selecione um cartão de benefícios.')
    const form = new FormData()
    form.append('file', file.file)
    const response = await postImportWithProgress<Record<string, unknown>>(
      `/api/benefit-card-statements/importar-csv?credit_card_id=${file.creditCardId}`,
      form,
      jobId,
      onProgress,
    )
    return { result: rawResult(file, response.data) }
  }

  throw new Error('Tipo de arquivo sem gravação.')
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
    issues: [],
    conflicts,
    unmapped,
  }
}
