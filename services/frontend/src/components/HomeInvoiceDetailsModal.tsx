import { useState, useEffect, useMemo } from 'react'
import axios from 'axios'
import { CreditCard, Clock, Calendar, Loader2, Gift, Download } from 'lucide-react'
import { formatCurrency } from '../utils/currency'
import { formatDateBR } from '../utils/dateUtils'
import { exportHomeInvoiceDetailsToPDF } from '../utils/pdfExport'
import {
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
  CadastroModalTabs,
} from './CadastroFormLayout'

export interface InvoiceDetailItem {
  id: number
  description: string
  amount: number
  date: string
  current_installment?: number | null
  total_installments?: number | null
  card_id: number
  card_name: string
  card_number: string
  card_type: string
  remaining_installments?: number | null
  remaining_total?: number | null
}

export interface InvoiceDetailsSection {
  key: string
  title: string
  total: number
  count: number
  items: InvoiceDetailItem[]
  next_month_total?: number | null
}

const calcRemainingItemValues = (item: InvoiceDetailItem) => {
  const nextMonth = Math.abs(Number(item.amount))
  const saldoDevedor = Math.abs(Number(item.remaining_total || 0))
  const future = Math.max(0, saldoDevedor - nextMonth)
  return { nextMonth, future, saldoDevedor }
}

const calcRemainingTotals = (items: InvoiceDetailItem[], section?: InvoiceDetailsSection) => {
  if (items.length > 0) {
    const nextMonth = items.reduce((sum, item) => sum + Math.abs(Number(item.amount)), 0)
    const future = items.reduce((sum, item) => {
      const parcel = Math.abs(Number(item.amount))
      const remaining = Math.abs(Number(item.remaining_total || 0))
      return sum + Math.max(0, remaining - parcel)
    }, 0)
    const saldoDevedor = nextMonth + future
    return { nextMonth, future, saldoDevedor }
  }

  const nextMonth = section?.next_month_total != null ? Number(section.next_month_total) : 0
  const saldoDevedor = Math.abs(Number(section?.total || 0))
  const future = Math.max(0, saldoDevedor - nextMonth)
  return { nextMonth, future, saldoDevedor }
}

const footerRowClass =
  'border-l-4 border-l-gray-300 dark:border-l-gray-600 border-t border-t-gray-200 dark:border-t-gray-700'

const RemainingTotalsFooter = ({
  items,
  colSpanBeforeTotals,
  section,
}: {
  items: InvoiceDetailItem[]
  colSpanBeforeTotals: number
  section?: InvoiceDetailsSection
}) => {
  const { nextMonth, future, saldoDevedor } = calcRemainingTotals(items, section)

  return (
    <tfoot>
      <tr className={`${footerRowClass} bg-amber-50 dark:bg-amber-950/25 font-medium`}>
        <td colSpan={colSpanBeforeTotals} className={`${tdClass} py-2.5 text-right text-amber-800 dark:text-amber-300`}>
          Próximo mês
        </td>
        <td className={`${tdClass} py-2.5`}></td>
        <td className={`${tdClass} py-2.5 text-right text-red-600 dark:text-red-400 whitespace-nowrap`}>
          -{formatCurrency(nextMonth)}
        </td>
        <td className={`${tdClass} py-2.5`}></td>
        <td className={`${tdClass} py-2.5`}></td>
      </tr>
      <tr className={`${footerRowClass} bg-slate-50 dark:bg-slate-800/60 font-medium`}>
        <td colSpan={colSpanBeforeTotals} className={`${tdClass} py-2.5 text-right text-slate-600 dark:text-slate-400`}>
          Futuro
        </td>
        <td className={`${tdClass} py-2.5`}></td>
        <td className={`${tdClass} py-2.5`}></td>
        <td className={`${tdClass} py-2.5 text-right text-red-600 dark:text-red-400 whitespace-nowrap`}>
          -{formatCurrency(future)}
        </td>
        <td className={`${tdClass} py-2.5`}></td>
      </tr>
      <tr className={`${footerRowClass} bg-red-50 dark:bg-red-950/30 font-bold`}>
        <td colSpan={colSpanBeforeTotals} className={`${tdClass} py-3 text-right text-red-900 dark:text-red-200`}>
          Saldo devedor
        </td>
        <td className={`${tdClass} py-3`}></td>
        <td className={`${tdClass} py-3`}></td>
        <td className={`${tdClass} py-3`}></td>
        <td className={`${tdClass} py-3 text-right text-red-700 dark:text-red-300 whitespace-nowrap`}>
          -{formatCurrency(saldoDevedor)}
        </td>
      </tr>
    </tfoot>
  )
}

