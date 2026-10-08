import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { ArrowDownCircle, ArrowUpCircle, CreditCard, ExternalLink, Landmark, Link2 } from 'lucide-react'
import {
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
  cadastroSectionsStackCls,
} from './CadastroFormLayout'
import {
  CadastroListPageTabs,
  listPageTableRowHoverCls,
  listPageTableSectionCls,
} from './CadastroListPageLayout'
import LoadingSpinner from './LoadingSpinner'
import SortableDateHeader from './SortableDateHeader'
import { formatDateBR, formatDateTimeBR } from '../utils/dateUtils'
import { formatCurrency } from '../utils/currency'
import {
  sortRowsByDate,
  toggleDateSortDirection,
  type DateSortDirection,
} from '../utils/tableDateSort'

export interface LinkedInvoiceSummary {
  match_id: number
  year_month: string
  display_name: string
}

interface InvoiceLineItem {
  id: number
  credit_card_id?: number
  date: string
  description: string
  amount: number
  card_name?: string | null
  card_number?: string | null
  tag_name?: string | null
  subtag_name?: string | null
  current_installment?: number | null
  total_installments?: number | null
}

interface InvoiceDetailResponse {
  year_month: string
  display_name: string
  bank_statement_amount: number | null
  bank_statement_description: string | null
  items_total: number
  items: InvoiceLineItem[]
}

interface LinkedInvoiceItemsModalProps {
  isOpen: boolean
  onClose: () => void
  bankStatementId: number | null
  linkedSummary?: LinkedInvoiceSummary | null
}

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

function cardTabKey(item: InvoiceLineItem): string {
  if (item.credit_card_id != null) return `card:${item.credit_card_id}`
  const name = (item.card_name || '').trim()
  const number = (item.card_number || '').trim()
  if (name || number) return `name:${name}:${number}`
  return 'unknown'
}

function cardIdentity(item: InvoiceLineItem) {
  const cardName = item.card_name?.trim() || 'Cartão'
  const cardNumber = item.card_number?.trim() ? String(item.card_number).trim() : ''
  return { cardName, cardNumber }
}

function cardTabShortLabel(cardName: string, cardNumber: string) {
  const suffix = cardNumber ? ` *** ${cardNumber.slice(-4)}` : ''
  return `${cardName}${suffix}`
}

function buildFaturasPageHref(yearMonth: string) {
  const params = new URLSearchParams({ yearMonth, selectAllCards: '1' })
  return `/relatorios/faturas?${params.toString()}`
}

function moneyCls(value: number) {
  if (Math.abs(value) < 0.005) return 'text-gray-900 dark:text-gray-100'
  return value < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
}

function formatSigned(value: number) {
  if (Math.abs(value) < 0.005) return formatCurrency(0)
  return `${value < 0 ? '-' : ''}${formatCurrency(Math.abs(value))}`
}

function formatItemDate(date: string) {
  if (!date) return '—'
  return date.includes('T') ? formatDateTimeBR(date) : formatDateBR(date)
}

function sumInvoiceAmounts(items: InvoiceLineItem[]) {
  return items.reduce(
    (acc, item) => {
      acc.count += 1
      acc.total += Number(item.amount)
      return acc
    },
    { count: 0, total: 0 },
  )
}

