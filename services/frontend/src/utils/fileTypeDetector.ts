/**
 * Utilitário para detectar tipo de arquivo de importação
 */

import * as XLSX from 'xlsx'

export type FileType =
  | 'extrato_bruto'
  | 'fatura_bruta'
  | 'beneficio_csv'
  | 'holerite'
  | 'informe'
  | 'pdf_unknown'
  | 'export_nao_suportado'
export type ImportSource = 'extrato' | 'fatura' | 'beneficio' | 'folha'
export type StatementIssuer = 'btg' | 'mercadopago' | 'unknown'

export function fileExtension(fileName: string): string {
  const match = fileName.toLowerCase().match(/(\.[a-z0-9]+)$/)
  return match?.[1] || ''
}

export function isPdfFileName(fileName: string): boolean {
  return fileExtension(fileName) === '.pdf'
}

export function isSupportedImportFileName(fileName: string): boolean {
  return ['.pdf', '.xlsx', '.xls', '.csv'].includes(fileExtension(fileName))
}

export interface DetectedFileInfo {
  file: File
  detectedType: FileType
  importSource: ImportSource
  isRaw: boolean
  needsYearMonth: boolean
  confidence: 'high' | 'medium' | 'low'
  columns?: string[]
  year?: string
  month?: string
  statementIssuer?: StatementIssuer
  issuerLabel?: string
  cardLast4?: string
  payrollPreview?: string
  detectionError?: string
}

const EXPORT_UNSUPPORTED_MESSAGE =
  'Planilha exportada ou editada no Plumo não pode ser reimportada. Use o arquivo original do banco (extrato/fatura PDF ou CSV de benefício).'

const DE_PARA_UNSUPPORTED_MESSAGE =
  'Este arquivo é o relatório DE-PARA gerado pelo Plumo após uma importação, não o extrato do banco. Use o Excel original exportado pelo banco (BTG, etc.).'

const EXTRATO_FORMAT_HINT =
  'Para importar extrato, use o arquivo original do banco com as colunas: Data e hora, Categoria, Transação, Descrição e Valor.'

function isPlumoDeParaReportFileName(fileName: string): boolean {
  return /_(ATUALIZADOS_DE-PARA|IGNORADOS|saque_negado_ignorados)(\.xlsx?)?$/i.test(fileName)
}

/** Extrato BTG/Mercado Pago: cabeçalho costuma ficar após linhas de metadado do banco. */
function isLikelyBankExtratoFileName(fileName: string): boolean {
  if (isPlumoDeParaReportFileName(fileName)) return false
  return /^extrato[_\s]/i.test(fileName)
}

function rowToHeaderColumns(row: unknown): string[] {
  if (!Array.isArray(row)) return []
  return row
    .filter((cell): cell is string => typeof cell === 'string' && cell.trim().length > 0)
    .map((cell) => cell.trim())
}

function isPlumoDeParaReportColumns(columns: string[]): boolean {
  const lower = columns.map((col) => col.toLowerCase().trim())
  if (lower.some((col) => col.startsWith('valor (de)') || col.startsWith('valor (para)'))) {
    return true
  }
  if (lower.includes('descrição (de)') && lower.includes('descrição (para)')) {
    return true
  }
  if (
    lower.includes('linha') &&
    lower.includes('id') &&
    lower.some((col) => col.startsWith('tag (de)') || col.startsWith('tag (para)'))
  ) {
    return true
  }
  return false
}

// Assinaturas só para extrato bruto e detecção de exportações (bloqueadas)
const COLUMN_SIGNATURES = {
  extrato_bruto: ['Data e hora', 'Categoria', 'Transação', 'Descrição', 'Valor'],
  extrato_export: ['Ano', 'Mês', 'Data e hora', 'Categoria', 'Transação', 'Descrição', 'Valor', 'Tag', 'Subtag'],
  fatura_export: ['Ano', 'Mês', 'Cartão', 'Titular', 'Data', 'Descrição', 'Descrição Limpa', 'Valor', 'Tag', 'Subtag'],
  beneficio_csv: ['Data', 'Hora', 'Movimentação', 'Valor', 'Meio de Pagamento', 'Saldo'],
  beneficio_export: ['Data', 'Cartão', 'Movimentação', 'Valor', 'Meio de Pagamento', 'Saldo', 'Tag', 'Subtag'],
}