export interface InvoiceDetailsData {
  title: string
  sections: InvoiceDetailsSection[]
}

export type HomeInvoiceView = 'remaining' | 'month' | 'card'

export interface HomeInvoiceModalParams {
  view: HomeInvoiceView
  year_month?: string
  card_id?: number
}

interface HomeInvoiceDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  params: HomeInvoiceModalParams | null
}

const stripInstallmentFromDescription = (description: string): string =>
  description.replace(/\s*\(\d+\/\d+\)\s*/g, ' ').trim()

const getCardHeaderColorIndex = (index: number) => (index % 5) + 1

const CardColoredHeader = ({
  colorIndex,
  icon: Icon,
  title,
  count,
  countLabel,
  total,
  variant = 'default',
}: {
  colorIndex: number
  icon: typeof CreditCard
  title: string
  count: number
  countLabel: string
  total?: number | null
  variant?: 'default' | 'debt'
}) => (
  <div
    className={`flex items-center justify-between px-6 py-4 border-b ${
      variant === 'debt'
        ? 'border-red-200 dark:border-red-800 bg-gradient-to-r from-red-600 to-red-700 text-white'
        : 'border-gray-200 dark:border-gray-700'
    }`}
    style={
      variant === 'debt'
        ? undefined
        : {
            backgroundColor: `var(--color-${colorIndex})`,
            color: `var(--on-color-${colorIndex})`,
          }
    }
  >
    <div className="flex items-center gap-3 min-w-0">
      <Icon size={20} className="flex-shrink-0" />
      <span className="font-bold text-lg truncate">{title}</span>
      <span className="text-xs opacity-80 flex-shrink-0">
        ({count} {countLabel})
      </span>
    </div>
    {total != null && (
      <span className="text-xl font-bold flex-shrink-0 ml-4">
        -{formatCurrency(Math.abs(total))}
      </span>
    )}
  </div>
)

const tableWrapperClass = 'border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden'
const theadClass = 'bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700'
const thClass = 'px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider'
const thRightClass = 'px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider'
const thCenterClass = 'px-4 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider'
const tdClass = 'px-4 py-3'

const TableRow = ({ children, index }: { children: React.ReactNode; index: number }) => (
  <tr
    className={`border-t border-t-gray-200 dark:border-t-gray-700 border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all ${
      index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50/50 dark:bg-gray-700/20'
    }`}
    onMouseEnter={(e) => {
      e.currentTarget.style.borderLeftColor = 'var(--color-1)'
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.borderLeftColor = ''
    }}
  >
    {children}
  </tr>
)

