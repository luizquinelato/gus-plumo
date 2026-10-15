/**
 * Utilitário para exportar dados do Extrato para Excel
 * Gera arquivo com 3 abas no formato compatível com importação
 */

import { filterRegularLoanPayments, getSettlementCreditEntries } from './closureCreditUtils'
import { expenseDateToExcelSerial, percentToExcel, roundExportMoney } from './excelCellFormat'
import { EXTRATO_DAILY_BALANCE_SOURCE as DAILY_BALANCE_SOURCE, localDateKeyFromIso } from './extratoDailyBalance'
import {
  downloadExcel,
  downloadExcelSafe,
  excelDateStamp,
  type ExcelCell,
  type ExcelColumnKind,
  type ExcelSheetSpec,
} from './excelExportClient'

// Planilhas reimportáveis pelo wizard /importar: números sem símbolo de moeda.
const SHARING_KINDS: Record<string, ExcelColumnKind> = { 'Parte na sua conta (%)': 'percent' }
const BANK_KINDS: Record<string, ExcelColumnKind> = {
  Ano: 'int', Mês: 'month', 'Data e hora': 'datetime', Valor: 'money', ...SHARING_KINDS,
}
const CARD_KINDS: Record<string, ExcelColumnKind> = {
  Ano: 'int', Mês: 'month', Data: 'date', Valor: 'money', ...SHARING_KINDS,
}
const BENEFIT_KINDS: Record<string, ExcelColumnKind> = {
  Data: 'datetime', Valor: 'money', ...SHARING_KINDS,
}

export interface ExpenseExportData {
  id: number
  date: string
  description: string
  amount: number
  source: string
  card_number: string | null
  card_name: string | null
  category: string | null
  transaction?: string | null
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
  issuer?: 'btg' | 'mercadopago' | null
  /** Saldo diário: última linha do mês civil. */
  daily_month_end?: boolean
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
  /** Colunas de compartilhamento; padrão: true. */
  includeSharing?: boolean
  /** 'separate' (padrão): uma aba por fonte; 'unified': uma única aba. */
  mode?: 'unified' | 'separate'
  /** Linhas de saldo diário, adicionadas a cada aba. */
  dailyBalanceRows?: ExpenseExportData[]
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
    'Parte na sua conta (%)': hasSharing && exp.ownership_percentage != null ? percentToExcel(Number(exp.ownership_percentage)) : ''
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
      'Ano': Number(year),
      'Mês': Number(month),
      'Data e hora': expenseDateToExcelSerial(exp.date),
      'Categoria': exp.category || '',
      'Transação': exp.transaction || '',
      'Descrição': exp.description,
      'Valor': roundExportMoney(exp.amount),
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

    // Mesmo sinal do banco: negativo = despesa, positivo = estorno/receita
    const valorExportado = exp.amount

    const record = {
      'Ano': Number(year),
      'Mês': Number(month),
      'Cartão': exp.card_number || '',
      'Titular': exp.card_name || '',
      'Data': expenseDateToExcelSerial(exp.date, true),
      'Descrição': descricaoCompleta,
      'Descrição Limpa': exp.description,
      'Valor': roundExportMoney(valorExportado),
      'Tag': exp.tag_name || '',
      'Subtag': exp.subtag_name || '',
      'Emissor': exp.issuer === 'mercadopago' ? 'Mercado Pago' : exp.issuer === 'btg' ? 'BTG' : '',
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
      'Data': expenseDateToExcelSerial(exp.date),
      'Cartão': cardLast4,
      'Movimentação': exp.description,
      'Valor': roundExportMoney(exp.amount),
      'Meio de Pagamento': exp.card_name || 'Benefício',
      'Saldo': '',                       // Não temos essa informação
      'Tag': exp.tag_name || '',
      'Subtag': exp.subtag_name || ''
    }
    return addSharingColumns(record, exp, options.includeSharing || false)
  })
}

const UNIFIED_KINDS: Record<string, ExcelColumnKind> = {
  'Data e hora': 'datetime', Valor: 'money', ...SHARING_KINDS,
}

const UNIFIED_SOURCE_LABEL: Record<string, string> = {
  bank: 'Extrato', card: 'Fatura', benefit: 'Benefício',
}

