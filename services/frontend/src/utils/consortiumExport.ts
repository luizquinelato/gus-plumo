import { downloadExcel, excelDateStamp, type ExcelSheetSpec } from './excelExportClient'
import { downloadPdf, type PdfBlock } from './pdfExportClient'
import { formatCurrency } from './currency'
import type { SaldoExportChartImage } from './saldoParceladoExportShared'
import { buildProjectionWorkbook, type ProjectionWorkbook } from './consortiumProjectionWorkbook'
import {
  buildBase,
  defaultFuroTotal,
  DEFAULT_RATE_PCT,
  simulate,
  ymLabel,
  type ProjectionConsortium,
  type Scenario,
} from './consortiumProjection'

export interface ExportField {
  label: string
  value: string
}

export interface ExportSection {
  title: string
  fields: ExportField[]
}

const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()

const money = (v: number | null | undefined) => (v == null ? '—' : formatCurrency(v))
const sum = (values: (number | null)[]) => values.reduce<number>((acc, v) => acc + (v ?? 0), 0)

/* ---------------------------------------------------------------- Detalhes + parcelas */

export interface InstallmentExportRow {
  number: number | null
  description: string
  due: string
  paidOn: string
  amountDue: number | null
  amountPaid: number | null
  fine: number | null
  interest: number | null
}

export interface ConsortiumDetailsExport {
  title: string
  subtitle: string
  sections: ExportSection[]
  installments: InstallmentExportRow[]
}

const detailsSheets = (data: ConsortiumDetailsExport): ExcelSheetSpec[] => {
  return [
    {
      name: 'Detalhes',
      preamble: [[data.title], [data.subtitle]],
      rows: data.sections.flatMap((s) => s.fields.map((f) => ({ Seção: s.title, Campo: f.label, Valor: f.value }))),
      columns: ['Seção', 'Campo', 'Valor'],
      kinds: { Seção: 'text', Campo: 'text', Valor: 'text' },
    },
    {
      name: 'Parcelas',
      rows: data.installments.map((r) => ({
        Parcela: r.number,
        Lançamento: r.description,
        Vencimento: r.due,
        Pagamento: r.paidOn,
        Devido: r.amountDue,
        Pago: r.amountPaid,
        Multa: r.fine,
        Juros: r.interest,
      })),
      columns: ['Parcela', 'Lançamento', 'Vencimento', 'Pagamento', 'Devido', 'Pago', 'Multa', 'Juros'],
      kinds: {
        Parcela: 'int', Lançamento: 'text', Vencimento: 'text', Pagamento: 'text',
        Devido: 'money', Pago: 'money', Multa: 'money', Juros: 'money',
      },
      footer: [[
        'Total', '', '', '',
        sum(data.installments.map((r) => r.amountDue)), sum(data.installments.map((r) => r.amountPaid)),
        sum(data.installments.map((r) => r.fine)), sum(data.installments.map((r) => r.interest)),
      ]],
    },
  ]
}

const detailsPdfBlocks = (data: ConsortiumDetailsExport): PdfBlock[] => {
  const blocks: PdfBlock[] = data.sections.flatMap<PdfBlock>((s) => [
    { type: 'heading', text: s.title },
    {
      type: 'table',
      columns: [{ header: 'Campo', width_mm: 60 }, { header: 'Valor' }],
      rows: s.fields.map((f) => [f.label, f.value]),
    },
  ])
  blocks.push({ type: 'page_break' }, { type: 'heading', text: 'Parcelas' })
  blocks.push({
    type: 'table',
    font_size: 7,
    columns: [
      { header: 'Parcela', width_mm: 14 }, { header: 'Lançamento' }, { header: 'Vencimento', width_mm: 20 },
      { header: 'Pagamento', width_mm: 20 }, { header: 'Devido', align: 'right', width_mm: 22 },
      { header: 'Pago', align: 'right', width_mm: 22 }, { header: 'Multa', align: 'right', width_mm: 18 },
      { header: 'Juros', align: 'right', width_mm: 18 },
    ],
    rows: data.installments.map((r) => [
      r.number == null ? '—' : String(r.number), r.description, r.due, r.paidOn,
      money(r.amountDue), money(r.amountPaid), money(r.fine), money(r.interest),
    ]),
    footer: [
      'Total', '', '', '',
      money(sum(data.installments.map((r) => r.amountDue))), money(sum(data.installments.map((r) => r.amountPaid))),
      money(sum(data.installments.map((r) => r.fine))), money(sum(data.installments.map((r) => r.interest))),
    ],
  })
  return blocks
}

