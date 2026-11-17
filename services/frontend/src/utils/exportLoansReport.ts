import { downloadExcelSafe, excelDateStamp, type ExcelSheetSpec } from './excelExportClient'
import { downloadPdf, type PdfBlock } from './pdfExportClient'

export interface LoanPaymentForExport {
  id: number
  loan_id: number
  amount: number
  payment_date: string
  notes: string | null
  balance_closure_id: number | null
}

export interface LoanForExport {
  id: number
  loan_type: 'lent' | 'borrowed'
  principal_amount: number
  description: string
  loan_date: string
  due_date: string | null
  interest_enabled: boolean
  interest_type: 'simple' | 'compound' | null
  interest_rate: number | null
  interest_period: 'daily' | 'monthly' | 'yearly' | null
  counterpart_account_id: number | null
  external_name: string | null
  status: 'open' | 'settled'
  settled_at: string | null
  source_table?: string | null
  balance_closure_id?: number | null
  balance_closure_period?: string | null
  total_paid: number
  remaining_balance: number
  is_owner: boolean
  counterpart?: { name: string } | null
  payments: LoanPaymentForExport[]
}

export interface LoansExportContext {
  loans: LoanForExport[]
  filterTypeLabel: string
  filterPartnerLabel: string
  searchTerm: string
}

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR')
}

const effectiveDirection = (loan: LoanForExport): 'lent' | 'borrowed' => {
  const raw = loan.is_owner ? loan.loan_type : loan.loan_type === 'lent' ? 'borrowed' : 'lent'
  return raw
}

const directionLabel = (loan: LoanForExport) => (effectiveDirection(loan) === 'lent' ? 'A receber' : 'A pagar')

const counterpartLabel = (loan: LoanForExport) =>
  loan.counterpart?.name || loan.external_name || (loan.counterpart_account_id ? 'Conta vinculada' : 'Externo')

const interestLabel = (loan: LoanForExport) => {
  if (!loan.interest_enabled || loan.interest_rate == null || !loan.interest_period || !loan.interest_type) {
    return 'Não'
  }
  const period =
    loan.interest_period === 'daily' ? 'ao dia' : loan.interest_period === 'monthly' ? 'ao mês' : 'ao ano'
  const kind = loan.interest_type === 'compound' ? 'composto' : 'simples'
  return `${Number(loan.interest_rate).toFixed(2)}% ${period} (${kind})`
}

const closureOrigin = (loan: LoanForExport) => {
  if (loan.source_table !== 'balance_closures' || loan.balance_closure_id == null) return ''
  return loan.balance_closure_period || `#${loan.balance_closure_id}`
}

const statusLabel = (loan: LoanForExport) => (loan.status === 'settled' ? 'Quitado' : 'Aberto')

function metaRows(ctx: LoansExportContext) {
  const now = new Date()
  return [
    { Campo: 'Gerado em', Valor: now.toLocaleString('pt-BR') },
    { Campo: 'Tipo', Valor: ctx.filterTypeLabel },
    { Campo: 'Parceiro', Valor: ctx.filterPartnerLabel },
    { Campo: 'Busca', Valor: ctx.searchTerm || '—' },
    { Campo: 'Empréstimos', Valor: String(ctx.loans.length) },
  ]
}

function loanSheetRows(loans: LoanForExport[]) {
  return loans.map((loan, i) => ({
    '#': i + 1,
    ID: loan.id,
    Descrição: loan.description,
    Direção: directionLabel(loan),
    Status: statusLabel(loan),
    Contraparte: counterpartLabel(loan),
    'Data empréstimo': fmtDate(loan.loan_date),
    Vencimento: fmtDate(loan.due_date),
    Principal: Math.abs(Number(loan.principal_amount)),
    'Total pago': Number(loan.total_paid),
    Saldo: Math.max(0, Math.abs(Number(loan.remaining_balance))),
    Juros: interestLabel(loan),
    'Origem fechamento': closureOrigin(loan),
    'Quitado em': fmtDate(loan.settled_at),
  }))
}

function paymentSheetRows(loans: LoanForExport[]) {
  const rows: Record<string, string | number>[] = []
  for (const loan of loans) {
    for (const p of loan.payments) {
      rows.push({
        'ID empréstimo': loan.id,
        Descrição: loan.description,
        Direção: directionLabel(loan),
        'ID pagamento': p.id,
        Data: fmtDate(p.payment_date),
        Valor: Number(p.amount),
        Observações: p.notes || '',
        Fechamento: p.balance_closure_id != null ? String(p.balance_closure_id) : '',
      })
    }
  }
  return rows
}

