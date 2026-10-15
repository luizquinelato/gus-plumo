import { downloadExcel, excelDateStamp, type ExcelColumnKind } from './excelExportClient'
import { downloadPdf, type PdfBlock, type PdfColumn } from './pdfExportClient'

/** Uma linha da tela "Fechamentos da conta" (já com a repartição Conta / Compartilhado). */
export interface AccountClosureExportRow {
  year: number
  month: number
  monthLabel: string
  statusLabel: string
  itemCount: number
  openingBalance: number
  entries: number
  entriesAccount: number
  entriesShared: number
  exits: number
  exitsAccount: number
  exitsShared: number
  closingBalance: number
  adjustment: number | null
  closedAt: string | null
}

const COLUMNS = [
  'Ano',
  'Mês',
  'Status',
  'Lançamentos',
  'Saldo anterior',
  'Entradas',
  'Entradas (conta)',
  'Entradas (compartilhado)',
  'Saídas',
  'Saídas (conta)',
  'Saídas (compartilhado)',
  'Resultado',
  'Ajuste',
  'Fechado em',
]

const KINDS: Record<string, ExcelColumnKind> = {
  Ano: 'int',
  Lançamentos: 'int',
  'Saldo anterior': 'money',
  Entradas: 'money',
  'Entradas (conta)': 'money',
  'Entradas (compartilhado)': 'money',
  Saídas: 'money',
  'Saídas (conta)': 'money',
  'Saídas (compartilhado)': 'money',
  Resultado: 'money',
  Ajuste: 'money',
}

const money = (value: number) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const formatDate = (iso: string | null) => {
  if (!iso) return ''
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (plain) return `${plain[3]}/${plain[2]}/${plain[1]}`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR')
}

export async function exportAccountClosuresToExcel(
  rows: AccountClosureExportRow[],
  tabLabel: string,
  absoluteValues = false,
): Promise<void> {
  if (!rows.length) return
  const v = (n: number) => (absoluteValues ? Math.abs(n) : n)
  const sheetRows = rows.map((r) => ({
    Ano: r.year,
    Mês: r.monthLabel,
    Status: r.statusLabel,
    Lançamentos: r.itemCount,
    'Saldo anterior': v(r.openingBalance),
    Entradas: v(r.entries),
    'Entradas (conta)': v(r.entriesAccount),
    'Entradas (compartilhado)': v(r.entriesShared),
    Saídas: v(r.exits),
    'Saídas (conta)': v(r.exitsAccount),
    'Saídas (compartilhado)': v(r.exitsShared),
    Resultado: v(r.closingBalance),
    Ajuste: r.adjustment == null ? null : v(r.adjustment),
    'Fechado em': formatDate(r.closedAt),
  }))
  await downloadExcel(`fechamentos_conta_${excelDateStamp()}.xlsx`, [
    { name: `Fechamentos ${tabLabel}`.slice(0, 31), rows: sheetRows, columns: COLUMNS, kinds: KINDS },
  ])
}

export async function exportAccountClosuresToPdf(
  rows: AccountClosureExportRow[],
  tabLabel: string,
  absoluteValues = false,
): Promise<void> {
  if (!rows.length) return
  const v = (n: number) => (absoluteValues ? Math.abs(n) : n)
  await downloadPdf(`fechamentos_conta_${excelDateStamp()}.pdf`, {
    title: 'Fechamentos da conta',
    subtitle: `${tabLabel} · ${rows.length} mês(es)`,
    blocks: [
      {
        type: 'table',
        font_size: 7.5,
        columns: [
          { header: 'Mês' },
          { header: 'Status' },
          { header: 'Lanç.', width_mm: 12, align: 'center' },
          { header: 'Saldo anterior', align: 'right' },
          { header: 'Entradas', align: 'right' },
          { header: 'Saídas', align: 'right' },
          { header: 'Resultado', align: 'right' },
        ],
        rows: rows.map((r) => [
          `${r.monthLabel} ${r.year}`,
          r.statusLabel,
          String(r.itemCount),
          money(v(r.openingBalance)),
          money(v(r.entries)),
          money(v(r.exits)),
          money(v(r.closingBalance)),
        ]),
        tones: rows.map((r) => [
          null,
          null,
          null,
          null,
          'positive',
          'negative',
          r.closingBalance < 0 ? 'negative' : 'positive',
        ]),
        bold_columns: [6],
      },
    ],
  })
}


/** Lançamento exibido no modal de detalhes (Visualizar) de um fechamento. */
export interface ClosureDetailItem {
  date: string
  description: string
  sourceLabel: string
  amount: number
  amountAccount: number
  amountShared: number
}

export interface ClosureDetailGroup {
  label: string
  receitas: ClosureDetailItem[]
  despesas: ClosureDetailItem[]
}

export interface ClosureDetailPartner {
  name: string
  entries: number
  exits: number
}

/** Conteúdo completo do modal de detalhes: resumo, compartilhado por conta e lançamentos por conta. */
export interface AccountClosureDetail {
  summary: AccountClosureExportRow
  partners: ClosureDetailPartner[]
  groups: ClosureDetailGroup[]
}

const DETAIL_ITEM_COLUMNS = ['Tipo', 'Fonte', 'Data', 'Descrição', 'Valor', 'Valor (conta)', 'Valor (compartilhado)']
const DETAIL_ITEM_KINDS: Record<string, ExcelColumnKind> = {
  Valor: 'money',
  'Valor (conta)': 'money',
  'Valor (compartilhado)': 'money',
}

const detailFileStem = (r: AccountClosureExportRow) =>
  `fechamento_conta_${r.year}-${String(r.month).padStart(2, '0')}_${excelDateStamp()}`

