import { useState, useEffect } from 'react'
import axios from 'axios'
import { X, Upload, FileSpreadsheet, AlertCircle, CheckCircle, Trash2, Landmark, CreditCard, FileText, Loader2, ClipboardCheck, Download, GripVertical, Gift, AlertTriangle } from 'lucide-react'
import { detectFileType, DetectedFileInfo } from '../utils/fileTypeDetector'
import { useEscapeKey } from '../hooks/useEscapeKey'
import * as XLSX from 'xlsx'
import ConflictReviewModal from './ConflictReviewModal'
import { ImportConflict, ConflictResolution } from '../types/importConflict'


interface UnifiedImportModalProps {
  isOpen: boolean
  onClose: () => void
}

interface FileConfig extends DetectedFileInfo {
  year?: string
  month?: string
  credit_card_id?: number
  forceRetag?: boolean  // Controle individual de forçar re-tageamento
}

interface ImportResult {
  fileName: string
  success: boolean
  created: number
  skipped: number
  duplicates?: number
  errors: string[]
  isPdf?: boolean
  skippedRows?: any[]  // Dados completos das linhas ignoradas
  conflicts_count?: number  // Número de conflitos detectados neste arquivo
}

const UnifiedImportModal = ({ isOpen, onClose }: UnifiedImportModalProps) => {
  const [fileConfigs, setFileConfigs] = useState<FileConfig[]>([])
  const [isDetecting, setIsDetecting] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [results, setResults] = useState<ImportResult[]>([])
  const [error, setError] = useState<string | null>(null)

  // Para PDFs
  const [globalYear, setGlobalYear] = useState('')

  // Contador de registros não mapeados
  const [totalUnmapped, setTotalUnmapped] = useState(0)

  // Cartões de benefícios
  const [benefitCards, setBenefitCards] = useState<Array<{id: number, name: string, number: string}>>([])

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
  // Armazena dados de debug para salvar no final (após resolução/descarte de conflitos)
  const [importDebugData, setImportDebugData] = useState<Record<string, unknown> | null>(null)

  // Hook para fechar modal com ESC (apenas se não estiver processando)
  useEscapeKey(() => {
    if (!isProcessing && !isDetecting) {
      handleClose()
    }
  }, isOpen)

  // Hook para Enter/Space quando mostrar resultados
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && results.length > 0 && !isProcessing && !isDetecting) {
        e.preventDefault()
        handleClose()
      }
    }

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, results.length, isProcessing, isDetecting])

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

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 10 }, (_, i) => currentYear - i)
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

  if (!isOpen) return null

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
        const isValidFile = file.name.endsWith('.pdf') ||
                           file.name.endsWith('.xlsx') ||
                           file.name.endsWith('.xls') ||
                           file.name.endsWith('.csv')

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

      // Ordenar alfabeticamente por nome do arquivo
      detectedConfigs.sort((a, b) => a.file.name.localeCompare(b.file.name))

      // Inicializa forceRetag: true para arquivos Excel processados
      const configsWithRetag = detectedConfigs.map(config => ({
        ...config,
        forceRetag: (config.detectedType === 'extrato_processado' || config.detectedType === 'fatura_processada' || config.detectedType === 'beneficio_xlsx') ? true : undefined
      }))

      // LIMPA BUFFER: Remove arquivos antigos e adiciona apenas os novos
      setFileConfigs(configsWithRetag)
      setResults([])
    } catch (err) {
      setError('Erro ao processar arquivos')
    } finally {
      setIsDetecting(false)
    }

    // Reseta o input
    e.target.value = ''
  }

  const handleTypeChange = (index: number, newSource: 'extrato' | 'fatura') => {
    const updated = [...fileConfigs]
    const config = updated[index]
    
    // PDF não pode mudar para extrato
    if (config.file.name.endsWith('.pdf') && newSource === 'extrato') {
      return
    }

    // Atualiza o tipo baseado na fonte
    if (newSource === 'extrato') {
      updated[index] = {
        ...config,
        importSource: 'extrato',
        detectedType: config.isRaw ? 'extrato_bruto' : 'extrato_processado'
      }
    } else {
      updated[index] = {
        ...config,
        importSource: 'fatura',
        detectedType: config.isRaw ? 'fatura_bruta' : 'fatura_processada'
      }
    }

    setFileConfigs(updated)
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

    // Valida se PDFs têm ano/mês
    const pdfsWithoutYearMonth = fileConfigs.filter(
      config => config.needsYearMonth && (!config.year || !config.month)
    )
    if (pdfsWithoutYearMonth.length > 0) {
      setError('Por favor, preencha ano e mês para todos os arquivos PDF')
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
      for (const config of fileConfigs) {
        try {
          let result: any

          // 1. Extrato Bruto (XLSX) → /api/import/extrato
          // NOTA: account_id vem automaticamente do JWT (não precisa enviar)
          if (config.detectedType === 'extrato_bruto') {
            const formData = new FormData()
            formData.append('files', config.file)
            formData.append('enable_tracing', enableTracing ? 'true' : 'false')
            // account_id vem do JWT automaticamente

            const response = await axios.post('/api/import/extrato', formData, {
              headers: { 'Content-Type': 'multipart/form-data' }
            })

            result = {
              fileName: config.file.name,
              success: response.data.success,
              created: response.data.linhas_salvas || 0,
              skipped: response.data.linhas_com_erro || 0,
              duplicates: response.data.linhas_atualizadas || 0,
              errors: [],
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
            formData.append('enable_tracing', enableTracing ? 'true' : 'false')
            // Não envia account_id - os cartões são identificados automaticamente do PDF

            const response = await axios.post('/api/import/cartao', formData, {
              headers: { 'Content-Type': 'multipart/form-data' }
            })

            // Fatura salva direto no banco
            result = {
              fileName: config.file.name,
              success: true,
              created: response.data?.linhas_salvas || 0,
              skipped: 0,
              duplicates: response.data?.linhas_atualizadas || 0,
              errors: [],
              isPdf: true, // Flag para identificar PDFs
              // Inclui conflitos detectados (tag/subtag ou valor diferente)
              conflicts: response.data?.conflicts || [],
              conflicts_count: response.data?.conflicts_count || 0
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

            const response = await axios.post(
              `/api/benefit-card-statements/importar-csv?credit_card_id=${config.credit_card_id}`,
              formData,
              { headers: { 'Content-Type': 'multipart/form-data' } }
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

          // 3b. Excel de Benefícios (processado) → /api/benefit-card-statements/importar-xlsx
          // NOTA: Não precisa selecionar cartão - identificado pelo arquivo (coluna "Cartão")
          else if (config.detectedType === 'beneficio_xlsx') {
            const formData = new FormData()
            formData.append('file', config.file)
            // account_id vem automaticamente do JWT (não precisa enviar)
            // credit_card_id é identificado automaticamente pela coluna "Cartão" no arquivo
            // Usa forceRetag individual do arquivo (padrão = true se não definido)
            formData.append('force_retag', (config.forceRetag ?? true).toString())

            const response = await axios.post(
              '/api/benefit-card-statements/importar-xlsx',
              formData,
              { headers: { 'Content-Type': 'multipart/form-data' } }
            )

            result = {
              fileName: config.file.name,
              success: true,
              created: response.data.registros_importados || 0,
              skipped: 0,
              // XLSX retorna registros_atualizados, CSV retorna registros_duplicados
              duplicates: response.data.registros_duplicados || response.data.registros_atualizados || 0,
              errors: [],
              // Inclui conflitos detectados (tag/subtag ou valor diferente)
              conflicts: response.data?.conflicts || [],
              conflicts_count: response.data?.conflicts_count || 0
            }

            // Conta registros não mapeados de benefícios
            if (response.data.unmapped > 0) {
              totalUnmappedCount += response.data.unmapped
            }
          }

          // 4. Excel Processado (Extrato ou Fatura) → /api/excel-import/upload
          else {
            const formData = new FormData()
            formData.append('file', config.file)
            formData.append('import_type', config.importSource)
            // Usa forceRetag individual do arquivo (padrão = true se não definido)
            formData.append('force_retag', (config.forceRetag ?? true).toString())

            // account_id vem automaticamente do JWT (não precisa enviar)

            const response = await axios.post('/api/excel-import/upload', formData, {
              headers: { 'Content-Type': 'multipart/form-data' }
            })

            result = {
              fileName: config.file.name,
              ...response.data
            }

            // Conta registros não mapeados
            if (response.data.unmapped) {
              totalUnmappedCount += response.data.unmapped
            }
          }

          uploadResults.push(result)
        } catch (err: any) {
          uploadResults.push({
            fileName: config.file.name,
            success: false,
            created: 0,
            skipped: 0,
            errors: [err.response?.data?.detail || 'Erro ao processar arquivo']
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
      // Marca quantos conflitos foram resolvidos (aceitos)
      setResolvedConflicts(conflicts.length)
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
      setFileConfigs([])
      setResults([])
      setError(null)
      setGlobalYear('')
      setConflicts([])
      setShowConflictModal(false)
      setDiscardedConflicts(0)
      setResolvedConflicts(0)
      setEnableTracing(false)  // Reseta checkbox de tracing
      setImportDebugData(null)  // Limpa dados de debug
      onClose()
    }
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

  const hasPDFs = fileConfigs.some(config => config.needsYearMonth)
  const hasExcel = fileConfigs.some(config => !config.needsYearMonth)

  return (
    <>
      <div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        onClick={handleClose}
      >
        <div
          className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-6xl w-full mx-4 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
          style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-[var(--color-1)] to-[var(--color-2)] rounded-lg">
                <Upload className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  Importar Arquivos
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Extratos bancários (XLSX) ou Faturas de cartão (PDF/XLSX)
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={isProcessing || isDetecting}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-50"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Upload de Arquivo */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Selecionar Arquivos
            </label>
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center">
              <input
                type="file"
                accept=".xlsx,.xls,.pdf,.csv"
                onChange={handleFileSelect}
                disabled={isProcessing || isDetecting}
                className="hidden"
                id="unified-file-input"
                multiple
              />
              <label
                htmlFor="unified-file-input"
                className={`cursor-pointer ${isProcessing || isDetecting ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isDetecting ? (
                  <Loader2 className="w-12 h-12 mx-auto mb-3 text-blue-500 animate-spin" />
                ) : (
                  <Upload className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                )}
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                  {isDetecting ? 'Detectando tipos de arquivo...' : 'Clique para selecionar ou arraste os arquivos'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-500">
                  PDF (faturas), Excel (.xlsx, .xls) - Múltiplos arquivos permitidos
                </p>
              </label>
            </div>
          </div>

          {/* Erro */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">Erro</p>
                <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Lista de Arquivos Selecionados */}
          {fileConfigs.length > 0 && results.length === 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Arquivos Selecionados ({fileConfigs.length})
                </label>

                {/* Botões de Ação em Massa (apenas para Excel) */}
                {hasExcel && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setFileConfigs(prev => prev.map(f =>
                        f.file.name.endsWith('.pdf') ? f : { ...f, importSource: 'extrato', detectedType: f.isRaw ? 'extrato_bruto' : 'extrato_processado' }
                      ))}
                      disabled={isProcessing}
                      style={{ backgroundColor: 'var(--color-1)', color: 'var(--on-color-1)' }}
                      className="px-3 py-1.5 text-xs font-medium hover:brightness-110 rounded-md shadow-sm transition-all disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Landmark className="w-3.5 h-3.5" />
                      <span>Todos: Extrato</span>
                    </button>
                    <button
                      onClick={() => setFileConfigs(prev => prev.map(f =>
                        f.file.name.endsWith('.pdf') ? f : { ...f, importSource: 'fatura', detectedType: f.isRaw ? 'fatura_bruta' : 'fatura_processada' }
                      ))}
                      disabled={isProcessing}
                      style={{ backgroundColor: 'var(--color-2)', color: 'var(--on-color-2)' }}
                      className="px-3 py-1.5 text-xs font-medium hover:brightness-110 rounded-md shadow-sm transition-all disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>Todos: Fatura</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Toggle Global: Forçar Re-tageamento (apenas para Excel processado) */}
              {fileConfigs.some(f => f.detectedType === 'extrato_processado' || f.detectedType === 'fatura_processada' || f.detectedType === 'beneficio_xlsx') && (
                <div className="mb-3 p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <label className="flex items-center gap-2 cursor-pointer" title="Marcar/Desmarcar todos os arquivos processados para forçar re-tageamento">
                    <input
                      type="checkbox"
                      checked={fileConfigs.filter(f => f.detectedType === 'extrato_processado' || f.detectedType === 'fatura_processada' || f.detectedType === 'beneficio_xlsx').every(f => f.forceRetag)}
                      onChange={(e) => {
                        setFileConfigs(prev => prev.map(config =>
                          (config.detectedType === 'extrato_processado' || config.detectedType === 'fatura_processada' || config.detectedType === 'beneficio_xlsx')
                            ? { ...config, forceRetag: e.target.checked }
                            : config
                        ))
                      }}
                      disabled={isProcessing}
                      className="w-4 h-4 text-amber-600 rounded focus:ring-2 focus:ring-amber-500 flex-shrink-0"
                    />
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Todos: Forçar re-tageamento (ignorar tags do arquivo)
                    </span>
                  </label>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 ml-6">
                    Use os checkboxes na tabela para controle individual por arquivo
                  </p>
                </div>
              )}

              {/* Configuração Global: Ano para PDFs */}
              {hasPDFs && (
                <div className="mb-3">
                  {/* Card: Ano para PDFs */}
                  <div className="p-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                        PDFs:
                      </span>
                      <select
                        value={globalYear}
                        onChange={(e) => setGlobalYear(e.target.value)}
                        className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        <option value="">Ano</option>
                        {years.map(year => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => {
                          setFileConfigs(prev => prev.map(config =>
                            config.needsYearMonth
                              ? { ...config, year: globalYear }
                              : config
                          ))
                        }}
                        disabled={!globalYear || isProcessing}
                        style={{ backgroundColor: !globalYear || isProcessing ? undefined : 'var(--crud-create)' }}
                        className="px-2.5 py-1.5 disabled:bg-gray-400 text-white text-xs font-medium rounded hover:brightness-110 transition-all flex items-center gap-1.5 whitespace-nowrap"
                        title="Aplicar este ano a todos os PDFs"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        Aplicar Ano
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabela de Arquivos */}
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto">
                <table className="w-full text-sm table-fixed">
                  <thead className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 w-[40px]"></th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Arquivo</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 w-[140px]">Tipo</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 w-[130px]">Importar</th>
                      {/* Coluna Re-tag: só aparece se há Excel processado */}
                      {fileConfigs.some(f => f.detectedType === 'extrato_processado' || f.detectedType === 'fatura_processada' || f.detectedType === 'beneficio_xlsx') && (
                        <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 w-[60px]" title="Forçar re-tageamento (ignorar tags do arquivo)">Re-tag</th>
                      )}
                      {(hasPDFs || fileConfigs.some(f => f.detectedType === 'beneficio_csv')) && (
                        <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 w-[160px]">Config</th>
                      )}
                      <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 w-[60px]">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fileConfigs.map((config, index) => {
                      const isPDF = config.file.name.endsWith('.pdf')
                      const icon = isPDF ? FileText : FileSpreadsheet
                      const Icon = icon
                      const isDragging = draggedIndex === index
                      const isDragOver = dragOverIndex === index

                      return (
                        <tr
                          key={index}
                          draggable={!isProcessing}
                          onDragStart={() => handleDragStart(index)}
                          onDragOver={(e) => handleDragOver(e, index)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, index)}
                          onDragEnd={handleDragEnd}
                          className={`border-b border-gray-200 dark:border-gray-700 transition-all ${
                            isDragging
                              ? 'opacity-50 bg-gray-100 dark:bg-gray-700'
                              : isDragOver
                              ? 'bg-blue-50 dark:bg-blue-900/20 border-t-2 border-t-blue-500'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                          }`}
                        >
                          {/* Drag Handle */}
                          <td className="px-2 py-2 text-center">
                            <div
                              className={`cursor-grab active:cursor-grabbing ${isProcessing ? 'opacity-30 cursor-not-allowed' : ''}`}
                              title="Arrastar para reordenar"
                            >
                              <GripVertical className="w-4 h-4 text-gray-400 dark:text-gray-500 mx-auto" />
                            </div>
                          </td>

                          {/* Nome do Arquivo */}
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Icon className="w-4 h-4 text-gray-600 dark:text-gray-400 flex-shrink-0" />
                              <span className="text-gray-900 dark:text-white truncate block text-xs" title={config.file.name}>
                                {config.file.name}
                              </span>
                            </div>
                          </td>

                          {/* Tipo Detectado */}
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium min-w-[100px] ${
                              config.isRaw
                                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                            }`}>
                              {config.isRaw ? '📄 Bruto' : '✅ Processado'}
                            </span>
                          </td>

                          {/* Importar Como (ícones) */}
                          <td className="px-3 py-2">
                            <div className="flex justify-center">
                              {config.detectedType === 'beneficio_csv' || config.detectedType === 'beneficio_xlsx' ? (
                                // Benefícios (CSV bruto ou XLSX processado) = ícone Gift
                                <Gift
                                  size={22}
                                  style={{ color: 'var(--color-3)' }}
                                  className="cursor-default"
                                  title="Benefício"
                                />
                              ) : config.detectedType === 'fatura_bruta' || config.detectedType === 'fatura_processada' ? (
                                // PDF ou Fatura Processada = ícone CreditCard
                                <CreditCard
                                  size={22}
                                  style={{ color: 'var(--color-2)' }}
                                  className="cursor-default"
                                  title="Fatura de Cartão"
                                />
                              ) : config.detectedType === 'extrato_bruto' || config.detectedType === 'extrato_processado' ? (
                                // XLSX Extrato = ícone Landmark
                                <Landmark
                                  size={22}
                                  style={{ color: 'var(--color-1)' }}
                                  className="cursor-default"
                                  title="Extrato Bancário"
                                />
                              ) : (
                                // Outros casos = pode escolher (botões com ícones)
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleTypeChange(index, 'extrato')}
                                    disabled={isProcessing}
                                    className={`p-1.5 rounded-lg transition-all ${
                                      config.importSource === 'extrato'
                                        ? 'bg-[var(--color-1)]/20 ring-2 ring-[var(--color-1)]'
                                        : 'hover:bg-gray-200 dark:hover:bg-gray-600'
                                    } disabled:opacity-50`}
                                    title="Extrato Bancário"
                                  >
                                    <Landmark
                                      size={20}
                                      style={{ color: config.importSource === 'extrato' ? 'var(--color-1)' : 'var(--gray-400)' }}
                                      className={config.importSource === 'extrato' ? '' : 'opacity-50'}
                                    />
                                  </button>
                                  <button
                                    onClick={() => handleTypeChange(index, 'fatura')}
                                    disabled={isProcessing}
                                    className={`p-1.5 rounded-lg transition-all ${
                                      config.importSource === 'fatura'
                                        ? 'bg-[var(--color-2)]/20 ring-2 ring-[var(--color-2)]'
                                        : 'hover:bg-gray-200 dark:hover:bg-gray-600'
                                    } disabled:opacity-50`}
                                    title="Fatura de Cartão"
                                  >
                                    <CreditCard
                                      size={20}
                                      style={{ color: config.importSource === 'fatura' ? 'var(--color-2)' : 'var(--gray-400)' }}
                                      className={config.importSource === 'fatura' ? '' : 'opacity-50'}
                                    />
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Re-tag checkbox (apenas para Excel processado) */}
                          {fileConfigs.some(f => f.detectedType === 'extrato_processado' || f.detectedType === 'fatura_processada' || f.detectedType === 'beneficio_xlsx') && (
                            <td className="px-2 py-2 text-center">
                              {(config.detectedType === 'extrato_processado' || config.detectedType === 'fatura_processada' || config.detectedType === 'beneficio_xlsx') ? (
                                <input
                                  type="checkbox"
                                  checked={config.forceRetag ?? true}
                                  onChange={(e) => {
                                    setFileConfigs(prev => prev.map((c, i) =>
                                      i === index ? { ...c, forceRetag: e.target.checked } : c
                                    ))
                                  }}
                                  disabled={isProcessing}
                                  className="w-4 h-4 text-amber-600 rounded focus:ring-2 focus:ring-amber-500 cursor-pointer"
                                  title={config.forceRetag ? 'Forçar re-tageamento (usar mapeamentos)' : 'Manter tags do arquivo'}
                                />
                              ) : (
                                <span className="text-xs text-gray-400">-</span>
                              )}
                            </td>
                          )}

                          {/* Configuração (Ano/Mês para PDFs, Cartão para Benefícios) */}
                          {(hasPDFs || fileConfigs.some(f => f.detectedType === 'beneficio_csv')) && (
                            <td className="px-3 py-2">
                              {config.needsYearMonth ? (
                                // PDFs: Ano/Mês
                                <div className="flex gap-1 justify-center">
                                  <select
                                    value={config.year || ''}
                                    onChange={(e) => handleYearMonthChange(index, 'year', e.target.value)}
                                    disabled={isProcessing}
                                    className="px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50 w-16"
                                  >
                                    <option value="">Ano</option>
                                    {years.map(year => (
                                      <option key={year} value={year}>{year}</option>
                                    ))}
                                  </select>
                                  <select
                                    value={config.month || ''}
                                    onChange={(e) => handleYearMonthChange(index, 'month', e.target.value)}
                                    disabled={isProcessing}
                                    className="px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50 w-14"
                                  >
                                    <option value="">Mês</option>
                                    {months.map(month => (
                                      <option key={month.value} value={month.value}>{month.value}</option>
                                    ))}
                                  </select>
                                </div>
                              ) : config.detectedType === 'beneficio_csv' ? (
                                // CSVs de Benefícios: Cartão (mesma largura que Ano + gap + Mês)
                                <div className="flex gap-1 justify-center">
                                  <select
                                    value={config.credit_card_id || ''}
                                    onChange={(e) => handleCardChange(index, parseInt(e.target.value))}
                                    disabled={isProcessing}
                                    className="px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                                    style={{ width: 'calc(4rem + 0.25rem + 3.5rem)' }}
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

                          {/* Remover */}
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => handleRemoveFile(index)}
                              disabled={isProcessing}
                              className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 p-0.5"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Resultados - só exibe quando não há conflitos pendentes */}
          {results.length > 0 && conflicts.length === 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Resultados da Importação
                </h3>
                <div className="flex items-center gap-2">
                  {totalUnmapped > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium rounded-full">
                      <ClipboardCheck className="w-3.5 h-3.5" />
                      {totalUnmapped} pendente(s)
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {results.map((result, index) => (
                  <div
                    key={index}
                    className={`p-4 rounded-lg border ${
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
                                  Nenhum lançamento novo
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
                            </div>
                          )
                        ) : (
                          <div className="space-y-1">
                            {result.errors.map((error, i) => (
                              <p key={i} className="text-xs text-red-600 dark:text-red-400">
                                • {error}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Aviso de Curadoria */}
              {totalUnmapped > 0 && (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
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
            </div>
          )}

          {/* Botões de Ação */}
          <div className={`flex flex-col gap-3 ${results.length > 0 ? 'mt-6' : ''}`}>
            {/* Opção de Tracing (Debug) - só mostra antes do processamento */}
            {results.length === 0 && fileConfigs.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={enableTracing}
                  onChange={(e) => setEnableTracing(e.target.checked)}
                  disabled={isProcessing || isDetecting}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-color-primary focus:ring-color-primary disabled:opacity-50"
                />
                <span>Gerar log de debug (JSON com detalhes de cada linha)</span>
              </label>
            )}

            <div className="flex gap-3">
              {results.length > 0 ? (
                // Após processamento - apenas botão Concluir
                <button
                  onClick={handleClose}
                  className="w-full px-4 py-2 text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
                  style={{ backgroundColor: 'var(--status-info)' }}
                >
                  Concluir
                </button>
              ) : (
                // Antes do processamento
                <>
                  <button
                    onClick={handleClose}
                    disabled={isProcessing || isDetecting}
                    className="flex-1 px-4 py-2 text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: 'var(--crud-cancel)' }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleUpload}
                    disabled={fileConfigs.length === 0 || isProcessing || isDetecting}
                    className="flex-1 px-4 py-2 text-white rounded-lg hover:opacity-90 transition-opacity font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ backgroundColor: 'var(--crud-create)' }}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Processando...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        Importar {fileConfigs.length > 0 && `(${fileConfigs.length})`}
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Revisão de Conflitos */}
      <ConflictReviewModal
        isOpen={showConflictModal}
        onClose={handleDiscardConflicts}
        conflicts={conflicts}
        onResolve={handleResolveConflicts}
      />
    </>
  )
}

export default UnifiedImportModal