const moneyPdf = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ')

export async function exportLoansToExcel(ctx: LoansExportContext): Promise<void> {
  const stamp = excelDateStamp()
  const loanRows = loanSheetRows(ctx.loans)
  const paymentRows = paymentSheetRows(ctx.loans)

  const sheets: ExcelSheetSpec[] = [
    {
      name: 'Empréstimos',
      rows: loanRows,
      columns: [
        '#',
        'ID',
        'Descrição',
        'Direção',
        'Status',
        'Contraparte',
        'Data empréstimo',
        'Vencimento',
        'Principal',
        'Total pago',
        'Saldo',
        'Juros',
        'Origem fechamento',
        'Quitado em',
      ],
      kinds: {
        Principal: 'money' as const,
        'Total pago': 'money' as const,
        Saldo: 'money' as const,
        'Data empréstimo': 'date' as const,
        Vencimento: 'date' as const,
        'Quitado em': 'date' as const,
      },
    },
    { name: 'Info', rows: metaRows(ctx), kinds: { Valor: 'text' as const } },
  ]

  if (paymentRows.length > 0) {
    sheets.splice(1, 0, {
      name: 'Pagamentos',
      rows: paymentRows,
      columns: [
        'ID empréstimo',
        'Descrição',
        'Direção',
        'ID pagamento',
        'Data',
        'Valor',
        'Observações',
        'Fechamento',
      ],
      kinds: {
        Valor: 'money' as const,
        Data: 'date' as const,
      },
    })
  }

  await downloadExcelSafe(`emprestimos_${stamp}.xlsx`, sheets)
}

const sortPayments = (payments: LoanPaymentForExport[]) =>
  [...payments].sort((a, b) => {
    const ta = new Date(a.payment_date).getTime()
    const tb = new Date(b.payment_date).getTime()
    if (ta !== tb) return ta - tb
    return a.id - b.id
  })

export async function exportLoansToPdf(ctx: LoansExportContext): Promise<void> {
  const subtitle = [ctx.filterTypeLabel, ctx.filterPartnerLabel, ctx.searchTerm ? `Busca: ${ctx.searchTerm}` : '']
    .filter(Boolean)
    .join(' · ')

  const blocks: PdfBlock[] = []

  ctx.loans.forEach((loan, i) => {
    const origin = closureOrigin(loan)
    const detailLines = [
      `ID ${loan.id} · Direção: ${directionLabel(loan)} · Status: ${statusLabel(loan)}`,
      `Contraparte: ${counterpartLabel(loan)}`,
      `Data do empréstimo: ${fmtDate(loan.loan_date)}${loan.due_date ? ` · Vencimento: ${fmtDate(loan.due_date)}` : ''}`,
      `Principal: ${moneyPdf(Math.abs(Number(loan.principal_amount)))} · Pago: ${moneyPdf(Number(loan.total_paid))} · Saldo: ${moneyPdf(Math.max(0, Math.abs(Number(loan.remaining_balance))))}`,
      loan.interest_enabled ? `Juros: ${interestLabel(loan)}` : null,
      origin ? `Origem fechamento: ${origin}` : null,
      loan.settled_at ? `Quitado em: ${fmtDate(loan.settled_at)}` : null,
    ].filter((line): line is string => Boolean(line))

    // Título com descrição completa (Paragraph no PDF quebra linha; não usa tabela com truncamento).
    blocks.push({ type: 'heading', text: `${i + 1}. ${loan.description}` })
    for (const line of detailLines) {
      blocks.push({ type: 'text', text: line, tone: 'muted' })
    }

    blocks.push({ type: 'text', text: 'Pagamentos', bold: true })
    const payments = sortPayments(loan.payments)
    if (payments.length === 0) {
      blocks.push({ type: 'text', text: 'Nenhum pagamento registrado.', tone: 'muted', italic: true })
    } else {
      for (const p of payments) {
        const closure =
          p.balance_closure_id != null ? ` · Vinculado ao fechamento #${p.balance_closure_id}` : ''
        const note = p.notes?.trim()
        const base = `• ${fmtDate(p.payment_date)} — ${moneyPdf(Number(p.amount))}${closure}`
        blocks.push({ type: 'text', text: note ? `${base} — ${note}` : base })
      }
    }

    blocks.push({ type: 'spacer', space_mm: 5 })
  })

  await downloadPdf(`emprestimos_${excelDateStamp()}.pdf`, {
    title: 'Empréstimos',
    subtitle: subtitle || undefined,
    blocks,
  })
}