/** Tipos e helpers compartilhados pelos exports (PDF e Excel) do Saldo Parcelado. */

export interface SaldoExportItem {
  id: number
  description: string
  card_id: number
  card_name: string
  card_number: string
  subtag_name: string | null
  tag_name: string | null
  shared_partner_name: string | null
  ownership_percentage: number
  installment_amount: number
  remaining_total: number
  current_installment: number
  total_installments: number
  remaining_installments: number
  last_projected_month: string
}

export interface SaldoExportMonth {
  year_month: string
  month_label: string
  total: number
  count: number
  remaining_after: number
  /** Total por cartão (chave = card_id) — usado no gráfico "Por cartão". */
  by_card?: Record<string, number>
}

export interface SaldoExportCard {
  card_id: number
  card_name: string
  card_number: string
  remaining_total: number
  purchases_count: number
}

export interface SaldoExportSummary {
  future_total: number
  next_month_total: number
  next_month_label: string | null
  purchases_count: number
  remaining_installments_count: number
  last_projected_month_label: string | null
  months_count: number
}

export interface SaldoExportLegendEntry {
  name: string
  color: string
  kind: 'bar' | 'line'
}

export interface SaldoExportChartImage {
  dataUrl: string
  width: number
  height: number
}

export interface SaldoParceladoExportData {
  summary: SaldoExportSummary
  months: SaldoExportMonth[]
  cards: SaldoExportCard[]
  items: SaldoExportItem[]
  share: 'mine' | 'total'
  chartMode: 'consolidated' | 'by_card'
  monthsTruncated: boolean
  chartImage: SaldoExportChartImage | null
  legend: SaldoExportLegendEntry[]
  inactiveCardIds: Set<number>
}

/** Valor exibido como saída (negativo), igual à tela; zero vira 0. */
export function asOutflow(value: number): number {
  return Math.abs(value) >= 0.005 ? -Math.abs(value) : 0
}

export function sharingLabel(item: SaldoExportItem): string {
  if (!item.shared_partner_name) return ''
  return `${item.shared_partner_name} (${Number(item.ownership_percentage).toFixed(0)}%)`
}

export function cardLabel(name: string, number: string, inactive: boolean): string {
  return `${name} · ${number}${inactive ? ' (Inativo)' : ''}`
}

export function exportFileStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Rasteriza o SVG do Recharts dentro de `container` para PNG (2x).
 * A legenda do Recharts é HTML, fora do SVG, por isso é desenhada à parte.
 */
export async function captureChartImage(container: HTMLElement | null): Promise<SaldoExportChartImage | null> {
  if (!container) return null
  // Os ícones da legenda também são svg.recharts-surface (14x14); o gráfico é o maior.
  const svg = Array.from(container.querySelectorAll<SVGSVGElement>('svg.recharts-surface')).sort((a, b) => {
    const ra = a.getBoundingClientRect()
    const rb = b.getBoundingClientRect()
    return rb.width * rb.height - ra.width * ra.height
  })[0]
  if (!svg) return null
  const rect = svg.getBoundingClientRect()
  const width = Math.round(rect.width)
  const height = Math.round(rect.height)
  if (!width || !height) return null

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.setAttribute('font-family', 'Helvetica, Arial, sans-serif')
  const rootStyle = getComputedStyle(document.documentElement)
  const xml = new XMLSerializer()
    .serializeToString(clone)
    .replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_m, name: string, fallback?: string) => {
      return rootStyle.getPropertyValue(name).trim() || fallback?.trim() || '#6b7280'
    })
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Falha ao renderizar o gráfico'))
      el.src = url
    })
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return { dataUrl: canvas.toDataURL('image/png'), width, height }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}
