/**
 * Três superfícies visuais de badge (mesclar entre colunas adjacentes na mesma linha).
 *
 * | Superfície | Nome        | Fundo              | Cantos      |
 * |------------|-------------|--------------------|-------------|
 * | `light`    | fundo claro | tint suave (soft)  | arredondado |
 * | `solid`    | fundo escuro| cor sólida         | reto        |
 * | `ghost`    | sem fundo   | transparente+borda | reto        |
 *
 * **Exceção:** colunas de **status/situação** usam cantos arredondados em todas as superfícies.
 */

export type BadgeSurface = 'light' | 'solid' | 'ghost'

export type BadgeSurfaceVariant = 'statusCompact' | 'statusSolid' | 'statusOutline'

export function badgeVariantForSurface(surface: BadgeSurface): BadgeSurfaceVariant {
  if (surface === 'light') return 'statusCompact'
  if (surface === 'solid') return 'statusSolid'
  return 'statusOutline'
}

export type BadgeColumnVariant =
  | 'statusCompact'
  | 'statusSolid'
  | 'statusOutline'
  | 'soft'
  | 'outline'
  | 'scope'
  | 'count'
  | 'countSolid'

export function badgeVariantForColumnRole(
  role: keyof typeof BADGE_COLUMN_SURFACE,
): BadgeColumnVariant {
  switch (role) {
    case 'statusPrimary':
      return 'statusCompact'
    case 'statusSecondary':
      return 'statusOutline'
    case 'classificationPrimary':
      return 'soft'
    case 'classificationSecondary':
      return 'outline'
    case 'scope':
      return 'scope'
    case 'metricGhost':
      return 'count'
    case 'metricSolid':
      return 'countSolid'
    case 'metricLight':
      return 'soft'
    default: {
      const surface = BADGE_COLUMN_SURFACE[role]
      if (surface === 'light') return 'soft'
      if (surface === 'solid') return 'countSolid'
      return 'outline'
    }
  }
}

export const BADGE_SURFACE_RADIUS: Record<BadgeSurface, string> = {
  light: 'rounded-full',
  solid: 'rounded-none',
  ghost: 'rounded-none',
}

export const STATUS_COLUMN_RADIUS = 'rounded-full'

export const BADGE_COLUMN_SURFACE = {
  statusPrimary: 'light',
  statusSecondary: 'ghost',
  classificationPrimary: 'light',
  classificationSecondary: 'ghost',
  scope: 'ghost',
  metricGhost: 'ghost',
  metricSolid: 'solid',
  metricLight: 'light',
} as const satisfies Record<string, BadgeSurface>

export const METRIC_COUNT_CYCLE = ['countSolid', 'count', 'soft'] as const
export type MetricCountBadgeVariant = (typeof METRIC_COUNT_CYCLE)[number]

export function metricCountVariant(columnIndex: number): MetricCountBadgeVariant {
  return METRIC_COUNT_CYCLE[((columnIndex % METRIC_COUNT_CYCLE.length) + METRIC_COUNT_CYCLE.length) % METRIC_COUNT_CYCLE.length]
}

export function metricCountColumnProps(columnIndex: number): {
  variant: MetricCountBadgeVariant
  tone?: 'neutral'
  className?: string
} {
  const variant = metricCountVariant(columnIndex)
  if (variant === 'countSolid') return { variant, tone: 'neutral' }
  if (variant === 'soft') {
    return {
      variant,
      tone: 'neutral',
      className: 'min-w-[2rem] justify-center tabular-nums text-[10px]',
    }
  }
  return { variant }
}
