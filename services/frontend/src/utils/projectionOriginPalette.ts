/**
 * Cores dedicadas à origem na projeção mensal (badges sólidas + faixa do card).
 * Evita --color-success/danger/info e marca do tema (entrada/saída).
 * Matizes bem separados: cinza · teal · violeta · laranja · rosa.
 */
export const PROJECTION_ORIGIN_PALETTE = {
  manual: { bg: '#64748b', fg: '#ffffff' },
  bank_statement: { bg: '#0d9488', fg: '#ffffff' },
  card_invoice: { bg: '#7c3aed', fg: '#ffffff' },
  card_item_installment: { bg: '#ea580c', fg: '#ffffff' },
  payroll: { bg: '#db2777', fg: '#ffffff' },
  payroll_estimate: { bg: '#f472b6', fg: '#ffffff' },
} as const satisfies Record<string, { bg: string; fg: string }>

export type ProjectionOriginPaletteKey = keyof typeof PROJECTION_ORIGIN_PALETTE

export function projectionOriginPaletteColor(key: ProjectionOriginPaletteKey): string {
  return PROJECTION_ORIGIN_PALETTE[key].bg
}