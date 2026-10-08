import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { Upload, FileSpreadsheet, Eye } from 'lucide-react'
import {
  CadastroModalShell,
  CadastroModalHeader,
  CadastroModalBody,
  CadastroModalFooter,
} from './CadastroFormLayout'
import ClosureEditImpactDialog from './ClosureEditImpactDialog'
import ExtratoVisualImportPreview, { type VisualImportPreviewData } from './ExtratoVisualImportPreview'
import {
  ImportModalMessageBanner,
  type ImportModalMessageVariant,
} from './ImportPreviewShared'
import type { ClosureEditImpact } from '../types/closureEditImpact'
import { messageFromUnknownError } from '../utils/importModalMessages'
import { parseExtratoExportWorkbook, type ParsedExtratoWorkbook } from '../utils/parseExtratoExportWorkbook'
import {
  buildEditSuccessPayload,
  extractClosureImpactFromResponse,
  parseAxiosClosureConflict,
} from '../utils/closureEditImpact'
import type { ExpenseEditSuccessPayload } from '../utils/closureEditImpact'

export interface VisualImportIssue {
  source: string
  row: number
  reason: string
}

interface ExtratoVisualImportModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (result: ExpenseEditSuccessPayload & { issues?: VisualImportIssue[]; stats?: Record<string, number> }) => void
  /** @deprecated Erros e avisos são exibidos no modal. */
  onError?: (message: string) => void
}

