import {
  itemViewerBalanceImpact,
  sourceTableToKey,
  type ClosureSourceKey,
} from './closureBalanceBySource'

export type RecalcDiffRow = {
  key: string
  source_table?: string
  item: Record<string, unknown>
}

export type SideBucket = 'mine' | 'other'

export type SourceMovementTotals = {
  newCount: number
  newImpact: number
  removedCount: number
  removedImpact: number
  newCountMine: number
  newCountOther: number
  removedCountMine: number
  removedCountOther: number
}

function resolveSourceKey(row: RecalcDiffRow): ClosureSourceKey | null {
  const fromRow = sourceTableToKey(row.source_table ?? String(row.item.source_table ?? ''))
  if (fromRow) return fromRow
  const bucket = String(row.item._bucket ?? '')
  if (bucket.includes('credit_card')) return 'card'
  if (bucket.includes('benefit_card')) return 'benefit'
  if (bucket.includes('expense_items') || bucket.includes('revenue_items')) return 'bank'
  const keyPart = row.key.split(':')[1]
  return sourceTableToKey(keyPart)
}

const emptyMovement = (): SourceMovementTotals => ({
  newCount: 0,
  newImpact: 0,
  removedCount: 0,
  removedImpact: 0,
  newCountMine: 0,
  newCountOther: 0,
  removedCountMine: 0,
  removedCountOther: 0,
})

function ownerIdFromKey(key: string): number {
  const part = key.split(':')[0]
  const id = Number(part)
  return Number.isFinite(id) ? id : 0
}

function sideForOwner(ownerId: number, loggedAccountId: number): SideBucket {
  return ownerId === loggedAccountId ? 'mine' : 'other'
}

export function aggregateRecalcMovementBySource(
  newItems: RecalcDiffRow[],
  removedItems: RecalcDiffRow[],
  loggedAccountId: number,
): Record<ClosureSourceKey, SourceMovementTotals> {
  const out: Record<ClosureSourceKey, SourceMovementTotals> = {
    bank: emptyMovement(),
    card: emptyMovement(),
    benefit: emptyMovement(),
  }

  for (const row of newItems) {
    const sk = resolveSourceKey(row)
    if (!sk) continue
    const ownerId = ownerIdFromKey(row.key)
    const impact = itemViewerBalanceImpact(row.item, ownerId, loggedAccountId)
    const side = sideForOwner(ownerId, loggedAccountId)
    const bucket = out[sk]
    bucket.newCount += 1
    bucket.newImpact += impact
    if (side === 'mine') bucket.newCountMine += 1
    else bucket.newCountOther += 1
  }

  for (const row of removedItems) {
    const sk = resolveSourceKey(row)
    if (!sk) continue
    const ownerId = ownerIdFromKey(row.key)
    const impact = -itemViewerBalanceImpact(row.item, ownerId, loggedAccountId)
    const side = sideForOwner(ownerId, loggedAccountId)
    const bucket = out[sk]
    bucket.removedCount += 1
    bucket.removedImpact += impact
    if (side === 'mine') bucket.removedCountMine += 1
    else bucket.removedCountOther += 1
  }

  return out
}

export type SideMovementSummary = {
  side: SideBucket
  label: string
  newCount: number
  newImpact: number
  removedCount: number
  removedImpact: number
}

export function aggregateRecalcMovementBySide(
  newItems: RecalcDiffRow[],
  removedItems: RecalcDiffRow[],
  loggedAccountId: number,
): SideMovementSummary[] {
  const mine = { newCount: 0, newImpact: 0, removedCount: 0, removedImpact: 0 }
  const other = { newCount: 0, newImpact: 0, removedCount: 0, removedImpact: 0 }

  for (const row of newItems) {
    const ownerId = ownerIdFromKey(row.key)
    const impact = itemViewerBalanceImpact(row.item, ownerId, loggedAccountId)
    const target = sideForOwner(ownerId, loggedAccountId) === 'mine' ? mine : other
    target.newCount += 1
    target.newImpact += impact
  }
  for (const row of removedItems) {
    const ownerId = ownerIdFromKey(row.key)
    const impact = -itemViewerBalanceImpact(row.item, ownerId, loggedAccountId)
    const target = sideForOwner(ownerId, loggedAccountId) === 'mine' ? mine : other
    target.removedCount += 1
    target.removedImpact += impact
  }

  return [
    { side: 'mine', label: 'Sua conta', ...mine },
    { side: 'other', label: 'Conta contraparte', ...other },
  ]
}

export function buildDisplayItemFromRecalcRow(
  row: RecalcDiffRow,
  mainAccountId: number,
  mainCard: Record<string, unknown> | undefined,
  partnerCard: Record<string, unknown> | undefined,
  isPartnerView: boolean,
) {
  const ownerId = ownerIdFromKey(row.key)
  const isFromPartner = ownerId !== mainAccountId
  const ownerCard = isFromPartner ? partnerCard : mainCard
  const counterpartCard = isFromPartner ? mainCard : partnerCard
  const sourceTable = row.source_table ?? row.item.source_table
  const source_type =
    sourceTable === 'credit_card_invoices'
      ? 'Cartão de Crédito'
      : sourceTable === 'benefit_card_statements'
        ? 'Cartão Benefício'
        : 'Conta Bancária'

  return {
    ...row.item,
    source_table: sourceTable,
    source_type,
    _closure_key: row.key,
    owner_account: {
      name: ownerCard?.account_name,
      number: ownerCard?.account_number,
      bank: ownerCard?.bank_name,
      agency: ownerCard?.agency,
    },
    counterpart_account: {
      name: counterpartCard?.account_name,
      number: counterpartCard?.account_number,
      bank: counterpartCard?.bank_name,
      agency: counterpartCard?.agency,
    },
    should_invert: isPartnerView !== isFromPartner,
  }
}