/**
 * Detecta o tipo de arquivo baseado APENAS na PRIMEIRA LINHA (header)
 */
export async function detectFileType(file: File): Promise<DetectedFileInfo> {
  const ext = fileExtension(file.name)

  if (ext === '.pdf') {
    return {
      file,
      detectedType: 'pdf_unknown',
      importSource: 'folha',
      isRaw: true,
      needsYearMonth: false,
      confidence: 'low',
    }
  }

  if (ext === '.csv') {
    try {
      const columns = await readCSVColumns(file)
      const matchCount = matchColumns(columns, COLUMN_SIGNATURES.beneficio_csv)
      const isBenefitCSV = matchCount >= 6

      if (isBenefitCSV) {
        return {
          file,
          detectedType: 'beneficio_csv',
          importSource: 'beneficio',
          isRaw: true,
          needsYearMonth: false,
          confidence: 'high',
          columns,
        }
      }

      throw new Error('CSV não reconhecido. Formato esperado: Data,Hora,Movimentação,Valor,Meio de Pagamento,Saldo')
    } catch (error) {
      console.error('Erro ao ler CSV:', error)
      throw error
    }
  }

  if (ext === '.xlsx' || ext === '.xls') {
    if (isPlumoDeParaReportFileName(file.name)) {
      return {
        file,
        detectedType: 'export_nao_suportado',
        importSource: 'extrato',
        isRaw: false,
        needsYearMonth: false,
        confidence: 'high',
        detectionError: DE_PARA_UNSUPPORTED_MESSAGE,
      }
    }

    try {
      const maxSize = 50 * 1024 * 1024
      if (file.size > maxSize) {
        console.warn(`⚠️ Arquivo grande (${(file.size / 1024 / 1024).toFixed(2)}MB): ${file.name}`)
      }

      const columns = await readExcelColumns(file)
      let typeInfo = detectExcelType(columns)
      if (
        typeInfo.type === 'export_nao_suportado' &&
        isLikelyBankExtratoFileName(file.name) &&
        !isPlumoDeParaReportColumns(columns)
      ) {
        typeInfo = {
          type: 'extrato_bruto',
          source: 'extrato',
          isRaw: true,
          confidence: 'medium',
        }
      }

      return {
        file,
        detectedType: typeInfo.type,
        importSource: typeInfo.source,
        isRaw: typeInfo.isRaw,
        needsYearMonth: false,
        confidence: typeInfo.confidence,
        columns,
        detectionError: typeInfo.detectionError,
      }
    } catch (error) {
      console.error('Erro ao ler colunas do Excel:', error)
      return {
        file,
        detectedType: 'extrato_bruto',
        importSource: 'extrato',
        isRaw: true,
        needsYearMonth: false,
        confidence: 'low',
      }
    }
  }

  throw new Error(`Tipo de arquivo não suportado: ${file.name}`)
}

async function readCSVColumns(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        const lines = text.split('\n')

        if (lines.length === 0) {
          reject(new Error('Arquivo CSV vazio'))
          return
        }

        const header = lines[0].trim()
        const columns = header.split(',').map(col => col.trim().replace(/^"|"$/g, ''))

        if (columns.length === 0) {
          reject(new Error('CSV não possui colunas válidas'))
          return
        }

        resolve(columns)
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => reject(new Error('Erro ao ler arquivo CSV'))
    reader.readAsText(file, 'utf-8')
  })
}

async function readExcelColumns(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = e.target?.result
        const workbook = XLSX.read(data, {
          type: 'binary',
          sheetRows: 30,
        })

        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as unknown[][]
        const headerRows = jsonData.map((row) => rowToHeaderColumns(row)).filter((cols) => cols.length > 0)

        if (headerRows.length === 0) {
          reject(new Error('Arquivo não possui colunas válidas'))
          return
        }

        for (const cols of headerRows) {
          if (isPlumoDeParaReportColumns(cols)) {
            resolve(cols)
            return
          }
        }

        for (const cols of headerRows) {
          const hasDataEHora = cols.some((c) => c.toLowerCase() === 'data e hora')
          if (hasDataEHora && matchColumns(cols, COLUMN_SIGNATURES.extrato_bruto) >= 4) {
            resolve(cols)
            return
          }
        }

        resolve(headerRows[0])
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => reject(new Error('Erro ao ler arquivo'))
    reader.readAsBinaryString(file)
  })
}

