export interface InvoiceMatchCandidate {
  bank_statement_id: number
  date: string | null
  description: string
  amount: number
  has_card_tag: boolean
  month_relative?: 'current' | 'previous' | 'next'
}

export interface InvoiceMatchCycle {
  key: string
  invoice_group_id: number | null
  credit_card_id: number | null
  name: string
  group_name?: string | null
  card_names?: string[]
  card_ids: number[]
  cards: Array<{ id: number; name: string; number: string; active?: boolean }>
  year_month: string
  net_amount: number
  amount_to_pay: number
  line_count: number
  status: 'matched' | 'unmatched' | 'ambiguous' | 'unlinked'
  auto_eligible: boolean
  multiple_debits?: boolean
  auto_candidate: InvoiceMatchCandidate | null
  match: {
    id: number
    bank_statement_id: number | null
    date: string | null
    description: string | null
    amount: number | null
    match_method: string
  } | null
  statement_description?: string | null
  candidates: InvoiceMatchCandidate[]
}

export interface InvoiceMatchPreview {
  year_month: string
  cycles: InvoiceMatchCycle[]
}

export interface InvoiceMatchHistory {
  months: Array<{ year_month: string; cycles: InvoiceMatchCycle[] }>
  summary: {
    month_count: number
    cycle_count: number
    matched: number
    unmatched: number
    ambiguous: number
    unlinked?: number
    auto_eligible: number
  }
}

export function flattenReconcileCycles(history: InvoiceMatchHistory | null): InvoiceMatchCycle[] {
  if (!history) return []
  return history.months.flatMap((month) => month.cycles)
}