/* ---------------------------------------------------------------- Projeção */

export interface ProjectionMonthRow {
  label: string
  parcelEnd: number
  balanceBeforeEnd: number
  balanceEnd: number
  parcelContemplated: number
  balanceBeforeContemplated: number
  furoPaid: number
  balanceContemplated: number
}

export interface ScenarioExportRow {
  metric: string
  end: string
  contemplated: string
  variation: string
}

export interface ConsortiumProjectionExport {
  title: string
  subtitle: string
  summary: ExportField[]
  premises: ExportField[]
  scenarios: ScenarioExportRow[]
  months: ProjectionMonthRow[]
  /** Só para o Excel: abas Projeção e Meses, com fórmulas e gráficos editáveis pelas premissas. */
  workbook?: ProjectionWorkbook
  /** Só para o PDF: gráficos já rasterizados e a legenda com cores resolvidas. */
  charts?: { title: string; image: SaldoExportChartImage | null }[]
  legend?: { name: string; color: string }[]
}

/** Variação em texto: "+12,3%", "-4,1%", "0%" ou "—" (base zero). */
const deltaText = (current: number | null, base: number | null): string => {
  if (current == null || base == null) return '—'
  if (current === base) return '0%'
  if (!base) return '—'
  const pct = ((current - base) / Math.abs(base)) * 100
  return `${pct > 0 ? '+' : ''}${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}
const pctOf = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`)

/** Mesmas linhas da tabela "Cenários" da tela, já em texto. */
export function buildScenarioExportRows(
  c: Scenario,
  n: Scenario,
  contemplatedDate: string,
  noneDate: string,
): ScenarioExportRow[] {
  const last = n.points.length - 1
  const after = c.contemplationIdx != null && c.contemplationIdx < last ? c.points[c.contemplationIdx + 1]?.parcel : null
  const months = c.contemplationIdx != null ? last - c.contemplationIdx : 0
  const atEnd = c.contemplationIdx != null && c.contemplationIdx >= last
  const cSettle = c.finalSettlement + (atEnd ? c.furoPaid : 0)
  const out = (v: number) => money(v > 0 ? -v : 0)
  return [
    {
      metric: 'Data do crédito', end: noneDate, contemplated: contemplatedDate,
      variation: months > 0 ? `${months} ${months === 1 ? 'mês' : 'meses'} antes do fim` : 'No fim do plano',
    },
    { metric: 'Crédito recebido ao final', end: money(n.creditReceived), contemplated: money(c.creditReceived), variation: deltaText(c.creditReceived, n.creditReceived) },
    { metric: 'Custo total', end: money(-n.totalCost), contemplated: money(-c.totalCost), variation: deltaText(c.totalCost, n.totalCost) },
    { metric: 'Juros total', end: pctOf(n.totalPct), contemplated: pctOf(c.totalPct), variation: deltaText(c.totalPct, n.totalPct) },
    { metric: 'Juros a.a.', end: pctOf(n.annualPct), contemplated: pctOf(c.annualPct), variation: deltaText(c.annualPct, n.annualPct) },
    { metric: 'Parcela (início)', end: money(-n.points[0].parcel), contemplated: money(-c.points[0].parcel), variation: '—' },
    { metric: 'Parcela (após)', end: '—', contemplated: after != null ? money(-after) : '—', variation: '—' },
    { metric: 'Parcela (fim)', end: money(-n.points[last].parcel), contemplated: money(-c.points[last].parcel), variation: '—' },
    {
      metric: 'Parcela: fim vs início',
      end: deltaText(n.points[last].parcel, n.points[0].parcel),
      contemplated: deltaText(c.points[last].parcel, c.points[0].parcel),
      variation: '—',
    },
    { metric: 'Furo pago', end: '—', contemplated: c.furoPaid > 0 && !atEnd ? money(-c.furoPaid) : '—', variation: '—' },
    {
      metric: 'Quitação no fim', end: n.finalSettlement > 0 ? money(-n.finalSettlement) : '—',
      contemplated: cSettle > 0 ? money(-cSettle) : '—',
      variation: cSettle > 0 && n.finalSettlement > 0 ? deltaText(cSettle, n.finalSettlement) : '—',
    },
    {
      metric: 'Saldo após última parcela', end: out(n.finalSettlement), contemplated: out(cSettle),
      variation: cSettle > 0 && n.finalSettlement > 0 ? deltaText(cSettle, n.finalSettlement) : '—',
    },
  ]
}


