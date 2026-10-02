export type AccountPeriodStatus = 'closed' | 'can_close' | 'blocked' | 'pending_shared' | 'current' | 'future' | 'no_data'

export type AccountPeriodItemSource = 'bank' | 'card' | 'benefit' | 'settlement'

export interface AccountPeriodSharedClosure {
  shared_partner_id: number | null
  expense_sharing_id?: number | null
  period_start_date: string | null
  closing_date: string | null
  is_settled?: boolean
}

export interface AccountPeriodItem {
  id: number | string
  date: string
  occurred_at?: string | null
  description: string
  amount: number
  source?: AccountPeriodItemSource
  kind?: string | null
  linked?: boolean
  is_manual?: boolean
  migrated_from_account_id?: number | null
  ownership_percentage?: number | null
  expense_sharing_id?: number | null
  amount_account?: number
  amount_shared?: number
  card_name?: string | null
  shared_partner_id?: number | null
  shared_partner_name?: string | null
  shared_partner_bank?: string | null
  shared_partner_agency?: string | null
  shared_partner_account_number?: string | null
}

export interface AccountPeriodSplit {
  entries: number
  exits: number
}

export interface AccountPeriodSharedPartner {
  shared_partner_id: number | null
  shared_partner_name: string
  shared_partner_bank?: string | null
  shared_partner_agency?: string | null
  shared_partner_account_number?: string | null
  entries: number
  exits: number
}

export interface AccountPeriodMonth {
  id: number | null
  year: number
  month: number
  year_month: string
  status: AccountPeriodStatus
  is_closed: boolean
  can_close: boolean
  can_reopen: boolean
  opening_editable: boolean
  opening_balance: number
  entries: number
  exits: number
  closing_balance: number
  item_count: number | null
  adjustment_amount?: number | null
  closed_at?: string | null
  notes?: string | null
  block_reason?: string | null
  has_open_shared_closure?: boolean
  open_shared_notice?: string | null
  sources: string[]
  items?: AccountPeriodItem[]
  card_items?: AccountPeriodItem[]
  benefit_items?: AccountPeriodItem[]
  shared_settlements?: AccountPeriodItem[]
  unmatched_card_payments?: AccountPeriodItem[]
  replaced_bank_ids?: number[]
  shared_by_account?: AccountPeriodSharedPartner[]
  shared_closures?: AccountPeriodSharedClosure[]
  split_account?: AccountPeriodSplit | null
  split_shared?: AccountPeriodSplit | null
}

export interface AccountPeriodFilterOptions {
  years: number[]
  first_data_year_month: string | null
  last_closed_year_month: string | null
  next_closeable_year_month: string | null
}

export interface AccountPeriodYearResponse {
  year: number | null
  all_years: boolean
  years: number[]
  first_data_year_month: string | null
  last_closed_year_month: string | null
  next_closeable_year_month: string | null
  months: AccountPeriodMonth[]
  closed_series: Array<{
    year_month: string
    label: string
    opening_balance: number
    entries: number
    exits: number
    closing_balance: number
    split_account?: AccountPeriodSplit | null
    split_shared?: AccountPeriodSplit | null
  }>
}

export interface AccountPeriodBulkCloseResponse {
  closed: AccountPeriodMonth[]
  count: number
  adjustment_year: number
  adjustment_month: number
  adjustment_date: string
  adjustment_amount: number
}

export interface AccountPeriodClosedValidation {
  is_closed: boolean
  closure_id?: number | null
  closure_year?: number | null
  closure_month?: number | null
  next_open_date?: string | null
  message?: string | null
}