/**
 * Mescla as linhas da aba com o saldo diário, ordenadas por data.
 * O saldo só entra nos dias em que a própria aba tem lançamento, e o destaque de "fim do mês"
 * vai para o último desses dias em cada mês (não necessariamente o último dia do calendário).
 */
export function withDailyBalance(rows: ExpenseExportData[], daily: ExpenseExportData[]): ExpenseExportData[] {
  if (daily.length === 0) return rows
  const dayOf = (r: ExpenseExportData) => r.year_month && r.source === DAILY_BALANCE_SOURCE ? r.year_month : localDateKeyFromIso(r.date)
  const daysWithEntries = new Set(rows.map(r => localDateKeyFromIso(r.date)))
  const kept = daily.filter(d => daysWithEntries.has(dayOf(d)))

  const lastDayByMonth = new Map<string, string>()
  for (const d of kept) {
    const day = dayOf(d)
    if (!day) continue
    const month = day.slice(0, 7)
    if (!lastDayByMonth.has(month) || day > lastDayByMonth.get(month)!) lastDayByMonth.set(month, day)
  }
  const marked = kept.map(d => {
    const day = dayOf(d)
    const isEnd = !!day && lastDayByMonth.get(day.slice(0, 7)) === day
    const base = d.description.replace(' · Final do mês', '')
    const label = base.split(' · ').pop()
    const description = base.startsWith('Saldo cumulativo')
      ? `Saldo cumulativo${isEnd ? ' · Final do mês' : ''} · ${label}`
      : d.description
    return { ...d, daily_month_end: isEnd, description }
  })
  return [...rows, ...marked].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

/** Estilo de linha enviado ao motor: saldo diário comum e saldo de fim de mês. */
export function rowStyles(rows: ExpenseExportData[]): string[] {
  return rows.map(r => (r.source !== DAILY_BALANCE_SOURCE ? '' : r.daily_month_end ? 'daily_month_end' : 'daily'))
}

/** Uma única aba com extrato e benefícios (e faturas, se houver), já ordenados por data. */
function convertUnified(expenses: ExpenseExportData[], options: ExportOptions): any[] {
  return expenses
    .map(exp => addSharingColumns({
      'Data e hora': expenseDateToExcelSerial(exp.date),
      'Fonte': UNIFIED_SOURCE_LABEL[exp.source] ?? 'Saldo diário',
      'Descrição': exp.description,
      'Valor': roundExportMoney(exp.amount),
      'Tag': exp.tag_name || '',
      'Subtag': exp.subtag_name || '',
    }, exp, options.includeSharing ?? true))
}

/**
 * Exporta dados filtrados para Excel.
 * - 'separate' (padrão): uma aba por fonte (extrato, benefícios e faturas, se houver).
 * - 'unified': uma única aba com tudo.
 * Linhas de saldo diário (options.dailyBalanceRows) entram em cada aba.
 */
export async function exportToExcel(expenses: ExpenseExportData[], filename?: string, options: ExportOptions = {}): Promise<void> {
  const opts: ExportOptions = { ...options, includeSharing: options.includeSharing ?? true }
  const daily = opts.dailyBalanceRows ?? []

  const bankStatements = expenses.filter(e => e.source === 'bank')
  const cardInvoices = expenses.filter(e => e.source === 'card')
  const benefits = expenses.filter(e => e.source === 'benefit')

  const sheets: ExcelSheetSpec[] = []
  if (opts.mode === 'unified') {
    if (expenses.length > 0) {
      const merged = withDailyBalance([...expenses].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()), daily)
      sheets.push({ name: 'Extrato e Benefícios', rows: convertUnified(merged, opts), kinds: UNIFIED_KINDS, row_styles: rowStyles(merged) })
    }
  } else {
    if (bankStatements.length > 0) {
      const merged = withDailyBalance(bankStatements, daily)
      sheets.push({ name: 'Extratos Bancários', rows: convertBankStatements(merged, opts), kinds: BANK_KINDS, row_styles: rowStyles(merged) })
    }
    if (cardInvoices.length > 0) {
      sheets.push({ name: 'Faturas de Cartão', rows: convertCardInvoices(cardInvoices, opts), kinds: CARD_KINDS })
    }
    if (benefits.length > 0) {
      const merged = withDailyBalance(benefits, daily)
      sheets.push({ name: 'Benefícios', rows: convertBenefits(merged, opts), kinds: BENEFIT_KINDS, row_styles: rowStyles(merged) })
    }
  }
  if (sheets.length === 0) return

  await downloadExcel(filename || `extrato_exportado_${excelDateStamp()}.xlsx`, sheets)
}