const RemainingItemsTable = ({
  items,
  showCard,
  bordered = true,
  section,
}: {
  items: InvoiceDetailItem[]
  showCard: boolean
  bordered?: boolean
  section?: InvoiceDetailsSection
}) => {
  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
        Nenhum item encontrado
      </p>
    )
  }

  const colSpanBeforeTotals = showCard ? 3 : 2

  const tableContent = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[1020px]">
        <thead className={theadClass}>
          <tr>
            <th className={thClass}>Data</th>
            {showCard && <th className={thClass}>Cartão</th>}
            <th className={thClass}>Descrição</th>
            <th className={thCenterClass}>Parcelas faltantes</th>
            <th className={thRightClass}>Próximo mês</th>
            <th className={thRightClass}>Futuro</th>
            <th className={thRightClass}>Saldo devedor</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const { nextMonth, future, saldoDevedor } = calcRemainingItemValues(item)
            return (
            <TableRow key={item.id} index={index}>
              <td className={`${tdClass} text-gray-600 dark:text-gray-400 whitespace-nowrap`}>
                {item.date ? formatDateBR(item.date) : '-'}
              </td>
              {showCard && (
                <td className={`${tdClass} text-gray-600 dark:text-gray-400 whitespace-nowrap`}>
                  <div className="flex items-center gap-1.5">
                    {item.card_type === 'beneficios' ? (
                      <Gift size={14} className="text-color-primary flex-shrink-0" />
                    ) : (
                      <CreditCard size={14} className="text-color-primary flex-shrink-0" />
                    )}
                    <span className="font-medium text-gray-900 dark:text-white">{item.card_name}</span>
                    <span className="text-xs text-gray-400">•••• {item.card_number}</span>
                  </div>
                </td>
              )}
              <td className={`${tdClass} text-gray-900 dark:text-white font-medium`}>
                {stripInstallmentFromDescription(item.description)}
              </td>
              <td className={`${tdClass} text-center text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap`}>
                {item.remaining_installments ?? '-'}
              </td>
              <td className={`${tdClass} text-right font-semibold text-red-600 dark:text-red-400 whitespace-nowrap`}>
                -{formatCurrency(nextMonth)}
              </td>
              <td className={`${tdClass} text-right font-semibold text-red-600 dark:text-red-400 whitespace-nowrap`}>
                -{formatCurrency(future)}
              </td>
              <td className={`${tdClass} text-right font-semibold text-red-600 dark:text-red-400 whitespace-nowrap`}>
                -{formatCurrency(saldoDevedor)}
              </td>
            </TableRow>
            )
          })}
        </tbody>
        <RemainingTotalsFooter items={items} colSpanBeforeTotals={colSpanBeforeTotals} section={section} />
      </table>
    </div>
  )

  if (!bordered) return tableContent

  return <div className={tableWrapperClass}>{tableContent}</div>
}

const RemainingTotalBanner = ({ section }: { section: InvoiceDetailsSection }) => {
  const { nextMonth, future, saldoDevedor } = calcRemainingTotals(section.items, section)

  return (
    <div className="rounded-xl border border-red-200 dark:border-red-800 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-red-600 to-red-700 text-white">
        <div className="flex items-center gap-3">
          <Clock size={20} />
          <span className="font-bold text-lg">Saldo devedor</span>
          <span className="text-xs opacity-90">
            ({section.count} {section.count === 1 ? 'compra' : 'compras'})
          </span>
        </div>
        <span className="text-xl font-bold">
          -{formatCurrency(saldoDevedor)}
        </span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-red-200 dark:divide-red-800 bg-red-50 dark:bg-red-950/25">
        <div className="px-6 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-red-800 dark:text-red-300">Próximo mês</span>
          <span className="text-sm font-bold text-red-700 dark:text-red-400">-{formatCurrency(nextMonth)}</span>
        </div>
        <div className="px-6 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-red-900/80 dark:text-red-200">Futuro</span>
          <span className="text-sm font-bold text-red-700 dark:text-red-400">-{formatCurrency(future)}</span>
        </div>
      </div>
    </div>
  )
}

const MonthTotalBanner = ({ section }: { section: InvoiceDetailsSection }) => (
  <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
    <div
      className="flex items-center justify-between px-6 py-4"
      style={{
        background: 'linear-gradient(to right, var(--color-1), var(--color-2))',
        color: 'white',
      }}
    >
      <div className="flex items-center gap-3">
        <Calendar size={20} />
        <span className="font-bold text-lg">Total do mês</span>
        <span className="text-xs opacity-80">
          ({section.count} {section.count === 1 ? 'transação' : 'transações'})
        </span>
      </div>
      <span className="text-xl font-bold">
        -{formatCurrency(Math.abs(Number(section.total)))}
      </span>
    </div>
  </div>
)

const CardBreakdownSection = ({
  section,
  variant,
  colorIndex,
}: {
  section: InvoiceDetailsSection
  variant: 'month' | 'remaining'
  colorIndex: number
}) => {
  const cardType = section.items[0]?.card_type
  const CardIcon = cardType === 'beneficios' ? Gift : CreditCard
  const countLabel = variant === 'remaining'
    ? (section.count === 1 ? 'compra' : 'compras')
    : (section.count === 1 ? 'transação' : 'transações')

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <CardColoredHeader
        colorIndex={colorIndex}
        icon={CardIcon}
        title={section.title}
        count={section.count}
        countLabel={countLabel}
        total={variant === 'month' ? Number(section.total) : null}
      />
      {variant === 'remaining' ? (
        <RemainingItemsTable items={section.items} showCard={false} bordered={false} section={section} />
      ) : (
        <MonthItemsTable items={section.items} showCard={false} bordered={false} />
      )}
    </div>
  )
}

