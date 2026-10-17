export type ClosureSourceKey = 'bank' | 'card' | 'benefit'

const SOURCE_BUCKETS: Record<
  ClosureSourceKey,
  { expense: string; revenue: string; sourceType: string }
> = {
  bank: {
    expense: 'expense_items',
    revenue: 'revenue_items',
    sourceType: 'Conta Bancária',
  },
  card: {
    expense: 'credit_card_expense_items',
    revenue: 'credit_card_revenue_items',
    sourceType: 'Cartão de Crédito',
  },
  benefit: {
    expense: 'benefit_card_expense_items',
    revenue: 'benefit_card_revenue_items',
    sourceType: 'Cartão Benefício',
  },
}

type SideTotals = { aReceber: number; aPagar: number }

function emptySide(): SideTotals {
  return { aReceber: 0, aPagar: 0 }
}

function addItemToSide(side: 'mine' | 'other', item: Record<string, unknown>, acc: SideTotals) {
  const amount = parseFloat(String(item.amount ?? 0))
  if (Math.abs(amount) < 1e-9) return
  const myPct = parseFloat(String(item.my_contribution_percentage ?? 0)) / 100
  const partnerPct = parseFloat(String(item.partner_contribution_percentage ?? 0)) / 100
  if (side === 'mine') {
    if (amount < 0) acc.aReceber += amount * partnerPct
    else acc.aPagar += amount * partnerPct
  } else {
    if (amount < 0) acc.aReceber += amount * myPct
    else acc.aPagar += amount * myPct
  }
}

function sideNet(t: SideTotals) {
  return t.aReceber + t.aPagar
}

function viewerNetFromSides(mine: SideTotals, other: SideTotals) {
  return mine.aReceber + mine.aPagar + -other.aPagar + -other.aReceber
}

function cardBuckets(card: Record<string, unknown> | null | undefined, key: ClosureSourceKey) {
  const def = SOURCE_BUCKETS[key]
  const expense = (card?.[def.expense] as unknown[]) ?? []
  const revenue = (card?.[def.revenue] as unknown[]) ?? []
  return { expense, revenue }
}

export type ClosureSourceBalanceRow = {
  key: ClosureSourceKey
  count: number
  myAccountCount: number
  partnerAccountCount: number
  /** Itens na conta logada (antes do cruzamento). */
  myAccountNet: number
  /** Itens na conta contraparte, impacto no seu saldo (lado invertido). */
  partnerAccountNet: number
  /** Efeito líquido no saldo do fechamento (itens), mesma regra do backend. */
  viewerNet: number
  /** A receber (itens), positivo. Soma = total_to_receive do fechamento. */
  toReceive: number
  /** A pagar (itens), negativo. Soma = total_to_pay do fechamento. */
  toPay: number
  /** toReceive + toPay (positivo = a receber). */
  result: number
}

export function sourceTableToKey(sourceTable: string | undefined): ClosureSourceKey | null {
  switch (sourceTable) {
    case 'bank_statements':
      return 'bank'
    case 'credit_card_invoices':
      return 'card'
    case 'benefit_card_statements':
      return 'benefit'
    default:
      return null
  }
}

/** Impacto de um lançamento no saldo do fechamento (perspectiva da conta logada). */
export function itemViewerBalanceImpact(
  item: Record<string, unknown>,
  ownerAccountId: number,
  loggedAccountId: number,
): number {
  const side: 'mine' | 'other' = ownerAccountId === loggedAccountId ? 'mine' : 'other'
  const acc = emptySide()
  addItemToSide(side, item, acc)
  if (side === 'mine') return sideNet(acc)
  return -acc.aPagar - acc.aReceber
}

/**
 * Repartição por tipo alinhada ao cálculo de balanço (main + inversão da contraparte).
 */
export function computeClosureBalanceBySource(
  closureData: Record<string, unknown> | null | undefined,
  isPartnerView: boolean,
): ClosureSourceBalanceRow[] {
  const main = (closureData?.main_account_card as Record<string, unknown>) ?? {}
  const partner = (closureData?.partner_account_card as Record<string, unknown>) ?? {}
  const myCard = isPartnerView ? partner : main
  const otherCard = isPartnerView ? main : partner

  return (Object.keys(SOURCE_BUCKETS) as ClosureSourceKey[]).map((key) => {
    const mine = emptySide()
    const other = emptySide()
    let count = 0

    const myBuckets = cardBuckets(myCard, key)
    const otherBuckets = cardBuckets(otherCard, key)
    let myAccountCount = 0
    let partnerAccountCount = 0

    for (const item of [...myBuckets.expense, ...myBuckets.revenue]) {
      count += 1
      myAccountCount += 1
      addItemToSide('mine', item as Record<string, unknown>, mine)
    }
    for (const item of [...otherBuckets.expense, ...otherBuckets.revenue]) {
      count += 1
      partnerAccountCount += 1
      addItemToSide('other', item as Record<string, unknown>, other)
    }

    const myAccountNet = sideNet(mine)
    const partnerAccountNet = -other.aPagar + -other.aReceber
    const viewerNet = viewerNetFromSides(mine, other)
    const toReceive = -mine.aReceber + other.aPagar
    const toPay = -(mine.aPagar - other.aReceber)

    return {
      toReceive,
      toPay,
      result: toReceive + toPay,
      key,
      count,
      myAccountCount,
      partnerAccountCount,
      myAccountNet,
      partnerAccountNet,
      viewerNet,
    }
  })
}

export function closureSourceLabels(): Record<
  ClosureSourceKey,
  { label: string; sourceType: string }
> {
  return {
    bank: { label: 'Conta corrente', sourceType: SOURCE_BUCKETS.bank.sourceType },
    card: { label: 'Cartão de crédito', sourceType: SOURCE_BUCKETS.card.sourceType },
    benefit: { label: 'Cartão benefício', sourceType: SOURCE_BUCKETS.benefit.sourceType },
  }
}
