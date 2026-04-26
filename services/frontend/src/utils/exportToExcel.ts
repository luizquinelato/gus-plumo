/**
 * Utilitário para exportar dados do Extrato para Excel
 * Gera arquivo com 3 abas no formato compatível com importação
 */

import * as XLSX from 'xlsx'

export interface ExpenseExportData {
  id: number
  date: string
  description: string
  amount: number
  source: string
  card_number: string | null
  card_name: string | null
  category: string | null
  subtag_id: number | null
  subtag_name: string | null
  tag_name: string | null
  current_installment: number | null
  total_installments: number | null
  adjustment_type: string | null
  ownership_percentage: number | null
  shared_partner_id: number | null
  shared_partner_name: string | null
  shared_partner_bank: string | null
  shared_partner_agency: string | null
  shared_partner_account_number: string | null
  account_id: number | null
  account_name: string | null
  bank_code: string | null
  bank_name: string | null
  account_agency: string | null
  account_number: string | null
  year_month: string | null  // Ano/mês da fatura (YYYY-MM) - usado apenas para faturas de cartão
}

/**
 * Formata data no formato brasileiro
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

/**
 * Formata data e hora com segundos
 */
function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`
}

/**
 * Extrai ano e mês de uma data
 */
function extractYearMonth(dateStr: string): { year: string; month: string } {
  const date = new Date(dateStr)
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0')
  }
}

/**
 * Opções de exportação
 */
export interface ExportOptions {
  includeSharing?: boolean
}

/**
 * Adiciona colunas de compartilhamento a um registro
 * Só preenche se houver conta parceira definida
 */
function addSharingColumns(record: any, exp: ExpenseExportData, includeSharing: boolean): any {
  if (!includeSharing) return record

  // Só preenche se houver compartilhamento (conta parceira definida)
  const hasSharing = exp.shared_partner_name != null && exp.shared_partner_name !== ''

  return {
    ...record,
    'Conta Parceira': hasSharing ? exp.shared_partner_name : '',
    'Minha Contribuição (%)': hasSharing && exp.ownership_percentage != null ? Number(exp.ownership_percentage) : ''
  }
}

/**
 * Converte dados de extrato bancário para formato de importação
 * Colunas: Ano, Mês, Data e hora, Categoria, Transação, Descrição, Valor, Tag, Subtag
 * + opcionais: Conta Parceira, Minha Contribuição (%)
 */
function convertBankStatements(expenses: ExpenseExportData[], options: ExportOptions = {}): any[] {
  return expenses.map(exp => {
    const { year, month } = extractYearMonth(exp.date)
    const record = {
      'Ano': year,
      'Mês': month,
      'Data e hora': formatDateTime(exp.date),
      'Categoria': exp.category || '',
      'Transação': exp.amount >= 0 ? 'Crédito' : 'Débito',
      'Descrição': exp.description,
      'Valor': exp.amount,
      'Tag': exp.tag_name || '',
      'Subtag': exp.subtag_name || ''
    }
    return addSharingColumns(record, exp, options.includeSharing || false)
  })
}

/**
 * Converte dados de fatura de cartão para formato de importação
 * Colunas: Ano, Mês, Cartão, Titular, Data, Descrição, Descrição Limpa, Valor, Tag, Subtag
 * + opcionais: Conta Parceira, Minha Contribuição (%)
 * Nota: Descrição inclui parcelas no formato "Descrição (X/Y)"
 */
function convertCardInvoices(expenses: ExpenseExportData[], options: ExportOptions = {}): any[] {
  return expenses.map(exp => {
    // IMPORTANTE: Usa year_month da fatura (não da data da compra)
    // Uma compra de novembro pode aparecer na fatura de dezembro
    // year_month="2025-12" deve exportar Ano=2025, Mês=12 (mesmo se data=15/11/2025)
    let year: string
    let month: string
    if (exp.year_month) {
      // Formato: "YYYY-MM" -> extrai ano e mês
      const [y, m] = exp.year_month.split('-')
      year = y
      month = m
    } else {
      // Fallback para extratos/benefícios que não têm year_month
      const extracted = extractYearMonth(exp.date)
      year = extracted.year
      month = extracted.month
    }

    // Monta descrição com parcelas se existirem
    let descricaoCompleta = exp.description
    if (exp.current_installment && exp.total_installments && exp.total_installments > 1) {
      descricaoCompleta = `${exp.description} (${exp.current_installment}/${exp.total_installments})`
    }

    // IMPORTANTE: Inverte o sinal do valor para manter compatibilidade com arquivo original
    // Arquivo original de fatura: positivo = despesa, negativo = receita
    // Banco de dados: negativo = despesa, positivo = receita
    const valorExportado = -exp.amount

    const record = {
      'Ano': year,
      'Mês': month,
      'Cartão': exp.card_number || '',
      'Titular': exp.card_name || '',
      'Data': formatDate(exp.date),
      'Descrição': descricaoCompleta,
      'Descrição Limpa': exp.description,
      'Valor': valorExportado,
      'Tag': exp.tag_name || '',
      'Subtag': exp.subtag_name || ''
    }
    return addSharingColumns(record, exp, options.includeSharing || false)
  })
}

/**
 * Converte dados de benefícios para formato de importação
 * Colunas: Data (timestamp), Cartão (4 últimos dígitos), Movimentação, Valor, Meio de Pagamento, Saldo, Tag, Subtag
 * + opcionais: Conta Parceira, Minha Contribuição (%)
 *
 * NOTA: Estrutura similar à fatura processada para consistência
 */
function convertBenefits(expenses: ExpenseExportData[], options: ExportOptions = {}): any[] {
  return expenses.map(exp => {
    // Extrai os 4 últimos dígitos do cartão
    const cardLast4 = exp.card_number ? exp.card_number.slice(-4) : ''

    const record = {
      'Data': formatDateTime(exp.date),  // Timestamp completo: DD/MM/YYYY HH:MM:SS
      'Cartão': cardLast4,               // 4 últimos dígitos do cartão
      'Movimentação': exp.description,
      'Valor': exp.amount,
      'Meio de Pagamento': exp.card_name || 'Benefício',
      'Saldo': '',                       // Não temos essa informação
      'Tag': exp.tag_name || '',
      'Subtag': exp.subtag_name || ''
    }
    return addSharingColumns(record, exp, options.includeSharing || false)
  })
}

/**
 * Exporta dados filtrados para Excel com 3 abas
 */
export function exportToExcel(expenses: ExpenseExportData[], filename?: string, options: ExportOptions = {}): void {
  // Separa por fonte
  const bankStatements = expenses.filter(e => e.source === 'bank')
  const cardInvoices = expenses.filter(e => e.source === 'card')
  const benefits = expenses.filter(e => e.source === 'benefit')

  // Cria workbook
  const wb = XLSX.utils.book_new()

  // Aba 1: Extratos Bancários
  if (bankStatements.length > 0) {
    const bankData = convertBankStatements(bankStatements, options)
    const wsBank = XLSX.utils.json_to_sheet(bankData)
    XLSX.utils.book_append_sheet(wb, wsBank, 'Extratos Bancários')
  }

  // Aba 2: Faturas de Cartão
  if (cardInvoices.length > 0) {
    const cardData = convertCardInvoices(cardInvoices, options)
    const wsCard = XLSX.utils.json_to_sheet(cardData)
    XLSX.utils.book_append_sheet(wb, wsCard, 'Faturas de Cartão')
  }

  // Aba 3: Benefícios
  if (benefits.length > 0) {
    const benefitData = convertBenefits(benefits, options)
    const wsBenefit = XLSX.utils.json_to_sheet(benefitData)
    XLSX.utils.book_append_sheet(wb, wsBenefit, 'Benefícios')
  }

  // Gera nome do arquivo
  const today = new Date()
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
  const finalFilename = filename || `extrato_exportado_${dateStr}.xlsx`

  // Faz download
  XLSX.writeFile(wb, finalFilename)
}

// ─── Exportação de Fechamento de Balanço ─────────────────────────────────────

interface ClosureTransactionItem {
  date: string
  description: string
  amount: number
  tag_name?: string | null
  subtag_name?: string | null
  my_contribution_percentage: number
  partner_contribution_percentage: number
  card_name?: string | null
  card_number?: string | null
  year_month?: string | null
  current_installment?: number | null
  total_installments?: number | null
}

interface ClosureAccountCard {
  account_name: string
  expense_items?: ClosureTransactionItem[]
  revenue_items?: ClosureTransactionItem[]
  credit_card_expense_items?: ClosureTransactionItem[]
  credit_card_revenue_items?: ClosureTransactionItem[]
  benefit_card_expense_items?: ClosureTransactionItem[]
  benefit_card_revenue_items?: ClosureTransactionItem[]
}

interface ClosurePaymentForExcel {
  id: number
  amount: number
  payment_date: string
  notes: string | null
}

interface BalanceClosureForExcel {
  period_start_date: string
  closing_date: string
  net_balance?: number
  total_paid?: number
  remaining_balance?: number
  is_settled?: boolean
  closure_payments?: ClosurePaymentForExcel[]
  closure_data: {
    main_account_card: ClosureAccountCard
    partner_account_card: ClosureAccountCard
  }
}

/**
 * Exporta fechamento de balanço para Excel com 3 abas: Extrato, Cartão e Benefício
 */
export function exportBalanceClosureToExcel(closure: BalanceClosureForExcel, absoluteValues: boolean = false, isCounterpart: boolean = false): void {
  const mainCard = closure.closure_data?.main_account_card
  const partnerCard = closure.closure_data?.partner_account_card
  if (!mainCard || !partnerCard) return

  const mainName = mainCard.account_name || 'Principal'
  const partnerName = partnerCard.account_name || 'Parceiro'

  const parseNum = (v: any): number => {
    if (typeof v === 'number') return v
    if (typeof v === 'string') return parseFloat(v) || 0
    return 0
  }

  const formatDateBR = (dateStr: string): string => {
    const d = new Date(dateStr)
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  }

  // Marca cada item com o nome da conta dona
  const tag = (items: ClosureTransactionItem[] | undefined, accountName: string) =>
    (items || []).map(i => ({ ...i, _account: accountName }))

  // Agrega e ordena por data
  const merge = (...groups: ReturnType<typeof tag>[]) =>
    groups.flat().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const bankItems = merge(
    tag(mainCard.expense_items, mainName),
    tag(mainCard.revenue_items, mainName),
    tag(partnerCard.expense_items, partnerName),
    tag(partnerCard.revenue_items, partnerName)
  )

  const cardItems = merge(
    tag(mainCard.credit_card_expense_items, mainName),
    tag(mainCard.credit_card_revenue_items, mainName),
    tag(partnerCard.credit_card_expense_items, partnerName),
    tag(partnerCard.credit_card_revenue_items, partnerName)
  )

  const benefitItems = merge(
    tag(mainCard.benefit_card_expense_items, mainName),
    tag(partnerCard.benefit_card_expense_items, partnerName)
  )

  // Formata year_month "YYYY-MM" para "MM/YYYY"
  const formatYearMonth = (ym: string | null | undefined): string => {
    if (!ym) return ''
    const [y, m] = ym.split('-')
    return m && y ? `${m}/${y}` : ym
  }

  // Converte itens em linhas para o Excel
  const toRows = (items: ReturnType<typeof merge>, includeCard = false) =>
    items.map(item => {
      const amount = parseNum(item.amount)
      const myPct = parseNum(item.my_contribution_percentage)
      const partnerPct = parseNum(item.partner_contribution_percentage)
      const absAmt = Math.abs(amount)
      const sign = amount < 0 ? -1 : 1
      const myValue = parseFloat((absAmt * myPct / 100 * sign).toFixed(2))
      const partnerValue = parseFloat((absAmt * partnerPct / 100 * sign).toFixed(2))

      const row: Record<string, any> = {
        'Data': formatDateBR(item.date),
      }

      if (includeCard) {
        row['Mês Fatura'] = formatYearMonth(item.year_month)
      }

      row['Conta'] = (item as any)._account
      const installmentSuffix = (item.current_installment && item.total_installments && item.total_installments > 1)
        ? ` ${item.current_installment}/${item.total_installments}`
        : ''
      row['Descrição'] = (item.description || '') + installmentSuffix
      row['Tag'] = item.tag_name || ''
      row['Subtag'] = item.subtag_name || ''

      if (includeCard) {
        row['Cartão'] = item.card_name || ''
        row['Nº Cartão'] = item.card_number
          ? `****${String(item.card_number).slice(-4)}`
          : ''
      }

      row['Valor'] = absoluteValues ? Math.abs(amount) : amount
      row[mainName] = absoluteValues ? Math.abs(myValue) : myValue
      row[partnerName] = absoluteValues ? Math.abs(partnerValue) : partnerValue

      return row
    })

  const wb = XLSX.utils.book_new()

  // Aba 1: Extrato (apenas se houver itens)
  if (bankItems.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(bankItems)), 'Extrato')
  }

  // Aba 2: Cartão (apenas se houver itens)
  if (cardItems.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(cardItems, true)), 'Cartão')
  }

  // Aba 3: Benefício (apenas se houver itens)
  if (benefitItems.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(benefitItems, true)), 'Benefício')
  }

  // Aba 4: Pagamentos Parciais (apenas se houver pagamentos)
  const closurePayments = closure.closure_payments || []
  if (closurePayments.length > 0) {
    const parseNum = (v: any): number => {
      if (typeof v === 'number') return v
      if (typeof v === 'string') return parseFloat(v) || 0
      return 0
    }

    // net_balance no objeto é sempre da perspectiva da conta principal;
    // se o usuário logado é a contraparte, invertemos o sinal para a perspectiva correta
    const rawNetBalance = parseNum(closure.net_balance ?? 0) * (isCounterpart ? -1 : 1)
    const sign = rawNetBalance >= 0 ? 1 : -1                      // para propagar o sinal ao saldo restante
    const netBalanceAbs = Math.abs(rawNetBalance)
    const totalPaid = parseNum(closure.total_paid ?? 0)           // sempre positivo (magnitude paga)
    const remainingAbs = parseNum(closure.remaining_balance ?? netBalanceAbs)  // sempre positivo (magnitude restante)
    const isSettled = closure.is_settled ?? false

    // Saldo do fechamento: respeita o sinal (negativo = devedor, positivo = credor)
    const netBalanceDisplay = absoluteValues ? netBalanceAbs : rawNetBalance
    // Saldo restante: mesmo sinal que o fechamento (reduz conforme pagamentos)
    const remainingDisplay = absoluteValues ? Math.max(0, remainingAbs) : sign * Math.max(0, remainingAbs)

    // Linhas de resumo no topo da aba
    const summaryRows: Record<string, any>[] = [
      { 'Campo': 'Saldo do fechamento', 'Valor': parseFloat(netBalanceDisplay.toFixed(2)) },
      { 'Campo': 'Total pago', 'Valor': parseFloat(totalPaid.toFixed(2)) },
      { 'Campo': 'Saldo restante', 'Valor': parseFloat(remainingDisplay.toFixed(2)) },
      { 'Campo': 'Status', 'Valor': isSettled ? 'Quitado' : 'Em aberto' },
      { 'Campo': '', 'Valor': '' }, // linha em branco separadora
    ]

    // Linhas de pagamentos com saldo acumulado (do mais antigo para o mais novo)
    const sortedPayments = [...closurePayments].sort(
      (a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime()
    )
    let accumulated = 0
    const paymentRows: Record<string, any>[] = sortedPayments.map(p => {
      const amount = parseNum(p.amount)                           // magnitude sempre positiva
      accumulated += amount
      const saldoRestanteAbs = Math.max(0, netBalanceAbs - accumulated)
      // Valor Pago e Acumulado: herdam o sinal do fechamento (se absoluto, sem sinal)
      const valorPagoDisplay = absoluteValues ? amount : sign * amount
      const acumuladoDisplay = absoluteValues ? accumulated : sign * accumulated
      // Saldo restante por linha: herda o sinal do fechamento
      const saldoRestanteDisplay = absoluteValues ? saldoRestanteAbs : sign * saldoRestanteAbs
      return {
        'Data': formatDateBR(p.payment_date),
        'Valor Pago': parseFloat(valorPagoDisplay.toFixed(2)),
        'Observações': p.notes || '',
        'Acumulado': parseFloat(acumuladoDisplay.toFixed(2)),
        'Saldo Restante': parseFloat(saldoRestanteDisplay.toFixed(2)),
      }
    })

    // Combinar resumo + pagamentos em uma única sheet
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows)
    XLSX.utils.sheet_add_json(wsSummary, paymentRows, { origin: summaryRows.length + 1, skipHeader: false })
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Pagamentos')
  }

  // Nome do arquivo
  const sanitize = (name: string) =>
    name.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase()

  const fmtDate = (dateStr: string): string => {
    const d = new Date(dateStr)
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
  }

  const fileName = `fechamento_${sanitize(mainName)}_${sanitize(partnerName)}_${fmtDate(closure.period_start_date)}_a_${fmtDate(closure.closing_date)}.xlsx`
  XLSX.writeFile(wb, fileName)
}

// ─── Resultado da exportação separada ────────────────────────────────────────

/**
 * Resultado da exportação separada
 */
export interface ExportSeparadoResult {
  extratos: number
  faturas: number
  beneficios: number
  total: number
}

/**
 * Exporta dados filtrados para 3 arquivos Excel separados (um por tipo)
 * Ideal para reimportação posterior
 */
export function exportToExcelSeparado(expenses: ExpenseExportData[], options: ExportOptions = {}): ExportSeparadoResult {
  // Separa por fonte
  const bankStatements = expenses.filter(e => e.source === 'bank')
  const cardInvoices = expenses.filter(e => e.source === 'card')
  const benefits = expenses.filter(e => e.source === 'benefit')

  // Gera prefixo com data
  const today = new Date()
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`

  // Arquivo 1: Extratos Bancários
  if (bankStatements.length > 0) {
    const wb = XLSX.utils.book_new()
    const data = convertBankStatements(bankStatements, options)
    const ws = XLSX.utils.json_to_sheet(data)
    XLSX.utils.book_append_sheet(wb, ws, 'Extratos')
    XLSX.writeFile(wb, `extratos_${dateStr}.xlsx`)
  }

  // Arquivo 2: Faturas de Cartão
  if (cardInvoices.length > 0) {
    const wb = XLSX.utils.book_new()
    const data = convertCardInvoices(cardInvoices, options)
    const ws = XLSX.utils.json_to_sheet(data)
    XLSX.utils.book_append_sheet(wb, ws, 'Faturas')
    XLSX.writeFile(wb, `faturas_${dateStr}.xlsx`)
  }

  // Arquivo 3: Benefícios
  if (benefits.length > 0) {
    const wb = XLSX.utils.book_new()
    const data = convertBenefits(benefits, options)
    const ws = XLSX.utils.json_to_sheet(data)
    XLSX.utils.book_append_sheet(wb, ws, 'Benefícios')
    XLSX.writeFile(wb, `beneficios_${dateStr}.xlsx`)
  }

  return {
    extratos: bankStatements.length,
    faturas: cardInvoices.length,
    beneficios: benefits.length,
    total: expenses.length
  }
}