const MonthItemsTable = ({
  items,
  showCard,
  bordered = true,
}: {
  items: InvoiceDetailItem[]
  showCard: boolean
  bordered?: boolean
}) => {
  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
        Nenhum item encontrado
      </p>
    )
  }

  const totalAmount = items.reduce((sum, item) => sum + Math.abs(Number(item.amount)), 0)
  const colSpanBeforeTotal = showCard ? 3 : 2

  const tableContent = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[900px]">
        <thead className={theadClass}>
          <tr>
            <th className={thClass}>Data</th>
            {showCard && <th className={thClass}>Cartão</th>}
            <th className={thClass}>Descrição</th>
            <th className={thCenterClass}>Parcela</th>
            <th className={thRightClass}>Valor</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <TableRow key={item.id} index={index}>
              <td className={`${tdClass} text-gray-600 dark:text-gray-400 whitespace-nowrap`}>
                {item.date ? formatDateBR(item.date) : '-'}
              </td>
              {showCard && (
                <td className={`${tdClass} text-gray-600 dark:text-gray-400 whitespace-nowrap`}>
                  <div className="flex items-center gap-1.5">
                    {item.card_type === 'beneficios' ? (
                      <Gift size={14} className="text-color-primary flex-shrink-0" />
                    ) : (
                      <CreditCard size={14} className="text-color-primary flex-shrink-0" />
                    )}
                    <span className="font-medium text-gray-900 dark:text-white">{item.card_name}</span>
                    <span className="text-xs text-gray-400">•••• {item.card_number}</span>
                  </div>
                </td>
              )}
              <td className={`${tdClass} text-gray-900 dark:text-white font-medium`}>
                {stripInstallmentFromDescription(item.description)}
              </td>
              <td className={`${tdClass} text-center text-gray-600 dark:text-gray-400 font-medium whitespace-nowrap`}>
                {item.current_installment && item.total_installments && item.total_installments > 1
                  ? `${item.current_installment}/${item.total_installments}`
                  : '-'}
              </td>
              <td className={`${tdClass} text-right font-semibold text-red-600 dark:text-red-400 whitespace-nowrap`}>
                -{formatCurrency(Math.abs(Number(item.amount)))}
              </td>
            </TableRow>
          ))}
        </tbody>
        <tfoot>
          <tr className={`${footerRowClass} bg-gray-50 dark:bg-gray-800 font-semibold border-t-2 border-t-gray-300 dark:border-t-gray-600`}>
            <td colSpan={colSpanBeforeTotal} className={`${tdClass} text-right text-gray-700 dark:text-gray-300`}>
              Subtotal:
            </td>
            <td className={tdClass}></td>
            <td className={`${tdClass} text-right text-red-600 dark:text-red-400 whitespace-nowrap`}>
              -{formatCurrency(totalAmount)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )

  if (!bordered) return tableContent

  return <div className={tableWrapperClass}>{tableContent}</div>
}