const projectionPdfBlocks = (data: ConsortiumProjectionExport): PdfBlock[] => {
  const fieldTable = (fields: ExportField[]): PdfBlock => ({
    type: 'table',
    columns: [{ header: 'Campo', width_mm: 60 }, { header: 'Valor' }],
    rows: fields.map((f) => [f.label, f.value]),
  })
  const blocks: PdfBlock[] = [
    { type: 'heading', text: 'Situação atual' },
    fieldTable(data.summary),
    { type: 'heading', text: 'Premissas' },
    fieldTable(data.premises),
  ]
  const charts = (data.charts ?? []).filter((chart) => chart.image)
  if (charts.length) {
    // Os gráficos (título + imagem + legenda embaixo) ficam juntos numa página própria.
    blocks.push({ type: 'page_break' })
    charts.forEach((chart) => {
      blocks.push({ type: 'heading', text: chart.title })
      blocks.push({ type: 'image', image_data_url: chart.image!.dataUrl, max_height_mm: 85 })
      if (data.legend?.length) {
        blocks.push({ type: 'legend', legend: data.legend.map((l) => ({ ...l, kind: 'line' as const })) })
      }
      // Respiro entre um gráfico e o título do próximo.
      blocks.push({ type: 'spacer', space_mm: 16 })
    })
    blocks.push({ type: 'page_break' })
  }
  blocks.push({ type: 'heading', text: 'Cenários' })
  blocks.push({
    type: 'table',
    columns: [{ header: 'Métrica', width_mm: 42 }, { header: 'Ao final' }, { header: 'Contemplado' }, { header: 'Variação', width_mm: 40 }],
    rows: data.scenarios.map((r) => [r.metric, r.end, r.contemplated, r.variation]),
  })
  blocks.push({ type: 'heading', text: 'Projeção mensal' })
  blocks.push({
    type: 'table',
    font_size: 7,
    columns: [
      { header: 'Mês', width_mm: 16 }, { header: 'Parcela (fim)', align: 'right' }, { header: 'Saldo após (fim)', align: 'right' },
      { header: 'Parcela (contemp.)', align: 'right' }, { header: 'Furo', align: 'right' }, { header: 'Saldo após (contemp.)', align: 'right' },
    ],
    rows: data.months.map((m) => [
      m.label, money(m.parcelEnd), money(m.balanceEnd), money(m.parcelContemplated),
      m.furoPaid > 0 ? money(m.furoPaid) : '—', money(m.balanceContemplated),
    ]),
  })
  return blocks
}

export type ProjectionSource = ProjectionConsortium & {
  company_label: string
  group_code: string
  quota: string
  paid_installments: number
  remaining_installments: number
}

export interface ProjectionChartRow {
  label: string
  parcel: number
  balance: number
  parcelNone: number
  balanceNone: number
}

export interface ProjectionPremises {
  /** Mês da contemplação, em meses absolutos (ano × 12 + mês − 1). */
  contemplationYm: number
  ratePct: number
  reductionPct: number
  furoTotal: number
}

/** Premissas iniciais da tela de projeções (contemplação no 1º mês, correção do segmento, redução e furo cadastrados). */
export function defaultProjectionPremises(c: ProjectionSource): ProjectionPremises | null {
  const base = buildBase(c)
  if (!base) return null
  return {
    contemplationYm: base.firstYm,
    ratePct: DEFAULT_RATE_PCT[c.segment] ?? 4.5,
    reductionPct: Math.min(Math.max(c.reduction_factor ?? 0, 0), 100),
    furoTotal: defaultFuroTotal(c, base),
  }
}

/**
 * Projeção a partir das premissas informadas (ou as iniciais). Devolve também as linhas dos gráficos;
 * null se faltarem dados.
 */
