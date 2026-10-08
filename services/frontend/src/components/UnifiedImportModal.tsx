import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, Trash2, Landmark, CreditCard, FileText, Loader2, ClipboardCheck, Download, GripVertical, Gift, AlertTriangle, Briefcase } from 'lucide-react'
import { detectFileType, DetectedFileInfo, StatementIssuer, isPdfFileName, isSupportedImportFileName } from '../utils/fileTypeDetector'
import { applyBenefitCardMatchToConfigs } from '../utils/benefitCardFileMatch'
import { formatImportApiError } from '../utils/importErrorUtils'
import { useEscapeKey } from '../hooks/useEscapeKey'
import * as XLSX from 'xlsx'
import ConflictReviewModal from './ConflictReviewModal'
import PdfImportPasswordModal from './PdfImportPasswordModal'
import { ImportConflict, ConflictResolution } from '../types/importConflict'
import {
  CadastroModalShell,
  CadastroModalHeader,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroFormSection,
  cadastroFieldCls,
  cadastroOptionLabelCls,
  cadastroAccentControlCls,
} from './CadastroFormLayout'
import { ListPageTable } from './ListPageTable'
import {
  cadastroRowIconDangerCls,
  listPageTableRowHoverCls,
  listPageTableTdCls,
} from './CadastroListPageLayout'
import {
  ListTableDragCell,
  ListTableDragHeader,
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableStaticHeader,
} from './ListTableSelectColumns'

const importResultTableRowCls = `${listPageTableRowHoverCls} [&>td]:border-b [&>td]:border-gray-200 dark:[&>td]:border-gray-700`

const fileListTableRowCls = (isDragging: boolean, isDragOver: boolean) => {
  if (isDragging) return `${importResultTableRowCls} opacity-50`
  if (isDragOver) return `${importResultTableRowCls} bg-blue-50 dark:bg-blue-900/20 table-row-selected`
  return importResultTableRowCls
}

/** Select compacto na tabela de importação (sem `w-full` do cadastroFieldCls). */
const importConfigSelectCls =
  'box-border shrink-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs leading-tight text-gray-800 outline-none focus:border-[var(--color-1)] disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]'

/** Ano (4 dígitos) + mês por extenso (ex.: Setembro) na mesma linha. */
const importYearMonthRowCls = 'mx-auto flex w-[12.5rem] max-w-full justify-center gap-1.5'
const importYearSelectCls = `${importConfigSelectCls} w-[4.25rem]`
const importMonthSelectCls = `${importConfigSelectCls} w-[7.75rem]`
const importConfigFieldWideCls = `${importConfigSelectCls} w-[12.5rem] max-w-full truncate`


export type UnifiedImportModalCloseInfo = {
  /** Dados podem ter mudado (import concluído com sucesso) — pai pode atualizar em background. */
  dataChanged?: boolean
}

interface UnifiedImportModalProps {
  isOpen: boolean
  onClose: (info?: UnifiedImportModalCloseInfo) => void
}

interface FileConfig extends DetectedFileInfo {
  year?: string
  month?: string
  credit_card_id?: number
  /** Senha de abertura do PDF (não persistida). */
  pdfPassword?: string
}

function appendPdfPasswords(formData: FormData, configs: FileConfig[]) {
  configs.forEach((config) => formData.append('passwords', config.pdfPassword ?? ''))
}

type ImportProgressState = {
  jobId: string
  fileIndex: number
  fileCount: number
  fileName: string
  processed: number
  total: number
  /** 0–1 do arquivo corrente, somando leitura, transformação e gravação. */
  fraction: number
}

/** Cada arquivo vale 1/N. ``fraction`` já reparte as etapas dentro do arquivo. */
function importBatchPercent(fileIndex: number, fileCount: number, fraction: number): number {
  if (fileCount <= 0) return 0
  const within = Math.min(Math.max(fraction, 0), 1)
  return Math.min(100, ((fileIndex + within) / fileCount) * 100)
}

function ImportProgressBar({ progress }: { progress: ImportProgressState }) {
  const percent = importBatchPercent(
    progress.fileIndex,
    progress.fileCount,
    progress.fraction,
  )
  const percentLabel = percent.toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  return (
    <div
      className="mb-4"
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progresso da importação"
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-gray-800 dark:text-gray-100">
          Arquivo {progress.fileIndex + 1} de {progress.fileCount}
          <span className="font-normal text-gray-500 dark:text-gray-400"> · {progress.fileName}</span>
        </p>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--color-1)]">{percentLabel}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className="h-full rounded-full transition-[width] duration-150 ease-linear"
          style={{ width: `${percent}%`, backgroundColor: 'var(--color-1)' }}
        />
      </div>
      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
        {progress.total > 0
          ? `Linha ${progress.processed.toLocaleString('pt-BR')} de ${progress.total.toLocaleString('pt-BR')}`
          : 'Preparando arquivo…'}
      </p>
    </div>
  )
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
      const fraction = Number.isFinite(data.fraction)
        ? Number(data.fraction)
        : total > 0
          ? processed / total
          : 0
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
    return await axios.post<T>(url, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  } finally {
    stopped = true
    window.clearInterval(timer)
  }
}

interface PayrollClassifyResult {
  filename: string
  status: string
  doc_type?: 'payslip' | 'income_report' | null
  message?: string | null
  employee_name?: string | null
  employer_name?: string | null
  payer_name?: string | null
  beneficiary_name?: string | null
  reference_label?: string | null
  payslip_kind?: string | null
  year?: number | null
  month?: number | null
  calendar_year?: number | null
}

interface PayrollImportFileResult {
  filename: string
  status: string
  message?: string | null
  action?: string | null
}

