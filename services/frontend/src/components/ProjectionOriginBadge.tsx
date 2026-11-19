import type { LucideIcon } from 'lucide-react'
import { Briefcase, CreditCard, Landmark, LineChart, PenLine } from 'lucide-react'
import Badge from './Badge'
import {
  PROJECTION_ORIGIN_PALETTE,
  type ProjectionOriginPaletteKey,
  projectionOriginPaletteColor,
} from '../utils/projectionOriginPalette'

export type ProjectionSource =
  | 'manual'
  | 'clone'
  | 'card_invoice'
  | 'card_item_manual'
  | 'card_item_installment'
  | 'payroll'
  | 'bank_statement'

export const PROJECTION_ORIGIN_KEYS = [
  'manual',
  'bank_statement',
  'card_invoice',
  'card_item_installment',
  'payroll',
] as const satisfies readonly ProjectionOriginPaletteKey[]

export type ProjectionOriginKey = (typeof PROJECTION_ORIGIN_KEYS)[number]

const ORIGIN_KEYS = PROJECTION_ORIGIN_KEYS

const ORIGIN_LABEL: Record<ProjectionOriginKey, string> = {
  manual: 'Manual',
  bank_statement: 'Conta',
  card_invoice: 'Cartão',
  card_item_installment: 'Estimativa',
  payroll: 'Folha',
}

const ORIGIN_ICON: Record<ProjectionOriginKey, LucideIcon> = {
  manual: PenLine,
  bank_statement: Landmark,
  card_invoice: CreditCard,
  card_item_installment: LineChart,
  payroll: Briefcase,
}

function ProjectionOriginIcon({ originKey }: { originKey: ProjectionOriginKey }) {
  const Icon = ORIGIN_ICON[originKey]
  return <Icon size={11} strokeWidth={2.25} className="shrink-0 opacity-95" aria-hidden />
}

/** Cor de origem para borda do card — mesma base da badge sólida. */
export function projectionOriginAccentColor(source: ProjectionSource): string {
  return projectionOriginPaletteColor(projectionOriginKey(source))
}

export function projectionOriginKey(source: ProjectionSource): ProjectionOriginKey {
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
  const { bg, fg } = PROJECTION_ORIGIN_PALETTE[key]
  return (
    <Badge
      variant="status"
      background={bg}
      color={fg}
      icon={<ProjectionOriginIcon originKey={key} />}
      label={ORIGIN_LABEL[key]}
    />
  )
}

export function defaultProjectionOriginVisibility(): Record<ProjectionOriginKey, boolean> {
  return Object.fromEntries(PROJECTION_ORIGIN_KEYS.map((k) => [k, true])) as Record<ProjectionOriginKey, boolean>
}

export function isProjectionOriginVisible(
  source: ProjectionSource,
  visible: Record<ProjectionOriginKey, boolean>,
): boolean {
  return visible[projectionOriginKey(source)] ?? true
}

type LegendProps = {
  visible: Record<ProjectionOriginKey, boolean>
  onToggle: (key: ProjectionOriginKey) => void
  filterSimilarDescriptions?: boolean
  onFilterSimilarDescriptionsChange?: (value: boolean) => void
}

export function ProjectionOriginLegend({
  visible,
  onToggle,
  filterSimilarDescriptions = false,
  onFilterSimilarDescriptionsChange,
}: LegendProps) {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-gray-600 dark:text-gray-400">
      <span className="font-medium text-gray-500 dark:text-gray-500">Origem</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {ORIGIN_KEYS.map((key) => {
          const on = visible[key]
          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggle(key)}
              aria-pressed={on}
              aria-label={`${ORIGIN_LABEL[key]}: ${on ? 'visível' : 'oculto'}`}
              title={on ? `Ocultar lançamentos ${ORIGIN_LABEL[key]}` : `Exibir lançamentos ${ORIGIN_LABEL[key]}`}
              className={`inline-flex border-0 bg-transparent p-0 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-1)] ${
                on ? 'opacity-100' : 'opacity-35 saturate-0'
              }`}
            >
              <ProjectionOriginBadge source={key} />
            </button>
          )
        })}
      </div>
      <span className="text-gray-400">(Clique para exibir ou ocultar no calendário)</span>
      {onFilterSimilarDescriptionsChange ? (
        <label className="ml-auto inline-flex max-w-full cursor-pointer select-none items-center gap-2 text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={filterSimilarDescriptions}
            onChange={(e) => onFilterSimilarDescriptionsChange(e.target.checked)}
            className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-[var(--color-1)] focus:ring-[var(--color-1)] dark:border-gray-600"
          />
          <span className="leading-snug">Só manual parecido com conta (extrato)</span>
        </label>
      ) : null}
    </div>
  )
}