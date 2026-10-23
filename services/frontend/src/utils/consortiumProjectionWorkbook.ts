import type { ExcelFreeCell, ExcelSheetSpec } from './excelExportClient'
import type { ProjectionBase, Scenario } from './consortiumProjection'

/**
 * Planilha "para brincar": a aba Projeção reúne a situação atual, as premissas (células amarelas) e os
 * cenários; a aba Meses calcula mês a mês com fórmulas. Mudar uma premissa recalcula tudo e os gráficos.
 * As fórmulas espelham `simulate()` (consortiumProjection.ts).
 */

export const PROJECTION_SHEET = 'Projeção'
export const MONTHS_SHEET = 'Meses'

export interface WorkbookPremises {
  contemplationYm: number
  ratePct: number
  reductionPct: number
  furoTotal: number
}

export interface ProjectionWorkbook {
  sheets: ExcelSheetSpec[]
  names: Record<string, string>
}

const ymToIso = (ym: number) => `${Math.floor(ym / 12)}-${String((ym % 12) + 1).padStart(2, '0')}-01`
/** Número de série do Excel (1º dia do mês). */
const ymSerial = (ym: number) => Math.round((Date.UTC(Math.floor(ym / 12), ym % 12, 1) - Date.UTC(1899, 11, 30)) / 86_400_000)

// Linhas (base 1) da aba Projeção que recebem nome definido; as fórmulas usam os nomes.
const NAMED_ROWS: Record<string, number> = {
  Credito: 5, Saldo: 6, ParcelaAtual: 7, TotalPago: 8, NParcelas: 9, PrazoMeses: 10, PrimeiroMes: 11,
  MesesAteReajuste: 12, ReducaoCadastrada: 13, ContempEm: 16, TaxaAnual: 17, ReducaoPct: 18, FuroTotal: 19,
  MesContemp: 22, FatorAnual: 23, EscalaReducao: 24, ParcelaInicial: 25, Recalcula: 26, FuroEfetivo: 27,
  RestantesApos: 28, SaldoFimA: 29, SaldoFimC: 30,
}

