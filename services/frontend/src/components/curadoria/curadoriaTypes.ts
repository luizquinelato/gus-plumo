export interface CuradoriaTag {
  id: number
  name: string
}

export interface CuradoriaSubtag {
  id: number
  tag_id: number
  name: string
  tag_name: string
  type: string
}

export interface CuradoriaPartner {
  id: number
  account_id: number
  shared_account_id: number
  my_contribution_percentage: number
  revenue_contribution_percentage?: number
  description: string | null
  active: boolean
  shared_account: { id: number; name: string; description: string | null } | null
}

export interface CuradoriaUnmappedRecord {
  id: number
  date: string
  description: string
  amount: number
  source: 'bank' | 'card' | 'benefit'
  card_number?: string
  card_owner?: string
  category?: string
  tag_id?: number | null
  subtag_id?: number | null
  expense_sharing_id?: number | null
  ownership_percentage?: number | null
  current_installment?: number | null
  total_installments?: number | null
  year_month?: string | null
}

export interface CuradoriaGroupedRecord {
  groupKey: string
  description: string
  tipo: 'receita' | 'despesa'
  count: number
  totalAmount: number
  records: CuradoriaUnmappedRecord[]
  tag_id: number | null
  subtag_id: number | null
  expense_sharing_id: number | null
  ownership_percentage: number | null
}

export interface CuradoriaTransactionMapping {
  id: number
  original_description: string
  mapped_description: string | null
  subtag_id: number
  subtag_name: string | null
  subtag_type: string | null
  tag_name: string | null
  active: boolean
  created_at: string | null
  last_updated_at: string | null
}
