export type ClosureImpactType = 'none' | 'classification' | 'split_recalc' | 'financial'

export interface ClosureClassificationSummary {
  records_updated: number
  closed_months_refreshed: number
  year_months: string[]
}

export interface ClosureFinancialPeriod {
  year: number
  month: number
  year_month: string
  closing_old: number
  closing_new: number
  delta_closing: number
}

export interface ClosureFinancialSummary {
  affected_periods: ClosureFinancialPeriod[]
}

export interface ClosureEditImpact {
  impact_type: ClosureImpactType
  message?: string
  requires_confirmation?: boolean
  classification?: ClosureClassificationSummary
  financial?: ClosureFinancialSummary
}

export function isClosureEditImpactDetail(detail: unknown): detail is ClosureEditImpact & { message?: string } {
  if (!detail || typeof detail !== 'object') return false
  const d = detail as Record<string, unknown>
  return typeof d.impact_type === 'string' || Array.isArray(d.affected_periods)
}

function coerceFinancialPeriods(value: unknown): ClosureFinancialPeriod[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (row): row is ClosureFinancialPeriod =>
      row != null &&
      typeof row === 'object' &&
      typeof (row as ClosureFinancialPeriod).year_month === 'string',
  )
}

/** Normaliza payload da API (409 ou 200) para o formato usado no frontend. */
export function normalizeClosureEditImpact(raw: unknown): ClosureEditImpact | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>

  const topPeriods = coerceFinancialPeriods(d.affected_periods)
  const financialBlock = d.financial as ClosureFinancialSummary | undefined
  const nestedPeriods = coerceFinancialPeriods(financialBlock?.affected_periods)

  let impactType = d.impact_type as ClosureImpactType | undefined
  const periods = nestedPeriods.length > 0 ? nestedPeriods : topPeriods

  if (!impactType && periods.length > 0) {
    impactType = 'financial'
  }
  if (!impactType || impactType === 'none') {
    if (d.classification) impactType = 'classification'
    else return null
  }

  const impact: ClosureEditImpact = {
    impact_type: impactType,
    message: typeof d.message === 'string' ? d.message : undefined,
    requires_confirmation: d.requires_confirmation === true,
  }

  if (periods.length > 0 || impactType === 'financial') {
    impact.financial = { affected_periods: periods }
  }
  if (d.classification && typeof d.classification === 'object') {
    impact.classification = d.classification as ClosureClassificationSummary
  }
  return impact
}

export function parseClosureConflictDetail(detail: unknown): ClosureEditImpact | null {
  return normalizeClosureEditImpact(detail)
}
