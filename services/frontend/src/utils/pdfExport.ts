import { filterRegularLoanPayments, getSettlementCreditEntries, type ClosureLoanPaymentEntry } from './closureCreditUtils'
import { downloadPdf, type PdfBlock, type PdfColumn, type PdfTone } from './pdfExportClient'

/**
 * PDFs de fechamento de balanço e de faturas da Home.
 * Geração no backend (ReportLab) via `downloadPdf`; aqui só montamos os blocos.
 */

interface TransactionItem {
  id: number
  date: string
  description: string
  amount: number
  tag_name?: string | null
  subtag_name?: string | null
  my_contribution_percentage: number
  partner_contribution_percentage: number
  year_month?: string
  card_name?: string
  card_number?: string
  current_installment?: number | null
  total_installments?: number | null
}

interface AccountBalanceCard {
  account_id: number
  account_name: string
  bank_name: string | null
  agency: string | null
  account_number: number | string | null
  total_expenses: number
  total_revenues: number
  total_to_receive?: number
  total_to_pay?: number
  net_amount: number
  contribution_percentage: number
  expense_items: TransactionItem[]
  revenue_items: TransactionItem[]
  credit_card_expense_items: TransactionItem[]
  credit_card_revenue_items: TransactionItem[]
  benefit_card_expense_items: TransactionItem[]
  benefit_card_revenue_items: TransactionItem[]
}

