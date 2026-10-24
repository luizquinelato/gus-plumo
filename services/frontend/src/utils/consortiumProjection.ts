/**
 * Motor de projeção de consórcio (puro, sem React).
 *
 * Linha do tempo: um ponto por parcela regular em aberto, a partir do próximo vencimento (índice 0).
 * Regras:
 *  - Antes da contemplação a parcela acompanha a correção do crédito (nos reajustes anuais).
 *  - O saldo devedor é corrigido pela taxa do saldo nos reajustes e abatido a cada parcela paga.
 *  - No mês da contemplação paga-se a parcela antiga e, DEPOIS dela, o total do furo (se houver) é pago de
 *    uma vez e abate o saldo. A nova parcela vale a partir do mês seguinte.
 *  - Com fator de redução ou furo informado, a nova parcela é saldo ÷ parcelas restantes (saldo já amortizado
 *    pelo furo) e é recalculada a cada reajuste. Sem os dois, a parcela não muda e o furo é calculado
 *    automaticamente: o que as parcelas até o último vencimento não cobrem é pago na contemplação.
 *  - Sem contemplação o furo não entra à parte (já está no saldo): o cenário é fixo e o saldo que sobrar
 *    é quitado no fim do plano.
 */

export interface ProjectionConsortium {
  segment: string
  monthly_amount?: number | null
  outstanding_balance?: number | null
  credit_amount?: number | null
  total_paid?: number | null
  open_regular_installments: number
  catch_up_installments: number
  catch_up_installment_amount?: number | null
  reduction_factor?: number | null
  next_due_date?: string | null
  next_adjustment_date?: string | null
  plan_term_months: number
}

export interface ProjectionBase {
  monthly: number
  balance: number
  credit: number
  totalPaid: number
  remaining: number
  planMonths: number
  firstYm: number
  adjYm: number
  /** Redução (%) já embutida na parcela atual (a cadastrada no consórcio). */
  baseReductionPct: number
}

export interface ProjectionParams {
  creditRatePct: number
  balanceRatePct: number
  reductionPct: number
  /** Valor total do furo, pago de uma vez na contemplação (após a parcela do mês) e abatido do saldo. */
  furoTotal: number
}

export interface ProjectionPoint {
  ym: number
  parcel: number
  /** Saldo devedor APÓS pagar a parcela do mês. */
  balance: number
  /** Saldo no início do mês, já com o reajuste (se houve) e ANTES de pagar furo/parcela do mês. */
  balanceBefore: number
  /** Houve reajuste anual neste mês. */
  adjusted: boolean
  /** Furo pago neste mês (só no mês da contemplação); amortiza o saldo. */
  furoPaid: number
  cumulative: number
}

export interface Scenario {
  contemplationIdx: number | null
  points: ProjectionPoint[]
  creditReceived: number
  newParcel: number | null
  furoPaid: number
  /** Saldo que sobra no fim do plano e é quitado de uma vez (última parcela / descontado do crédito). */
  finalSettlement: number
  futureTotal: number
  totalCost: number
  totalPct: number
  annualPct: number | null
}

export const ymOf = (iso: string): number => {
  const [y, m] = iso.slice(0, 10).split('-').map(Number)
  return y * 12 + (m - 1)
}
export const ymLabel = (ym: number): string => `${String((ym % 12) + 1).padStart(2, '0')}/${Math.floor(ym / 12)}`
export const ymToInput = (ym: number): string => `${Math.floor(ym / 12)}-${String((ym % 12) + 1).padStart(2, '0')}`
export const inputToYm = (value: string): number | null => {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null
}

export const DEFAULT_RATE_PCT: Record<string, number> = { auto: 4.5, imovel: 6 }

export function buildBase(c: ProjectionConsortium): ProjectionBase | null {
  const monthly = Math.abs(c.monthly_amount ?? 0)
  const balance = Math.abs(c.outstanding_balance ?? 0)
  const credit = c.credit_amount ?? 0
  if (!monthly || !balance || !credit || c.open_regular_installments <= 0 || !c.next_due_date) return null
  const firstYm = ymOf(c.next_due_date)
  let adjYm = c.next_adjustment_date ? ymOf(c.next_adjustment_date) : firstYm + 12
  while (adjYm < firstYm) adjYm += 12
  return {
    monthly,
    balance,
    credit,
    totalPaid: Math.abs(c.total_paid ?? 0),
    remaining: c.open_regular_installments,
    planMonths: c.plan_term_months,
    firstYm,
    adjYm,
    baseReductionPct: Math.min(Math.max(c.reduction_factor ?? 0, 0), 99.99),
  }
}

/**
 * Furo informado como premissa: qtde × parcela do furo, só se estiver cadastrada. Sem cadastro fica 0, e a
 * simulação calcula o furo sozinha (o que as parcelas até o último vencimento não cobrem).
 */
export function defaultFuroTotal(c: ProjectionConsortium, _base: ProjectionBase): number {
  if (c.catch_up_installments <= 0 || c.catch_up_installment_amount == null) return 0
  return Math.round(Math.abs(c.catch_up_installment_amount) * c.catch_up_installments * 100) / 100
}

