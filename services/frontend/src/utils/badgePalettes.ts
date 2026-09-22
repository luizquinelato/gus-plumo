import type { BadgeTone } from './badgeTones'

/**
 * Paletas para linhas com 2+ colunas de badges.
 * - `semantic` → somente status/situação
 * - `brand`    → classificação (tipo, escopo, dimensão)
 * - `metric`   → contagens numéricas
 */

export const BADGE_SEMANTIC_SEQUENCE = [
  'info',
  'warning',
  'success',
  'danger',
  'neutral',
] as const satisfies readonly BadgeTone[]

export const BADGE_BRAND_SEQUENCE = [
  'brand1',
  'brand2',
  'brand3',
  'brand4',
  'brand5',
] as const satisfies readonly BadgeTone[]

export const BADGE_CLASSIFICATION_SEQUENCE = BADGE_BRAND_SEQUENCE

export const BADGE_METRIC_COLUMN_TONES = [
  'brand2',
  'brand3',
  'brand4',
] as const satisfies readonly BadgeTone[]

export type BadgePaletteFamily = 'semantic' | 'brand' | 'metric'

const PALETTE_BY_FAMILY: Record<BadgePaletteFamily, readonly BadgeTone[]> = {
  semantic: BADGE_SEMANTIC_SEQUENCE,
  brand: BADGE_BRAND_SEQUENCE,
  metric: BADGE_METRIC_COLUMN_TONES,
}

export function badgeToneAt(family: BadgePaletteFamily, index: number): BadgeTone {
  const palette = PALETTE_BY_FAMILY[family]
  return palette[((index % palette.length) + palette.length) % palette.length]
}

export function badgeToneMap<K extends string>(
  keys: readonly K[],
  family: BadgePaletteFamily,
): Record<K, BadgeTone> {
  return Object.fromEntries(
    keys.map((key, index) => [key, badgeToneAt(family, index)]),
  ) as Record<K, BadgeTone>
}
