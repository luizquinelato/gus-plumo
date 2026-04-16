/**
 * Utilitário para detectar tipo de arquivo de importação
 */

import * as XLSX from 'xlsx'

export type FileType = 'extrato_bruto' | 'extrato_processado' | 'fatura_bruta' | 'fatura_processada' | 'beneficio_csv' | 'beneficio_xlsx'
export type ImportSource = 'extrato' | 'fatura' | 'beneficio'

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
}

// Definições de colunas esperadas (assinaturas COMPLETAS para detecção precisa)
const COLUMN_SIGNATURES = {
  // Extrato bruto: arquivo original do banco (sem processamento)
  extrato_bruto: ['Data e hora', 'Categoria', 'Transação', 'Descrição', 'Valor'],
  // Extrato processado: exportado pelo sistema
  // Colunas: Ano, Mês, Data e hora, Categoria, Transação, Descrição, Valor, Tag, Subtag
  extrato_processado: ['Ano', 'Mês', 'Data e hora', 'Categoria', 'Transação', 'Descrição', 'Valor', 'Tag', 'Subtag'],
  // Fatura bruta: PDF (não tem colunas)
  fatura_bruta: [],
  // Fatura processada: exportada pelo sistema
  // Colunas: Ano, Mês, Cartão, Titular, Data, Descrição, Descrição Limpa, Valor, Tag, Subtag
  fatura_processada: ['Ano', 'Mês', 'Cartão', 'Titular', 'Data', 'Descrição', 'Descrição Limpa', 'Valor', 'Tag', 'Subtag'],
  // Benefício CSV bruto: arquivo original do banco (formato antigo)
  // Colunas: Data, Hora, Movimentação, Valor, Meio de Pagamento, Saldo
  beneficio_csv: ['Data', 'Hora', 'Movimentação', 'Valor', 'Meio de Pagamento', 'Saldo'],
  // Benefício XLSX processado: exportado pelo sistema (formato novo)
  // Colunas: Data, Cartão, Movimentação, Valor, Meio de Pagamento, Saldo, Tag, Subtag
  beneficio_xlsx: ['Data', 'Cartão', 'Movimentação', 'Valor', 'Meio de Pagamento', 'Saldo', 'Tag', 'Subtag']
}

/**
 * Detecta o tipo de arquivo baseado APENAS na PRIMEIRA LINHA (header)
 *
 * ESTRATÉGIA:
 * 1. PDF → Sempre fatura bruta (não tem header)
 * 2. CSV → Lê primeira linha e compara com assinatura de benefícios
 * 3. Excel → Lê primeira linha e compara com assinaturas conhecidas
 *
 * ⚠️ IMPORTANTE: NUNCA usa o nome do arquivo para detectar tipo!
 */
export async function detectFileType(file: File): Promise<DetectedFileInfo> {
  const fileName = file.name.toLowerCase()

  // 1. PDF = Fatura Bruta (sempre)
  // PDFs não têm header, então assumimos fatura bruta
  if (fileName.endsWith('.pdf')) {
    return {
      file,
      detectedType: 'fatura_bruta',
      importSource: 'fatura',
      isRaw: true,
      needsYearMonth: true,
      confidence: 'high'
    }
  }

  // 2. CSV = Lê primeira linha e detecta tipo
  if (fileName.endsWith('.csv')) {
    try {
      // ✅ LÊ A PRIMEIRA LINHA DO CSV
      const columns = await readCSVColumns(file)

      // Verifica se é CSV de benefícios (6 colunas esperadas)
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
          columns
        }
      }

      throw new Error('CSV não reconhecido. Formato esperado: Data,Hora,Movimentação,Valor,Meio de Pagamento,Saldo')
    } catch (error) {
      console.error('Erro ao ler CSV:', error)
      throw error
    }
  }

  // 3. Excel = Lê primeira linha e detecta tipo
  if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    try {
      // Validação de tamanho (opcional: avisar se > 10MB)
      const maxSize = 50 * 1024 * 1024 // 50MB
      if (file.size > maxSize) {
        console.warn(`⚠️ Arquivo grande (${(file.size / 1024 / 1024).toFixed(2)}MB): ${file.name}`)
      }

      // ✅ LÊ A PRIMEIRA LINHA DO EXCEL
      const columns = await readExcelColumns(file)
      const typeInfo = detectExcelType(columns)

      return {
        file,
        detectedType: typeInfo.type,
        importSource: typeInfo.source,
        isRaw: typeInfo.isRaw,
        needsYearMonth: false,
        confidence: typeInfo.confidence,
        columns
      }
    } catch (error) {
      console.error('Erro ao ler colunas do Excel:', error)
      // Fallback: assume extrato bruto com baixa confiança
      return {
        file,
        detectedType: 'extrato_bruto',
        importSource: 'extrato',
        isRaw: true,
        needsYearMonth: false,
        confidence: 'low'
      }
    }
  }

  throw new Error(`Tipo de arquivo não suportado: ${fileName}`)
}

/**
 * Lê as colunas (header) de um arquivo CSV
 */
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

        // Primeira linha = header
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

/**
 * Lê as colunas (header) de um arquivo Excel
 * OTIMIZADO: Lê apenas a primeira linha para economizar memória
 */