const HomeInvoiceDetailsModal = ({ isOpen, onClose, params }: HomeInvoiceDetailsModalProps) => {
  const [data, setData] = useState<InvoiceDetailsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeSectionKey, setActiveSectionKey] = useState<string>('')

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen || !params) {
      setData(null)
      setError(null)
      setActiveSectionKey('')
      return
    }

    const loadDetails = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await axios.get('/api/dashboard/invoice-details', {
          params: {
            view: params.view,
            year_month: params.year_month,
            card_id: params.card_id,
          },
        })
        setData(response.data)
      } catch (err) {
        console.error('Erro ao carregar detalhes da fatura:', err)
        setError('Não foi possível carregar os detalhes.')
        setData(null)
      } finally {
        setLoading(false)
      }
    }

    loadDetails()
  }, [isOpen, params])

  useEffect(() => {
    if (!data?.sections?.length) return
    setActiveSectionKey(prev => (data.sections.some(s => s.key === prev) ? prev : data.sections[0].key))
  }, [data])

  const cardColorByKey = useMemo(() => {
    if (!data) return {}
    if (params?.view !== 'month' && params?.view !== 'remaining') return {}

    const map: Record<string, number> = {}
    const cardSectionsInOrder = data.sections.filter(s => s.key.startsWith('card-'))
    cardSectionsInOrder.forEach((s, idx) => {
      map[s.key] = getCardHeaderColorIndex(idx)
    })
    return map
  }, [data, params?.view])

  const handleExportPdf = (mode: 'all' | 'card') => {
    if (!data) return
    if (mode === 'all' || params?.view === 'card') {
      exportHomeInvoiceDetailsToPDF(data)
      return
    }

    const activeSection = data.sections.find(s => s.key === activeSectionKey)
    if (!activeSection) {
      exportHomeInvoiceDetailsToPDF(data)
      return
    }

    const exportData = {
      ...data,
      title: activeSection.title,
      sections: [activeSection],
    }

    exportHomeInvoiceDetailsToPDF(exportData as any)
  }

  if (!isOpen) return null

  return (
    <CadastroModalShell maxWidth="max-w-[95vw] xl:max-w-6xl" onBackdropClick={onClose}>
      <CadastroModalHeader
        isEdit={false}
        title={data?.title || 'Detalhes'}
        onClose={onClose}
        icon={<CreditCard size={18} />}
      />
      <CadastroModalBody>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={32} className="animate-spin text-color-primary" />
              <span className="ml-3 text-gray-600 dark:text-gray-400">Carregando...</span>
            </div>
          ) : error ? (
            <p className="text-center py-12 text-red-500">{error}</p>
          ) : data ? (
            <div className="space-y-6">
              {(() => {
                const totalSection =
                  params?.view === 'month'
                    ? data.sections.find(s => s.key === 'month-total')
                    : params?.view === 'remaining'
                    ? data.sections.find(s => s.key === 'remaining-total')
                    : null

                const sectionsForTabs =
                  (params?.view === 'month' || params?.view === 'remaining')
                    ? data.sections.filter(s => s.key !== 'month-total' && s.key !== 'remaining-total')
                    : data.sections

                const activeKey = activeSectionKey || sectionsForTabs[0]?.key
                const activeSection = sectionsForTabs.find(s => s.key === activeKey) || sectionsForTabs[0]

                return (
                  <>
                    {totalSection && (() => {
                      const totalAbs = Math.abs(Number(totalSection.total || 0))
                      const nextMonthAbs = Math.abs(Number(totalSection.next_month_total || 0))
                      const remainingAbs = Math.max(0, totalAbs - nextMonthAbs)

                      return (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <Clock className="w-5 h-5 text-red-600 dark:text-red-400" />
                                <div>
                                  <p className="text-xs text-gray-600 dark:text-gray-400">Total</p>
                                  <p className="text-lg font-bold text-red-600 dark:text-red-400">
                                    -{formatCurrency(totalAbs)}
                                  </p>
                                </div>
                              </div>
                              <span className="text-xs text-gray-500 dark:text-gray-500">
                                {totalSection.count} {totalSection.count === 1 ? 'item' : 'itens'}
                              </span>
                            </div>
                          </div>

                          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <Calendar className="w-5 h-5 text-red-600 dark:text-red-400" />
                                <div>
                                  <p className="text-xs text-gray-600 dark:text-gray-400">Próximo mês</p>
                                  <p className="text-lg font-bold text-red-600 dark:text-red-400">
                                    -{formatCurrency(nextMonthAbs)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <Gift className="w-5 h-5 text-red-600 dark:text-red-400" />
                                <div>
                                  <p className="text-xs text-gray-600 dark:text-gray-400">Demais</p>
                                  <p className="text-lg font-bold text-red-600 dark:text-red-400">
                                    -{formatCurrency(remainingAbs)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })()}

                    <CadastroModalTabs
                      ariaLabel="Seções do detalhe da fatura"
                      active={(activeKey || sectionsForTabs[0]?.key || '') as string}
                      onChange={setActiveSectionKey}
                      tabs={sectionsForTabs.map((section) => {
                        let IconComp: typeof CreditCard | typeof Clock | typeof Calendar | typeof Gift | null = null
                        if (params?.view === 'card') {
                          IconComp = section.key === 'remaining' ? Clock : Calendar
                        } else if (section.key === 'remaining-total' || section.key === 'remaining') {
                          IconComp = Clock
                        } else if (section.key === 'month-total' || section.key === 'month') {
                          IconComp = Calendar
                        } else if (section.key.startsWith('card-')) {
                          const cardType = section.items?.[0]?.card_type
                          IconComp = cardType === 'beneficios' ? Gift : CreditCard
                        }
                        return {
                          key: section.key,
                          label: section.title,
                          title: section.title,
                          icon: IconComp ? <IconComp size={14} /> : undefined,
                          badge: section.count != null && section.count > 0 ? section.count : undefined,
                        }
                      })}
                    />

                    <div>
                      {(() => {
                        if (!activeSection) return null

                        if (params?.view === 'month') {
                          if (activeSection.key.startsWith('card-')) {
                            const colorIndex = cardColorByKey[activeSection.key] ?? 1
                            return <CardBreakdownSection section={activeSection} variant="month" colorIndex={colorIndex} />
                          }
                        }

                        if (params?.view === 'remaining') {
                          if (activeSection.key.startsWith('card-')) {
                            const colorIndex = cardColorByKey[activeSection.key] ?? 1
                            return <CardBreakdownSection section={activeSection} variant="remaining" colorIndex={colorIndex} />
                          }
                        }

                        // view=card => exibe “Saldo Devedor” e “Fatura do mês”
                        const showCard = params?.view !== 'card'
                        const isRemaining = activeSection.key === 'remaining'
                        const remainingTotals = isRemaining ? calcRemainingTotals(activeSection.items, activeSection) : null
                        const sectionCountLabel = isRemaining
                          ? (activeSection.count === 1 ? 'compra' : 'compras')
                          : (activeSection.count === 1 ? 'transação' : 'transações')
                        const SectionHeaderIcon = isRemaining ? Clock : Calendar

                        return (
                          <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border overflow-hidden ${
                            isRemaining
                              ? 'border-red-200 dark:border-red-800'
                              : 'border-gray-200 dark:border-gray-700'
                          }`}>
                            <CardColoredHeader
                              colorIndex={1}
                              variant={isRemaining ? 'debt' : 'default'}
                              icon={SectionHeaderIcon}
                              title={activeSection.title}
                              count={activeSection.count}
                              countLabel={sectionCountLabel}
                              total={
                                isRemaining && remainingTotals
                                  ? remainingTotals.saldoDevedor
                                  : Number(activeSection.total)
                              }
                            />
                            {isRemaining ? (
                              <RemainingItemsTable
                                items={activeSection.items}
                                showCard={showCard}
                                bordered={false}
                                section={activeSection}
                              />
                            ) : (
                              <MonthItemsTable items={activeSection.items} showCard={showCard} bordered={false} />
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  </>
                )
              })()}
            </div>
          ) : null}
      </CadastroModalBody>
      <CadastroModalFooter
        onClose={onClose}
        hideSave
        closeLabel="Fechar"
        leading={
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExportPdf('all')}
              disabled={loading || !data || !!error}
              className="px-4 py-2 rounded-lg transition-all font-semibold flex items-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              title="Exportar PDF (Todos)"
            >
              <Download size={16} className="text-color-primary" />
              Todos
            </button>
            <button
              onClick={() => handleExportPdf('card')}
              disabled={
                loading ||
                !data ||
                !!error ||
                (params?.view !== 'card' && !activeSectionKey)
              }
              className="px-4 py-2 rounded-lg transition-all font-semibold flex items-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              title="Exportar PDF (Por cartão/aba ativa)"
            >
              <CreditCard size={16} className="text-color-primary" />
              Por cartão
            </button>
          </div>
        }
      />
    </CadastroModalShell>
  )
}

export default HomeInvoiceDetailsModal