export interface FaturaReportExportItem {
  date: string
  description: string
  amount: number
  card_number: string
  card_name: string
  tag_name?: string
  subtag_name?: string
  current_installment?: number | null
  total_installments?: number | null
  year_month: string
  ownership_percentage?: number
  shared_partner_name?: string
  issuer?: 'btg' | 'mercadopago' | null
}

/** Excel do relatório de faturas, no formato que o wizard /importar reimporta. */
export async function exportFaturasReport(
  items: FaturaReportExportItem[],
  options: { mode?: 'unified' | 'separate' } = {},
): Promise<void> {
  const cardKey = (i: FaturaReportExportItem) => `${i.card_name} ${i.card_number}`
  const byCardThenDate = (a: FaturaReportExportItem, b: FaturaReportExportItem) =>
    a.year_month.localeCompare(b.year_month) ||
    cardKey(a).localeCompare(cardKey(b)) ||
    new Date(a.date).getTime() - new Date(b.date).getTime()
  const toSheet = (name: string, list: FaturaReportExportItem[]): ExcelSheetSpec => ({
    name,
    rows: convertCardInvoices(toCardExpenses([...list].sort(byCardThenDate)), { includeSharing: true }),
    kinds: CARD_KINDS,
  })
  if (options.mode !== 'unified') {
    const months = [...new Set(items.map((i) => i.year_month))].sort().reverse()
    await downloadExcel(
      `faturas_${excelDateStamp()}.xlsx`,
      months.map((ym) => toSheet(ym, items.filter((i) => i.year_month === ym))),
    )
    return
  }
  await downloadExcel(`faturas_${excelDateStamp()}.xlsx`, [toSheet('Faturas de Cartão', items)])
}

function toCardExpenses(items: FaturaReportExportItem[]): ExpenseExportData[] {
  return items.map((item, index) => ({
    id: index,
    date: item.date,
    description: item.description,
    amount: item.amount,
    source: 'card',
    card_number: item.card_number,
    card_name: item.card_name,
    category: null,
    subtag_id: null,
    subtag_name: item.subtag_name ?? null,
    tag_name: item.tag_name ?? null,
    current_installment: item.current_installment ?? null,
    total_installments: item.total_installments ?? null,
    adjustment_type: null,
    ownership_percentage: item.ownership_percentage ?? null,
    shared_partner_id: item.shared_partner_name ? 1 : null,
    shared_partner_name: item.shared_partner_name ?? null,
    shared_partner_bank: null,
    shared_partner_agency: null,
    shared_partner_account_number: null,
    account_id: null,
    account_name: null,
    bank_code: null,
    bank_name: null,
    account_agency: null,
    account_number: null,
    year_month: item.year_month,
    issuer: item.issuer ?? null,
  }))
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

interface LoanPaymentItemForExcel {
  loan_id: number
  loan_type: 'lent' | 'borrowed'
  description: string
  original_amount: number
  remaining_before: number
  amount_paid: number
  remaining_after: number
  is_settled?: boolean
  generated_on_settlement?: boolean
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
    loan_payments?: LoanPaymentItemForExcel[]
  }
}

/**
 * Exporta fechamento de balanço para Excel com 3 abas: Extrato, Cartão e Benefício
 */