export function buildProjectionExport(
  c: ProjectionSource,
  premises?: ProjectionPremises,
): { data: ConsortiumProjectionExport; chartRows: ProjectionChartRow[] } | null {
  const base = buildBase(c)
  const p = premises ?? defaultProjectionPremises(c)
  if (!base || !p) return null
  const rate = p.ratePct
  const reductionPct = Math.min(Math.max(p.reductionPct, 0), 100)
  const furoTotal = Math.max(0, p.furoTotal)
  const idx = Math.min(Math.max(p.contemplationYm - base.firstYm, 0), base.remaining - 1)
  const params = { creditRatePct: rate, balanceRatePct: rate, reductionPct, furoTotal }
  const contemplated = simulate(base, params, idx)
  const none = simulate(base, params, null)
  const contemplationLabel = ymLabel(base.firstYm + idx)
  const lastLabel = ymLabel(base.firstYm + base.remaining - 1)
  const round = (v: number) => Math.round(v * 100) / 100
  const brDate = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')

  const data: ConsortiumProjectionExport = {
    title: 'Projeção de consórcio',
    subtitle: `${c.company_label} · Grupo ${c.group_code} · Cota ${c.quota}`,
    summary: [
      { label: 'Crédito', value: money(c.credit_amount ?? 0) },
      { label: 'Saldo devedor', value: money(c.outstanding_balance ?? 0) },
      {
        label: 'Parcela atual',
        value: `${money(c.monthly_amount ?? 0)}${c.reduction_factor != null ? ` (redução ${pctOf(c.reduction_factor)})` : ''}`,
      },
      { label: 'Pagas', value: `${c.paid_installments} de ${c.plan_term_months}` },
      {
        label: 'Restantes',
        value: `${c.remaining_installments} (${c.open_regular_installments} regulares + ${c.catch_up_installments} furo)`,
      },
      { label: 'Próx. vencimento', value: brDate(c.next_due_date) },
    ],
    premises: [
      { label: 'Contemplação em', value: contemplationLabel },
      { label: 'Correção anual (% a.a.)', value: pctOf(rate) },
      { label: 'Fator de redução até a contemplação', value: pctOf(reductionPct) },
      { label: 'Total furo', value: money(furoTotal) },
    ],
    scenarios: buildScenarioExportRows(contemplated, none, contemplationLabel, lastLabel),
    months: contemplated.points.map((p, i) => ({
      label: ymLabel(p.ym),
      parcelEnd: round(none.points[i]?.parcel ?? p.parcel),
      balanceBeforeEnd: round(none.points[i]?.balanceBefore ?? p.balanceBefore),
      balanceEnd: round(none.points[i]?.balance ?? p.balance),
      parcelContemplated: round(p.parcel),
      balanceBeforeContemplated: round(p.balanceBefore),
      furoPaid: round(p.furoPaid),
      balanceContemplated: round(p.balance),
    })),
    legend: [],
  }
  const css = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const hex = (cssVar: string, fallback: string) => {
    const value = css?.getPropertyValue(cssVar).trim() ?? ''
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
  }
  data.workbook = buildProjectionWorkbook({
    title: data.title,
    subtitle: data.subtitle,
    base,
    premises: { contemplationYm: base.firstYm + idx, ratePct: rate, reductionPct, furoTotal },
    contemplated,
    none,
    colors: { end: hex('--color-2', '#0CC02A'), contemplated: hex('--color-1', '#297BFF') },
  })
  const chartRows: ProjectionChartRow[] = [
    { label: ymLabel(base.firstYm - 1), parcel: round(base.monthly), balance: round(base.balance), parcelNone: round(base.monthly), balanceNone: round(base.balance) },
    ...data.months.map((m) => ({
      label: m.label,
      parcel: m.parcelContemplated,
      balance: m.balanceContemplated,
      parcelNone: m.parcelEnd,
      balanceNone: m.balanceEnd,
    })),
  ]
  return { data, chartRows }
}

export async function exportConsortiumExcel(
  details: ConsortiumDetailsExport,
  projection: ConsortiumProjectionExport | null,
): Promise<void> {
  const sheets = [...detailsSheets(details), ...(projection?.workbook?.sheets ?? [])]
  await downloadExcel(`consorcio_${slug(details.title)}_${excelDateStamp()}.xlsx`, sheets, projection?.workbook?.names)
}

export async function exportConsortiumPdf(
  details: ConsortiumDetailsExport,
  projection: ConsortiumProjectionExport | null,
): Promise<void> {
  const blocks: PdfBlock[] = [...detailsPdfBlocks(details)]
  if (projection) {
    blocks.push({ type: 'page_break' }, { type: 'heading', text: 'Projeção' }, ...projectionPdfBlocks(projection))
  }
  await downloadPdf(`consorcio_${slug(details.title)}_${excelDateStamp()}.pdf`, {
    title: details.title,
    subtitle: details.subtitle,
    blocks,
  })
}
