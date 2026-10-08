import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { Upload, FileSpreadsheet, Eye } from 'lucide-react'
import {
  CadastroModalShell,
  CadastroModalHeader,
  CadastroModalBody,
  CadastroModalFooter,
} from './CadastroFormLayout'
import ClosureEditImpactDialog from './ClosureEditImpactDialog'
import MappingVisualImportPreview, {
  type MappingImportPreviewData,
} from './MappingVisualImportPreview'
import {
  ImportModalMessageBanner,
  type ImportModalMessageVariant,
} from './ImportPreviewShared'
import type { ClosureEditImpact } from '../types/closureEditImpact'
import { messageFromUnknownError } from '../utils/importModalMessages'
import { parseMappingExportWorkbook, type ParsedMappingImportRow } from '../utils/parseMappingExportWorkbook'
import {
  collectUnsavedManualRows,
  manualEntriesToTabRows,
  mergeManualEntriesFromPreview,
  validateManualRowSave,
  type ManualMappingRowEntry,
  type MappingImportLookup,
} from '../utils/mappingImportCorrections'
import {
  buildEditSuccessPayload,
  extractClosureImpactFromResponse,
  parseAxiosClosureConflict,
} from '../utils/closureEditImpact'
import type { ExpenseEditSuccessPayload } from '../utils/closureEditImpact'

interface MappingVisualImportModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (
    result: ExpenseEditSuccessPayload & {
      issues?: Array<{ row: number; reason: string }>
      stats?: Record<string, number>
    },
  ) => void
  /** @deprecated Erros e avisos são exibidos no modal. */
  onError?: (message: string) => void
}

