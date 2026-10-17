import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowDownCircle, ArrowUp, ArrowUpCircle, Banknote, Calendar, CreditCard, Gift, Landmark, Receipt, Scale } from 'lucide-react'
import Badge from './Badge'
import {
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from './CadastroFormLayout'
import { CadastroListPageTabs, listPageTableRowHoverCls } from './CadastroListPageLayout'
import SharedAccountDisplay from './SharedAccountDisplay'
import { formatDateTimeBR } from '../utils/dateUtils'
import SortableDateHeader from './SortableDateHeader'
import {
  sortRowsByDate,
  toggleDateSortDirection,
  type DateSortDirection,
} from '../utils/tableDateSort'
import {
  filterRegularLoanPayments,
  getSettlementCreditSignedForViewer,
  signedLoanFieldValue,
} from '../utils/closureCreditUtils'
import {
  computeClosureBalanceBySource,
  type ClosureSourceBalanceRow,
  type ClosureSourceKey,
} from '../utils/closureBalanceBySource'
import type { SourceMovementTotals } from '../utils/closureRecalcDiff'

const headCls =
  'bg-gray-100 dark:bg-gray-800/80 [&_th]:border-b-2 [&_th]:border-gray-200 dark:[&_th]:border-gray-600'
const thLeftCls =
  'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
const thRightCls =
  'px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
const thCenterCls =
  'px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
const tdCls = 'border-b border-gray-200 px-3 py-2 dark:border-gray-600'
const footCls = 'border-t-2 border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/50'
const footTdCls = 'px-3 py-2.5 font-semibold'

type SourceKey = 'bank' | 'card' | 'benefit'
type TabKey = 'geral' | SourceKey

const SOURCES: { key: SourceKey; sourceType: string; label: string; icon: ReactNode }[] = [
  { key: 'bank', sourceType: 'Conta Bancária', label: 'Conta corrente', icon: <Landmark size={14} /> },
  { key: 'card', sourceType: 'Cartão de Crédito', label: 'Cartão de crédito', icon: <CreditCard size={14} /> },
  { key: 'benefit', sourceType: 'Cartão Benefício', label: 'Cartão benefício', icon: <Gift size={14} /> },
]

type Totals = { count: number; raw: number; mine: number; partner: number }

const emptyTotals = (): Totals => ({ count: 0, raw: 0, mine: 0, partner: 0 })

function shareValues(item: any) {
  const originalMy = parseFloat(String(item.my_contribution_percentage || '0'))
  const originalPartner = parseFloat(String(item.partner_contribution_percentage || '0'))
  const myPercentage = item.should_invert ? originalPartner : originalMy
  const partnerPercentage = item.should_invert ? originalMy : originalPartner
  const rawAmount = parseFloat(String(item.amount))
  return {
    myPercentage,
    rawAmount,
    mine: rawAmount * (myPercentage / 100),
    partner: rawAmount * (partnerPercentage / 100),
  }
}

function sumItems(items: any[]): Totals {
  return items.reduce((acc: Totals, item) => {
    const share = shareValues(item)
    acc.count += 1
    acc.raw += share.rawAmount
    acc.mine += share.mine
    acc.partner += share.partner
    return acc
  }, emptyTotals())
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatSigned(value: number) {
  if (Math.abs(value) < 0.005) return formatCurrency(0)
  return `${value < 0 ? '-' : ''}${formatCurrency(Math.abs(value))}`
}

function moneyCls(value: number) {
  if (Math.abs(value) < 0.005) return 'text-gray-900 dark:text-gray-100'
  return value < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
}

function MoneyCell({
  value,
  bold = false,
  blankZero = false,
  cls = tdCls,
}: {
  value: number
  bold?: boolean
  blankZero?: boolean
  cls?: string
}) {
  const zero = Math.abs(value) < 0.005
  return (
    <td className={`${cls} whitespace-nowrap text-right tabular-nums ${bold ? 'font-semibold' : ''} ${moneyCls(value)}`}>
      {zero && blankZero ? <span className="text-gray-400">—</span> : formatSigned(value)}
    </td>
  )
}

function formatItemDate(date: string) {
  if (!date) return '—'
  return date.includes('T')
    ? new Date(date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date(date).toLocaleDateString('pt-BR')
}

function FlowSummaryTable({ receitas, despesas }: { receitas: Totals; despesas: Totals }) {
  const rows = [
    { label: 'Receitas', totals: receitas },
    { label: 'Despesas', totals: despesas },
  ]
  const result = {
    raw: receitas.raw + despesas.raw,
    mine: receitas.mine + despesas.mine,
    partner: receitas.partner + despesas.partner,
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className={headCls}>
          <tr>
            <th className={thLeftCls}>Fluxo</th>
            <th className={thRightCls}>Itens</th>
            <th className={thRightCls}>Valor total</th>
            <th className={thRightCls}>Minha parte</th>
            <th className={thRightCls}>Contraparte</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className={`${tdCls} font-medium text-gray-700 dark:text-gray-200`}>{row.label}</td>
              <td className={`${tdCls} text-right tabular-nums text-gray-600 dark:text-gray-300`}>{row.totals.count}</td>
              <MoneyCell value={row.totals.raw} bold />
              <MoneyCell value={row.totals.mine} bold />
              <MoneyCell value={row.totals.partner} bold />
            </tr>
          ))}
        </tbody>
        <tfoot className={footCls}>
          <tr>
            <td className={`${footTdCls} text-gray-800 dark:text-gray-100`}>Resultado</td>
            <td className={`${footTdCls} text-right tabular-nums text-gray-600 dark:text-gray-300`}>
              {receitas.count + despesas.count}
            </td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(result.raw)}`}>{formatSigned(result.raw)}</td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(result.mine)}`}>{formatSigned(result.mine)}</td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(result.partner)}`}>{formatSigned(result.partner)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function ItemsTable({ items, showCard }: { items: any[]; showCard: boolean }) {
  const [dateSort, setDateSort] = useState<DateSortDirection>('desc')
  const sortedItems = useMemo(
    () =>
      sortRowsByDate(
        items,
        (row) => row.date,
        dateSort,
        (left, right) =>
          String(left.id ?? '').localeCompare(String(right.id ?? ''), undefined, { numeric: true }),
      ),
    [items, dateSort],
  )
  if (items.length === 0) {
    return <p className="px-3 py-4 text-center text-sm text-gray-500">Nenhum lançamento.</p>
  }
  const totals = sumItems(items)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] text-sm">
        <thead className={headCls}>
          <tr>
            <th className={`${thCenterCls} w-12`}>#</th>
            <SortableDateHeader
              sortDirection={dateSort}
              onToggle={() => setDateSort((prev) => toggleDateSortDirection(prev))}
              className={thLeftCls}
            />
            <th className={thLeftCls}>Descrição</th>
            {showCard && <th className={thLeftCls}>Cartão</th>}
            <th className={thLeftCls}>Tag/Subtag</th>
            <th className={thLeftCls}>Conta contraparte</th>
            <th className={thRightCls}>Valor total</th>
            <th className={thCenterCls}>%</th>
            <th className={thRightCls}>Minha parte</th>
            <th className={thRightCls}>Contraparte</th>
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item, index) => {
            const share = shareValues(item)
            return (
              <tr key={`${item.id}-${index}`} className={listPageTableRowHoverCls}>
                <td className={`${tdCls} text-center text-sm text-gray-500 dark:text-gray-400`}>{index + 1}</td>
                <td className={`${tdCls} whitespace-nowrap text-gray-600 dark:text-gray-400`}>{formatItemDate(item.date)}</td>
                <td className={`${tdCls} font-medium text-gray-900 dark:text-white`}>
                  {item.description || 'Sem descrição'}
                  {item.current_installment && item.total_installments && item.total_installments > 1 && (
                    <span className="ml-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                      ({item.current_installment}/{item.total_installments})
                    </span>
                  )}
                </td>
                {showCard && (
                  <td className={`${tdCls} text-xs text-gray-900 dark:text-white`}>
                    {item.card_name ? (
                      <div>
                        <span className="font-medium">{item.card_name}</span>
                        {item.card_number && (
                          <span className="ml-1 text-[10px] text-gray-500 dark:text-gray-400">•••• {item.card_number}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                )}
                <td className={`${tdCls} text-gray-500 dark:text-gray-400`}>
                  {item.tag_name ? <>{item.tag_name}{item.subtag_name && ` > ${item.subtag_name}`}</> : '—'}
                </td>
                <td className={tdCls}>
                  <SharedAccountDisplay
                    account={item.counterpart_account ? {
                      id: 0,
                      name: item.counterpart_account.name,
                      bank: item.counterpart_account.bank ? { name: item.counterpart_account.bank } : null,
                      agency: item.counterpart_account.agency,
                      account_number: item.counterpart_account.number,
                    } : null}
                    ownershipPercentage={item.should_invert
                      ? parseFloat(item.my_contribution_percentage || '0')
                      : parseFloat(item.partner_contribution_percentage || '0')}
                  />
                </td>
                <MoneyCell value={share.rawAmount} />
                <td className={`${tdCls} text-center font-medium text-gray-700 dark:text-gray-300`}>
                  {share.myPercentage.toFixed(0)}%
                </td>
                <MoneyCell value={share.mine} blankZero />
                <MoneyCell value={share.partner} blankZero />
              </tr>
            )
          })}
        </tbody>
        <tfoot className={footCls}>
          <tr>
            <td colSpan={showCard ? 6 : 5} className={`${footTdCls} text-gray-800 dark:text-gray-100`}>Total</td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(totals.raw)}`}>{formatSigned(totals.raw)}</td>
            <td className={`${footTdCls} text-center text-gray-500 dark:text-gray-400`}>—</td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(totals.mine)}`}>{formatSigned(totals.mine)}</td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(totals.partner)}`}>{formatSigned(totals.partner)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function tagLabel(item: Record<string, unknown>) {
  if (!item.tag_name && !item.subtag_name) return '—'
  return `${item.tag_name ?? ''}${item.subtag_name ? ` > ${item.subtag_name}` : ''}`
}

export function AlteredClosureItemsTable({
  rows,
}: {
  rows: Array<{
    key: string
    source_label: string
    before: Record<string, unknown>
    after: Record<string, unknown>
  }>
}) {
  const [dateSort, setDateSort] = useState<DateSortDirection>('desc')
  const sorted = useMemo(
    () =>
      sortRowsByDate(
        rows,
        (row) => String(row.after.date ?? row.before.date ?? ''),
        dateSort,
        (a, b) => a.key.localeCompare(b.key),
      ),
    [rows, dateSort],
  )

  if (rows.length === 0) {
    return <p className="px-3 py-4 text-center text-sm text-gray-500">Nenhum lançamento alterado.</p>
  }

  const deParaSubTh = `${thLeftCls} !text-[10px] !font-semibold !normal-case !tracking-normal text-gray-500 dark:text-gray-400`
  const deParaSubThR = `${thRightCls} !text-[10px] !font-semibold !normal-case !tracking-normal text-gray-500 dark:text-gray-400`

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1280px] text-sm">
        <thead className={headCls}>
          <tr>
            <th className={`${thCenterCls} w-12`} rowSpan={2}>
              #
            </th>
            <th className={thLeftCls} rowSpan={2}>
              Tipo
            </th>
            <th className={`${thLeftCls} align-bottom`} rowSpan={2}>
              <button
                type="button"
                className="inline-flex items-center gap-1 hover:text-[var(--color-1)]"
                onClick={() => setDateSort((prev) => toggleDateSortDirection(prev))}
              >
                Data
                {dateSort === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
              </button>
            </th>
            <th className={`${thLeftCls} text-center`} colSpan={2}>
              Descrição
            </th>
            <th className={`${thRightCls} text-center`} colSpan={2}>
              Valor total
            </th>
            <th className={`${thLeftCls} text-center`} colSpan={2}>
              Tag / subtag
            </th>
            <th className={`${thCenterCls} text-center`} colSpan={2}>
              %
            </th>
            <th className={`${thCenterCls} text-center`} colSpan={2}>
              Parcelas
            </th>
          </tr>
          <tr>
            <th className={deParaSubTh}>De</th>
            <th className={deParaSubTh}>Para</th>
            <th className={deParaSubThR}>De</th>
            <th className={deParaSubThR}>Para</th>
            <th className={deParaSubTh}>De</th>
            <th className={deParaSubTh}>Para</th>
            <th className={deParaSubTh}>De</th>
            <th className={deParaSubTh}>Para</th>
            <th className={deParaSubTh}>De</th>
            <th className={deParaSubTh}>Para</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => {
            const b = row.before
            const a = row.after
            const bAmt = parseFloat(String(b.amount ?? 0))
            const aAmt = parseFloat(String(a.amount ?? 0))
            const bPct = parseFloat(String(b.my_contribution_percentage ?? 0))
            const aPct = parseFloat(String(a.my_contribution_percentage ?? 0))
            const bInst =
              b.current_installment && b.total_installments
                ? `${b.current_installment}/${b.total_installments}`
                : '—'
            const aInst =
              a.current_installment && a.total_installments
                ? `${a.current_installment}/${a.total_installments}`
                : '—'
            const cellChanged = (changed: boolean) =>
              changed ? 'bg-amber-50/80 dark:bg-amber-900/15' : ''

            const descChanged = String(b.description ?? '') !== String(a.description ?? '')
            const tagChanged = tagLabel(b) !== tagLabel(a)
            const amtChanged = Math.abs(bAmt - aAmt) > 0.005
            const pctChanged = Math.abs(bPct - aPct) > 0.05
            const instChanged = bInst !== aInst

            return (
              <tr key={row.key} className={listPageTableRowHoverCls}>
                <td className={`${tdCls} text-center text-sm text-gray-500 dark:text-gray-400`}>{index + 1}</td>
                <td className={`${tdCls} text-gray-700 dark:text-gray-200`}>{row.source_label}</td>
                <td className={`${tdCls} whitespace-nowrap text-gray-600 dark:text-gray-400`}>
                  {formatItemDate(String(a.date ?? b.date ?? ''))}
                </td>
                <td className={`${tdCls} text-gray-600 dark:text-gray-400 ${cellChanged(descChanged)}`}>
                  {String(b.description ?? '—')}
                </td>
                <td className={`${tdCls} font-medium text-gray-900 dark:text-white ${cellChanged(descChanged)}`}>
                  {String(a.description ?? '—')}
                </td>
                <td className={`${tdCls} text-right tabular-nums ${moneyCls(bAmt)} ${cellChanged(amtChanged)}`}>
                  {formatSigned(bAmt)}
                </td>
                <td className={`${tdCls} text-right tabular-nums font-semibold ${moneyCls(aAmt)} ${cellChanged(amtChanged)}`}>
                  {formatSigned(aAmt)}
                </td>
                <td className={`${tdCls} text-gray-500 dark:text-gray-400 ${cellChanged(tagChanged)}`}>{tagLabel(b)}</td>
                <td className={`${tdCls} text-gray-800 dark:text-gray-200 ${cellChanged(tagChanged)}`}>{tagLabel(a)}</td>
                <td className={`${tdCls} text-center tabular-nums text-gray-600 dark:text-gray-400 ${cellChanged(pctChanged)}`}>
                  {bPct.toFixed(0)}%
                </td>
                <td className={`${tdCls} text-center tabular-nums font-medium text-gray-800 dark:text-gray-200 ${cellChanged(pctChanged)}`}>
                  {aPct.toFixed(0)}%
                </td>
                <td className={`${tdCls} text-center text-gray-500 dark:text-gray-400 ${cellChanged(instChanged)}`}>{bInst}</td>
                <td className={`${tdCls} text-center text-gray-800 dark:text-gray-200 ${cellChanged(instChanged)}`}>{aInst}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function sourceMeta(key: ClosureSourceKey) {
  return SOURCES.find((s) => s.key === key)!
}

function formatQty(n: number) {
  if (n === 0) return '—'
  return String(n)
}

function SourceSummaryDeltaTable({
  savedRows,
  proposedRows,
  movementBySource,
  expectedNewCount,
  expectedRemovedCount,
}: {
  savedRows: ClosureSourceBalanceRow[]
  proposedRows: ClosureSourceBalanceRow[]
  movementBySource?: Record<ClosureSourceKey, SourceMovementTotals>
  expectedNewCount?: number
  expectedRemovedCount?: number
}) {
  const totalViewerDelta = proposedRows.reduce((acc, row, index) => {
    const saved = savedRows[index]
    return acc + (row.viewerNet - saved.viewerNet)
  }, 0)

  let totalNewQtd = 0
  let totalRemovedQtd = 0
  if (movementBySource) {
    for (const key of Object.keys(movementBySource) as ClosureSourceKey[]) {
      const mov = movementBySource[key]
      totalNewQtd += mov.newCount
      totalRemovedQtd += mov.removedCount
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[960px] w-full text-sm">
        <thead className={headCls}>
          <tr>
            <th className={thLeftCls} rowSpan={2}>
              Tipo
            </th>
            <th className={`${thCenterCls} border-b border-gray-200 dark:border-gray-600`} colSpan={2}>
              Novos (qtd)
            </th>
            <th className={`${thCenterCls} border-b border-gray-200 dark:border-gray-600`} colSpan={2}>
              Removidos (qtd)
            </th>
            <th className={`${thCenterCls} border-b border-gray-200 dark:border-gray-600`} colSpan={2}>
              Δ no seu saldo (R$)
            </th>
            <th className={`${thCenterCls} border-b border-gray-200 dark:border-gray-600`} colSpan={3}>
              Fechamento salvo → proposta (R$)
            </th>
          </tr>
          <tr>
            <th className={thRightCls}>Sua conta</th>
            <th className={thRightCls}>Contraparte</th>
            <th className={thRightCls}>Sua conta</th>
            <th className={thRightCls}>Contraparte</th>
            <th className={thRightCls}>Novos</th>
            <th className={thRightCls}>Removidos</th>
            <th className={thRightCls}>Δ sua conta</th>
            <th className={thRightCls}>Δ contraparte</th>
            <th className={thRightCls}>Δ no saldo</th>
          </tr>
        </thead>
        <tbody>
          {proposedRows.map((row, index) => {
            const saved = savedRows[index]
            const meta = sourceMeta(row.key)
            const mov = movementBySource?.[row.key]
            const deltaMyAccount = row.myAccountNet - saved.myAccountNet
            const deltaPartner = row.partnerAccountNet - saved.partnerAccountNet
            const deltaViewer = row.viewerNet - saved.viewerNet
            return (
              <tr key={row.key}>
                <td className={`${tdCls} font-medium text-gray-700 dark:text-gray-200`}>
                  <span className="inline-flex items-center gap-2">
                    {meta.icon}
                    {meta.label}
                  </span>
                </td>
                <td className={`${tdCls} text-right tabular-nums font-semibold text-gray-800 dark:text-gray-100`}>
                  {formatQty(mov?.newCountMine ?? 0)}
                </td>
                <td className={`${tdCls} text-right tabular-nums font-semibold text-gray-800 dark:text-gray-100`}>
                  {formatQty(mov?.newCountOther ?? 0)}
                </td>
                <td className={`${tdCls} text-right tabular-nums font-semibold text-gray-800 dark:text-gray-100`}>
                  {formatQty(mov?.removedCountMine ?? 0)}
                </td>
                <td className={`${tdCls} text-right tabular-nums font-semibold text-gray-800 dark:text-gray-100`}>
                  {formatQty(mov?.removedCountOther ?? 0)}
                </td>
                <MoneyCell value={mov?.newImpact ?? 0} bold blankZero />
                <MoneyCell value={mov?.removedImpact ?? 0} bold blankZero />
                <MoneyCell value={deltaMyAccount} bold blankZero />
                <MoneyCell value={deltaPartner} bold blankZero />
                <MoneyCell value={deltaViewer} bold blankZero />
              </tr>
            )
          })}
        </tbody>
        <tfoot className={footCls}>
          <tr>
            <td className={`${footTdCls} text-gray-800 dark:text-gray-100`}>Totais (qtd)</td>
            <td colSpan={2} className={`${footTdCls} text-right tabular-nums text-gray-700 dark:text-gray-200`}>
              {totalNewQtd}
              {expectedNewCount != null && totalNewQtd !== expectedNewCount ? (
                <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
                  (scorecard: {expectedNewCount})
                </span>
              ) : null}
            </td>
            <td colSpan={2} className={`${footTdCls} text-right tabular-nums text-gray-700 dark:text-gray-200`}>
              {totalRemovedQtd}
              {expectedRemovedCount != null && totalRemovedQtd !== expectedRemovedCount ? (
                <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
                  (scorecard: {expectedRemovedCount})
                </span>
              ) : null}
            </td>
            <td colSpan={5} />
          </tr>
          <tr>
            <td colSpan={9} className={`${footTdCls} text-gray-800 dark:text-gray-100`}>
              Soma Δ no saldo (itens)
            </td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(totalViewerDelta)}`}>
              {formatSigned(totalViewerDelta)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

const dividerCls = 'border-l border-gray-200 dark:border-gray-600'

function ResultCell({ value, bold = false, cls = tdCls }: { value: number; bold?: boolean; cls?: string }) {
  return (
    <td className={`${cls} whitespace-nowrap text-right tabular-nums ${bold ? 'font-semibold' : ''} ${moneyCls(value)}`}>
      {formatSigned(value)}
    </td>
  )
}

type FlowResult = { toReceive: number; toPay: number; result: number }

function SourceSummaryTable({
  bySource,
  viewerNetByKey,
}: {
  bySource: { key: SourceKey; label: string; icon: ReactNode; totals: Totals }[]
  viewerNetByKey: Partial<Record<SourceKey, FlowResult>>
}) {
  const sumFlow = bySource.reduce(
    (acc, row) => {
      const f = viewerNetByKey[row.key]
      return {
        toReceive: acc.toReceive + (f?.toReceive ?? 0),
        toPay: acc.toPay + (f?.toPay ?? 0),
        result: acc.result + (f?.result ?? 0),
      }
    },
    { toReceive: 0, toPay: 0, result: 0 },
  )
  const total = bySource.reduce((acc, row) => ({
    count: acc.count + row.totals.count,
    raw: acc.raw + row.totals.raw,
    mine: acc.mine + row.totals.mine,
    partner: acc.partner + row.totals.partner,
  }), emptyTotals())
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className={headCls}>
          <tr>
            <th className={thLeftCls}>Tipo</th>
            <th className={thRightCls}>Itens</th>
            <th className={thRightCls}>Valor total</th>
            <th className={thRightCls}>Minha parte</th>
            <th className={thRightCls}>Contraparte</th>
            <th className={`${thRightCls} ${dividerCls}`}>A receber</th>
            <th className={thRightCls}>A pagar</th>
            <th className={`${thRightCls} ${dividerCls}`}>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {bySource.map((row) => (
            <tr key={row.key}>
              <td className={`${tdCls} font-medium text-gray-700 dark:text-gray-200`}>
                <span className="inline-flex items-center gap-2">
                  {row.icon}
                  {row.label}
                </span>
              </td>
              <td className={`${tdCls} text-right tabular-nums text-gray-600 dark:text-gray-300`}>{row.totals.count}</td>
              <MoneyCell value={row.totals.raw} bold />
              <MoneyCell value={row.totals.mine} bold />
              <MoneyCell value={row.totals.partner} bold />
              <MoneyCell value={viewerNetByKey[row.key]?.toReceive ?? 0} bold cls={`${tdCls} ${dividerCls}`} />
              <MoneyCell value={viewerNetByKey[row.key]?.toPay ?? 0} bold />
              <ResultCell value={viewerNetByKey[row.key]?.result ?? 0} bold cls={`${tdCls} ${dividerCls}`} />
            </tr>
          ))}
        </tbody>
        <tfoot className={footCls}>
          <tr>
            <td className={`${footTdCls} text-gray-800 dark:text-gray-100`}>Total</td>
            <td className={`${footTdCls} text-right tabular-nums text-gray-600 dark:text-gray-300`}>{total.count}</td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(total.raw)}`}>{formatSigned(total.raw)}</td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(total.mine)}`}>{formatSigned(total.mine)}</td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(total.partner)}`}>{formatSigned(total.partner)}</td>
            <td className={`${footTdCls} ${dividerCls} text-right tabular-nums ${moneyCls(sumFlow.toReceive)}`}>{formatSigned(sumFlow.toReceive)}</td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(sumFlow.toPay)}`}>{formatSigned(sumFlow.toPay)}</td>
            <ResultCell value={sumFlow.result} bold cls={`${footTdCls} ${dividerCls}`} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function ClosureBalanceTable({ closure, isPartnerView }: { closure: any; isPartnerView: boolean }) {
  const closureData = closure?.closure_data || {}
  const viewerCard = (isPartnerView ? closureData.partner_account_card : closureData.main_account_card) || {}
  const toReceive = parseFloat(viewerCard.total_to_receive ?? 0)
  const toPay = -Math.abs(parseFloat(viewerCard.total_to_pay ?? 0))
  const loanToReceive = parseFloat(viewerCard.loan_to_receive ?? 0)
  const loanToPay = -Math.abs(parseFloat(viewerCard.loan_to_pay ?? 0))
  const settlementCredit = getSettlementCreditSignedForViewer(closure, !isPartnerView)
  const balance = toReceive + toPay + loanToReceive + loanToPay + settlementCredit

  const rows = [
    { label: 'A receber (itens)', value: toReceive, always: true },
    { label: 'A pagar (itens)', value: toPay, always: true },
    { label: 'Empréstimos a receber', value: loanToReceive, always: false },
    { label: 'Empréstimos a pagar', value: loanToPay, always: false },
    { label: 'Crédito da quitação', value: settlementCredit, always: false },
  ].filter((row) => row.always || Math.abs(row.value) >= 0.005)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className={headCls}>
          <tr>
            <th className={thLeftCls}>Composição</th>
            <th className={thRightCls}>Valor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className={`${tdCls} font-medium text-gray-700 dark:text-gray-200`}>{row.label}</td>
              <MoneyCell value={row.value} bold />
            </tr>
          ))}
        </tbody>
        <tfoot className={footCls}>
          <tr>
            <td className={`${footTdCls} text-gray-800 dark:text-gray-100`}>Saldo</td>
            <td className={`${footTdCls} text-right text-base tabular-nums ${moneyCls(balance)}`}>{formatSigned(balance)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function formatMonthOnly(yearMonth: string) {
  if (yearMonth === 'Sem mês') return yearMonth
  const [, month] = yearMonth.split('-')
  const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return monthNames[parseInt(month, 10) - 1]
}

function groupCardItemsByPeriod(allItems: any[]) {
  const groupedByMonth = allItems.reduce((acc, item) => {
    const month = item.year_month || 'Sem mês'
    if (!acc[month]) acc[month] = []
    acc[month].push(item)
    return acc
  }, {} as Record<string, any[]>)

  const sortedMonths = Object.keys(groupedByMonth).sort((a, b) => {
    if (a === 'Sem mês') return 1
    if (b === 'Sem mês') return -1
    return b.localeCompare(a)
  })

  const groupedByYear = sortedMonths.reduce((acc, yearMonth) => {
    if (yearMonth === 'Sem mês') {
      if (!acc['Sem ano']) acc['Sem ano'] = []
      acc['Sem ano'].push(yearMonth)
    } else {
      const year = yearMonth.split('-')[0]
      if (!acc[year]) acc[year] = []
      acc[year].push(yearMonth)
    }
    return acc
  }, {} as Record<string, string[]>)

  const sortedYears = Object.keys(groupedByYear).sort((a, b) => {
    if (a === 'Sem ano') return 1
    if (b === 'Sem ano') return -1
    return b.localeCompare(a)
  })

  return { groupedByMonth, groupedByYear, sortedYears }
}

function groupItemsByCard(items: any[]) {
  const grouped = items.reduce((acc, item) => {
    const key = `${item.card_name || 'Sem cartão'}|${item.card_id ?? 0}`
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {} as Record<string, any[]>)

  return Object.entries(grouped)
    .map(([cardKey, groupItems]) => {
      const [cardName] = cardKey.split('|')
      const cardNumber = groupItems[0]?.card_number ? String(groupItems[0].card_number) : ''
      return { cardName, cardNumber, items: groupItems }
    })
    .sort((a, b) => (a.cardNumber || '').localeCompare(b.cardNumber || '', 'pt-BR'))
}

function cardSummaryTitle(cardName: string, cardNumber: string) {
  const suffix = cardNumber ? ` *** ${cardNumber.slice(-4)}` : ''
  return `${cardName}${suffix}`
}

const CARD_GROUP_COLORS = [
  'var(--color-1)',
  'var(--color-2)',
  'var(--color-3)',
  'var(--color-4)',
  'var(--color-5)',
]

function CardSourceTabContent({
  receitas,
  despesas,
}: {
  receitas: any[]
  despesas: any[]
}) {
  const allItems = useMemo(() => [...receitas, ...despesas], [receitas, despesas])
  const { groupedByMonth, groupedByYear, sortedYears } = useMemo(
    () => groupCardItemsByPeriod(allItems),
    [allItems],
  )

  const [activeYear, setActiveYear] = useState('')
  const [activeMonth, setActiveMonth] = useState('')

  useEffect(() => {
    if (sortedYears.length === 0) {
      setActiveYear('')
      setActiveMonth('')
      return
    }
    const firstYear = sortedYears[0]
    const firstMonth = groupedByYear[firstYear]?.[0] ?? ''
    setActiveYear(firstYear)
    setActiveMonth(firstMonth)
  }, [sortedYears, groupedByYear])

  const monthsOfActiveYear = activeYear ? groupedByYear[activeYear] || [] : []

  const filteredReceitas = useMemo(() => {
    if (!activeMonth) return receitas
    return receitas.filter((item) => (item.year_month || 'Sem mês') === activeMonth)
  }, [receitas, activeMonth])

  const filteredDespesas = useMemo(() => {
    if (!activeMonth) return despesas
    return despesas.filter((item) => (item.year_month || 'Sem mês') === activeMonth)
  }, [despesas, activeMonth])

  const cardGroups = useMemo(() => {
    const periodItems = [...filteredReceitas, ...filteredDespesas]
    return groupItemsByCard(periodItems)
  }, [filteredReceitas, filteredDespesas])

  return (
    <>
      {sortedYears.length > 0 && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
            <Calendar size={16} style={{ color: 'var(--color-1)' }} />
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Período da fatura</span>
          </div>
          <div className="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700 px-2">
            {sortedYears.map((year) => {
              const totalItemsInYear = groupedByYear[year].reduce(
                (sum, month) => sum + groupedByMonth[month].length,
                0,
              )
              const isActive = activeYear === year
              return (
                <button
                  key={year}
                  type="button"
                  onClick={() => {
                    setActiveYear(year)
                    const firstMonth = groupedByYear[year]?.[0]
                    if (firstMonth) setActiveMonth(firstMonth)
                  }}
                  className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-all whitespace-nowrap ${
                    isActive
                      ? 'border-[var(--color-1)] text-[var(--color-1)]'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-300'
                  }`}
                >
                  {year}
                  <Badge
                    variant="tab"
                    tone="brand1"
                    className="bg-[var(--color-1)] text-[var(--on-color-1)]"
                    label={String(totalItemsInYear)}
                  />
                </button>
              )
            })}
          </div>
          {monthsOfActiveYear.length > 0 ? (
            <div className="flex overflow-x-auto px-2 bg-gray-50/80 dark:bg-gray-800/50">
              {monthsOfActiveYear.map((month) => {
                const isActive = activeMonth === month
                const monthCount = groupedByMonth[month].length
                return (
                  <button
                    key={month}
                    type="button"
                    onClick={() => setActiveMonth(month)}
                    className={`flex flex-1 min-w-[4.5rem] items-center justify-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-all whitespace-nowrap ${
                      isActive
                        ? 'border-[var(--color-2)] text-[var(--color-2)]'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-300'
                    }`}
                  >
                    {formatMonthOnly(month)}
                    <Badge
                      variant="tab"
                      tone="brand2"
                      className={
                        isActive
                          ? 'bg-[var(--color-2)] text-[var(--on-color-2)]'
                          : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                      }
                      label={String(monthCount)}
                    />
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      )}
      {cardGroups.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">Nenhum lançamento neste período.</p>
      ) : (
        <div className="space-y-10">
        {cardGroups.map(({ cardName, cardNumber, items }, groupIndex) => {
          const cardReceitas = items.filter((item) => parseFloat(String(item.amount)) >= 0)
          const cardDespesas = items.filter((item) => parseFloat(String(item.amount)) < 0)
          const groupKey = `${cardName}|${cardNumber}`
          const color = CARD_GROUP_COLORS[groupIndex % CARD_GROUP_COLORS.length]

          return (
            <div
              key={groupKey}
              className="overflow-hidden rounded-xl border-2"
              style={{ borderColor: color }}
            >
              <div
                className="flex items-center gap-2 px-4 py-3 text-sm font-bold text-white"
                style={{ background: color }}
              >
                <CreditCard size={16} />
                <span className="truncate">{cardSummaryTitle(cardName, cardNumber)}</span>
              </div>
              <div className="space-y-4 p-4">
              <CadastroFormSection
                title="Resumo"
                hint="Receitas, despesas e resultado, com a divisão entre a sua parte e a da contraparte."
                icon={<Scale size={14} />}
                bodyClassName="p-0"
              >
                <FlowSummaryTable receitas={sumItems(cardReceitas)} despesas={sumItems(cardDespesas)} />
              </CadastroFormSection>
              {cardReceitas.length > 0 && (
                <CadastroFormSection title="Receitas" icon={<ArrowUpCircle size={14} />} bodyClassName="p-0">
                  <ItemsTable items={cardReceitas} showCard={false} />
                </CadastroFormSection>
              )}
              {cardDespesas.length > 0 && (
                <CadastroFormSection title="Despesas" icon={<ArrowDownCircle size={14} />} bodyClassName="p-0">
                  <ItemsTable items={cardDespesas} showCard={false} />
                </CadastroFormSection>
              )}
              </div>
            </div>
          )
        })}
        </div>
      )}
    </>
  )
}

function LoansTable({ loans, isPartnerView }: { loans: any[]; isPartnerView: boolean }) {
  const signed = (payment: any) => {
    const isLent = isPartnerView ? payment.loan_type !== 'lent' : payment.loan_type === 'lent'
    return {
      isLent,
      principal: signedLoanFieldValue(payment.original_amount || 0, isLent, 'principal'),
      before: signedLoanFieldValue(payment.remaining_before || 0, isLent, 'corrected'),
      paid: signedLoanFieldValue(payment.amount_paid || 0, isLent, 'paid'),
      after: signedLoanFieldValue(payment.remaining_after || 0, isLent, 'remaining'),
    }
  }
  const totals = loans.reduce((acc, payment) => {
    const row = signed(payment)
    acc.principal += row.principal
    acc.before += row.before
    acc.paid += row.paid
    acc.after += row.after
    return acc
  }, { principal: 0, before: 0, paid: 0, after: 0 })

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className={headCls}>
          <tr>
            <th className={`${thCenterCls} w-12`}>#</th>
            <th className={thLeftCls}>Tipo</th>
            <th className={thLeftCls}>Descrição</th>
            <th className={thRightCls}>Principal</th>
            <th className={thRightCls}>Saldo corrigido</th>
            <th className={thRightCls}>Valor quitado</th>
            <th className={thRightCls}>Saldo restante</th>
            <th className={thCenterCls}>Status</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((payment, index) => {
            const row = signed(payment)
            const valueColor = row.isLent ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
            const isSettled = Math.abs(row.after) < 0.01
            return (
              <tr key={index} className={listPageTableRowHoverCls}>
                <td className={`${tdCls} text-center text-sm text-gray-500 dark:text-gray-400`}>{index + 1}</td>
                <td className={tdCls}>
                  <span
                    className={`inline-flex w-[100px] items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-white ${
                      row.isLent ? 'bg-green-600' : 'bg-red-600'
                    }`}
                  >
                    {row.isLent ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                    {row.isLent ? 'A Receber' : 'A Pagar'}
                  </span>
                </td>
                <td className={`${tdCls} text-gray-900 dark:text-white`}>{payment.description || 'Empréstimo'}</td>
                <td className={`${tdCls} text-right tabular-nums ${Math.abs(row.principal) < 0.01 ? 'text-gray-900 dark:text-gray-100' : valueColor}`}>
                  {formatSigned(row.principal)}
                </td>
                <td className={`${tdCls} text-right tabular-nums ${valueColor}`}>{formatSigned(row.before)}</td>
                <td className={`${tdCls} text-right tabular-nums ${valueColor}`}>{formatSigned(row.paid)}</td>
                <td className={`${tdCls} text-right tabular-nums ${isSettled ? 'text-gray-500 dark:text-gray-400' : valueColor}`}>
                  {formatSigned(row.after)}
                </td>
                <td className={`${tdCls} text-center`}>
                  <span
                    className={`inline-flex w-[100px] items-center justify-center gap-1.5 rounded px-3 py-1 text-xs font-medium text-white ${
                      isSettled ? 'bg-green-600' : 'bg-blue-600'
                    }`}
                  >
                    <span className="text-sm font-bold">{isSettled ? '✓' : '○'}</span>
                    {isSettled ? 'Quitado' : 'Aberto'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className={footCls}>
          <tr>
            <td colSpan={3} className={`${footTdCls} text-gray-800 dark:text-gray-100`}>Total</td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(totals.principal)}`}>{formatSigned(totals.principal)}</td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(totals.before)}`}>{formatSigned(totals.before)}</td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(totals.paid)}`}>{formatSigned(totals.paid)}</td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(totals.after)}`}>{formatSigned(totals.after)}</td>
            <td className="px-3 py-2.5" />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function closureItemsBySource(items: any[]) {
  return SOURCES.map((source) => {
    const sourceItems = items.filter((item) => item.source_type === source.sourceType)
    const receitas = sourceItems.filter((item) => parseFloat(String(item.amount)) >= 0)
    const despesas = sourceItems.filter((item) => parseFloat(String(item.amount)) < 0)
    return {
      ...source,
      items: sourceItems,
      receitas,
      despesas,
      totals: sumItems(sourceItems),
    }
  })
}

function useClosureItemsBySource(items: any[]) {
  return useMemo(() => closureItemsBySource(items), [items])
}

export function SharedClosureItemsTabs({
  items,
  activeTab,
  onTabChange,
}: {
  items: any[]
  activeTab: TabKey
  onTabChange: (tab: TabKey) => void
}) {
  const bySource = useClosureItemsBySource(items)
  const visibleSources = bySource.filter((source) => source.items.length > 0)
  return (
    <CadastroListPageTabs<TabKey>
      tabs={[
        { key: 'geral', label: 'Geral', icon: <Scale size={14} /> },
        ...visibleSources.map((source) => ({
          key: source.key,
          label: source.label,
          icon: source.icon,
          count: source.items.length,
        })),
      ]}
      active={activeTab}
      onChange={onTabChange}
    />
  )
}

export function SharedClosureItemsView({
  closure,
  items,
  loanPayments,
  isPartnerView,
  intro,
  activeTab,
  hideClosureBalanceSection = false,
  compareSavedClosureData,
  recalcMovementBySource,
  recalcExpectedNewCount,
  recalcExpectedRemovedCount,
}: {
  closure: any
  items: any[]
  loanPayments: any[]
  isPartnerView: boolean
  intro?: ReactNode
  activeTab: TabKey
  /** Recálculo: saldo já exibido no bloco comparativo acima */
  hideClosureBalanceSection?: boolean
  /** Recálculo: Δ por tipo com a mesma regra do balanço compartilhado */
  compareSavedClosureData?: Record<string, unknown>
  recalcMovementBySource?: Record<ClosureSourceKey, SourceMovementTotals>
  recalcExpectedNewCount?: number
  recalcExpectedRemovedCount?: number
}) {
  const regularLoans = filterRegularLoanPayments(loanPayments)
  const bySource = useClosureItemsBySource(items)
  const proposedBalanceBySource = useMemo(
    () =>
      compareSavedClosureData
        ? computeClosureBalanceBySource(closure?.closure_data, isPartnerView)
        : [],
    [compareSavedClosureData, closure?.closure_data, isPartnerView],
  )
  const savedBalanceBySource = useMemo(
    () => (compareSavedClosureData ? computeClosureBalanceBySource(compareSavedClosureData, isPartnerView) : []),
    [compareSavedClosureData, isPartnerView],
  )
  const viewerNetByKey = useMemo(() => {
    const out: Partial<Record<SourceKey, FlowResult>> = {}
    for (const row of computeClosureBalanceBySource(closure?.closure_data, isPartnerView)) {
      out[row.key] = { toReceive: row.toReceive, toPay: row.toPay, result: row.result }
    }
    return out
  }, [closure?.closure_data, isPartnerView])
  const activeSource = activeTab === 'geral' ? null : bySource.find((source) => source.key === activeTab) ?? null

  return (
    <>
        {activeSource ? (
          activeSource.key === 'card' ? (
            <CardSourceTabContent
              receitas={activeSource.receitas}
              despesas={activeSource.despesas}
            />
          ) : (
            <>
              <CadastroFormSection
                title={`Resumo · ${activeSource.label}`}
                hint="Receitas, despesas e resultado, com a divisão entre a sua parte e a da contraparte."
                icon={<Scale size={14} />}
                bodyClassName="p-0"
              >
                <FlowSummaryTable receitas={sumItems(activeSource.receitas)} despesas={sumItems(activeSource.despesas)} />
              </CadastroFormSection>
              <CadastroFormSection title="Receitas" icon={<ArrowUpCircle size={14} />} bodyClassName="p-0">
                <ItemsTable items={activeSource.receitas} showCard={activeSource.key !== 'bank'} />
              </CadastroFormSection>
              <CadastroFormSection title="Despesas" icon={<ArrowDownCircle size={14} />} bodyClassName="p-0">
                <ItemsTable items={activeSource.despesas} showCard={activeSource.key !== 'bank'} />
              </CadastroFormSection>
            </>
          )
        ) : (
          <>
            {intro}
            {!hideClosureBalanceSection && (
              <CadastroFormSection
                title="Saldo do fechamento"
                hint="Valores gravados no fechamento, na perspectiva da conta logada."
                icon={<Scale size={14} />}
                bodyClassName="p-0"
              >
                <ClosureBalanceTable closure={closure} isPartnerView={isPartnerView} />
              </CadastroFormSection>
            )}
            <CadastroFormSection
              title={compareSavedClosureData ? 'Variação por tipo' : 'Resumo por tipo'}
              hint={
                compareSavedClosureData
                  ? 'Qtd alinhada aos scorecards; valores em R$ refletem salvo → proposta (alterados só nessa parte).'
                  : undefined
              }
              icon={<Receipt size={14} />}
              bodyClassName="p-0"
            >
              {compareSavedClosureData ? (
                <SourceSummaryDeltaTable
                  savedRows={savedBalanceBySource}
                  proposedRows={proposedBalanceBySource}
                  movementBySource={recalcMovementBySource}
                  expectedNewCount={recalcExpectedNewCount}
                  expectedRemovedCount={recalcExpectedRemovedCount}
                />
              ) : (
                <SourceSummaryTable bySource={bySource} viewerNetByKey={viewerNetByKey} />
              )}
            </CadastroFormSection>
            {regularLoans.length > 0 && (
              <CadastroFormSection title="Empréstimos" icon={<Banknote size={14} />} bodyClassName="p-0">
                <LoansTable loans={regularLoans} isPartnerView={isPartnerView} />
              </CadastroFormSection>
            )}
          </>
        )}
    </>
  )
}

export default function SharedClosureItemsModal({
  closure,
  items,
  loanPayments,
  isPartnerView,
  onClose,
}: {
  closure: any
  items: any[]
  loanPayments: any[]
  isPartnerView: boolean
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('geral')
  const headerResult = useMemo(
    () => computeClosureBalanceBySource(closure?.closure_data, isPartnerView).reduce((acc, row) => acc + row.result, 0),
    [closure?.closure_data, isPartnerView],
  )

  return (
    <CadastroModalShell maxWidth="max-w-[95vw] xl:max-w-[90rem]" maxHeight="max-h-[90vh]" zClass="z-50">
      <CadastroModalHeader
        isEdit={false}
        title={`Itens do Fechamento - ${String(closure.month).padStart(2, '0')}/${closure.year}`}
        titleAddon={
          Math.abs(headerResult) < 0.005 ? null : (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-white ${
                headerResult > 0 ? 'bg-green-600' : 'bg-red-600'
              }`}
            >
              {headerResult > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              {headerResult > 0 ? 'A Receber' : 'A Pagar'}
            </span>
          )
        }
        subtitle={`${items.length} itens • ${formatDateTimeBR(closure.period_start_date)} a ${formatDateTimeBR(closure.closing_date)}`}
        onClose={onClose}
        icon={<Receipt size={18} />}
      />
      <CadastroModalBody
        chrome={
          <SharedClosureItemsTabs items={items} activeTab={activeTab} onTabChange={setActiveTab} />
        }
      >
        <SharedClosureItemsView
          closure={closure}
          items={items}
          loanPayments={loanPayments}
          isPartnerView={isPartnerView}
          activeTab={activeTab}
        />
      </CadastroModalBody>
      <CadastroModalFooter hideSave closeLabel="Fechar" onClose={onClose} />
    </CadastroModalShell>
  )
}
