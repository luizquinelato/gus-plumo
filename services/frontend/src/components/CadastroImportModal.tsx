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
import CadastroImportPreview, { type CadastroImportPreviewData } from './CadastroImportPreview'
import {
  ImportModalMessageBanner,
  type ImportModalMessageVariant,
} from './ImportPreviewShared'
import type { ClosureEditImpact } from '../types/closureEditImpact'
import { parseAxiosClosureConflict } from '../utils/closureEditImpact'
import { messageFromUnknownError } from '../utils/importModalMessages'

export interface CadastroImportModalConfig {
  title: string
  subtitleFile: string
  subtitlePreview: string
  apiPath: string
  parseFile: (file: File) => Promise<unknown>
  /** Se true, trata 409 com ClosureEditImpactDialog (ex.: remapeamento / extrato). */
  supportsClosedPeriodConfirm?: boolean
  buildApplyBody?: (parsed: unknown, confirmClosed: boolean) => Record<string, unknown>
}

interface CadastroImportModalProps {
  isOpen: boolean
  config: CadastroImportModalConfig
  onClose: () => void
  onSuccess: (message: string) => void
  /** @deprecated Erros e avisos são exibidos no modal; mantido só por compatibilidade. */
  onError?: (message: string) => void
}

export default function CadastroImportModal({
  isOpen,
  config,
  onClose,
  onSuccess,
  onError,
}: CadastroImportModalProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<unknown>(null)
  const [preview, setPreview] = useState<CadastroImportPreviewData | null>(null)
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
      setParsed(await config.parseFile(f))
      showBanner('Planilha lida. Revise na pré-visualização (opcional) ou clique em Importar.', 'info')
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
      const response = await axios.post<CadastroImportPreviewData>(
        `${config.apiPath}/preview`,
        parsed,
      )
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
      const body = config.buildApplyBody
        ? config.buildApplyBody(parsed, confirmClosed)
        : { ...(parsed as object), confirm_closed_closure_impact: confirmClosed }
      const response = await axios.post<{ message?: string }>(config.apiPath, body)
      onSuccess(response.data?.message ?? 'Importação concluída.')
      handleClose()
    } catch (error: unknown) {
      if (config.supportsClosedPeriodConfirm) {
        const conflict = parseAxiosClosureConflict(error)
        if (conflict && !confirmClosed) {
          setClosureImpact(conflict)
          setClosureOpen(true)
          return
        }
      }
      showBanner(messageFromUnknownError(error, 'Erro ao importar planilha'))
    } finally {
      setLoading(false)
    }
  }

  const footerBusy = loading
  const previewBusy = previewLoading || loading
  const canImport = Boolean(parsed && !footerBusy)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (closureOpen) {
          setClosureOpen(false)
          return
        }
        handleClose()
        return
      }
      if (e.key !== 'Enter' || e.shiftKey || closureOpen || footerBusy || !parsed) return
      const target = e.target as HTMLElement
      if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return
      e.preventDefault()
      void submitImport(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closureOpen, footerBusy, parsed])

  if (!isOpen) return null

  return (
    <>
      <CadastroModalShell maxWidth={preview ? 'max-w-7xl' : 'max-w-lg'} maxHeight="max-h-[96vh]">
        <CadastroModalHeader
          isEdit={false}
          title={config.title}
          subtitle={preview ? config.subtitlePreview : config.subtitleFile}
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
              </>
            ) : (
              preview && <CadastroImportPreview data={preview} />
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
                disabled={!parsed || previewBusy}
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
      {config.supportsClosedPeriodConfirm ? (
        <ClosureEditImpactDialog
          isOpen={isOpen && closureOpen}
          impact={closureImpact}
          onClose={() => setClosureOpen(false)}
          onConfirm={() => {
            setClosureOpen(false)
            void submitImport(true)
          }}
        />
      ) : null}
    </>
  )
}
