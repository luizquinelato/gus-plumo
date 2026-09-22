import type { CSSProperties, ReactNode } from 'react'
import { badgeOutlineToneStyle, badgeSoftStyle, badgeToneStyle, type BadgeTone } from '../utils/badgeTones'
import { BADGE_SURFACE_RADIUS, STATUS_COLUMN_RADIUS, type BadgeSurface } from '../utils/badgeSurfaces'

export type { BadgeTone }

export type BadgeVariant =
  | 'status'
  | 'statusCompact'
  | 'statusSolid'
  | 'statusOutline'
  | 'soft'
  | 'outline'
  | 'scope'
  | 'count'
  | 'countSolid'
  | 'tab'
  | 'tag'
  | 'filter'
  | 'overlay'

/** Badge sólido (fundo escuro) — cantos retos; uso genérico (ex.: escopo). */
export const STATUS_BADGE_CLASS =
  'inline-flex items-center justify-center px-2 py-0.5 text-[11px] font-semibold rounded-none whitespace-nowrap'

/** Outline neutro — sem fundo; borda/texto adaptam ao tema; cantos retos. */
const OUTLINE_NEUTRAL_CLASS =
  'border border-gray-300 bg-transparent text-gray-700 dark:border-gray-600 dark:text-gray-300'

/** Badge soft (fundo claro) — cantos arredondados; coluna de status. */
export const STATUS_COMPACT_BADGE_CLASS =
  `inline-flex items-center justify-center px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLUMN_RADIUS} whitespace-nowrap`

/** Status sólido — coluna de situação; cantos arredondados. */
export const STATUS_SOLID_BADGE_CLASS =
  `inline-flex items-center justify-center px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLUMN_RADIUS} whitespace-nowrap`

/** Status sem fundo — coluna de situação secundária; cantos arredondados. */
export const STATUS_OUTLINE_BADGE_CLASS =
  `inline-flex shrink-0 items-center justify-center px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLUMN_RADIUS} whitespace-nowrap ${OUTLINE_NEUTRAL_CLASS}`

const GHOST_BASE = 'inline-flex shrink-0 items-center rounded-none whitespace-nowrap'
const LIGHT_BASE = 'inline-flex shrink-0 items-center font-semibold whitespace-nowrap'

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  status: STATUS_BADGE_CLASS,
  statusCompact: STATUS_COMPACT_BADGE_CLASS,
  statusSolid: STATUS_SOLID_BADGE_CLASS,
  statusOutline: STATUS_OUTLINE_BADGE_CLASS,
  soft: `${LIGHT_BASE} ${BADGE_SURFACE_RADIUS.light} px-2.5 py-0.5 text-[11px]`,
  outline: `${GHOST_BASE} px-2.5 py-0.5 text-[11px] ${OUTLINE_NEUTRAL_CLASS}`,
  scope: `${GHOST_BASE} min-w-[2rem] items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold ${OUTLINE_NEUTRAL_CLASS}`,
  count: `${GHOST_BASE} min-w-[2rem] items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${OUTLINE_NEUTRAL_CLASS}`,
  countSolid: `${GHOST_BASE} min-w-[2rem] items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold tabular-nums`,
  tab: 'ml-1 rounded-none px-1.5 py-0.5 text-[10px] font-semibold',
  tag: `inline-flex items-center ${BADGE_SURFACE_RADIUS.light} px-2 py-0.5 text-[11px] font-medium`,
  filter:
    `inline-flex items-center ${BADGE_SURFACE_RADIUS.light} border border-gray-200/80 bg-gray-50 px-2 py-0.5 text-[11px] font-medium leading-none text-gray-500 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-400`,
  overlay: 'absolute top-1 left-1 rounded-none px-1.5 py-0.5 text-[10px] font-semibold text-white',
}

const GHOST_VARIANTS = new Set<BadgeVariant>(['outline', 'scope', 'count', 'statusOutline'])
const LIGHT_VARIANTS = new Set<BadgeVariant>(['soft', 'statusCompact'])
const SOLID_VARIANTS = new Set<BadgeVariant>(['status', 'countSolid', 'statusSolid'])

export function badgeSurfaceForVariant(variant: BadgeVariant): BadgeSurface | null {
  if (LIGHT_VARIANTS.has(variant)) return 'light'
  if (SOLID_VARIANTS.has(variant)) return 'solid'
  if (GHOST_VARIANTS.has(variant)) return 'ghost'
  return null
}

type BadgeStyleProps =
  | { variant: 'filter' | 'tag'; tone?: never; background?: never; color?: never }
  | { tone?: BadgeTone; background?: never; color?: never; variant?: Exclude<BadgeVariant, 'filter' | 'tag'> }
  | { tone?: never; background: string; color?: string; variant?: BadgeVariant }

export type BadgeProps = BadgeStyleProps & {
  variant?: BadgeVariant
  label?: ReactNode
  children?: ReactNode
  icon?: ReactNode
  className?: string
  title?: string
}

export default function Badge({
  variant = 'status',
  tone,
  background,
  color,
  label,
  children,
  icon,
  className = '',
  title,
}: BadgeProps) {
  const content = children ?? label
  const base = VARIANT_CLASS[variant]
  const withIcon = icon ? 'gap-1' : ''

  if (variant === 'filter') {
    return (
      <span className={`${base} ${className}`.trim()} title={title}>
        {icon}
        {content}
      </span>
    )
  }

  if (variant === 'tag') {
    return (
      <span
        className={`${base} bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 ${className}`.trim()}
        title={title}
      >
        {icon}
        {content}
      </span>
    )
  }

  let style: CSSProperties = {}
  if (tone && GHOST_VARIANTS.has(variant)) {
    style = badgeOutlineToneStyle(tone)
  } else if (tone && LIGHT_VARIANTS.has(variant)) {
    style = badgeSoftStyle(tone)
  } else if (tone && SOLID_VARIANTS.has(variant)) {
    style = badgeToneStyle(tone)
  } else if (background) {
    style = {
      background,
      ...(color ? { color } : {}),
    }
    if ((variant === 'status' || variant === 'statusSolid' || variant === 'statusCompact') && !color) {
      style.color = variant === 'statusCompact' ? undefined : '#ffffff'
    }
  }

  return (
    <span
      className={`${base} ${withIcon} ${className}`.trim()}
      style={style}
      title={title}
    >
      {icon}
      {content}
    </span>
  )
}