interface LoanPaymentItem {
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

interface ClosurePaymentItem {
  id: number
  amount: number
  payment_date: string
  notes: string | null
}

interface BalanceClosure {
  id: number
  period_start_date: string
  closing_date: string
  year: number
  month: number
  total_to_receive: number
  total_to_pay: number
  net_balance: number
  is_settled?: boolean
  total_paid?: number
  remaining_balance?: number
  notes: string | null
  closure_payments?: ClosurePaymentItem[]
  closure_data: {
    main_account_card: AccountBalanceCard
    partner_account_card: AccountBalanceCard
    loan_payments?: LoanPaymentItem[]
  }
}

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(value)
    .replace(/\s/g, ' ')

const formatDate = (dateStr: string): string => new Date(dateStr).toLocaleDateString('pt-BR')

const formatDateTime = (dateStr: string): string => {
  const date = new Date(dateStr)
  const datePart = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timePart = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${datePart} ${timePart}`
}

const formatAgencyMask = (agency: string | null): string =>
  agency ? `${String(agency).padStart(5, '0')}-0` : ''

const formatAccountMask = (accountNumber: number | string | null): string =>
  accountNumber ? `${String(accountNumber).padStart(9, '0')}-6` : ''

const parseNumeric = (value: unknown): number => {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return parseFloat(value) || 0
  return 0
}

const sanitizeFileName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()

const dashDate = (d: Date): string =>
  `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`

const right = (header: string): PdfColumn => ({ header, align: 'right' })
const center = (header: string): PdfColumn => ({ header, align: 'center' })

/** Verde se positivo, vermelho se negativo, sem cor se zero. */
const signTone = (value: number): PdfTone | null => (value > 0 ? 'positive' : value < 0 ? 'negative' : null)

/** Valor com sinal explícito (0 sem sinal); `absoluteValues` remove o sinal. */
const signed = (value: number, absoluteValues: boolean, plus = true): string => {
  if (value === 0) return formatCurrency(0)
  if (absoluteValues) return formatCurrency(Math.abs(value))
  return (value < 0 ? '-' : plus ? '+' : '') + formatCurrency(Math.abs(value))
}

// ==================== FECHAMENTO DE BALANÇO ====================

const transactionBlocks = (
  title: string,
  items: TransactionItem[],
  mainName: string,
  partnerName: string,
  absoluteValues: boolean,
): PdfBlock[] => {
  if (!items.length) return []
  const rows: string[][] = []
  const tones: (PdfTone | null)[][] = []
  let total = 0
  let totalMine = 0
  let totalPartner = 0
  items.forEach((item) => {
    const amount = parseNumeric(item.amount)
    const mine = amount * (parseNumeric(item.my_contribution_percentage) / 100)
    const partner = amount * (parseNumeric(item.partner_contribution_percentage) / 100)
    total += amount
    totalMine += mine
    totalPartner += partner
    const installment =
      item.current_installment && item.total_installments && item.total_installments > 1
        ? ` (${item.current_installment}/${item.total_installments})`
        : ''
    const category = item.tag_name ? `${item.tag_name}${item.subtag_name ? ' > ' + item.subtag_name : ''}` : '-'
    const tone: PdfTone = amount < 0 ? 'negative' : 'positive'
    rows.push([
      formatDate(item.date),
      `${item.description || ''}${installment}`,
      category,
      signed(amount, absoluteValues),
      signed(mine, absoluteValues),
      signed(partner, absoluteValues),
    ])
    tones.push([null, null, null, tone, tone, tone])
  })
  return [
    { type: 'heading', text: title },
    {
      type: 'table',
      font_size: 7,
      columns: [
        { header: 'Data', width_mm: 18 },
        { header: 'Descrição' },
        { header: 'Categoria', width_mm: 32 },
        { ...right('Valor'), width_mm: 26 },
        { ...right(mainName || 'Principal'), width_mm: 26 },
        { ...right(partnerName || 'Contraparte'), width_mm: 26 },
      ],
      rows,
      tones,
      footer: ['TOTAL', '', '', signed(total, absoluteValues), signed(totalMine, absoluteValues), signed(totalPartner, absoluteValues)],
      footer_tones: [null, null, null, signTone(total), signTone(totalMine), signTone(totalPartner)],
    },
  ]
}

/** Uma tabela por cartão (crédito/benefício), título "Nome (****1234)". */
const cardGroupBlocks = (
  items: TransactionItem[],
  mainName: string,
  partnerName: string,
  absoluteValues: boolean,
  ownerName?: string,
): PdfBlock[] => {
  const groups = new Map<string, TransactionItem[]>()
  items.forEach((item) => {
    const key = item.card_name || 'Sem Cartão'
    groups.set(key, [...(groups.get(key) ?? []), item])
  })
  return [...groups.entries()].flatMap(([name, list]) => {
    const last4 = list[0]?.card_number ? list[0].card_number!.slice(-4) : ''
    const title = `${ownerName ? `${ownerName} · ` : ''}${name}${last4 ? ` (****${last4})` : ''}`
    return transactionBlocks(title, list, mainName, partnerName, absoluteValues)
  })
}


const paymentsBlocks = (
  payments: ClosurePaymentItem[],
  summary: { netBalance: number; totalPaid: number; remainingAbs: number; isSettled: boolean },
  absoluteValues: boolean,
): PdfBlock[] => {
  const sign = summary.netBalance >= 0 ? 1 : -1
  const netAbs = Math.abs(summary.netBalance)
  const fmtBalance = formatCurrency(absoluteValues ? netAbs : summary.netBalance)
  const remainingShown = Math.max(0, summary.remainingAbs)
  const fmtRemaining = formatCurrency(absoluteValues ? remainingShown : sign * remainingShown)
  const line =
    `Saldo do fechamento: ${fmtBalance}   |   Total pago: ${formatCurrency(summary.totalPaid)}` +
    `   |   Saldo restante: ${fmtRemaining}   |   Status: ${summary.isSettled ? 'Quitado' : 'Em aberto'}`

  let accumulated = 0
  const rows: string[][] = []
  const tones: (PdfTone | null)[][] = []
  payments.forEach((p) => {
    const amount = parseNumeric(p.amount)
    accumulated += amount
    const remainingAbs = Math.max(0, netAbs - accumulated)
    rows.push([
      new Date(p.payment_date).toLocaleDateString('pt-BR'),
      formatCurrency(amount),
      p.notes || '-',
      formatCurrency(accumulated),
      formatCurrency(absoluteValues ? remainingAbs : sign * remainingAbs),
    ])
    tones.push([null, 'positive', null, 'positive', netAbs - accumulated <= 0.01 ? 'positive' : 'negative'])
  })
  return [
    { type: 'heading', text: 'Histórico de Pagamentos' },
    { type: 'text', text: line, tone: 'muted' },
    {
      type: 'table',
      font_size: 7,
      columns: [{ header: 'Data', width_mm: 22 }, right('Valor Pago'), { header: 'Observações' }, right('Acumulado'), right('Saldo Restante')],
      rows,
      tones,
      footer: ['TOTAL', formatCurrency(summary.totalPaid), '', formatCurrency(accumulated), fmtRemaining],
      footer_tones: [null, 'positive', null, 'positive', summary.remainingAbs <= 0.01 ? 'positive' : 'negative'],
    },
  ]
}

const settlementBlocks = (credits: ClosureLoanPaymentEntry[], mainName: string, absoluteValues: boolean): PdfBlock[] => {
  const amounts = credits.map((c) => Math.abs(c.original_amount || c.remaining_after || 0))
  const fmt = (v: number) => signed(-v, absoluteValues, false)
  return [
    {
      type: 'text',
      italic: true,
      tone: 'muted',
      text: mainName
        ? `Saldo a pagar na mandante (${mainName}) — crédito para o próximo fechamento`
        : 'Saldo a pagar na mandante — crédito para o próximo fechamento',
    },
    {
      type: 'table',
      font_size: 7,
      columns: [{ header: 'Descrição' }, { header: 'Empréstimo' }, right('Saldo a Pagar')],
      rows: credits.map((c, i) => [c.description || 'Crédito da quitação', String(c.loan_id ?? '-'), fmt(amounts[i])]),
      tones: credits.map(() => [null, null, 'negative'] as (PdfTone | null)[]),
      footer: ['TOTAL', '', fmt(amounts.reduce((s, v) => s + v, 0))],
      footer_tones: [null, null, 'negative'],
    },
  ]
}

const loanBlocks = (payments: LoanPaymentItem[], mainName: string, absoluteValues: boolean): PdfBlock[] => {
  const fmt = (v: number) => signed(v, absoluteValues, false)
  const totals = [0, 0, 0, 0]
  const rows: string[][] = []
  const tones: (PdfTone | null)[][] = []
  payments.forEach((p) => {
    const lent = p.loan_type === 'lent'
    const vals = [
      lent ? -(p.original_amount || 0) : p.original_amount || 0,
      lent ? -(p.remaining_before || 0) : p.remaining_before || 0,
      lent ? p.amount_paid || 0 : -(p.amount_paid || 0),
      lent ? p.remaining_after || 0 : -(p.remaining_after || 0),
    ]
    vals.forEach((v, i) => (totals[i] += v))
    rows.push([lent ? 'Emprestei' : 'Peguei', p.description || 'Empréstimo', ...vals.map(fmt), p.is_settled ? 'Quitado' : 'Parcial'])
    tones.push([null, null, ...vals.map(signTone), null])
  })
  return [
    { type: 'heading', text: 'Empréstimos' },
    {
      type: 'text',
      italic: true,
      tone: 'muted',
      text: mainName ? `Dados referentes à perspectiva de ${mainName}` : 'Dados referentes à perspectiva da Conta Principal',
    },
    {
      type: 'table',
      font_size: 7,
      columns: [
        { header: 'Tipo', width_mm: 20 },
        { header: 'Descrição' },
        right('Principal'),
        right('Corrigido'),
        right('Vlr. Liquidado'),
        right('Saldo Após'),
        center('Status'),
      ],
      rows,
      tones,
      footer: ['TOTAL', '', ...totals.map(fmt), ''],
      footer_tones: [null, null, ...totals.map((t) => (t < 0 ? ('negative' as PdfTone) : null)), null],
    },
  ]
}

export const exportBalanceClosureToPDF = async (
  closure: BalanceClosure,
  isCounterpart: boolean = false,
  absoluteValues: boolean = false,
): Promise<void> => {
  const mainCard = closure.closure_data?.main_account_card
  const partnerCard = closure.closure_data?.partner_account_card
  if (!mainCard || !partnerCard) {
    console.error('Dados de closure incompletos')
    return
  }

  const viewer = isCounterpart ? partnerCard : mainCard
  const other = isCounterpart ? mainCard : partnerCard
  const accountRow = (label: string, c: AccountBalanceCard) => [
    label,
    c.account_name || '-',
    c.bank_name || '-',
    c.agency ? formatAgencyMask(c.agency) : '-',
    c.account_number ? formatAccountMask(c.account_number) : '-',
  ]

  const side = (c: AccountBalanceCard) => {
    const toReceive = parseNumeric(c.total_to_receive) + parseNumeric((c as any).loan_to_receive)
    const toPay = Math.abs(parseNumeric(c.total_to_pay)) + Math.abs(parseNumeric((c as any).loan_to_pay))
    return { toReceive, toPay, net: toReceive - toPay }
  }
  const v = side(viewer)
  const o = side(other)
  const fmtPay = (n: number) => (absoluteValues || n <= 0 ? formatCurrency(Math.max(n, 0)) : `-${formatCurrency(n)}`)
  const fmtNet = (n: number) => formatCurrency(absoluteValues ? Math.abs(n) : n)
  const summaryRow = (name: string, s: typeof v) => [name, formatCurrency(s.toReceive), fmtPay(s.toPay), fmtNet(s.net)]
  const summaryTones = (s: typeof v): (PdfTone | null)[] => [null, s.toReceive > 0 ? 'positive' : null, s.toPay > 0 ? 'negative' : null, signTone(s.net)]

  const finalText =
    v.net > 0
      ? `${other.account_name} deve pagar ${formatCurrency(v.net)} para ${viewer.account_name}`
      : v.net < 0
        ? `${viewer.account_name} deve pagar ${formatCurrency(Math.abs(v.net))} para ${other.account_name}`
        : 'Contas zeradas - nenhum pagamento necessário'

  const blocks: PdfBlock[] = [
    { type: 'heading', text: 'Contas do Fechamento' },
    {
      type: 'table',
      font_size: 9,
      columns: [{ header: '' }, { header: 'Nome' }, { header: 'Banco' }, center('Agência'), center('Conta')],
      rows: [accountRow('Principal', viewer), accountRow('Contraparte', other)],
      bold_columns: [0],
    },
    { type: 'heading', text: 'Resumo' },
    {
      type: 'table',
      font_size: 9,
      columns: [{ header: 'Conta' }, right('Total a Receber'), right('Total a Pagar'), right('Saldo')],
      rows: [summaryRow(viewer.account_name, v), summaryRow(other.account_name, o)],
      tones: [summaryTones(v), summaryTones(o)],
    },
    { type: 'text', text: finalText, bold: true },
  ]

  const names: [string, string] = [mainCard.account_name, partnerCard.account_name]
  const pairItems = (key: 'bank' | 'card' | 'benefit'): [TransactionItem[], TransactionItem[]] =>
    key === 'bank'
      ? [[...(mainCard.expense_items || []), ...(mainCard.revenue_items || [])], [...(partnerCard.expense_items || []), ...(partnerCard.revenue_items || [])]]
      : key === 'card'
        ? [[...(mainCard.credit_card_expense_items || []), ...(mainCard.credit_card_revenue_items || [])], [...(partnerCard.credit_card_expense_items || []), ...(partnerCard.credit_card_revenue_items || [])]]
        : [[...(mainCard.benefit_card_expense_items || [])], [...(partnerCard.benefit_card_expense_items || [])]]

  // Aba "Geral" do modal de itens: contas, resumo e empréstimos.
  const loanPayments = filterRegularLoanPayments(closure.closure_data.loan_payments || [])
  if (loanPayments.length) {
    blocks.push({ type: 'heading', text: 'EMPRÉSTIMOS' }, ...loanBlocks(loanPayments, mainCard.account_name, absoluteValues))
  }

  // Uma página por aba do modal (conta corrente, cartão de crédito, cartão benefício).
  const addSection = (title: string, key: 'bank' | 'card' | 'benefit') => {
    const [mainItems, partnerItems] = pairItems(key)
    if (!mainItems.length && !partnerItems.length) return
    blocks.push({ type: 'page_break' }, { type: 'heading', text: title })
    if (key === 'card') {
      // Ano-mês da fatura como título de seção, antes dos cartões.
      const months = [...new Set([...mainItems, ...partnerItems].map((i) => i.year_month || ''))].sort()
      months.forEach((ym) => {
        const monthLabel = /^\d{4}-\d{2}/.test(ym) ? `Fatura ${ym.slice(5, 7)}/${ym.slice(0, 4)}` : 'Fatura sem mês'
        blocks.push({ type: 'heading', text: monthLabel })
        const forMonth = (list: TransactionItem[]) => list.filter((i) => (i.year_month || '') === ym)
        blocks.push(
          ...cardGroupBlocks(forMonth(mainItems), names[0], names[1], absoluteValues, mainCard.account_name),
          ...cardGroupBlocks(forMonth(partnerItems), names[0], names[1], absoluteValues, partnerCard.account_name),
        )
      })
      return
    }
    const build = (label: string, list: TransactionItem[]) =>
      key === 'bank'
        ? transactionBlocks(label, list, names[0], names[1], absoluteValues)
        : cardGroupBlocks(list, names[0], names[1], absoluteValues)
    blocks.push(...build(mainCard.account_name, mainItems), ...build(partnerCard.account_name, partnerItems))
  }
  addSection('TRANSAÇÕES BANCÁRIAS', 'bank')
  addSection('CARTÕES DE CRÉDITO', 'card')
  addSection('CARTÕES DE BENEFÍCIOS', 'benefit')

  const closurePayments = closure.closure_payments || []
  if (closurePayments.length) {
    const rawNet = parseNumeric(closure.net_balance)
    blocks.push(
      { type: 'page_break' },
      { type: 'heading', text: 'PAGAMENTOS PARCIAIS' },
      ...paymentsBlocks(
        closurePayments,
        {
          netBalance: rawNet,
          totalPaid: parseNumeric(closure.total_paid ?? 0),
          remainingAbs: parseNumeric(closure.remaining_balance ?? Math.abs(rawNet)),
          isSettled: closure.is_settled ?? false,
        },
        absoluteValues,
      ),
    )
  }

  const credits = getSettlementCreditEntries(closure)
  if (credits.length) {
    blocks.push({ type: 'heading', text: 'SALDO GERADO NO PAGAMENTO A MAIOR' }, ...settlementBlocks(credits, mainCard.account_name, absoluteValues))
  }

  const fileName = `fechamento_${sanitizeFileName(mainCard.account_name || 'principal')}_${sanitizeFileName(partnerCard.account_name || 'parceira')}_${dashDate(new Date(closure.period_start_date))}_a_${dashDate(new Date(closure.closing_date))}.pdf`
  await downloadPdf(fileName, {
    title: 'Fechamento de Balanço',
    subtitle: `Período: ${formatDateTime(closure.period_start_date)} até ${formatDateTime(closure.closing_date)}`,
    blocks,
  })
}

// ==================== HOME - FATURAS DE CARTÕES ====================

export interface HomeInvoicePDFItem {
  id: number
  description: string
  amount: number
  date: string
  current_installment?: number | null
  total_installments?: number | null
  card_id: number
  card_name: string
  card_number: string
  card_type: string
  remaining_installments?: number | null
  remaining_total?: number | null
}

export interface HomeInvoicePDFSection {
  key: string
  title: string
  total: number
  count: number
  items: HomeInvoicePDFItem[]
  next_month_total?: number | null
}

export interface HomeInvoicePDFData {
  title: string
  sections: HomeInvoicePDFSection[]
}

const stripInstallment = (description: string): string => (description || '').replace(/\s*\(\d+\/\d+\)\s*/g, ' ').trim()

const formatDatePDF = (dateStr: string): string => {
  if (!dateStr) return '-'
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : formatDate(dateStr)
}

const expense = (value: number): string => `-${formatCurrency(Math.abs(value))}`

const remainingValues = (item: HomeInvoicePDFItem) => {
  const nextMonth = Math.abs(Number(item.amount))
  const saldoDevedor = Math.abs(Number(item.remaining_total || 0))
  return { nextMonth, future: Math.max(0, saldoDevedor - nextMonth), saldoDevedor }
}

const remainingTotals = (section: HomeInvoicePDFSection) => {
  if (section.items.length > 0) {
    const nextMonth = section.items.reduce((s, i) => s + Math.abs(Number(i.amount)), 0)
    const future = section.items.reduce((s, i) => s + remainingValues(i).future, 0)
    return { nextMonth, future, saldoDevedor: nextMonth + future }
  }
  const nextMonth = section.next_month_total != null ? Number(section.next_month_total) : 0
  const saldoDevedor = Math.abs(Number(section.total || 0))
  return { nextMonth, future: Math.max(0, saldoDevedor - nextMonth), saldoDevedor }
}

const totalSummaryBlocks = (section: HomeInvoicePDFSection, countLabel: string): PdfBlock[] => {
  if (section.key.includes('remaining')) {
    const { nextMonth, future, saldoDevedor } = remainingTotals(section)
    return [
      { type: 'heading', text: 'Saldo devedor' },
      {
        type: 'table',
        font_size: 7,
        columns: [{ header: 'Resumo' }, center(countLabel), right('Próximo mês'), right('Futuro'), right('Saldo devedor')],
        rows: [[section.title, String(section.count), expense(nextMonth), expense(future), expense(saldoDevedor)]],
        tones: [[null, null, 'negative', 'negative', 'negative']],
      },
    ]
  }
  return [
    { type: 'heading', text: 'Total do Mês' },
    {
      type: 'table',
      font_size: 7,
      columns: [{ header: 'Resumo' }, center(countLabel), right('Total')],
      rows: [[section.title, String(section.count), expense(Number(section.total))]],
      tones: [[null, null, 'negative']],
    },
  ]
}

const remainingItemsBlocks = (section: HomeInvoicePDFSection): PdfBlock[] => {
  if (!section.items.length) return []
  const { nextMonth, future, saldoDevedor } = remainingTotals(section)
  return [
    { type: 'heading', text: section.title },
    {
      type: 'table',
      font_size: 7,
      columns: [
        { header: 'Data', width_mm: 20 },
        { header: 'Descrição' },
        { ...center('Parc. falt.'), width_mm: 18 },
        right('Próximo mês'),
        right('Futuro'),
        right('Saldo devedor'),
      ],
      rows: section.items.map((item) => {
        const v = remainingValues(item)
        return [formatDatePDF(item.date), stripInstallment(item.description), String(item.remaining_installments ?? '-'), expense(v.nextMonth), expense(v.future), expense(v.saldoDevedor)]
      }),
      tones: section.items.map(() => [null, null, null, 'negative', 'negative', 'negative'] as (PdfTone | null)[]),
      footer: ['TOTAL', '', '', expense(nextMonth), expense(future), expense(saldoDevedor)],
      footer_tones: [null, null, null, 'negative', 'negative', 'negative'],
    },
  ]
}

const monthItemsBlocks = (section: HomeInvoicePDFSection): PdfBlock[] => {
  if (!section.items.length) return []
  const total = section.items.reduce((s, i) => s + Math.abs(Number(i.amount)), 0)
  return [
    { type: 'heading', text: section.title },
    {
      type: 'table',
      font_size: 7,
      columns: [{ header: 'Data', width_mm: 22 }, { header: 'Descrição' }, { ...center('Parcela'), width_mm: 20 }, { ...right('Valor'), width_mm: 28 }],
      rows: section.items.map((item) => [
        formatDatePDF(item.date),
        stripInstallment(item.description),
        item.current_installment && item.total_installments && item.total_installments > 1 ? `${item.current_installment}/${item.total_installments}` : '-',
        expense(Number(item.amount)),
      ]),
      tones: section.items.map(() => [null, null, null, 'negative'] as (PdfTone | null)[]),
      footer: ['TOTAL', '', '', expense(total)],
      footer_tones: [null, null, null, 'negative'],
    },
  ]
}

export const exportHomeInvoiceDetailsToPDF = async (data: HomeInvoicePDFData): Promise<void> => {
  if (!data?.sections?.length) return

  const blocks: PdfBlock[] = data.sections.flatMap((section): PdfBlock[] => {
    if (section.key === 'month-total') return totalSummaryBlocks(section, 'Transações')
    if (section.key === 'remaining-total') return totalSummaryBlocks(section, 'Compras')
    if (section.key.startsWith('card-')) {
      return section.items.some((i) => i.remaining_total != null) ? remainingItemsBlocks(section) : monthItemsBlocks(section)
    }
    if (section.key === 'remaining') return remainingItemsBlocks(section)
    if (section.key === 'month') return monthItemsBlocks(section)
    return []
  })
  if (!blocks.length) return

  await downloadPdf(`faturas_${sanitizeFileName(data.title)}_${dashDate(new Date())}.pdf`, {
    title: data.title,
    blocks,
  })
}