/** Quantos reajustes anuais já ocorreram até o mês `ym` (inclusive). */
const adjustmentsUntil = (base: ProjectionBase, ym: number) =>
  ym < base.adjYm ? 0 : Math.floor((ym - base.adjYm) / 12) + 1

/**
 * Simula um cenário. Depois da contemplação:
 *  - Com fator de redução (a parcela estava reduzida) ou com furo informado: a parcela é refeita pelo saldo
 *    (saldo ÷ parcelas restantes) e o furo informado é pago na contemplação.
 *  - Sem redução e sem furo informado: a parcela NÃO muda (só a correção anual). O furo é calculado sozinho:
 *    é o que as parcelas até o último vencimento não cobrem, pago de uma vez na contemplação, de modo que o
 *    saldo chegue a zero no fim.
 */
export function simulate(base: ProjectionBase, params: ProjectionParams, contemplationIdx: number | null): Scenario {
  const manual = params.reductionPct > 0 || params.furoTotal > 0
  if (contemplationIdx == null || manual) {
    return runScenario(base, params, contemplationIdx, manual, Math.max(0, params.furoTotal))
  }
  // Ensaio sem furo: o saldo que sobra no fim é o que o furo precisa quitar. Ele é abatido na contemplação,
  // depois do reajuste do mês, e por isso só é corrigido pelos reajustes seguintes.
  const dry = runScenario(base, params, contemplationIdx, false, 0)
  const rs = 1 + params.balanceRatePct / 100
  const stepsAfter =
    adjustmentsUntil(base, base.firstYm + base.remaining - 1) - adjustmentsUntil(base, base.firstYm + contemplationIdx)
  const furo = Math.round((dry.finalSettlement / rs ** stepsAfter) * 100) / 100
  return runScenario(base, params, contemplationIdx, false, furo)
}

function runScenario(
  base: ProjectionBase,
  params: ProjectionParams,
  contemplationIdx: number | null,
  recalc: boolean,
  furoTotal: number,
): Scenario {
  const rc = 1 + params.creditRatePct / 100
  const rs = 1 + params.balanceRatePct / 100
  // A parcela atual já tem a redução cadastrada embutida: recupera a parcela cheia e aplica a redução simulada.
  const reductionScale =
    (1 - Math.min(Math.max(params.reductionPct, 0), 99.99) / 100) / (1 - base.baseReductionPct / 100)
  let parcel = base.monthly * reductionScale
  let balance = base.balance
  let credit = base.credit
  let cumulative = 0
  let contemplated = false
  let creditReceived: number | null = null
  let newParcel: number | null = null
  let furoPaid = 0
  let prevAdj = 0
  let pendingSwitch = false
  const points: ProjectionPoint[] = []

  for (let i = 0; i < base.remaining; i += 1) {
    const ym = base.firstYm + i
    const adj = adjustmentsUntil(base, ym)
    const steps = adj - prevAdj
    prevAdj = adj
    if (steps > 0) {
      credit *= rc ** steps
      balance *= rs ** steps
      if (!contemplated) parcel *= rc ** steps
      else if (!recalc) parcel *= rs ** steps
    }
    const balanceBefore = balance
    let furoThisMonth = 0
    const isContemplationMonth = !contemplated && contemplationIdx === i
    if (isContemplationMonth) {
      // Mês da contemplação: recebe o crédito; a parcela deste mês ainda é a antiga.
      contemplated = true
      creditReceived = credit
      pendingSwitch = true
    } else if (contemplated) {
      // A partir do mês seguinte à contemplação vale a nova parcela.
      if (recalc && (pendingSwitch || steps > 0)) {
        parcel = Math.max(0, balance) / (base.remaining - i)
      }
      if (pendingSwitch) {
        newParcel = parcel
        pendingSwitch = false
      }
    }
    cumulative += parcel
    balance -= parcel
    // O furo é pago na contemplação, DEPOIS da parcela do mês, e amortiza o saldo de uma vez.
    if (isContemplationMonth && furoTotal > 0) {
      furoPaid = furoTotal
      furoThisMonth = furoTotal
      balance -= furoTotal
      cumulative += furoTotal
    }
    points.push({ ym, parcel, balance: Math.max(0, balance), balanceBefore, adjusted: steps > 0, furoPaid: furoThisMonth, cumulative })
  }

  // Fim do plano. O furo só entra na contemplação: sem contemplação ele não é tratado à parte (já está
  // dentro do saldo devedor), então este cenário é fixo, não muda com o furo.
  // O que sobrar de saldo no fim (parcelas reduzidas não cobrem tudo) é quitado no fim do plano:
  // como última parcela ou descontado do crédito a receber.
  const finalSettlement = Math.max(0, balance)
  if (finalSettlement > 0.005) cumulative += finalSettlement
  const totalCost = base.totalPaid + cumulative
  const received = creditReceived ?? credit
  const totalPct = (totalCost / received - 1) * 100
  const years = base.planMonths / 12
  return {
    contemplationIdx,
    points,
    creditReceived: received,
    newParcel,
    furoPaid,
    finalSettlement: finalSettlement > 0.005 ? finalSettlement : 0,
    futureTotal: cumulative,
    totalCost,
    totalPct,
    annualPct: years > 0 ? totalPct / years : null,
  }
}