export default function MappingVisualImportModal({
  isOpen,
  onClose,
  onSuccess,
}: MappingVisualImportModalProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedMappingImportRow[] | null>(null)
  const [preview, setPreview] = useState<MappingImportPreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [autoRunRemap, setAutoRunRemap] = useState(true)
  const [overwriteSharing, setOverwriteSharing] = useState(true)
  const [closureOpen, setClosureOpen] = useState(false)
  const [closureImpact, setClosureImpact] = useState<ClosureEditImpact | null>(null)
  const [banner, setBanner] = useState<{ message: string; variant: ImportModalMessageVariant } | null>(
    null,
  )
  const [lookup, setLookup] = useState<MappingImportLookup | null>(null)
  const [manualEntries, setManualEntries] = useState<Record<number, ManualMappingRowEntry>>({})

  const loadLookup = useCallback(async () => {
    try {
      const [tagsRes, subtagsRes, partnersRes] = await Promise.all([
        axios.get<Array<{ id: number; name: string }>>('/api/expenses/tags'),
        axios.get<
          Array<{ id: number; tag_id: number; name: string; type: string; tag_name: string | null }>
        >('/api/expenses/subtags'),
        axios.get('/api/expense-sharing/'),
      ])
      setLookup({
        tags: tagsRes.data,
        subtags: subtagsRes.data,
        partners: partnersRes.data,
      })
    } catch {
      setLookup(null)
      showBanner('Não foi possível carregar tags e compartilhamentos para validar correções.', 'warning')
    }
  }, [])

  const showBanner = (message: string, variant: ImportModalMessageVariant = 'error') => {
    setBanner({ message, variant })
  }

  const reset = () => {
    setFile(null)
    setParsed(null)
    setPreview(null)
    setClosureOpen(false)
    setClosureImpact(null)
    setAutoRunRemap(true)
    setOverwriteSharing(true)
    setBanner(null)
    setLookup(null)
    setManualEntries({})
    if (inputRef.current) inputRef.current.value = ''
  }

  const patchManualDraft = useCallback(
    (rowIndex: number, patch: Partial<ParsedMappingImportRow>) => {
      setManualEntries((prev) => {
        const entry = prev[rowIndex]
        if (!entry) return prev
        const draft = { ...entry.draft, ...patch }
        const updated: ManualMappingRowEntry = { ...entry, draft }
        const saveError = validateManualRowSave(updated, lookup)
        const newEntry: ManualMappingRowEntry = saveError
          ? { ...updated, saveError, saved: entry.saved }
          : { ...updated, saveError: null, saved: draft }
        if (!saveError) {
          setParsed((p) => p?.map((r) => (r.row_index === rowIndex ? draft : r)) ?? null)
        }
        return { ...prev, [rowIndex]: newEntry }
      })
    },
    [lookup],
  )

  useEffect(() => {
    if (!preview || !parsed?.length) return
    setManualEntries((prev) =>
      mergeManualEntriesFromPreview(prev, preview.issues ?? [], parsed, preview.corrections),
    )
  }, [preview, parsed])

  useEffect(() => {
    if (!lookup) return
    setManualEntries((prev) => {
      if (!Object.keys(prev).length) return prev
      const rowsToApply = new Map<number, ParsedMappingImportRow>()
      const next = { ...prev }
      for (const [key, entry] of Object.entries(prev)) {
        const rowIndex = Number(key)
        const saveError = validateManualRowSave(entry, lookup)
        if (saveError) {
          next[rowIndex] = { ...entry, saveError }
          continue
        }
        next[rowIndex] = { ...entry, saveError: null, saved: entry.draft }
        rowsToApply.set(rowIndex, entry.draft)
      }
      if (rowsToApply.size) {
        setParsed((p) =>
          p?.map((r) => (rowsToApply.has(r.row_index) ? rowsToApply.get(r.row_index)! : r)) ?? null,
        )
      }
      return next
    })
  }, [lookup])

  const handleClose = () => {
    reset()
    onClose()
  }

  const handlePickFile = async (f: File) => {
    setFile(f)
    setPreview(null)
    setManualEntries({})
    setBanner(null)
    try {
      const data = await parseMappingExportWorkbook(f)
      setParsed(data)
      if (data.length === 0) {
        showBanner('Nenhuma linha na aba Mapeamentos.', 'warning')
      } else {
        showBanner(`${data.length} mapeamento(s) prontos para importar.`, 'info')
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
      const response = await axios.post<MappingImportPreviewData>(
        '/api/expenses/mappings/visual-import/preview',
        { rows: parsed },
      )
      setPreview(response.data)
      void loadLookup()
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
      const response = await axios.post('/api/expenses/mappings/visual-import', {
        rows: parsed,
        auto_run_remap: autoRunRemap,
        overwrite_sharing: overwriteSharing,
        confirm_closed_closure_impact: confirmClosed,
      })
      const impact = extractClosureImpactFromResponse(response.data)
      const payload = buildEditSuccessPayload(response.data.message, impact)
      const manualUnsaved = collectUnsavedManualRows(manualEntries, lookup)
      const mergedIssues = [...(response.data.issues ?? []), ...manualUnsaved]
      onSuccess({
        ...payload,
        issues: mergedIssues.length ? mergedIssues : undefined,
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

  const rowCount = parsed?.length || 0
  const footerBusy = loading
  const previewBusy = previewLoading || loading
  const manualTabRows = manualEntriesToTabRows(manualEntries)
  const canImport = Boolean(parsed && rowCount > 0 && !footerBusy)

  const remapOptions = (
    <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-600">
      <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-800 dark:text-gray-100">
        <input
          type="checkbox"
          className="mt-1"
          checked={autoRunRemap}
          onChange={(e) => setAutoRunRemap(e.target.checked)}
        />
        <span>
          Rodar remapeamento após importar
          <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
            Aplica os mapeamentos importados aos lançamentos existentes (mesmo fluxo do botão Remapear).
          </span>
        </span>
      </label>
      {autoRunRemap ? (
        <label className="flex cursor-pointer items-center gap-2 pl-6 text-sm text-gray-800 dark:text-gray-100">
          <input
            type="checkbox"
            checked={overwriteSharing}
            onChange={(e) => setOverwriteSharing(e.target.checked)}
          />
          Sobrescrever compartilhamento nos lançamentos
        </label>
      ) : null}
    </div>
  )

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
      if (closureOpen || footerBusy || !parsed || rowCount === 0) return

      const target = e.target as HTMLElement
      if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return
      if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') return

      e.preventDefault()
      void submitImport(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closureOpen, footerBusy, parsed, rowCount])

  if (!isOpen) return null

  return (
    <>
      <CadastroModalShell maxWidth={preview ? 'max-w-7xl' : 'max-w-lg'} maxHeight="max-h-[96vh]">
        <CadastroModalHeader
          isEdit={false}
          title="Importar mapeamentos"
          subtitle={
            preview
              ? 'Revise antes de importar. Fechamentos só são validados na importação com remapeamento.'
              : 'Use o Excel gerado por Exportar Excel nesta tela'
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
                  <>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {parsed.length} linha(s) na aba Mapeamentos
                    </p>
                    {remapOptions}
                  </>
                ) : null}
              </>
            ) : (
              <>
                <MappingVisualImportPreview
                  data={preview}
                  parsedRows={parsed ?? []}
                  lookup={lookup}
                  manualTabRows={manualTabRows}
                  onPatchManualRow={patchManualDraft}
                />
                {remapOptions}
              </>
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
              <>
                {(preview.corrections?.length ?? 0) > 0 ? (
                  <button
                    type="button"
                    disabled={previewBusy}
                    onClick={() => void runPreview()}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
                  >
                    <Eye size={15} className={previewLoading ? 'animate-pulse' : undefined} />
                    {previewLoading ? 'Atualizando…' : 'Atualizar preview'}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={previewBusy}
                  onClick={() => setPreview(null)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  Voltar
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={!parsed || rowCount === 0 || previewBusy}
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