export async function exportAccountClosureDetailToExcel(
  detail: AccountClosureDetail,
  absoluteValues = false,
): Promise<void> {
  const v = (n: number) => (absoluteValues ? Math.abs(n) : n)
  const { summary: r } = detail
  const flow = (secao: string, item: string, entries: number | null, exits: number | null, result: number) => ({
    Seção: secao,
    Item: item,
    Entradas: entries == null ? null : v(entries),
    Saídas: exits == null ? null : v(exits),
    Resultado: v(result),
  })
  // Aba "Geral" do modal: caixa do extrato, repartição conta/compartilhado e compartilhado por conta.
  const geralRows = [
    flow('Caixa do extrato', 'Saldo anterior', null, null, r.openingBalance),
    flow('Caixa do extrato', 'Resultado do caixa', r.entries, r.exits, r.closingBalance),
    flow('Repartição Conta / Compartilhado', 'Conta', r.entriesAccount, r.exitsAccount, r.entriesAccount - r.exitsAccount),
    flow('Repartição Conta / Compartilhado', 'Compartilhado', r.entriesShared, r.exitsShared, r.entriesShared - r.exitsShared),
    ...detail.partners.map((p) => flow('Compartilhado por conta', p.name, p.entries, p.exits, p.entries - p.exits)),
  ]
  const usedNames = new Set<string>(['Geral'])
  const sheetName = (label: string) => {
    const base = (label.replace(/[\\/?*[\]:]/g, ' ').trim() || 'Conta').slice(0, 31)
    let name = base
    for (let n = 2; usedNames.has(name); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`
    usedNames.add(name)
    return name
  }
  await downloadExcel(`${detailFileStem(r)}.xlsx`, [
    {
      name: 'Geral',
      rows: geralRows,
      columns: ['Seção', 'Item', 'Entradas', 'Saídas', 'Resultado'],
      kinds: { Entradas: 'money', Saídas: 'money', Resultado: 'money' },
      preamble: [[`${r.monthLabel} ${r.year} · ${r.statusLabel} · ${r.itemCount} lançamento(s)`]],
    },
    // Uma aba por conta, como as abas do modal "Visualizar".
    ...detail.groups.map((g) => ({
      name: sheetName(g.label),
      rows: ([['Receita', g.receitas], ['Despesa', g.despesas]] as const).flatMap(([tipo, list]) =>
        list.map((i) => ({
          Tipo: tipo,
          Fonte: i.sourceLabel,
          Data: formatDate(i.date),
          Descrição: i.description,
          Valor: v(i.amount),
          'Valor (conta)': v(i.amountAccount),
          'Valor (compartilhado)': v(i.amountShared),
        })),
      ),
      columns: DETAIL_ITEM_COLUMNS,
      kinds: DETAIL_ITEM_KINDS,
    })),
  ])
}

export async function exportAccountClosureDetailToPdf(
  detail: AccountClosureDetail,
  absoluteValues = false,
): Promise<void> {
  const v = (n: number) => (absoluteValues ? Math.abs(n) : n)
  const { summary: r } = detail
  const right = (header: string): PdfColumn => ({ header, align: 'right' })
  const blocks: PdfBlock[] = [
    {
      type: 'table',
      font_size: 8,
      columns: [{ header: 'Caixa do extrato' }, right('Total'), right('Conta'), right('Compartilhado')],
      rows: [
        ['Saldo anterior', money(v(r.openingBalance)), '', ''],
        ['Entradas', money(v(r.entries)), money(v(r.entriesAccount)), money(v(r.entriesShared))],
        ['Saídas', money(v(r.exits)), money(v(r.exitsAccount)), money(v(r.exitsShared))],
        ['Resultado', money(v(r.closingBalance)), '', ''],
      ],
    },
  ]

  if (detail.partners.length) {
    blocks.push(
      { type: 'heading', text: 'Compartilhado por conta' },
      {
        type: 'table',
        font_size: 8,
        columns: [{ header: 'Conta' }, right('Entradas'), right('Saídas'), right('Resultado')],
        rows: detail.partners.map((p) => [
          p.name, money(v(p.entries)), money(v(p.exits)), money(v(p.entries - p.exits)),
        ]),
      },
    )
  }

  // Cada aba do modal (Geral e uma por conta) começa em uma página nova.
  for (const g of detail.groups) {
    let firstOfTab = true
    for (const [tipo, list] of [['Receitas', g.receitas], ['Despesas', g.despesas]] as const) {
      if (!list.length) continue
      if (firstOfTab) blocks.push({ type: 'page_break' })
      firstOfTab = false
      blocks.push(
        { type: 'heading', text: `${g.label} · ${tipo} (${list.length})` },
        {
          type: 'table',
          font_size: 7.5,
          columns: [
            { header: 'Data', width_mm: 20 },
            { header: 'Fonte', width_mm: 24 },
            { header: 'Descrição' },
            { ...right('Valor'), width_mm: 24 },
            { ...right('Conta'), width_mm: 22 },
            { ...right('Compart.'), width_mm: 22 },
          ],
          rows: list.map((i) => [
            formatDate(i.date), i.sourceLabel, i.description,
            money(v(i.amount)), money(v(i.amountAccount)), money(v(i.amountShared)),
          ]),
          tones: list.map((i) => [null, null, null, i.amount < 0 ? 'negative' : 'positive', null, null]),
          bold_columns: [3],
        },
      )
    }
  }

  await downloadPdf(`${detailFileStem(r)}.pdf`, {
    title: `Fechamento · ${r.monthLabel} ${r.year}`,
    subtitle: `${r.statusLabel} · ${r.itemCount} lançamento(s)`,
    blocks,
  })
}