export default function ExtratoVisualImportModal({
  isOpen,
  onClose,
  onSuccess,
}: ExtratoVisualImportModalProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedExtratoWorkbook | null>(null)
  const [preview, setPreview] = useState<VisualImportPreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [closureOpen, setClosureOpen] = useState(false)
  const [closureImpact, setClosureImpact] = useState<ClosureEditImpact | null>(null)
  const [banner, setBanner] = useState<{ message: string; variant: ImportModalMessageVariant } | null>(
    null,
  )

  const showBanner = (message: string, variant: ImportModalMessageVariant = 'error') => {
    setBanner({ message, variant })
  }

  const reset = () => {
    setFile(null)
    setParsed(null)
    setPreview(null)
    setClosureOpen(false)
    setClosureImpact(null)
    setBanner(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handlePickFile = async (f: File) => {
    setFile(f)
    setPreview(null)
    setBanner(null)
    try {
      const data = await parseExtratoExportWorkbook(f)
      setParsed(data)
      const total = data.bank_rows.length + data.benefit_rows.length
      if (total === 0) {
        showBanner('Nenhuma linha de extrato ou benefício encontrada na planilha.', 'warning')
      } else {
        showBanner(
          `${data.bank_rows.length} linha(s) de extrato e ${data.benefit_rows.length} de benefício prontas para importar.`,
          'info',
        )
      }
    } catch (e: unknown) {
      setParsed(null)
      showBanner(messageFromUnknownError(e, 'Arquivo inválido'))
    }
  }

  const runPreview = async () => {
    if (!parsed) return
    setPreviewLoading(true)
    setBanner(null)
    try {
      const response = await axios.post<VisualImportPreviewData>('/api/expenses/visual-import/preview', {
        bank_rows: parsed.bank_rows,
        benefit_rows: parsed.benefit_rows,
      })
      setPreview(response.data)
    } catch (error: unknown) {
      showBanner(messageFromUnknownError(error, 'Erro ao gerar pré-visualização'))
    } finally {
      setPreviewLoading(false)
    }
  }

  const submitImport = async (confirmClosed: boolean) => {
    if (!parsed) return
    setLoading(true)
    setBanner(null)
    try {
      const response = await axios.post('/api/expenses/visual-import', {
        bank_rows: parsed.bank_rows,
        benefit_rows: parsed.benefit_rows,
        confirm_closed_closure_impact: confirmClosed,
      })
      const impact = extractClosureImpactFromResponse(response.data)
      const payload = buildEditSuccessPayload(response.data.message, impact)
      onSuccess({
        ...payload,
        issues: response.data.issues,
        stats: response.data.stats,
      })
      handleClose()
    } catch (error: unknown) {
      const conflict = parseAxiosClosureConflict(error)
      if (conflict && !confirmClosed) {
        setClosureImpact(conflict)
        setClosureOpen(true)
        return
      }
      showBanner(messageFromUnknownError(error, 'Erro ao importar planilha'))
    } finally {
      setLoading(false)
    }
  }

  const totalRows = (parsed?.bank_rows.length || 0) + (parsed?.benefit_rows.length || 0)
  const footerBusy = loading
  const previewBusy = previewLoading || loading
  const canImport = Boolean(parsed && totalRows > 0 && !footerBusy)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (closureOpen) {
          setClosureOpen(false)
          return
        }
        handleClose()
        return
      }

      if (e.key !== 'Enter' || e.shiftKey) return
      if (closureOpen || footerBusy || !parsed || totalRows === 0) return

      const target = e.target as HTMLElement
      if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return

      e.preventDefault()
      void submitImport(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closureOpen, footerBusy, parsed, totalRows])

  if (!isOpen) return null

  return (
    <>
      <CadastroModalShell
        maxWidth={preview ? 'max-w-7xl' : 'max-w-lg'}
        maxHeight={preview ? 'max-h-[96vh]' : 'max-h-[92vh]'}
      >
        <CadastroModalHeader
          isEdit={false}
          title="Importar Excel"
          subtitle={
            preview
              ? 'Revise as mudanças antes de importar (fechamentos não entram na prévia)'
              : 'Use o arquivo gerado por Exportar Excel nesta tela'
          }
          onClose={handleClose}
          icon={<Upload size={18} />}
        />
        <CadastroModalBody>
          <div className="space-y-4">
            {banner ? (
              <ImportModalMessageBanner
                message={banner.message}
                variant={banner.variant}
                onDismiss={() => setBanner(null)}
              />
            ) : null}
            {!preview ? (
              <>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center dark:border-gray-600 dark:bg-gray-900/40">
                  <FileSpreadsheet className="mb-2 text-[var(--color-primary)]" size={32} />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                    {file ? file.name : 'Selecionar arquivo .xlsx'}
                  </span>
                  <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Mesmo formato do export (extrato e benefícios)
                  </span>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void handlePickFile(f)
                    }}
                  />
                </label>
                {parsed ? (
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {parsed.bank_rows.length} linha(s) de extrato · {parsed.benefit_rows.length} de benefício
                    {parsed.skipped_sheets.length > 0
                      ? ` · abas ignoradas: ${parsed.skipped_sheets.join(', ')}`
                      : ''}
                  </p>
                ) : null}
              </>
            ) : (
              <ExtratoVisualImportPreview data={preview} />
            )}
          </div>
        </CadastroModalBody>
        <CadastroModalFooter
          onClose={handleClose}
          onSave={() => void submitImport(false)}
          saving={loading}
          disabled={!canImport}
          saveLabel="Importar"
          secondaryActions={
            preview ? (
              <button
                type="button"
                disabled={previewBusy}
                onClick={() => setPreview(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                Voltar
              </button>
            ) : (
              <button
                type="button"
                disabled={!parsed || totalRows === 0 || previewBusy}
                onClick={() => void runPreview()}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                <Eye size={15} className={previewLoading ? 'animate-pulse' : undefined} />
                {previewLoading ? 'Analisando…' : 'Pré-visualizar'}
              </button>
            )
          }
        />
      </CadastroModalShell>

      <ClosureEditImpactDialog
        isOpen={isOpen && closureOpen}
        impact={closureImpact}
        onClose={() => setClosureOpen(false)}
        onConfirm={() => {
          setClosureOpen(false)
          void submitImport(true)
        }}
      />
    </>
  )
}