export function buildProjectionWorkbook(input: {
  title: string
  subtitle: string
  base: ProjectionBase
  premises: WorkbookPremises
  contemplated: Scenario
  none: Scenario
  colors: { end: string; contemplated: string }
}): ProjectionWorkbook {
  const { base, premises: p, contemplated, none, colors } = input
  const N = base.remaining
  const last = N + 1 // última linha (base 1) da aba Meses
  const rng = (letter: string) => `${MONTHS_SHEET}!$${letter}$2:$${letter}$${last}`
  const at = (letter: string, row: number) => `${MONTHS_SHEET}!$${letter}$${row}`
  const k = Math.min(Math.max(p.contemplationYm - base.firstYm, 0), N - 1) + 1

  /* ---------------------------------------------------------------- aba Projeção */
  const cells: ExcelFreeCell[] = []
  const put = (r: number, c: number, v: ExcelFreeCell['v'], extra: Partial<ExcelFreeCell> = {}) =>
    cells.push({ r, c, v, ...extra })
  const fx = (r: number, c: number, f: string, extra: Partial<ExcelFreeCell> = {}) => cells.push({ r, c, f, ...extra })
  const line = (r: number, label: string, v: ExcelFreeCell['v'], extra: Partial<ExcelFreeCell> = {}) => {
    put(r, 0, label, { style: 'label' })
    put(r, 1, v, extra)
  }

  put(0, 0, input.title, { style: 'title' })
  put(1, 0, input.subtitle, { style: 'note' })
  put(2, 0, 'Edite as células amarelas (premissas): os cenários, a aba Meses e os gráficos recalculam sozinhos.', { style: 'note' })

  put(3, 0, 'Situação atual', { style: 'section' })
  line(4, 'Crédito', base.credit, { kind: 'money' })
  line(5, 'Saldo devedor', base.balance, { kind: 'money' })
  line(6, 'Parcela atual', base.monthly, { kind: 'money' })
  line(7, 'Total pago (líquido)', base.totalPaid, { kind: 'money' })
  line(8, 'Parcelas regulares em aberto', N, { kind: 'int' })
  line(9, 'Prazo do plano (meses)', base.planMonths, { kind: 'int' })
  line(10, 'Próx. vencimento', ymToIso(base.firstYm), { kind: 'monthyear' })
  line(11, 'Meses até o 1º reajuste (0 = já na 1ª parcela)', base.adjYm - base.firstYm, { kind: 'int' })
  line(12, 'Redução já embutida na parcela (%)', base.baseReductionPct, { kind: 'decimal' })

  put(14, 0, 'Premissas (edite)', { style: 'section' })
  line(15, 'Contemplação em', ymToIso(p.contemplationYm), { kind: 'monthyear', style: 'input' })
  line(16, 'Correção anual (% a.a.)', p.ratePct, { kind: 'decimal', style: 'input' })
  line(17, 'Fator de redução até a contemplação (%)', p.reductionPct, { kind: 'decimal', style: 'input' })
  line(18, 'Total furo (R$)', p.furoTotal, { kind: 'money', style: 'input' })

  const G = rng('G')
  const K = rng('K')
  put(20, 0, 'Cálculos auxiliares', { style: 'section' })
  const aux = (r: number, label: string, f: string, v: number, kind: ExcelFreeCell['kind']) => {
    put(r, 0, label, { style: 'calc' })
    fx(r, 1, f, { kind, style: 'calc', v })
  }
  aux(21, 'Nº da parcela da contemplação', 'MAX(1,MIN(NParcelas,(YEAR(ContempEm)-YEAR(PrimeiroMes))*12+MONTH(ContempEm)-MONTH(PrimeiroMes)+1))', k, 'int')
  aux(22, 'Fator de correção anual', '1+TaxaAnual/100', 1 + p.ratePct / 100, 'decimal')
  aux(23, 'Escala da redução', '(1-MIN(MAX(ReducaoPct,0),99.99)/100)/(1-ReducaoCadastrada/100)', (1 - Math.min(Math.max(p.reductionPct, 0), 99.99) / 100) / (1 - base.baseReductionPct / 100), 'decimal')
  aux(24, 'Parcela inicial (com a redução)', 'ParcelaAtual*EscalaReducao', base.monthly, 'money')
  aux(
    25,
    'Parcela refeita pelo saldo após a contemplação (1 = sim; há redução ou furo)',
    'IF(OR(MIN(MAX(ReducaoPct,0),100)>0,FuroEfetivo>0),1,0)',
    p.reductionPct > 0 || p.furoTotal > 0 ? 1 : 0,
    'int',
  )
  aux(26, 'Furo considerado', 'MAX(0,FuroTotal)', Math.max(0, p.furoTotal), 'money')
  aux(27, 'Parcelas restantes após a contemplação', 'NParcelas-MesContemp', N - k, 'int')
  const settleN = Math.max(0, none.finalSettlement)
  const settleC = contemplated.finalSettlement + (contemplated.contemplationIdx != null && contemplated.contemplationIdx >= N - 1 ? contemplated.furoPaid : 0)
  aux(28, 'Saldo após a última parcela (ao final)', `IF(INDEX(${G},NParcelas)>0.005,INDEX(${G},NParcelas),0)`, settleN, 'money')
  aux(29, 'Saldo após a última parcela (contemplado)', `IF(INDEX(${K},NParcelas)>0.005,INDEX(${K},NParcelas),0)+IF(MesContemp>=NParcelas,FuroEfetivo,0)`, settleC, 'money')

  /* Cenários: B = ao final, C = contemplado, D = variação do contemplado sobre o ao final. */
  put(31, 0, 'Cenários', { style: 'section' })
  ;['Métrica', 'Ao final', 'Contemplado', 'Variação'].forEach((h, c) => put(32, c, h, { style: 'head' }))
  const row = (
    r: number,
    label: string,
    b: string | null,
    c: string | null,
    d: string | null,
    kind: ExcelFreeCell['kind'],
    cache?: [number, number],
    dKind: ExcelFreeCell['kind'] = 'percent',
  ) => {
    put(r, 0, label, { style: 'label' })
    ;[b, c].forEach((f, i) => {
      if (f == null) put(r, 1 + i, '—')
      else fx(r, 1 + i, f, { kind, v: cache?.[i] })
    })
    if (d) fx(r, 3, d, { kind: dKind })
    else put(r, 3, '—')
  }
  const delta = (r: number) => `IF(C${r}=B${r},0,IF(B${r}=0,"—",(C${r}-B${r})/ABS(B${r})))`
  const dash = (a: string, b: string) =>
    `IF(AND(${a}>0,${b}>0),IF(${b}=${a},0,(${b}-${a})/ABS(${a})),"—")`
  const gap = 'NParcelas-MesContemp'
  row(33, 'Data do crédito', 'EDATE(PrimeiroMes,NParcelas-1)', 'EDATE(PrimeiroMes,MesContemp-1)',
    `IF(${gap}>0,(${gap})&IF(${gap}=1," mês"," meses")&" antes do fim","No fim do plano")`, 'monthyear', undefined, 'text')
  row(34, 'Crédito recebido ao final', `Credito*FatorAnual^INDEX(${rng('C')},NParcelas)`, `Credito*FatorAnual^INDEX(${rng('C')},MesContemp)`, delta(35), 'money', [none.creditReceived, contemplated.creditReceived])
  row(35, 'Custo total', `TotalPago+SUM(${rng('E')})+SaldoFimA`,
    `TotalPago+SUM(${rng('H')})+SUM(${rng('J')})+IF(INDEX(${K},NParcelas)>0.005,INDEX(${K},NParcelas),0)`, delta(36), 'money', [none.totalCost, contemplated.totalCost])
  row(36, 'Juros total', 'B36/B35-1', 'C36/C35-1', delta(37), 'percent', [none.totalPct / 100, contemplated.totalPct / 100])
  row(37, 'Juros a.a.', 'B37/(PrazoMeses/12)', 'C37/(PrazoMeses/12)', delta(38), 'percent', [(none.annualPct ?? 0) / 100, (contemplated.annualPct ?? 0) / 100])
  row(38, 'Parcela (início)', at('E', 2), at('H', 2), null, 'money')
  row(39, 'Parcela (após)', null, `IF(MesContemp<NParcelas,INDEX(${rng('H')},MesContemp+1),"—")`, null, 'money')
  row(40, 'Parcela (fim)', at('E', last), at('H', last), null, 'money')
  row(41, 'Parcela: fim vs início', 'IF(B41=B39,0,(B41-B39)/ABS(B39))', 'IF(C41=C39,0,(C41-C39)/ABS(C39))', null, 'percent')
  row(42, 'Furo pago', null, 'IF(AND(FuroEfetivo>0,MesContemp<NParcelas),FuroEfetivo,"—")', null, 'money')
  row(43, 'Quitação no fim', 'IF(SaldoFimA>0,SaldoFimA,"—")', 'IF(SaldoFimC>0,SaldoFimC,"—")', dash('SaldoFimA', 'SaldoFimC'), 'money')
  row(44, 'Saldo após última parcela', 'SaldoFimA', 'SaldoFimC', dash('SaldoFimA', 'SaldoFimC'), 'money')
  put(46, 0, 'Variação = Contemplado em relação ao Ao final. Custo e juros menores no contemplado são melhores.', { style: 'note' })

  /* ---------------------------------------------------------------- aba Meses */
  const month: ExcelFreeCell[] = []
  ;[
    'Nº', 'Mês', 'Reajustes acumulados', 'Reajustes no mês', 'Parcela (ao final)', 'Saldo antes (ao final)',
    'Saldo após (ao final)', 'Parcela (contemplado)', 'Saldo antes (contemplado)', 'Furo pago',
    'Saldo após (contemplado)', 'Saldo ao final (gráfico)', 'Saldo contemplado (gráfico)',
  ].forEach((h, c) => month.push({ r: 0, c, v: h, style: 'head' }))

  let prevAdj = 0
  for (let i = 1; i <= N; i += 1) {
    const x = i + 1
    const r = i
    const ym = base.firstYm + i - 1
    const adj = i - 1 < base.adjYm - base.firstYm ? 0 : Math.floor((i - 1 - (base.adjYm - base.firstYm)) / 12) + 1
    const steps = adj - prevAdj
    prevAdj = adj
    const pn = none.points[i - 1]
    const pc = contemplated.points[i - 1]
    const prev = (letter: string, first: string) => (i === 1 ? first : `${letter}${x - 1}`)
    const f = (c: number, formula: string, kind: ExcelFreeCell['kind'], v?: number) =>
      month.push({ r, c, f: formula, kind, v })
    month.push({ r, c: 0, v: i, kind: 'int' })
    f(1, `EDATE(PrimeiroMes,A${x}-1)`, 'monthyear', ymSerial(ym))
    f(2, `IF(A${x}-1<MesesAteReajuste,0,INT((A${x}-1-MesesAteReajuste)/12)+1)`, 'int', adj)
    f(3, i === 1 ? `C${x}` : `C${x}-C${x - 1}`, 'int', steps)
    f(4, `${prev('E', 'ParcelaInicial')}*IF(D${x}>0,FatorAnual^D${x},1)`, 'money', pn?.parcel)
    f(5, `${prev('G', 'Saldo')}*FatorAnual^D${x}`, 'money', pn?.balanceBefore)
    f(6, `F${x}-E${x}`, 'money', pn?.balance)
    f(
      7,
      `IF(AND(A${x}>MesContemp,Recalcula=1,OR(A${x}=MesContemp+1,D${x}>0)),MAX(0,I${x})/(NParcelas-A${x}+1),` +
        `${prev('H', 'ParcelaInicial')}*IF(D${x}>0,FatorAnual^D${x},1))`,
      'money',
      pc?.parcel,
    )
    f(8, `${prev('K', 'Saldo')}*FatorAnual^D${x}`, 'money', pc?.balanceBefore)
    f(9, `IF(AND(A${x}=MesContemp,FuroEfetivo>0),FuroEfetivo,0)`, 'money', pc?.furoPaid)
    f(10, `I${x}-H${x}-J${x}`, 'money', pc?.balance)
    f(11, `MAX(0,G${x})`, 'money', pn?.balance)
    f(12, `MAX(0,K${x})`, 'money', pc?.balance)
  }

  const cat = { sheet: MONTHS_SHEET, r1: 1, c1: 1, r2: N, c2: 1 }
  const series = (c: number) => ({ sheet: MONTHS_SHEET, r1: 1, c1: c, r2: N, c2: c })
  const chart = (title: string, row0: number, endCol: number, contCol: number) => ({
    title,
    row: row0,
    col: 5,
    categories: cat,
    series: [
      { name: 'Ao final', values: series(endCol), color: colors.end },
      { name: 'Contemplado', values: series(contCol), color: colors.contemplated },
    ],
  })

  const widths: Record<number, number> = { 0: 42, 1: 20, 2: 20, 3: 26, 4: 3 }
  const monthWidths: Record<number, number> = {}
  for (let c = 0; c <= 12; c += 1) monthWidths[c] = c === 0 ? 6 : 16

  const names: Record<string, string> = {}
  Object.entries(NAMED_ROWS).forEach(([name, rowNumber]) => {
    names[name] = `='${PROJECTION_SHEET}'!$B$${rowNumber}`
  })

  return {
    names,
    sheets: [
      {
        name: PROJECTION_SHEET,
        rows: [],
        cells,
        col_widths: widths,
        line_charts: [
          chart('Valor da parcela por mês', 3, 4, 7),
          chart('Saldo devedor projetado (após pagar a parcela do mês)', 24, 11, 12),
        ],
      },
      { name: MONTHS_SHEET, rows: [], cells: month, col_widths: monthWidths },
    ],
  }
}