function detectExcelType(columns: string[]): {
  type: FileType
  source: ImportSource
  isRaw: boolean
  confidence: 'high' | 'medium' | 'low'
  detectionError?: string
} {
  const normalizedCols = columns.map(col => col.trim())

  const matches = {
    extrato_bruto: matchColumns(normalizedCols, COLUMN_SIGNATURES.extrato_bruto),
    extrato_export: matchColumns(normalizedCols, COLUMN_SIGNATURES.extrato_export),
    fatura_export: matchColumns(normalizedCols, COLUMN_SIGNATURES.fatura_export),
    beneficio_export: matchColumns(normalizedCols, COLUMN_SIGNATURES.beneficio_export),
    beneficio_csv: matchColumns(normalizedCols, COLUMN_SIGNATURES.beneficio_csv),
  }

  const hasDescricaoLimpa = normalizedCols.some(c => c.toLowerCase() === 'descrição limpa')
  const hasTitular = normalizedCols.some(c => c.toLowerCase() === 'titular')
  const hasDataEHora = normalizedCols.some(c => c.toLowerCase() === 'data e hora')
  const hasCategoria = normalizedCols.some(c => c.toLowerCase() === 'categoria')
  const hasTransacao = normalizedCols.some(c => c.toLowerCase() === 'transação')
  const hasTag = normalizedCols.some(c => c.toLowerCase() === 'tag')
  const hasSubtag = normalizedCols.some(c => c.toLowerCase() === 'subtag')
  const hasMovimentacao = normalizedCols.some(c => c.toLowerCase() === 'movimentação')
  const hasMeioPagamento = normalizedCols.some(c => c.toLowerCase() === 'meio de pagamento')
  const hasSaldo = normalizedCols.some(c => c.toLowerCase() === 'saldo')
  const hasHora = normalizedCols.some(c => c.toLowerCase() === 'hora')

  const blockedExport = (): ReturnType<typeof detectExcelType> => ({
    type: 'export_nao_suportado',
    source: 'extrato',
    isRaw: false,
    confidence: 'high',
    detectionError: EXPORT_UNSUPPORTED_MESSAGE,
  })

  if (hasDescricaoLimpa && hasTitular && matches.fatura_export >= 8) {
    return { ...blockedExport(), source: 'fatura' }
  }

  if (hasDataEHora && hasCategoria && hasTransacao && (hasTag || hasSubtag) && matches.extrato_export >= 7) {
    return blockedExport()
  }

  if (hasMovimentacao && hasMeioPagamento && hasSaldo && (hasTag || hasSubtag) && matches.beneficio_export >= 6) {
    return { ...blockedExport(), source: 'beneficio' }
  }

  if (hasHora && hasMovimentacao && hasMeioPagamento && matches.beneficio_csv >= 5) {
    return { ...blockedExport(), source: 'beneficio' }
  }

  if (isPlumoDeParaReportColumns(normalizedCols)) {
    return {
      type: 'export_nao_suportado',
      source: 'extrato',
      isRaw: false,
      confidence: 'high',
      detectionError: DE_PARA_UNSUPPORTED_MESSAGE,
    }
  }

  if (hasDataEHora && matches.extrato_bruto >= 4) {
    return {
      type: 'extrato_bruto',
      source: 'extrato',
      isRaw: true,
      confidence: matches.extrato_bruto >= 5 ? 'high' : 'medium',
    }
  }

  return {
    type: 'export_nao_suportado',
    source: 'extrato',
    isRaw: false,
    confidence: 'low',
    detectionError: EXTRATO_FORMAT_HINT,
  }
}

function matchColumns(actualCols: string[], expectedCols: string[]): number {
  return expectedCols.filter(expected =>
    actualCols.some(actual => actual.toLowerCase().includes(expected.toLowerCase()))
  ).length
}