async function readExcelColumns(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = e.target?.result

        // ✅ OTIMIZAÇÃO: Lê apenas 1 linha (header)
        const workbook = XLSX.read(data, {
          type: 'binary',
          sheetRows: 1  // Lê apenas a primeira linha!
        })

        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 })

        // Primeira linha = colunas
        const columns = (jsonData[0] as any[]) || []
        const validColumns = columns.filter(col => col && typeof col === 'string' && col.trim())

        // Validação: arquivo deve ter pelo menos 1 coluna
        if (validColumns.length === 0) {
          reject(new Error('Arquivo não possui colunas válidas na primeira linha'))
          return
        }

        resolve(validColumns)
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => reject(new Error('Erro ao ler arquivo'))
    reader.readAsBinaryString(file)
  })
}

/**
 * Detecta tipo de Excel baseado nas colunas
 */
function detectExcelType(columns: string[]): {
  type: FileType
  source: ImportSource
  isRaw: boolean
  confidence: 'high' | 'medium' | 'low'
} {
  const normalizedCols = columns.map(col => col.trim())

  // Verifica cada assinatura
  const matches = {
    extrato_bruto: matchColumns(normalizedCols, COLUMN_SIGNATURES.extrato_bruto),
    extrato_processado: matchColumns(normalizedCols, COLUMN_SIGNATURES.extrato_processado),
    fatura_processada: matchColumns(normalizedCols, COLUMN_SIGNATURES.fatura_processada),
    beneficio_csv: matchColumns(normalizedCols, COLUMN_SIGNATURES.beneficio_csv),
    beneficio_xlsx: matchColumns(normalizedCols, COLUMN_SIGNATURES.beneficio_xlsx)
  }

  // Colunas únicas para diferenciação:
  // - Fatura: "Titular", "Descrição Limpa" (únicas)
  // - Extrato: "Data e hora", "Categoria", "Transação" (únicas)
  // - Benefício: "Movimentação", "Meio de Pagamento", "Saldo" (únicas)
  const hasDescricaoLimpa = normalizedCols.some(c => c.toLowerCase() === 'descrição limpa')
  const hasTitular = normalizedCols.some(c => c.toLowerCase() === 'titular')
  const hasDataEHora = normalizedCols.some(c => c.toLowerCase() === 'data e hora')
  const hasCategoria = normalizedCols.some(c => c.toLowerCase() === 'categoria')
  const hasTransacao = normalizedCols.some(c => c.toLowerCase() === 'transação')
  const hasMovimentacao = normalizedCols.some(c => c.toLowerCase() === 'movimentação')
  const hasMeioPagamento = normalizedCols.some(c => c.toLowerCase() === 'meio de pagamento')
  const hasSaldo = normalizedCols.some(c => c.toLowerCase() === 'saldo')
  const hasHora = normalizedCols.some(c => c.toLowerCase() === 'hora')

  // Fatura Processada: tem "Descrição Limpa" e "Titular" (colunas únicas)
  // Assinatura: Ano, Mês, Cartão, Titular, Data, Descrição, Descrição Limpa, Valor, Tag, Subtag (10 colunas)
  if (hasDescricaoLimpa && hasTitular && matches.fatura_processada >= 8) {
    return {
      type: 'fatura_processada',
      source: 'fatura',
      isRaw: false,
      confidence: matches.fatura_processada >= 10 ? 'high' : 'medium'
    }
  }

  // Extrato Processado: tem "Data e hora", "Categoria", "Transação" (colunas únicas)
  // Assinatura: Ano, Mês, Data e hora, Categoria, Transação, Descrição, Valor, Tag, Subtag (9 colunas)
  if (hasDataEHora && hasCategoria && hasTransacao && matches.extrato_processado >= 7) {
    return {
      type: 'extrato_processado',
      source: 'extrato',
      isRaw: false,
      confidence: matches.extrato_processado >= 9 ? 'high' : 'medium'
    }
  }

  // Benefício XLSX Processado: tem "Movimentação", "Meio de Pagamento", "Saldo" (colunas únicas)
  // Assinatura: Data, Cartão, Movimentação, Valor, Meio de Pagamento, Saldo, Tag, Subtag (8 colunas)
  if (hasMovimentacao && hasMeioPagamento && hasSaldo && matches.beneficio_xlsx >= 6) {
    return {
      type: 'beneficio_xlsx',
      source: 'beneficio',
      isRaw: false,
      confidence: matches.beneficio_xlsx >= 8 ? 'high' : 'medium'
    }
  }

  // Benefício CSV (formato antigo): tem "Hora" ao invés de timestamp
  // Assinatura: Data, Hora, Movimentação, Valor, Meio de Pagamento, Saldo (6 colunas)
  if (hasHora && hasMovimentacao && hasMeioPagamento && matches.beneficio_csv >= 5) {
    return {
      type: 'beneficio_xlsx',  // Tratado como XLSX processado
      source: 'beneficio',
      isRaw: false,
      confidence: matches.beneficio_csv >= 6 ? 'high' : 'medium'
    }
  }

  // Extrato Bruto: tem "Data e hora" mas sem "Ano", "Mês", "Tag", "Subtag"
  // Assinatura: Data e hora, Categoria, Transação, Descrição, Valor (5 colunas)
  if (hasDataEHora && matches.extrato_bruto >= 4) {
    return {
      type: 'extrato_bruto',
      source: 'extrato',
      isRaw: true,
      confidence: matches.extrato_bruto >= 5 ? 'high' : 'medium'
    }
  }

  // Não conseguiu detectar com certeza - assume extrato bruto
  return {
    type: 'extrato_bruto',
    source: 'extrato',
    isRaw: true,
    confidence: 'low'
  }
}

/**
 * Conta quantas colunas esperadas estão presentes
 */
function matchColumns(actualCols: string[], expectedCols: string[]): number {
  return expectedCols.filter(expected =>
    actualCols.some(actual => actual.toLowerCase().includes(expected.toLowerCase()))
  ).length
}

