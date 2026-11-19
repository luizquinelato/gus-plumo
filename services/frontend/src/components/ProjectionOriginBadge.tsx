import Badge from './Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import { badgeToneMap } from '../utils/badgePalettes'

/** Origem na linha do card: classificação secundária (ghost + marca), ver badge-surfaces.mdc */
const ORIGIN_BADGE_ROLE = 'classificationSecondary' as const

export type ProjectionSource =
  | 'manual'
  | 'clone'
  | 'card_invoice'
  | 'card_item_manual'
  | 'card_item_installment'
  | 'payroll'
  | 'bank_statement'

const ORIGIN_KEYS = ['manual', 'bank_statement', 'card_invoice', 'card_item_installment', 'payroll'] as const

type OriginKey = (typeof ORIGIN_KEYS)[number]

const ORIGIN_TONE = badgeToneMap(ORIGIN_KEYS, 'brand')

const ORIGIN_LABEL: Record<OriginKey, string> = {
  manual: 'Manual',
  bank_statement: 'Conta',
  card_invoice: 'Cartão',
  card_item_installment: 'Estimativa',
  payroll: 'Folha',
}

export function projectionOriginKey(source: ProjectionSource): OriginKey {
  if (
    source === 'bank_statement'
    || source === 'card_invoice'
    || source === 'card_item_installment'
    || source === 'payroll'
  ) {
    return source
  }
  return 'manual'
}

export function ProjectionOriginBadge({ source }: { source: ProjectionSource }) {
  const key = projectionOriginKey(source)
  return (
    <Badge
      variant={badgeVariantForColumnRole(ORIGIN_BADGE_ROLE)}
      tone={ORIGIN_TONE[key]}
      label={ORIGIN_LABEL[key]}
    />
  )
}

export function ProjectionOriginLegend() {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
      <span className="font-medium text-gray-500 dark:text-gray-500">Origem</span>
      {ORIGIN_KEYS.map((source) => (
        <ProjectionOriginBadge key={source} source={source} />
      ))}
    </div>
  )
}
