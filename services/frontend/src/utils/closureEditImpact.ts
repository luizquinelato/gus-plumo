import axios from 'axios'
import type { ClosureEditImpact } from '../types/closureEditImpact'
import { normalizeClosureEditImpact, parseClosureConflictDetail } from '../types/closureEditImpact'

export function formatMoneyBr(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const CONFIRM_MESSAGES: Record<string, string> = {
  financial:
    'Esta alteração muda valores em meses já fechados. Os fechamentos serão recalculados automaticamente.',
  classification:
    'Meses fechados serão atualizados no histórico. Confirme para aplicar a alteração.',
  split_recalc:
    'O compartilhamento será recalculado nos meses fechados. Confirme para aplicar a alteração.',
}

export function closureImpactConfirmMessage(impact: ClosureEditImpact): string {
  if (impact.message?.trim()) return impact.message.trim()
  return CONFIRM_MESSAGES[impact.impact_type] ?? CONFIRM_MESSAGES.classification
}

export function hasClosureImpactSummary(impact: ClosureEditImpact | null | undefined): boolean {
  if (!impact || impact.impact_type === 'none') return false
  if (impact.impact_type === 'financial') return true
  if (impact.financial?.affected_periods?.length) return true
  if (impact.classification) return true
  return false
}

export function formatClosureImpactSuccessToast(impact: ClosureEditImpact | null | undefined): string | null {
  if (!impact || impact.impact_type === 'none') return null
  if (impact.classification) {
    const c = impact.classification
    if (impact.impact_type === 'split_recalc') {
      return `Compartilhamento recalculado · ${c.records_updated} registro(s) · ${c.closed_months_refreshed} mês(es) fechado(s)`
    }
    return `${c.records_updated} registro(s) · ${c.closed_months_refreshed} mês(es) fechado(s) atualizado(s) no histórico`
  }
  if (impact.impact_type === 'financial' && impact.financial?.affected_periods?.length) {
    const lines = impact.financial.affected_periods.map(
      (row) =>
        `${row.year_month}: ${formatMoneyBr(row.closing_old)} → ${formatMoneyBr(row.closing_new)} (Δ ${formatMoneyBr(row.delta_closing)})`,
    )
    return `Fechamentos recalculados:\n${lines.join('\n')}`
  }
  return impact.message ?? null
}

export interface ExpenseEditSuccessPayload {
  message: string
  closureImpact?: ClosureEditImpact | null
}

export function extractClosureImpactFromResponse(data: unknown): ClosureEditImpact | null {
  if (!data || typeof data !== 'object') return null
  const impact = (data as Record<string, unknown>).closure_impact
  return normalizeClosureEditImpact(impact)
}

export function parseAxiosClosureConflict(error: unknown): ClosureEditImpact | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) return null
  return parseClosureConflictDetail(error.response.data?.detail)
}

export function buildSuccessMessage(base: string, impact: ClosureEditImpact | null | undefined): string {
  const extra = formatClosureImpactSuccessToast(impact ?? null)
  return extra ? `${base}\n${extra}` : base
}

export function buildEditSuccessPayload(
  base: string,
  impact: ClosureEditImpact | null | undefined,
): ExpenseEditSuccessPayload {
  const normalized = impact ?? null
  if (normalized?.impact_type === 'financial' || normalized?.financial?.affected_periods?.length) {
    return {
      message: base,
      closureImpact: {
        ...normalized,
        impact_type: 'financial',
      },
    }
  }
  return {
    message: base,
    closureImpact: hasClosureImpactSummary(normalized) ? normalized : null,
  }
}