function LinkedInvoiceItemsTable({
  items,
  showCard,
  dateSort,
  onToggleDateSort,
}: {
  items: InvoiceLineItem[]
  showCard: boolean
  dateSort: DateSortDirection
  onToggleDateSort: () => void
}) {
  const sortedItems = useMemo(
    () =>
      sortRowsByDate(
        items,
        (row) => row.date,
        dateSort,
        (a, b) => a.id - b.id,
      ),
    [items, dateSort],
  )
  if (items.length === 0) {
    return <p className="px-3 py-4 text-center text-sm text-gray-500">Nenhum lançamento.</p>
  }
  const totals = sumInvoiceAmounts(items)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className={headCls}>
          <tr>
            <th className={`${thCenterCls} w-12`}>#</th>
            <SortableDateHeader
              sortDirection={dateSort}
              onToggle={onToggleDateSort}
              className={thLeftCls}
            />
            <th className={thLeftCls}>Descrição</th>
            {showCard ? <th className={thLeftCls}>Cartão</th> : null}
            <th className={thLeftCls}>Tag/Subtag</th>
            <th className={thRightCls}>Valor</th>
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item, index) => {
            const { cardName, cardNumber } = cardIdentity(item)
            return (
              <tr key={item.id} className={listPageTableRowHoverCls}>
                <td className={`${tdCls} text-center text-sm text-gray-500 dark:text-gray-400`}>{index + 1}</td>
                <td className={`${tdCls} whitespace-nowrap text-gray-600 dark:text-gray-400`}>
                  {formatItemDate(item.date)}
                </td>
                <td className={`${tdCls} font-medium text-gray-900 dark:text-white`}>
                  {item.description || 'Sem descrição'}
                  {item.current_installment && item.total_installments && item.total_installments > 1 ? (
                    <span className="ml-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                      ({item.current_installment}/{item.total_installments})
                    </span>
                  ) : null}
                </td>
                {showCard ? (
                  <td className={`${tdCls} text-xs text-gray-900 dark:text-white`}>
                    {cardName ? (
                      <div>
                        <span className="font-medium">{cardName}</span>
                        {cardNumber ? (
                          <span className="ml-1 text-[10px] text-gray-500 dark:text-gray-400">
                            •••• {cardNumber.slice(-4)}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                ) : null}
                <td className={`${tdCls} text-gray-500 dark:text-gray-400`}>
                  {item.tag_name ? (
                    <>
                      {item.tag_name}
                      {item.subtag_name ? ` > ${item.subtag_name}` : ''}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={`${tdCls} whitespace-nowrap text-right tabular-nums font-semibold ${moneyCls(item.amount)}`}>
                  {formatSigned(item.amount)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className={footCls}>
          <tr>
            <td className={`${footTdCls} text-gray-800 dark:text-gray-100`} colSpan={showCard ? 5 : 4}>
              Total ({totals.count} {totals.count === 1 ? 'item' : 'itens'})
            </td>
            <td className={`${footTdCls} text-right tabular-nums ${moneyCls(totals.total)}`}>
              {formatSigned(totals.total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function LinkedInvoiceTotalsScorecards({
  detail,
  activeCardTabMeta,
  filteredTotal,
}: {
  detail: InvoiceDetailResponse
  activeCardTabMeta: { label: string } | null
  filteredTotal: number
}) {
  return (
    <article className={`${listPageTableSectionCls} overflow-hidden`}>
      <div className="grid grid-cols-1 divide-y divide-gray-200 dark:divide-gray-600 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="flex min-h-[6.5rem] flex-col justify-center px-5 py-4">
          <div className="mb-2 flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <Landmark size={14} className="text-[var(--color-1)]" />
            <span className="text-xs font-semibold uppercase tracking-wide">Lançamento no extrato</span>
          </div>
          <p
            className="truncate text-sm font-medium text-gray-900 dark:text-white"
            title={detail.bank_statement_description || undefined}
          >
            {detail.bank_statement_description || '—'}
          </p>
          <p className={`mt-1 text-xl font-bold tabular-nums ${moneyCls(detail.bank_statement_amount ?? 0)}`}>
            {detail.bank_statement_amount != null ? formatSigned(detail.bank_statement_amount) : '—'}
          </p>
        </div>
        <div className="flex min-h-[6.5rem] flex-col justify-center px-5 py-4">
          <div className="mb-2 flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <CreditCard size={14} className="text-[var(--color-2)]" />
            <span className="text-xs font-semibold uppercase tracking-wide">Soma do cartão</span>
          </div>
          {activeCardTabMeta ? (
            <p className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">{activeCardTabMeta.label}</p>
          ) : null}
          <p className={`text-xl font-bold tabular-nums ${moneyCls(filteredTotal)}`}>{formatSigned(filteredTotal)}</p>
          {detail.bank_statement_amount != null &&
          Math.abs(detail.items_total - detail.bank_statement_amount) > 0.02 ? (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
              O valor do extrato pode incluir juros, IOF ou arredondamentos não listados item a item.
            </p>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function InvoiceCardTabContent({ items }: { items: InvoiceLineItem[] }) {
  const [dateSort, setDateSort] = useState<DateSortDirection>('desc')
  const toggleSort = () => setDateSort((prev) => toggleDateSortDirection(prev))
  const receitas = useMemo(() => items.filter((item) => Number(item.amount) >= 0), [items])
  const despesas = useMemo(() => items.filter((item) => Number(item.amount) < 0), [items])

  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">Nenhum lançamento neste cartão.</p>
  }

  return (
    <div className={cadastroSectionsStackCls}>
      {receitas.length > 0 ? (
        <CadastroFormSection title="Receitas" icon={<ArrowUpCircle size={14} />} bodyClassName="p-0">
          <LinkedInvoiceItemsTable
            items={receitas}
            showCard={false}
            dateSort={dateSort}
            onToggleDateSort={toggleSort}
          />
        </CadastroFormSection>
      ) : null}
      {despesas.length > 0 ? (
        <CadastroFormSection title="Despesas" icon={<ArrowDownCircle size={14} />} bodyClassName="p-0">
          <LinkedInvoiceItemsTable
            items={despesas}
            showCard={false}
            dateSort={dateSort}
            onToggleDateSort={toggleSort}
          />
        </CadastroFormSection>
      ) : null}
    </div>
  )
}

export default function LinkedInvoiceItemsModal({
  isOpen,
  onClose,
  bankStatementId,
  linkedSummary,
}: LinkedInvoiceItemsModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<InvoiceDetailResponse | null>(null)
  const [activeCardTab, setActiveCardTab] = useState('')

  const cardTabs = useMemo(() => {
    if (!detail?.items?.length) return []
    const byKey = new Map<string, { key: string; label: string; count: number }>()
    for (const item of detail.items) {
      const key = cardTabKey(item)
      const { cardName, cardNumber } = cardIdentity(item)
      const existing = byKey.get(key)
      if (existing) {
        existing.count += 1
      } else {
        byKey.set(key, {
          key,
          label: cardTabShortLabel(cardName, cardNumber),
          count: 1,
        })
      }
    }
    return [...byKey.values()].sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'))
  }, [detail?.items])

  const filteredItems = useMemo(() => {
    if (!detail?.items?.length || !activeCardTab) return []
    return detail.items.filter((item) => cardTabKey(item) === activeCardTab)
  }, [detail?.items, activeCardTab])

  const filteredTotal = useMemo(
    () => filteredItems.reduce((sum, item) => sum + Number(item.amount), 0),
    [filteredItems],
  )

  const showCardTabs = cardTabs.length > 1

  const activeCardTabMeta = useMemo(
    () => cardTabs.find((tab) => tab.key === activeCardTab) ?? cardTabs[0] ?? null,
    [activeCardTab, cardTabs],
  )

  useEffect(() => {
    if (!isOpen || bankStatementId == null) {
      setDetail(null)
      setError(null)
      setActiveCardTab('')
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    axios
      .get<InvoiceDetailResponse>(`/api/invoice-payment-matches/by-bank-statement/${bankStatementId}`)
      .then((response) => {
        if (!cancelled) setDetail(response.data)
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = axios.isAxiosError(err)
            ? err.response?.data?.detail || err.message
            : 'Erro ao carregar itens da fatura'
          setError(typeof msg === 'string' ? msg : 'Erro ao carregar itens da fatura')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, bankStatementId])

  useEffect(() => {
    if (cardTabs.length === 0) {
      setActiveCardTab('')
      return
    }
    setActiveCardTab((prev) => (cardTabs.some((tab) => tab.key === prev) ? prev : cardTabs[0].key))
  }, [cardTabs])

  if (!isOpen) return null

  const titleName = detail?.display_name || linkedSummary?.display_name || 'Fatura vinculada'
  const yearMonth = detail?.year_month || linkedSummary?.year_month

  return (
    <CadastroModalShell maxWidth="max-w-[95vw] xl:max-w-[90rem]" maxHeight="max-h-[92vh]" onBackdropClick={onClose}>
      <CadastroModalHeader
        isEdit={false}
        icon={<Link2 size={18} />}
        iconStyle={{ backgroundColor: 'var(--color-2)', color: 'var(--on-color-2)' }}
        title="Itens da fatura vinculada"
        subtitle={
          yearMonth
            ? `${titleName} · competência ${yearMonth.split('-').reverse().join('/')}`
            : titleName
        }
        onClose={onClose}
      />
      <CadastroModalBody
        scrollable
        chrome={
          !loading && !error && detail ? (
            <div className="flex flex-col gap-4">
              <LinkedInvoiceTotalsScorecards
                detail={detail}
                activeCardTabMeta={activeCardTabMeta}
                filteredTotal={filteredTotal}
              />
              {showCardTabs ? (
                <div className="overflow-x-auto scroll-slim [-webkit-overflow-scrolling:touch]">
                  <CadastroListPageTabs
                    nowrap
                    tabs={cardTabs.map((tab) => ({
                      key: tab.key,
                      label: tab.label,
                      icon: <CreditCard size={14} />,
                      count: tab.count,
                    }))}
                    active={activeCardTab}
                    onChange={setActiveCardTab}
                  />
                </div>
              ) : null}
            </div>
          ) : null
        }
      >
        {loading && <LoadingSpinner message="Carregando itens..." />}
        {!loading && error && (
          <p className="py-8 text-center text-sm text-[var(--color-danger)]">{error}</p>
        )}
        {!loading && !error && detail && (
          <InvoiceCardTabContent items={filteredItems} />
        )}
      </CadastroModalBody>
      <CadastroModalFooter
        onClose={onClose}
        hideSave
        closeLabel="Fechar"
        leading={
          yearMonth ? (
            <a
              href={buildFaturasPageHref(yearMonth)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-color-primary transition-colors hover:bg-color-primary-light"
            >
              <ExternalLink size={16} />
              Abrir em Faturas
            </a>
          ) : undefined
        }
      />
    </CadastroModalShell>
  )
}
