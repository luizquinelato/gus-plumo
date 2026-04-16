/**
 * Tipos TypeScript para Expense Templates
 * Correspondem aos schemas Pydantic do backend
 */

export interface SubtagInfo {
  id: number
  name: string
  type: 'receita' | 'despesa'
  icon: string | null
  tag_id: number
  tag_name: string | null
}

export interface AccountInfo {
  id: number
  name?: string | null
  description?: string | null
  bank?: {
    id: number
    code: string
    name: string
    full_name?: string
  } | null
  agency?: string | null
  account_number?: string | null
}

export interface ExpenseSharingInfo {
  id: number
  shared_account_id: number
  my_contribution_percentage: number
  description: string | null
  shared_account?: AccountInfo | null
}

export interface ExpenseTemplateItem {
  id: number
  expense_template_id: number
  description: string
  amount: number | null
  day_of_month: number | null
  subtag_id: number | null
  subtag: SubtagInfo | null
  ownership_percentage: number
  expense_sharing_id: number | null
  expense_sharing: ExpenseSharingInfo | null
  display_order: number
  account_id: number
  created_at: string
  last_updated_at: string
}

export interface ExpenseTemplate {
  id: number
  name: string
  description: string | null
  icon: string
  account_id: number
  active: boolean
  items: ExpenseTemplateItem[]
  created_at: string
  last_updated_at: string
}

export interface ExpenseTemplateItemCreate {
  description: string
  amount?: number | null
  day_of_month?: number | null
  subtag_id?: number | null
  ownership_percentage?: number
  expense_sharing_id?: number | null
  display_order?: number
}

export interface ExpenseTemplateCreate {
  name: string
  description?: string | null
  icon?: string
  items?: ExpenseTemplateItemCreate[]
}

export interface ExpenseTemplateItemUpdate {
  description?: string
  amount?: number | null
  day_of_month?: number | null
  subtag_id?: number
  ownership_percentage?: number
  expense_sharing_id?: number | null
  display_order?: number
}

export interface ExpenseTemplateUpdate {
  name?: string
  description?: string | null
  icon?: string
  active?: boolean
}

export interface ApplyTemplateItem {
  date: string
  description: string
  amount: number
  subtag_id: number
  ownership_percentage?: number
  expense_sharing_id?: number | null
  adjustment_notes?: string | null
}

export interface ApplyTemplateRequest {
  items: ApplyTemplateItem[]
}

export interface ApplyTemplateResponse {
  created_count: number
  bank_statements: number[]
}