const MONTH_PREVIEW = [
  '',
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

const isPayrollType = (type: FileConfig['detectedType']) => type === 'holerite' || type === 'informe'

const payslipKindLabel = (kind?: string | null) => {
  if (kind === 'advance') return 'Adiantamento'
  if (kind === 'final') return 'Folha final'
  if (kind === 'regular') return 'Mensal'
  if (kind === 'profit_share') return 'Participação nos lucros'
  return null
}

const payrollPreviewFromClassify = (classified: PayrollClassifyResult) => {
  if (classified.doc_type === 'income_report') {
    return [
      classified.payer_name,
      classified.calendar_year ? `Ano-calendário ${classified.calendar_year}` : null,
      classified.beneficiary_name,
    ].filter(Boolean).join(' • ') || 'Informe detectado'
  }
  const kind = payslipKindLabel(classified.payslip_kind)
  const period =
    classified.year && classified.month
      ? `${MONTH_PREVIEW[classified.month] || classified.month} ${classified.year}`
      : classified.reference_label
  return [classified.employer_name, kind, period].filter(Boolean).join(' • ') || 'Holerite detectado'
}

interface ImportResult {
  fileName: string
  success: boolean
  created: number
  skipped: number
  duplicates?: number
  errors: string[]
  isPdf?: boolean
  emptyInvoice?: boolean
  message?: string
  skippedRows?: any[]  // Dados completos das linhas ignoradas
  updatedRows?: Array<Record<string, string | number>>  // DE-PARA dos atualizados (extrato)
  policyIgnoredRows?: Array<{ data: string; transacao: string; descricao: string; valor: number; motivo?: string }>
  policyIgnoredCount?: number
  conflicts_count?: number  // Número de conflitos detectados neste arquivo
  conversionTxtUrl?: string
  conversionTxtFilename?: string
}

const UnifiedImportModal = ({ isOpen, onClose }: UnifiedImportModalProps) => {
  const [fileConfigs, setFileConfigs] = useState<FileConfig[]>([])
  const [isDetecting, setIsDetecting] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null)
  const [results, setResults] = useState<ImportResult[]>([])
  const [error, setError] = useState<string | null>(null)

  // Contador de registros não mapeados
  const [totalUnmapped, setTotalUnmapped] = useState(0)

  // Cartões de benefícios
  const [benefitCards, setBenefitCards] = useState<Array<{id: number, name: string, number: string}>>([])
  const benefitCardsRef = useRef(benefitCards)
  benefitCardsRef.current = benefitCards

  // Estados para drag and drop
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Estados para conflitos de importação
  const [conflicts, setConflicts] = useState<ImportConflict[]>([])
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [discardedConflicts, setDiscardedConflicts] = useState(0)
  const [resolvedConflicts, setResolvedConflicts] = useState(0)

  // Flag para ativar tracing/debug (gera JSON com detalhes)
  const [enableTracing, setEnableTracing] = useState(false)
  // Flag para salvar TXT da conversão PDF (somente faturas PDF)
  const [saveConversionTxt, setSaveConversionTxt] = useState(false)
  // Armazena dados de debug para salvar no final (após resolução/descarte de conflitos)
  const [importDebugData, setImportDebugData] = useState<Record<string, unknown> | null>(null)

  const [showPdfPasswordModal, setShowPdfPasswordModal] = useState(false)
  const [pdfPasswordQueue, setPdfPasswordQueue] = useState<FileConfig[]>([])
  const [pendingBaseConfigs, setPendingBaseConfigs] = useState<FileConfig[]>([])

  // Hook para fechar modal com ESC (apenas se não estiver processando)
  useEscapeKey(() => {
    if (!isProcessing && !isDetecting && !showPdfPasswordModal) {
      handleClose()
    }
  }, isOpen)

  // Hook para Enter/Space quando mostrar resultados
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        !showPdfPasswordModal &&
        (e.key === 'Enter' || e.key === ' ') &&
        results.length > 0 &&
        !isProcessing &&
        !isDetecting
      ) {
        e.preventDefault()
        handleClose()
      }
    }

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, results.length, isProcessing, isDetecting, showPdfPasswordModal])

  // Buscar cartões de benefícios ao abrir o modal
  useEffect(() => {
    if (isOpen) {
      // Buscar cartões de benefícios
      axios.get('/api/cartoes/')
        .then(response => {
          const cards = response.data.filter((card: any) => card.type === 'beneficios' && card.active)
          setBenefitCards(cards)
        })
        .catch(err => console.error('Erro ao buscar cartões de benefícios:', err))
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || benefitCards.length === 0) return
    setFileConfigs((prev) => {
      const next = applyBenefitCardMatchToConfigs(prev, benefitCards)
      const unchanged = next.every(
        (config, index) => config.credit_card_id === prev[index]?.credit_card_id,
      )
      return unchanged ? prev : next
    })
  }, [isOpen, benefitCards])

  const currentYear = new Date().getFullYear()
  const years = Array.from(new Set([
    ...Array.from({ length: 11 }, (_, i) => String(currentYear + 1 - i)),
    ...fileConfigs.map(config => config.year).filter((year): year is string => Boolean(year)),
  ])).sort((a, b) => Number(b) - Number(a))
  const months = [
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
    { value: '12', label: 'Dezembro' }
  ]

  const extratoBtgBadge = {
    text: 'BTG - Extrato',
    title: 'Extrato BTG Pactual (arquivo original)',
    className:
      'bg-[#C5D4EF] text-[#001E62] border border-[#001E62]/25 dark:bg-[#163875] dark:text-[#E8EEF7] dark:border-[#4A7BC8]/45',
  }

  const issuerBadge = (issuer?: StatementIssuer, label?: string) => {
    if (issuer === 'btg') {
      return {
        text: 'BTG - Cartão',
        title: 'Fatura BTG Pactual',
        className: 'bg-[#001E62] text-white dark:bg-[#0B3A8F] dark:text-white',
      }
    }
    if (issuer === 'mercadopago') {
      return {
        text: 'Mercado Pago',
        title: 'Fatura Mercado Pago',
        className: 'bg-[#FFE600] text-[#333333] dark:bg-[#FFE600] dark:text-[#1A1A1A]',
      }
    }
    return {
      text: label || 'Fatura',
      title: 'Fatura de cartão',
      className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    }
  }

  if (!isOpen) return null

  const finishPdfDetection = async (detectedConfigs: FileConfig[]) => {
    const pdfConfigs = detectedConfigs.filter((config) => isPdfFileName(config.file.name))
    if (pdfConfigs.length > 0) {
      let classifiedResults: PayrollClassifyResult[] = []
      try {
        const payrollForm = new FormData()
        pdfConfigs.forEach((config) => payrollForm.append('files', config.file))
        appendPdfPasswords(payrollForm, pdfConfigs)
        const classified = await axios.post<{ results: PayrollClassifyResult[] }>(
          '/api/payroll/classify-pdfs',
          payrollForm,
          { headers: { 'Content-Type': 'multipart/form-data' } },
        )
        classifiedResults = classified.data.results || []
      } catch (err) {
        console.error('Erro ao classificar PDFs de folha:', err)
      }

      const remainingPdfs: FileConfig[] = []
      pdfConfigs.forEach((config, index) => {
        const classified =
          classifiedResults.find((result) => result.filename === config.file.name) ||
          classifiedResults[index]
        if (classified?.status === 'ok' && (classified.doc_type === 'payslip' || classified.doc_type === 'income_report')) {
          config.detectedType = classified.doc_type === 'payslip' ? 'holerite' : 'informe'
          config.importSource = 'folha'
          config.needsYearMonth = false
          config.confidence = 'high'
          config.payrollPreview = payrollPreviewFromClassify(classified)
          config.detectionError = undefined
          return
        }
        remainingPdfs.push(config)
      })

      if (remainingPdfs.length > 0) {
        try {
          const formData = new FormData()
          remainingPdfs.forEach((config) => formData.append('files', config.file))
          appendPdfPasswords(formData, remainingPdfs)
          const response = await axios.post<{
            results: Array<{
              filename: string
              status: string
              issuer?: StatementIssuer
              issuer_label?: string
              year?: string
              month?: string
              card_last4?: string
              message?: string
            }>
          }>('/api/import/cartao/detect', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })

          const detectResults = response.data.results || []
          const detectByName = new Map(detectResults.map((result) => [result.filename, result]))
          remainingPdfs.forEach((config, index) => {
            const detected = detectByName.get(config.file.name) || detectResults[index]
            if (!detected || detected.status !== 'ok') {
              config.detectedType = 'pdf_unknown'
              config.importSource = 'folha'
              config.needsYearMonth = false
              config.detectionError =
                detected?.message || 'PDF não reconhecido como fatura, holerite ou informe'
              return
            }
            config.detectedType = 'fatura_bruta'
            config.importSource = 'fatura'
            config.needsYearMonth = true
            config.confidence = 'high'
            config.statementIssuer = detected.issuer || 'unknown'
            config.issuerLabel = detected.issuer_label
            config.cardLast4 = detected.card_last4 || undefined
            if (detected.year) config.year = String(detected.year)
            if (detected.month) config.month = String(detected.month).padStart(2, '0')
          })
        } catch (err) {
          console.error('Erro ao identificar emissor da fatura PDF:', err)
          remainingPdfs.forEach((config) => {
            config.detectedType = 'pdf_unknown'
            config.importSource = 'folha'
            config.needsYearMonth = false
            config.detectionError = 'Não foi possível identificar o PDF'
          })
        }
      }
    }

    detectedConfigs.sort((a, b) => a.file.name.localeCompare(b.file.name))
    setFileConfigs(applyBenefitCardMatchToConfigs(detectedConfigs, benefitCardsRef.current))
    setResults([])
  }

  const handlePdfPasswordCancel = () => {
    setShowPdfPasswordModal(false)
    setPdfPasswordQueue([])
    setPendingBaseConfigs([])
  }

  const handlePdfPasswordConfirm = (passwordsByFilename: Record<string, string>) => {
    const updated = pendingBaseConfigs.map((config) => {
      const pwd = passwordsByFilename[config.file.name]
      if (pwd) return { ...config, pdfPassword: pwd }
      return config
    })
    setShowPdfPasswordModal(false)
    setPdfPasswordQueue([])
    setPendingBaseConfigs([])
    setIsDetecting(true)
    void finishPdfDetection(updated)
      .catch(() => setError('Erro ao processar arquivos'))
      .finally(() => setIsDetecting(false))
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setIsDetecting(true)
    setError(null)

    try {
      const detectedConfigs: FileConfig[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        
        // Valida extensão
        const isValidFile = isSupportedImportFileName(file.name)

        if (!isValidFile) {
          setError(`Arquivo ${file.name} não é suportado. Use PDF, XLSX, XLS ou CSV.`)
          continue
        }

        try {
          const detected = await detectFileType(file)
          detectedConfigs.push(detected)
        } catch (err) {
          console.error(`Erro ao detectar tipo de ${file.name}:`, err)
          setError(`Erro ao processar ${file.name}`)
        }
      }

      if (detectedConfigs.length === 0) {
        setError('Nenhum arquivo válido foi selecionado')
        setIsDetecting(false)
        return
      }

      const pdfConfigs = detectedConfigs.filter((config) => isPdfFileName(config.file.name))
      if (pdfConfigs.length > 0) {
        try {
          const checkForm = new FormData()
          pdfConfigs.forEach((config) => checkForm.append('files', config.file))
          const checkResponse = await axios.post<{
            results: Array<{ filename: string; requires_password: boolean }>
          }>('/api/import/pdf/check-passwords', checkForm, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
          const lockedNames = new Set(
            (checkResponse.data.results || [])
              .filter((row) => row.requires_password)
              .map((row) => row.filename),
          )
          if (lockedNames.size > 0) {
            setPendingBaseConfigs(detectedConfigs)
            setPdfPasswordQueue(pdfConfigs.filter((c) => lockedNames.has(c.file.name)))
            setShowPdfPasswordModal(true)
            setIsDetecting(false)
            e.target.value = ''
            return
          }
        } catch (err) {
          console.error('Erro ao verificar senha dos PDFs:', err)
        }
      }

      await finishPdfDetection(detectedConfigs)
    } catch (err) {
      setError('Erro ao processar arquivos')
    } finally {
      setIsDetecting(false)
    }

    // Reseta o input
    e.target.value = ''
  }

  const handleRemoveFile = (index: number) => {
    setFileConfigs(fileConfigs.filter((_, i) => i !== index))
  }

  // Drag and Drop handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleDragLeave = () => {
    setDragOverIndex(null)
  }

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()

    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null)
      setDragOverIndex(null)
      return
    }

    const newConfigs = [...fileConfigs]
    const draggedItem = newConfigs[draggedIndex]

    // Remove o item da posição original
    newConfigs.splice(draggedIndex, 1)

    // Insere na nova posição
    newConfigs.splice(dropIndex, 0, draggedItem)

    setFileConfigs(newConfigs)
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleYearMonthChange = (index: number, field: 'year' | 'month', value: string) => {
    const updated = [...fileConfigs]
    updated[index] = { ...updated[index], [field]: value }
    setFileConfigs(updated)
  }

  const handleCardChange = (index: number, cardId: number) => {
    const updated = [...fileConfigs]
    updated[index] = { ...updated[index], credit_card_id: cardId }
    setFileConfigs(updated)
  }

  const handleUpload = async () => {
    if (fileConfigs.length === 0) {
      setError('Por favor, selecione pelo menos um arquivo')
      return
    }

    // NOTA: Não precisa mais validar account_id - todos os tipos usam o account_id do JWT

    const unrecognizedPdfs = fileConfigs.filter(config => config.detectedType === 'pdf_unknown')
    if (unrecognizedPdfs.length > 0) {
      setError('Remova os PDFs não reconhecidos antes de importar')
      return
    }

    const blockedExports = fileConfigs.filter(config => config.detectedType === 'export_nao_suportado')
    if (blockedExports.length > 0) {
      setError(
        blockedExports.find((config) => config.detectionError)?.detectionError
          ?? 'Remova planilhas exportadas do Plumo — use apenas arquivos originais do banco',
      )
      return
    }

    // Valida se PDFs de fatura têm ano/mês
    const pdfsWithoutYearMonth = fileConfigs.filter(
      config => config.needsYearMonth && (!config.year || !config.month)
    )
    if (pdfsWithoutYearMonth.length > 0) {
      setError('Por favor, preencha ano e mês para todos os arquivos PDF de fatura')
      return
    }

    // Valida se CSVs de benefícios têm cartão selecionado
    const csvsWithoutCard = fileConfigs.filter(
      config => config.detectedType === 'beneficio_csv' && !config.credit_card_id
    )
    if (csvsWithoutCard.length > 0) {
      setError('Por favor, selecione um cartão de benefícios para todos os arquivos CSV')
      return
    }

    setIsProcessing(true)
    setError(null)
    setResults([])
    setTotalUnmapped(0)

    const uploadResults: ImportResult[] = []
    let totalUnmappedCount = 0

    try {
      for (let fileIndex = 0; fileIndex < fileConfigs.length; fileIndex++) {
        const config = fileConfigs[fileIndex]
        const jobId = crypto.randomUUID()
        const onProgress = (update: { processed: number; total: number; fraction: number }) => {
          setImportProgress((current) => {
            if (!current || current.jobId !== jobId) return current
            if (update.fraction + 1e-6 < current.fraction) return current
            return { ...current, ...update }
          })
        }
        setImportProgress({
          jobId,
          fileIndex,
          fileCount: fileConfigs.length,
          fileName: config.file.name,
          processed: 0,
          total: 0,
          fraction: 0,
        })

        if (isPayrollType(config.detectedType)) {
          try {
            const formData = new FormData()
            formData.append('files', config.file)
            formData.append('passwords', config.pdfPassword ?? '')
            const response = await postImportWithProgress<{ results: PayrollImportFileResult[] }>(
              '/api/payroll/import-pdfs',
              formData,
              jobId,
              onProgress,
            )
            const hit = (response.data.results || [])[0]
            if (!hit || hit.status !== 'ok') {
              uploadResults.push({
                fileName: config.file.name,
                success: false,
                created: 0,
                skipped: 0,
                errors: [hit?.message || 'Erro ao importar PDF'],
              })
            } else {
              uploadResults.push({
                fileName: config.file.name,
                success: true,
                created: hit.action === 'created' ? 1 : 0,
                skipped: 0,
                duplicates: hit.action === 'updated' ? 1 : 0,
                errors: [],
              })
            }
          } catch (err: any) {
            uploadResults.push({
              fileName: config.file.name,
              success: false,
              created: 0,
              skipped: 0,
              errors: formatImportApiError(err.response?.data?.detail ?? 'Erro ao importar holerites e informes'),
            })
          }
          continue
        }
        if (config.detectedType === 'pdf_unknown') {
          uploadResults.push({
            fileName: config.file.name,
            success: false,
            created: 0,
            skipped: 0,
            errors: [config.detectionError || 'PDF não reconhecido'],
          })
          continue
        }

        try {
          let result: any

          // 1. Extrato Bruto (XLSX) → /api/import/extrato
          // NOTA: account_id vem automaticamente do JWT (não precisa enviar)
          if (config.detectedType === 'extrato_bruto') {
            const formData = new FormData()
            formData.append('files', config.file)
            formData.append('enable_tracing', enableTracing ? 'true' : 'false')
            // account_id vem do JWT automaticamente

            const response = await postImportWithProgress<any>('/api/import/extrato', formData, jobId, onProgress)

            result = {
              fileName: config.file.name,
              success: response.data.success,
              created: response.data.linhas_salvas || 0,
              skipped: response.data.linhas_com_erro || 0,
              duplicates: response.data.linhas_atualizadas || 0,
              updatedRows: response.data.registros_atualizados_detalhe || [],
              skippedRows: response.data.linhas_ignoradas_detalhe || [],
              errors: [],
              policyIgnoredRows: response.data.linhas_ignoradas_politica || [],
              policyIgnoredCount: response.data.linhas_ignoradas_politica_count || 0,
              // Inclui conflitos detectados (tag/subtag ou valor diferente)
              conflicts: response.data.conflicts || [],
              conflicts_count: response.data.conflicts_count || 0
            }

            // Armazena dados de debug para salvar no final (se tracing ativo)
            if (enableTracing && response.data.debug_data) {
              setImportDebugData(response.data.debug_data)
            }

            // Conta registros não mapeados
            if (response.data.linhas_nao_mapeadas > 0) {
              totalUnmappedCount += response.data.linhas_nao_mapeadas
            }
          }

          // 2. Fatura Bruta (PDF) → /api/import/cartao
          else if (config.detectedType === 'fatura_bruta') {
            const formData = new FormData()
            formData.append('files', config.file)
            formData.append('years', config.year!)
            formData.append('months', config.month!)
            formData.append('passwords', config.pdfPassword ?? '')
            formData.append('save_conversion_txt', saveConversionTxt ? 'true' : 'false')
            // Não envia account_id - os cartões são identificados automaticamente do PDF

            const response = await postImportWithProgress<any>('/api/import/cartao', formData, jobId, onProgress)

            const conversionTxt = response.data?.conversion_txt?.[0]

            // Fatura salva direto no banco
            result = {
              fileName: config.file.name,
              success: true,
              created: response.data?.linhas_salvas || 0,
              skipped: 0,
              duplicates: response.data?.linhas_atualizadas || 0,
              errors: [],
              isPdf: true, // Flag para identificar PDFs
              emptyInvoice: Boolean(response.data?.empty_invoice),
              message: response.data?.message,
              // Inclui conflitos detectados (tag/subtag ou valor diferente)
              conflicts: response.data?.conflicts || [],
              conflicts_count: response.data?.conflicts_count || 0,
              conversionTxtUrl: conversionTxt?.download_url,
              conversionTxtFilename: conversionTxt?.download_filename,
            }

            // Conta registros não mapeados do PDF
            if (response.data?.linhas_nao_mapeadas > 0) {
              totalUnmappedCount += response.data.linhas_nao_mapeadas
            }
          }

          // 3. CSV de Benefícios (bruto) → /api/benefit-card-statements/importar-csv
          else if (config.detectedType === 'beneficio_csv') {
            if (!config.credit_card_id) {
              throw new Error('Selecione um cartão de benefícios')
            }

            const formData = new FormData()
            formData.append('file', config.file)
            // account_id vem automaticamente do JWT (não precisa enviar)

            const response = await postImportWithProgress<any>(
              `/api/benefit-card-statements/importar-csv?credit_card_id=${config.credit_card_id}`,
              formData,
              jobId,
              onProgress,
            )

            result = {
              fileName: config.file.name,
              success: true,
              created: response.data.registros_importados || 0,
              skipped: 0,
              // CSV retorna registros_atualizados (não registros_duplicados)
              duplicates: response.data.registros_atualizados || response.data.registros_duplicados || 0,
              errors: [],
              // Conflitos de benefícios
              conflicts: response.data.conflicts || [],
              conflicts_count: response.data.conflicts_count || 0
            }

            // Conta registros não mapeados de benefícios
            if (response.data.unmapped > 0) {
              totalUnmappedCount += response.data.unmapped
            }
          }

          else if (config.detectedType === 'export_nao_suportado') {
            throw new Error(config.detectionError || 'Planilha exportada não suportada')
          } else {
            throw new Error('Tipo de arquivo não suportado para importação')
          }

          uploadResults.push(result)
        } catch (err: any) {
          uploadResults.push({
            fileName: config.file.name,
            success: false,
            created: 0,
            skipped: 0,
            errors: formatImportApiError(err.response?.data?.detail)
          })
        }
      }

      setResults(uploadResults)
      setTotalUnmapped(totalUnmappedCount)

      // Verifica se há conflitos em algum resultado
      // Adiciona source_file a cada conflito para agrupar no modal
      const allConflicts: ImportConflict[] = []
      uploadResults.forEach(result => {
        if ((result as any).conflicts && Array.isArray((result as any).conflicts)) {
          const conflictsWithSource = (result as any).conflicts.map((c: ImportConflict) => ({
            ...c,
            source_file: result.fileName
          }))
          allConflicts.push(...conflictsWithSource)
        }
      })

      if (allConflicts.length > 0) {
        setConflicts(allConflicts)
        setShowConflictModal(true)
      }
    } catch (err: any) {
      setError('Erro ao processar arquivos')
    } finally {
      setImportProgress(null)
      setIsProcessing(false)
    }
  }

  // Função para resolver conflitos
  const handleResolveConflicts = async (resolutions: ConflictResolution[]) => {
    try {
      // Envia resoluções junto com dados de debug (se tracing ativo)
      await axios.post('/api/import/resolve-conflicts', {
        resolutions,
        debug_data: importDebugData  // Será null se tracing não estava ativo
      })
      const appliedCount = resolutions.filter(
        (r) => r.accept_tag_change || r.accept_amount_change,
      ).length
      setResolvedConflicts(appliedCount)
      setDiscardedConflicts(0)  // Limpa descartados pois foram resolvidos
      setConflicts([])
      setShowConflictModal(false)
      setImportDebugData(null)  // Limpa dados de debug após salvar
    } catch (error) {
      console.error('Erro ao resolver conflitos:', error)
      throw error
    }
  }

  // Função chamada quando usuário descarta os conflitos (cancela o modal de conflitos)
  const handleDiscardConflicts = async () => {
    const count = conflicts.length

    // Se tracing estava ativo, salva o debug JSON com status "descartado"
    if (importDebugData) {
      try {
        await axios.post('/api/import/save-debug', {
          debug_data: importDebugData,
          discarded_count: count,
          reason: 'user_cancelled'
        })
      } catch (error) {
        console.error('Erro ao salvar debug de conflitos descartados:', error)
      }
      setImportDebugData(null)  // Limpa dados de debug
    }

    setDiscardedConflicts(count)
    setResolvedConflicts(0)  // Limpa resolvidos pois foram descartados
    setConflicts([])
    setShowConflictModal(false)
  }

  const handleClose = () => {
    if (!isProcessing) {
      const dataChanged =
        results.length > 0 &&
        results.some((r) => r.success && (r.created > 0 || (r.skipped ?? 0) > 0 || (r.duplicates ?? 0) > 0))
      setFileConfigs([])
      setResults([])
      setError(null)
      setConflicts([])
      setShowConflictModal(false)
      setDiscardedConflicts(0)
      setResolvedConflicts(0)
      setEnableTracing(false)  // Reseta checkbox de tracing
      setSaveConversionTxt(false)  // Reseta checkbox de TXT de conversão PDF
      setImportDebugData(null)  // Limpa dados de debug
      setShowPdfPasswordModal(false)
      setPdfPasswordQueue([])
      setPendingBaseConfigs([])
      onClose(dataChanged ? { dataChanged: true } : undefined)
    }
  }

  const downloadPolicyIgnoredRecords = (result: ImportResult) => {
    if (!result.policyIgnoredRows || result.policyIgnoredRows.length === 0) {
      return
    }
    const ws = XLSX.utils.json_to_sheet(result.policyIgnoredRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Ignorados')
    const originalName = result.fileName.replace(/\.(xlsx|xls)$/i, '')
    XLSX.writeFile(wb, `${originalName}_saque_negado_ignorados.xlsx`)
  }

  const downloadSkippedRecords = (result: ImportResult) => {
    if (!result.skippedRows || result.skippedRows.length === 0) {
      return
    }

    // Cria worksheet com os dados ignorados
    const ws = XLSX.utils.json_to_sheet(result.skippedRows)

    // Cria workbook
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Registros Ignorados')

    // Gera nome do arquivo
    const originalName = result.fileName.replace(/\.(xlsx|xls)$/i, '')
    const fileName = `${originalName}_IGNORADOS.xlsx`

    // Download
    XLSX.writeFile(wb, fileName)
  }

  const downloadUpdatedRecords = (result: ImportResult) => {
    if (!result.updatedRows || result.updatedRows.length === 0) {
      return
    }

    const ws = XLSX.utils.json_to_sheet(result.updatedRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'DE-PARA')
    const originalName = result.fileName.replace(/\.(xlsx|xls)$/i, '')
    XLSX.writeFile(wb, `${originalName}_ATUALIZADOS_DE-PARA.xlsx`)
  }

  const downloadConversionTxt = async (result: ImportResult) => {
    if (!result.conversionTxtUrl) {
      return
    }

    try {
      const response = await axios.get(result.conversionTxtUrl, {
        responseType: 'blob',
      })
      const blob = new Blob([response.data], { type: 'text/plain;charset=utf-8' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.conversionTxtFilename || `${result.fileName.replace(/\.pdf$/i, '')}_conversao.txt`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Erro ao baixar TXT de conversão:', err)
      setError('Erro ao baixar arquivo TXT de conversão do PDF')
    }
  }

  const hasPDFs = fileConfigs.some(config => config.needsYearMonth)
  const hasPayrollFiles = fileConfigs.some(config => isPayrollType(config.detectedType) || config.detectedType === 'pdf_unknown')
  const hasUnrecognized = fileConfigs.some(config => config.detectedType === 'pdf_unknown')
  const hasConfigColumn = hasPDFs || hasPayrollFiles || fileConfigs.some(f => f.detectedType === 'beneficio_csv')
  const showSelectedFilesTable = fileConfigs.length > 0 && results.length === 0

  const importErrorBanner = error ? (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
      <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
      <div className="flex-1">
        <p className="text-sm font-medium text-red-800 dark:text-red-200">Erro</p>
        <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error}</p>
      </div>
    </div>
  ) : null

  return (
    <>
      <CadastroModalShell maxWidth="max-w-6xl">
        <CadastroModalHeader
          isEdit={false}
          title="Importar Arquivos"
          subtitle="Extratos, faturas, benefícios, holerites e informes"
          onClose={handleClose}
          icon={<Upload size={18} />}
        />
        <CadastroModalBody
          chrome={isProcessing && importProgress ? <ImportProgressBar progress={importProgress} /> : undefined}
        >
          <CadastroFormSection title="Selecionar Arquivos" icon={<Upload size={14} />}>
            <div className="rounded-lg border-2 border-dashed border-gray-300 p-6 text-center dark:border-gray-600">
              <input
                type="file"
                accept=".xlsx,.xls,.pdf,.csv,application/pdf"
                onChange={handleFileSelect}
                disabled={isProcessing || isDetecting}
                className="hidden"
                id="unified-file-input"
                multiple
              />
              <label
                htmlFor="unified-file-input"
                className={`cursor-pointer ${isProcessing || isDetecting ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                {isDetecting ? (
                  <Loader2 className="mx-auto mb-3 h-12 w-12 animate-spin text-[var(--color-1)]" />
                ) : (
                  <Upload className="mx-auto mb-3 h-12 w-12 text-gray-400" />
                )}
                <p className="mb-1 text-sm text-gray-600 dark:text-gray-400">
                  {isDetecting ? 'Detectando tipos de arquivo...' : 'Clique para selecionar ou arraste os arquivos'}
                </p>
                <p className="text-xs text-gray-500">
                  PDF (fatura, holerite ou informe), Excel (.xlsx, .xls), CSV — múltiplos arquivos
                </p>
              </label>
            </div>
            {error && !showSelectedFilesTable ? importErrorBanner : null}
          </CadastroFormSection>

          {showSelectedFilesTable ? (
            <CadastroFormSection title={`Arquivos Selecionados (${fileConfigs.length})`} icon={<FileSpreadsheet size={14} />}>
              <ListPageTable
                framed
                leadingPrefixCol
                minWidth={hasConfigColumn ? 836 : 656}
                colsRest={
                  <>
                    <ListTableSpacerCol />
                    <col />
                    <col style={{ width: 140, minWidth: 140 }} />
                    <col style={{ width: 100, minWidth: 100 }} />
                    {hasConfigColumn ? <col style={{ width: 220, minWidth: 220 }} /> : null}
                    <col style={{ width: 72, minWidth: 72 }} />
                  </>
                }
                head={
                  <tr>
                    <ListTableDragHeader />
                    <ListTableIndexHeader />
                    <ListTableSpacerHeader />
                    <ListTableStaticHeader label="Arquivo" />
                    <ListTableStaticHeader label="Tipo" className="w-[140px] text-center" />
                    <ListTableStaticHeader label="Importar" className="w-[100px] text-center" />
                    {hasConfigColumn ? (
                      <ListTableStaticHeader label="Config" className="w-[220px] text-center" />
                    ) : null}
                    <ListTableStaticHeader label="Ação" className="w-[72px] text-center" />
                  </tr>
                }
              >
                    {fileConfigs.map((config, index) => {
                      const isPDF = isPdfFileName(config.file.name)
                      const icon = isPDF ? FileText : FileSpreadsheet
                      const Icon = icon
                      const isDragging = draggedIndex === index
                      const isDragOver = dragOverIndex === index
                      const badge = issuerBadge(config.statementIssuer, config.issuerLabel)

                      return (
                        <tr
                          key={index}
                          draggable={!isProcessing}
                          onDragStart={() => handleDragStart(index)}
                          onDragOver={(e) => handleDragOver(e, index)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, index)}
                          onDragEnd={handleDragEnd}
                          className={fileListTableRowCls(isDragging, isDragOver)}
                        >
                          <ListTableDragCell>
                            <div
                              className={isProcessing ? 'cursor-not-allowed opacity-30' : 'cursor-grab active:cursor-grabbing'}
                              title="Arrastar para reordenar"
                            >
                              <GripVertical className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                            </div>
                          </ListTableDragCell>
                          <ListTableIndexCell index={index + 1} />
                          <ListTableSpacerCell />

                          <td className={listPageTableTdCls}>
                            <div className="flex min-w-0 items-center gap-2">
                              <Icon className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-400" />
                              <span className="truncate text-sm text-gray-900 dark:text-white" title={config.file.name}>
                                {config.file.name}
                              </span>
                            </div>
                          </td>

                          <td className={`${listPageTableTdCls} text-center`}>
                            {config.detectedType === 'holerite' ? (
                              <span
                                className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-medium min-w-[100px]"
                                style={{ background: 'var(--color-1)', color: 'var(--on-color-1)' }}
                              >
                                Holerite
                              </span>
                            ) : config.detectedType === 'informe' ? (
                              <span
                                className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-medium min-w-[100px]"
                                style={{ background: 'var(--color-2)', color: 'var(--on-color-2)' }}
                              >
                                Informe
                              </span>
                            ) : config.detectedType === 'pdf_unknown' ? (
                              <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-medium min-w-[100px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                                Não reconhecido
                              </span>
                            ) : config.detectedType === 'export_nao_suportado' ? (
                              <span
                                className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-medium min-w-[100px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                                title={config.detectionError}
                              >
                                Export Plumo
                              </span>
                            ) : config.detectedType === 'fatura_bruta' ? (
                              <span
                                className={`inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium min-w-[100px] ${badge.className}`}
                                title={[
                                  badge.title,
                                  config.cardLast4 ? `final ${config.cardLast4}` : null
                                ].filter(Boolean).join(' • ')}
                              >
                                {badge.text}
                              </span>
                            ) : config.detectedType === 'extrato_bruto' ? (
                              <span
                                className={`inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium min-w-[100px] ${extratoBtgBadge.className}`}
                                title={extratoBtgBadge.title}
                              >
                                {extratoBtgBadge.text}
                              </span>
                            ) : config.detectedType === 'beneficio_csv' ? (
                              <span
                                className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-medium min-w-[100px]"
                                style={{ background: 'var(--color-3)', color: 'var(--on-color-3)' }}
                              >
                                Benefício CSV
                              </span>
                            ) : (
                              <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-medium min-w-[100px] bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                —
                              </span>
                            )}
                          </td>

                          <td className={`${listPageTableTdCls} text-center`}>
                            <div className="flex justify-center">
                              {isPayrollType(config.detectedType) ? (
                                <Briefcase
                                  size={22}
                                  style={{ color: config.detectedType === 'holerite' ? 'var(--color-1)' : 'var(--color-2)' }}
                                  className="cursor-default"
                                  title={config.detectedType === 'holerite' ? 'Holerite' : 'Informe de rendimento'}
                                />
                              ) : config.detectedType === 'pdf_unknown' ? (
                                <AlertTriangle
                                  size={22}
                                  style={{ color: 'var(--color-danger)' }}
                                  className="cursor-default"
                                  title="PDF não reconhecido"
                                />
                              ) : config.detectedType === 'export_nao_suportado' ? (
                                <AlertTriangle
                                  size={22}
                                  style={{ color: 'var(--color-danger)' }}
                                  className="cursor-default"
                                  title={config.detectionError || 'Export não suportado'}
                                />
                              ) : config.detectedType === 'beneficio_csv' ? (
                                <Gift
                                  size={22}
                                  style={{ color: 'var(--color-3)' }}
                                  className="cursor-default"
                                  title="Benefício"
                                />
                              ) : config.detectedType === 'fatura_bruta' ? (
                                <CreditCard
                                  size={22}
                                  style={{ color: 'var(--color-2)' }}
                                  className="cursor-default"
                                  title={badge.title}
                                />
                              ) : config.detectedType === 'extrato_bruto' ? (
                                <Landmark
                                  size={22}
                                  style={{ color: 'var(--color-1)' }}
                                  className="cursor-default"
                                  title="Extrato Bancário"
                                />
                              ) : null}
                            </div>
                          </td>

                          {/* Configuração (Ano/Mês para PDFs, Cartão para Benefícios) */}
                          {hasConfigColumn && (
                            <td className={`${listPageTableTdCls} text-center`}>
                              {isPayrollType(config.detectedType) ? (
                                <p className="truncate text-xs text-gray-600 dark:text-gray-300" title={config.payrollPreview}>
                                  {config.payrollPreview || '—'}
                                </p>
                              ) : config.detectedType === 'pdf_unknown' ? (
                                <p className="truncate text-xs text-red-600 dark:text-red-400" title={config.detectionError}>
                                  {config.detectionError || 'PDF não reconhecido'}
                                </p>
                              ) : config.detectedType === 'export_nao_suportado' ? (
                                <p className="truncate text-xs text-red-600 dark:text-red-400" title={config.detectionError}>
                                  {config.detectionError}
                                </p>
                              ) : config.needsYearMonth ? (
                                // PDFs: Ano/Mês
                                <div className={importYearMonthRowCls}>
                                  <select
                                    value={config.year || ''}
                                    onChange={(e) => handleYearMonthChange(index, 'year', e.target.value)}
                                    disabled={isProcessing}
                                    className={importYearSelectCls}
                                  >
                                    <option value="">Ano</option>
                                    {years.map((year) => (
                                      <option key={year} value={year}>
                                        {year}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={config.month || ''}
                                    onChange={(e) => handleYearMonthChange(index, 'month', e.target.value)}
                                    disabled={isProcessing}
                                    className={importMonthSelectCls}
                                  >
                                    <option value="">Mês</option>
                                    {months.map((month) => (
                                      <option key={month.value} value={month.value}>
                                        {month.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : config.detectedType === 'beneficio_csv' ? (
                                // CSVs de Benefícios: Cartão (mesma largura que Ano + gap + Mês)
                                <div className="flex justify-center">
                                  <select
                                    value={config.credit_card_id || ''}
                                    onChange={(e) => handleCardChange(index, parseInt(e.target.value))}
                                    disabled={isProcessing}
                                    className={importConfigFieldWideCls}
                                  >
                                    <option value="">Selecione...</option>
                                    {benefitCards.map(card => (
                                      <option key={card.id} value={card.id}>
                                        {card.name} ({card.number})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : (
                                // Outros: vazio
                                <div className="text-center">
                                  <span className="text-xs text-gray-400">-</span>
                                </div>
                              )}
                            </td>
                          )}

                          <td className={`${listPageTableTdCls} text-center`}>
                            <button
                              type="button"
                              onClick={() => handleRemoveFile(index)}
                              disabled={isProcessing}
                              className={cadastroRowIconDangerCls}
                              title="Remover arquivo"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
              </ListPageTable>
              {error ? <div className="mt-4">{importErrorBanner}</div> : null}
            </CadastroFormSection>
          ) : null}

          {/* Resultados - só exibe quando não há conflitos pendentes */}
          {results.length > 0 && conflicts.length === 0 && (
            <CadastroFormSection
              title="Resultados da Importação"
              icon={<ClipboardCheck size={14} />}
              trailing={
                totalUnmapped > 0 ? (
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    {totalUnmapped} pendente(s)
                  </span>
                ) : undefined
              }
            >

              <div className="space-y-5">
                {results.map((result, index) => (
                  <div
                    key={index}
                    className={`space-y-4 p-4 rounded-lg border ${
                      result.success
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                        : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {result.success ? (
                        <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate mb-1.5">
                          {result.fileName}
                        </p>
                        {result.success ? (
                          result.isPdf ? (
                            // Mensagem específica para PDFs
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                              {result.created > 0 && (
                                <span className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                                  {result.created} lançamento(s) importado(s)
                                </span>
                              )}
                              {(result.duplicates ?? 0) > 0 && (
                                <span className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                  {result.duplicates} atualizado(s)
                                </span>
                              )}
                              {resolvedConflicts > 0 && (result.conflicts_count ?? 0) > 0 && (
                                <span className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                                  {result.conflicts_count} conflito(s) resolvido(s)
                                </span>
                              )}
                              {discardedConflicts > 0 && (result.conflicts_count ?? 0) > 0 && (
                                <span className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                                  {result.conflicts_count} conflito(s) descartado(s)
                                </span>
                              )}
                              {result.created === 0 && (result.duplicates ?? 0) === 0 && (result.conflicts_count ?? 0) === 0 && (
                                <span className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                                  {result.emptyInvoice
                                    ? 'Fatura sem compras para importar'
                                    : 'Nenhum lançamento novo'}
                                </span>
                              )}
                              {result.conversionTxtUrl && (
                                <span className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                                  TXT de conversão
                                  <button
                                    onClick={() => downloadConversionTxt(result)}
                                    className="ml-1 px-2 py-0.5 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded flex items-center gap-1 transition-colors"
                                    title="Baixar texto extraído do PDF"
                                  >
                                    <Download className="w-3 h-3" />
                                    Baixar
                                  </button>
                                </span>
                              )}
                            </div>
                          ) : (
                            // Mensagem para Excel/CSV
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                              {result.created > 0 && (
                                <span className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                                  {result.created} criado(s)
                                </span>
                              )}
                              {(result.duplicates ?? 0) > 0 && (
                                <span className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                  {result.duplicates} atualizado(s)
                                  {(result.updatedRows?.length ?? 0) > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => downloadUpdatedRecords(result)}
                                      className="ml-2 px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded flex items-center gap-1 transition-colors"
                                      title="Baixar DE-PARA dos registros atualizados"
                                    >
                                      <Download className="w-3 h-3" />
                                      Baixar
                                    </button>
                                  )}
                                </span>
                              )}
                              {resolvedConflicts > 0 && (result.conflicts_count ?? 0) > 0 && (
                                <span className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                                  {result.conflicts_count} conflito(s) resolvido(s)
                                </span>
                              )}
                              {discardedConflicts > 0 && (result.conflicts_count ?? 0) > 0 && (
                                <span className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                                  {result.conflicts_count} conflito(s) descartado(s)
                                </span>
                              )}
                              {result.skipped > 0 && (
                                <span className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                                  {result.skipped} ignorado(s)
                                  <button
                                    onClick={() => downloadSkippedRecords(result)}
                                    className="ml-2 px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white text-xs rounded flex items-center gap-1 transition-colors"
                                    title="Baixar registros ignorados em Excel"
                                  >
                                    <Download className="w-3 h-3" />
                                    Baixar
                                  </button>
                                </span>
                              )}
                              {(result.policyIgnoredCount ?? 0) > 0 && (
                                <span className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                  {result.policyIgnoredCount} &quot;Saque negado&quot; ignorado(s)
                                  <button
                                    type="button"
                                    onClick={() => downloadPolicyIgnoredRecords(result)}
                                    className="ml-2 px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white text-xs rounded flex items-center gap-1 transition-colors"
                                    title="Baixar linhas ignoradas (Saque negado)"
                                  >
                                    <Download className="w-3 h-3" />
                                    Baixar
                                  </button>
                                </span>
                              )}
                            </div>
                          )
                        ) : (
                          <div className="space-y-1.5 rounded-md border border-red-200 bg-white/60 p-3 dark:border-red-900/50 dark:bg-red-950/20">
                            <p className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
                              Falha na importação
                            </p>
                            {result.errors.map((error, i) => (
                              <p
                                key={i}
                                className={`text-sm leading-snug text-red-800 dark:text-red-200 ${
                                  error.startsWith('Motivo:') || error.startsWith('Dica:')
                                    ? 'font-medium'
                                    : ''
                                }`}
                              >
                                {error.startsWith('•') ? error : `• ${error}`}
                              </p>
                            ))}
                          </div>
                        )}
                        {(result.policyIgnoredCount ?? 0) > 0 && result.policyIgnoredRows && (
                          <div className="pt-1">
                            <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                              Linhas ignoradas (Saque negado)
                            </p>
                            <ListPageTable
                              framed
                              colsRest={<ListTableSpacerCol />}
                              head={
                                <tr>
                                  <ListTableIndexHeader />
                                  <ListTableSpacerHeader />
                                  <ListTableStaticHeader label="Data" className="w-[22%]" />
                                  <ListTableStaticHeader label="Transação" className="w-[22%]" />
                                  <ListTableStaticHeader label="Descrição" />
                                  <ListTableStaticHeader label="Valor" className="w-[18%] text-right" />
                                </tr>
                              }
                            >
                              {result.policyIgnoredRows.slice(0, 8).map((row, rowIndex) => (
                                <tr key={rowIndex} className={importResultTableRowCls}>
                                  <ListTableIndexCell index={rowIndex + 1} />
                                  <ListTableSpacerCell />
                                  <td className={`${listPageTableTdCls} whitespace-nowrap text-xs`}>{row.data}</td>
                                  <td className={`${listPageTableTdCls} whitespace-nowrap text-xs`}>{row.transacao}</td>
                                  <td className={`${listPageTableTdCls} max-w-0 truncate text-xs`} title={row.descricao}>
                                    {row.descricao}
                                  </td>
                                  <td className={`${listPageTableTdCls} text-right whitespace-nowrap text-xs tabular-nums`}>
                                    {typeof row.valor === 'number'
                                      ? row.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                                      : row.valor}
                                  </td>
                                </tr>
                              ))}
                            </ListPageTable>
                            {result.policyIgnoredRows.length > 8 && (
                              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                + {result.policyIgnoredRows.length - 8} linha(s) — use Baixar para ver todas.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Aviso de Curadoria */}
              {totalUnmapped > 0 && (
                <div className="mt-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-800/50 rounded-lg flex-shrink-0">
                      <ClipboardCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">
                        Próximo passo: Categorizar registros
                      </h4>
                      <p className="text-xs text-blue-700 dark:text-blue-300 mb-3">
                        {totalUnmapped} registro(s) não foram mapeados automaticamente.
                        Acesse a Curadoria para categorizá-los e manter suas finanças organizadas.
                      </p>
                      <a
                        href="/curadoria"
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors"
                      >
                        <ClipboardCheck className="w-4 h-4" />
                        Ir para Curadoria
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </CadastroFormSection>
          )}
        </CadastroModalBody>
        <CadastroModalFooter
          onClose={handleClose}
          onSave={results.length > 0 ? undefined : handleUpload}
          hideSave={results.length > 0}
          closeLabel={results.length > 0 ? 'Concluir' : 'Cancelar'}
          saveLabel={isProcessing ? 'Processando...' : `Importar${fileConfigs.length > 0 ? ` (${fileConfigs.length})` : ''}`}
          saving={isProcessing}
          disabled={fileConfigs.length === 0 || isDetecting || hasUnrecognized}
          saveIcon={isProcessing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          leading={
            results.length === 0 && fileConfigs.length > 0 ? (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <label className={`${cadastroOptionLabelCls} text-xs text-gray-600 dark:text-gray-400`}>
                    <input
                      type="checkbox"
                      checked={enableTracing}
                      onChange={(e) => setEnableTracing(e.target.checked)}
                      disabled={isProcessing || isDetecting}
                      className={`${cadastroAccentControlCls} h-3.5 w-3.5 rounded border-gray-300 disabled:opacity-50`}
                    />
                    Gerar log de debug (JSON com detalhes de cada linha)
                  </label>
                  {hasPDFs ? (
                    <label className={`${cadastroOptionLabelCls} text-xs text-gray-600 dark:text-gray-400`}>
                      <input
                        type="checkbox"
                        checked={saveConversionTxt}
                        onChange={(e) => setSaveConversionTxt(e.target.checked)}
                        disabled={isProcessing || isDetecting}
                        className={`${cadastroAccentControlCls} h-3.5 w-3.5 rounded border-gray-300 disabled:opacity-50`}
                      />
                      Salvar TXT da conversão do PDF (debug)
                    </label>
                  ) : null}
                </div>
                {hasUnrecognized ? (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    Remova os PDFs não reconhecidos para habilitar a importação.
                  </p>
                ) : null}
              </div>
            ) : hasUnrecognized && results.length === 0 ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                Remova os PDFs não reconhecidos para habilitar a importação.
              </p>
            ) : null
          }
        />
      </CadastroModalShell>

      {/* Modal de Revisão de Conflitos */}
      <ConflictReviewModal
        isOpen={showConflictModal}
        onClose={handleDiscardConflicts}
        conflicts={conflicts}
        onResolve={handleResolveConflicts}
      />

      <PdfImportPasswordModal
        isOpen={showPdfPasswordModal}
        files={pdfPasswordQueue.map((c) => ({ filename: c.file.name }))}
        onCancel={handlePdfPasswordCancel}
        onConfirm={handlePdfPasswordConfirm}
      />
    </>
  )
}

export default UnifiedImportModal