export async function exportBalanceClosureToExcel(closure: BalanceClosureForExcel, absoluteValues: boolean = false, isCounterpart: boolean = false): Promise<void> {
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
        ? ` (${item.current_installment}/${item.total_installments})`
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

  const sheets: ExcelSheetSpec[] = []
  const itemKinds: Record<string, ExcelColumnKind> = {
    Valor: 'money',
    [mainName]: 'money',
    [partnerName]: 'money',
    'Nº Cartão': 'text',
  }

  // Aba 1: Extrato (apenas se houver itens)
  if (bankItems.length > 0) {
    sheets.push({ name: 'Extrato', rows: toRows(bankItems), kinds: itemKinds })
  }

  // Aba 2: Cartão (apenas se houver itens)
  if (cardItems.length > 0) {
    sheets.push({ name: 'Cartão', rows: toRows(cardItems, true), kinds: itemKinds })
  }

  // Aba 3: Benefício (apenas se houver itens)
  if (benefitItems.length > 0) {
    sheets.push({ name: 'Benefício', rows: toRows(benefitItems, true), kinds: itemKinds })
  }

  // Aba 4: Empréstimos (liquidações do período; sem crédito da quitação)
  const loanPayments = filterRegularLoanPayments(
    (closure.closure_data as any).loan_payments as LoanPaymentItemForExcel[] | undefined
  )
  if (loanPayments.length > 0) {
    const loanRows = loanPayments.map(lp => {
      const isLent = lp.loan_type === 'lent'
      const typeLabel = isLent ? 'Emprestei' : 'Peguei'
      // Lent: dinheiro saiu → principal negativo; Borrowed: dinheiro entrou → principal positivo
      const sign = isLent ? -1 : 1
      const principal   = absoluteValues ? Math.abs(lp.original_amount)  : sign * lp.original_amount
      const saldoAntes  = absoluteValues ? Math.abs(lp.remaining_before) : sign * lp.remaining_before
      // Valor quitado: sentido inverso (lent = recebe de volta; borrowed = paga)
      const valorQuitado = absoluteValues ? Math.abs(lp.amount_paid) : -sign * lp.amount_paid
      const saldoApos   = absoluteValues ? Math.abs(lp.remaining_after) : sign * lp.remaining_after
      return {
        'Tipo': typeLabel,
        'Descrição': lp.description || 'Empréstimo',
        'Principal': parseFloat(principal.toFixed(2)),
        'Saldo Antes': parseFloat(saldoAntes.toFixed(2)),
        'Valor Quitado': parseFloat(valorQuitado.toFixed(2)),
        'Saldo Após': parseFloat(saldoApos.toFixed(2)),
        'Status': lp.is_settled ? 'Quitado' : 'Parcial',
      }
    })
    sheets.push({
      name: 'Empréstimos',
      rows: loanRows,
      kinds: { Principal: 'money', 'Saldo Antes': 'money', 'Valor Quitado': 'money', 'Saldo Após': 'money' },
    })
  }

  // Aba 5: Pagamentos Parciais (apenas se houver pagamentos)
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

    // Linhas de resumo no topo da aba (acima do cabeçalho da tabela de pagamentos)
    const summaryRows: ExcelCell[][] = [
      ['Saldo do fechamento', Number(netBalanceDisplay.toFixed(2))],
      ['Total pago', Number(totalPaid.toFixed(2))],
      ['Saldo restante', Number(remainingDisplay.toFixed(2))],
      ['Status', isSettled ? 'Quitado' : 'Em aberto'],
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

    // Resumo + pagamentos em uma única sheet
    sheets.push({
      name: 'Pagamentos',
      rows: paymentRows,
      preamble: summaryRows,
      kinds: { 'Valor Pago': 'money', Acumulado: 'money', 'Saldo Restante': 'money' },
    })
  }

  // Aba 6: Saldo gerado no pagamento a maior (após pagamentos, como no PDF)
  const settlementCredits = getSettlementCreditEntries(closure)
  if (settlementCredits.length > 0) {
    const formatSignedCredit = (value: number): number => {
      if (absoluteValues) return parseFloat(Math.abs(value).toFixed(2))
      return parseFloat(value.toFixed(2))
    }

    const creditRows = settlementCredits.map(credit => {
      const amount = Math.abs(parseNum(credit.original_amount ?? credit.remaining_after ?? 0))
      const signed = -amount // borrowed na mandante (mesma perspectiva do PDF)
      return {
        'Descrição': credit.description || 'Crédito da quitação',
        'Empréstimo': credit.loan_id ?? '',
        'Saldo a Pagar': formatSignedCredit(signed),
      }
    })

    const totalSigned = -settlementCredits.reduce(
      (sum, credit) => sum + Math.abs(parseNum(credit.original_amount ?? credit.remaining_after ?? 0)),
      0
    )

    sheets.push({
      name: 'Saldo Gerado',
      rows: creditRows,
      preamble: [[`Saldo a pagar na mandante (${mainName}) — crédito para o próximo fechamento`]],
      footer: [['TOTAL', '', formatSignedCredit(totalSigned)]],
      kinds: { 'Empréstimo': 'int', 'Saldo a Pagar': 'money' },
    })
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
  if (sheets.length === 0) return
  await downloadExcelSafe(fileName, sheets)
}

// ─── Exportação de mapeamentos de transação ───────────────────────────────────

export interface TransactionMappingExportItem {
  id: number
  mapping_type: string
  original_description: string | null
  pattern: string | null
  regex_pattern: string | null
  mapped_description: string | null
  priority: number
  subtag_type: string | null
  tag_name: string | null
  subtag_name: string | null
  shared_partner_name: string | null
  my_contribution_percentage: number | null
  revenue_contribution_percentage: number | null
  is_sensitive: boolean
}

export interface TransactionMappingExportOptions {
  filterSummary?: string
  searchTerm?: string
}

const mappingExportMatchLabel = (mappingType: string): string => {
  if (mappingType === 'exact') return 'Exato'
  if (mappingType === 'pattern') return 'Padrão'
  return 'Regex'
}

const mappingExportPriorityLabel = (priority: number): string => {
  if (priority === 0) return 'Alta'
  if (priority === 1) return 'Média'
  return 'Baixa'
}

const mappingExportCriterion = (item: TransactionMappingExportItem): string => {
  if (item.is_sensitive) return '(conteúdo sensível)'
  if (item.mapping_type === 'exact') return item.original_description ?? ''
  if (item.mapping_type === 'pattern') return item.pattern ?? ''
  return item.regex_pattern ?? ''
}

const mappingExportMappedDescription = (item: TransactionMappingExportItem): string => {
  if (item.is_sensitive && item.mapped_description) return '(conteúdo sensível)'
  return item.mapped_description ?? ''
}

const mappingExportContribution = (item: TransactionMappingExportItem): number | '' => {
  const pct =
    item.subtag_type === 'receita'
      ? (item.revenue_contribution_percentage ?? item.my_contribution_percentage)
      : item.my_contribution_percentage
  if (pct == null || Number.isNaN(Number(pct))) return ''
  return percentToExcel(Number(pct))
}

export async function exportTransactionMappingsToExcel(
  items: TransactionMappingExportItem[],
  options: TransactionMappingExportOptions = {},
): Promise<void> {
  if (!items.length) return

  const now = new Date()

  const rows = items.map((item) => ({
    ID: item.id,
    Match: mappingExportMatchLabel(item.mapping_type),
    Critério: mappingExportCriterion(item),
    Prioridade: mappingExportPriorityLabel(item.priority ?? 2),
    'Descrição mapeada': mappingExportMappedDescription(item),
    Tipo: item.subtag_type === 'receita' ? 'Receita' : 'Despesa',
    Tag: item.tag_name ?? '',
    Subtag: item.subtag_name ?? '',
    'Conta parceira': item.shared_partner_name ?? '',
    'Contribuição (%)': mappingExportContribution(item),
    Sensível: item.is_sensitive ? 'Sim' : 'Não',
  }))

  const metaRows: { Campo: string; Valor: string }[] = [
    { Campo: 'Gerado em', Valor: now.toLocaleString('pt-BR') },
    { Campo: 'Total', Valor: String(items.length) },
  ]
  if (options.filterSummary?.trim()) {
    metaRows.push({ Campo: 'Filtros', Valor: options.filterSummary.trim() })
  }
  if (options.searchTerm?.trim()) {
    metaRows.push({ Campo: 'Busca', Valor: options.searchTerm.trim() })
  }

  await downloadExcelSafe(`mapeamentos_${excelDateStamp(now)}_${items.length}.xlsx`, [
    {
      name: 'Mapeamentos',
      rows,
      // Critério regex como texto puro — evita Excel alterar \b, \s, etc.
      kinds: { ID: 'int', Critério: 'text', 'Contribuição (%)': 'percent' },
    },
    { name: 'Info', rows: metaRows, kinds: { Valor: 'text' } },
  ])
}

