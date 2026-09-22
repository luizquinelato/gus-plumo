/** Tons semânticos e de marca — mapeiam para variáveis CSS do design system. */
export type BadgeTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'brand1'
  | 'brand2'
  | 'brand3'
  | 'brand4'
  | 'brand5'

const BRAND_SLOT: Record<`brand${1 | 2 | 3 | 4 | 5}`, string> = {
  brand1: '1',
  brand2: '2',
  brand3: '3',
  brand4: '4',
  brand5: '5',
}

function cssVar(name: string): string {
  return `var(--color-${name})`
}

function onCssVar(name: string): string {
  return `var(--on-color-${name})`
}

/** Fundo sólido + texto contrastante (badges de status, classificação). */
export function badgeToneStyle(tone: BadgeTone): { background: string; color: string } {
  if (tone in BRAND_SLOT) {
    const slot = BRAND_SLOT[tone as keyof typeof BRAND_SLOT]
    return { background: cssVar(slot), color: onCssVar(slot) }
  }
  return { background: cssVar(tone), color: onCssVar(tone) }
}

function toneColor(tone: BadgeTone): string {
  if (tone in BRAND_SLOT) {
    return cssVar(BRAND_SLOT[tone as keyof typeof BRAND_SLOT])
  }
  return cssVar(tone)
}

/** Outline — sem fundo; borda e texto com o tom. */
export function badgeOutlineToneStyle(tone: BadgeTone): {
  background: string
  color: string
  borderWidth: number
  borderStyle: 'solid'
  borderColor: string
} {
  const color = toneColor(tone)
  return {
    background: 'transparent',
    color,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
  }
}

/** Variante suave — tint 14% + texto na cor sólida. */
export function badgeSoftStyle(tone: BadgeTone): { background: string; color: string } {
  const solid = badgeToneStyle(tone)
  return {
    background: `color-mix(in srgb, ${solid.background} 14%, transparent)`,
    color: solid.background,
  }
}

export function toneBackground(tone: BadgeTone): string {
  return badgeToneStyle(tone).background
}

export function tonesToBackground(map: Record<string, BadgeTone>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(map).map(([key, tone]) => [key, toneBackground(tone)]),
  )
}
