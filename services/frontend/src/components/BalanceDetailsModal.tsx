import { useState, useEffect } from 'react'
import { Receipt, CreditCard, Gift, ArrowUpDown, ArrowUp, ArrowDown, Calendar, Scale } from 'lucide-react'
import {
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
  CadastroModalTabs,
  cadastroSectionsStackCls,
} from './CadastroFormLayout'
import Badge from './Badge'
import { listPageTableRowHoverCls } from './CadastroListPageLayout'

interface BalanceItem {
  id: number
  date: string
  description: string
  amount: number
  tag_name?: string
  subtag_name?: string
  my_contribution_percentage: number
  partner_contribution_percentage: number
  // Campos específicos para credit_card_invoices
  year_month?: string  // Formato: "YYYY-MM" (ex: "2025-12")
  card_id?: number
  card_name?: string
  card_number?: string  // Número do cartão (últimos 4 dígitos)
  card_active?: boolean  // Se o cartão está ativo
  card_type?: string  // Tipo do cartão: "crédito" ou "benefício"
  card_closing_day?: number
  card_due_day?: number  // Dia de vencimento do cartão (1-31)
  current_installment?: number | null
  total_installments?: number | null
}

interface BalanceDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  type: 'transactions' | 'credit_card' | 'benefit_card'
  accountColor: 'primary' | 'secondary'
  expenseItems: BalanceItem[]
  revenueItems: BalanceItem[]
  isPartnerAccount?: boolean  // Indica se é a conta compartilhada (lado direito)
}

type SortField = 'date' | 'description' | 'category' | 'amount' | 'my_percentage' | 'my_value' | 'partner_value'
type SortDirection = 'asc' | 'desc'

interface SortConfig {
  field: SortField
  direction: SortDirection
}

type FlowTotals = { count: number; raw: number; mine: number; partner: number }

const balanceTableHeadCls =
  'bg-gray-100 dark:bg-gray-800/80 [&_th]:border-b-2 [&_th]:border-gray-200 dark:[&_th]:border-gray-600'
const balanceThLeftCls =
  'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
const balanceThCenterCls =
  'px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300'
const balanceTdCls = 'border-b border-gray-200 px-3 py-2 dark:border-gray-600'
const balanceFootCls = 'border-t-2 border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/50'
const balanceFootTdCls = 'px-3 py-2.5 font-semibold'

function formatSignedCurrency(value: number) {
  if (Math.abs(value) < 0.005) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(0)
  }
  const formatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(value))
  return `${value < 0 ? '-' : ''}${formatted}`
}

function moneyToneCls(value: number) {
  if (Math.abs(value) < 0.005) return 'text-gray-900 dark:text-gray-100'
  return value < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
}

function computeFlowTotals(items: BalanceItem[], preserveSign: boolean): FlowTotals {
  return items.reduce(
    (acc, item) => {
      const amount = Number(item.amount)
      const raw = preserveSign ? amount : Math.abs(amount)
      const myPct = Number(item.my_contribution_percentage ?? 0)
      const partnerPct = Number(item.partner_contribution_percentage ?? 0)
      const mine = preserveSign ? amount * (myPct / 100) : Math.abs(amount) * (myPct / 100)
      const partner = preserveSign ? amount * (partnerPct / 100) : Math.abs(amount) * (partnerPct / 100)
      acc.count += 1
      acc.raw += raw
      acc.mine += mine
      acc.partner += partner
      return acc
    },
    { count: 0, raw: 0, mine: 0, partner: 0 },
  )
}

function BalanceFlowSummaryTable({ receitas, despesas }: { receitas: FlowTotals; despesas: FlowTotals }) {
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
        <thead className={balanceTableHeadCls}>
          <tr>
            <th className={balanceThLeftCls}>Fluxo</th>
            <th className={balanceThLeftCls}>Itens</th>
            <th className={balanceThLeftCls}>Valor total</th>
            <th className={balanceThLeftCls}>Minha parte</th>
            <th className={balanceThLeftCls}>Contraparte</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className={`${balanceTdCls} font-medium text-gray-700 dark:text-gray-200`}>{row.label}</td>
              <td className={`${balanceTdCls} tabular-nums text-gray-600 dark:text-gray-300`}>{row.totals.count}</td>
              <td className={`${balanceTdCls} tabular-nums font-semibold ${moneyToneCls(row.totals.raw)}`}>
                {formatSignedCurrency(row.totals.raw)}
              </td>
              <td className={`${balanceTdCls} tabular-nums font-semibold ${moneyToneCls(row.totals.mine)}`}>
                {formatSignedCurrency(row.totals.mine)}
              </td>
              <td className={`${balanceTdCls} tabular-nums font-semibold ${moneyToneCls(row.totals.partner)}`}>
                {formatSignedCurrency(row.totals.partner)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className={balanceFootCls}>
          <tr>
            <td className={`${balanceFootTdCls} text-gray-800 dark:text-gray-100`}>Resultado</td>
            <td className={`${balanceFootTdCls} tabular-nums text-gray-600 dark:text-gray-300`}>
              {receitas.count + despesas.count}
            </td>
            <td className={`${balanceFootTdCls} tabular-nums ${moneyToneCls(result.raw)}`}>
              {formatSignedCurrency(result.raw)}
            </td>
            <td className={`${balanceFootTdCls} tabular-nums ${moneyToneCls(result.mine)}`}>
              {formatSignedCurrency(result.mine)}
            </td>
            <td className={`${balanceFootTdCls} tabular-nums ${moneyToneCls(result.partner)}`}>
              {formatSignedCurrency(result.partner)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

const BalanceDetailsModal = ({
  isOpen,
  onClose,
  title,
  type,
  accountColor,
  expenseItems,
  revenueItems,
  isPartnerAccount = false
}: BalanceDetailsModalProps) => {
  const isCreditCard = type === 'credit_card'
  const isBenefitCard = type === 'benefit_card'

  // Para cartões benefício, remove todas as receitas (amount > 0) dos cálculos
  const filteredRevenueItems = isBenefitCard ? [] : revenueItems

  // Para cartões: activeTab será o year_month (ex: "2025-12")
  // Para outros: activeTab será 'expenses' ou 'revenues'
  const [activeTab, setActiveTab] = useState<string>('expenses')
  const [activeYear, setActiveYear] = useState<string>('') // Ano selecionado para cartões
  const [sortConfig, setSortConfig] = useState<SortConfig[]>([
    { field: 'date', direction: 'desc' },
    { field: 'description', direction: 'desc' }
  ])

  // Combina todos os itens para cartões
  const allItems = isCreditCard ? [...expenseItems, ...filteredRevenueItems] : []

  // Agrupa por year_month para cartões
  const groupedByMonth = isCreditCard
    ? allItems.reduce((acc, item) => {
        const month = item.year_month || 'Sem mês'
        if (!acc[month]) acc[month] = []
        acc[month].push(item)
        return acc
      }, {} as Record<string, BalanceItem[]>)
    : {}

  // Ordena os meses cronologicamente (do mais novo para o mais antigo)
  const sortedMonths = Object.keys(groupedByMonth).sort((a, b) => {
    if (a === 'Sem mês') return 1
    if (b === 'Sem mês') return -1
    return b.localeCompare(a) // Invertido: b.localeCompare(a)
  })

  // Agrupa meses por ano
  const groupedByYear = isCreditCard
    ? sortedMonths.reduce((acc, yearMonth) => {
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
    : {}

  // Lista de anos ordenados (do mais novo para o mais antigo)
  const sortedYears = Object.keys(groupedByYear).sort((a, b) => {
    if (a === 'Sem ano') return 1
    if (b === 'Sem ano') return -1
    return b.localeCompare(a) // Invertido: b.localeCompare(a)
  })

  // Meses do ano selecionado
  const monthsOfActiveYear = activeYear ? (groupedByYear[activeYear] || []) : []

  // Formata apenas o mês (sem ano)
  const formatMonthOnly = (yearMonth: string) => {
    if (yearMonth === 'Sem mês') return yearMonth
    const [, month] = yearMonth.split('-')
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
                        'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
    return monthNames[parseInt(month) - 1]
  }

  // Reseta para primeira aba ao abrir
  useEffect(() => {
    if (isOpen) {
      if (isCreditCard && sortedYears.length > 0) {
        // Define o primeiro ano
        const firstYear = sortedYears[0]
        setActiveYear(firstYear)
        // Define o primeiro mês desse ano
        const firstMonth = groupedByYear[firstYear]?.[0]
        if (firstMonth) {
          setActiveTab(firstMonth)
        }
      } else {
        setActiveTab(expenseItems.length > 0 ? 'expenses' : 'revenues')
      }
      // Reseta ordenação padrão
      setSortConfig([
        { field: 'date', direction: 'desc' },
        { field: 'description', direction: 'desc' }
      ])
    }
  }, [isOpen, expenseItems.length, isCreditCard, sortedYears.length])

  // Atalho ESC para fechar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const getIcon = () => {
    switch (type) {
      case 'transactions':
        return <Receipt size={20} className={`text-color-${accountColor}`} />
      case 'credit_card':
        return <CreditCard size={20} className={`text-color-${accountColor}`} />
      case 'benefit_card':
        return <Gift size={20} className={`text-color-${accountColor}`} />
    }
  }

  // Função para alternar ordenação de uma coluna
  const handleSort = (field: SortField) => {
    setSortConfig(prevConfig => {
      const existingIndex = prevConfig.findIndex(s => s.field === field)

      if (existingIndex === -1) {
        // Campo não está na ordenação: adiciona no final com direção 'desc'
        return [...prevConfig, { field, direction: 'desc' }]
      } else {
        const existing = prevConfig[existingIndex]

        if (existing.direction === 'desc') {
          // Se está desc, muda para asc
          const newConfig = [...prevConfig]
          newConfig[existingIndex] = { field, direction: 'asc' }
          return newConfig
        } else {
          // Se está asc, remove da ordenação
          return prevConfig.filter((_, i) => i !== existingIndex)
        }
      }
    })
  }

  // Ordena os itens com base na configuração de ordenação
  const currentItems = (
    isCreditCard
      ? (groupedByMonth[activeTab] || [])
      : (activeTab === 'expenses' ? expenseItems : filteredRevenueItems)
  ).sort((a, b) => {
    for (const sort of sortConfig) {
      let compareResult = 0

      switch (sort.field) {
        case 'date':
          compareResult = new Date(a.date).getTime() - new Date(b.date).getTime()
          break
        case 'description':
          compareResult = a.description.localeCompare(b.description, 'pt-BR')
          break
        case 'category':
          const catA = a.tag_name ? `${a.tag_name}${a.subtag_name ? ` > ${a.subtag_name}` : ''}` : ''
          const catB = b.tag_name ? `${b.tag_name}${b.subtag_name ? ` > ${b.subtag_name}` : ''}` : ''
          compareResult = catA.localeCompare(catB, 'pt-BR')
          break
        case 'amount':
          compareResult = Math.abs(Number(a.amount)) - Math.abs(Number(b.amount))
          break
        case 'my_percentage':
          compareResult = Number(a.my_contribution_percentage ?? 0) - Number(b.my_contribution_percentage ?? 0)
          break
        case 'my_value':
          const myValueA = Math.abs(Number(a.amount)) * (Number(a.my_contribution_percentage ?? 0) / 100)
          const myValueB = Math.abs(Number(b.amount)) * (Number(b.my_contribution_percentage ?? 0) / 100)
          compareResult = myValueA - myValueB
          break
        case 'partner_value':
          const partnerValueA = Math.abs(Number(a.amount)) * (Number(a.partner_contribution_percentage ?? 0) / 100)
          const partnerValueB = Math.abs(Number(b.amount)) * (Number(b.partner_contribution_percentage ?? 0) / 100)
          compareResult = partnerValueA - partnerValueB
          break
      }

      if (compareResult !== 0) {
        return sort.direction === 'asc' ? compareResult : -compareResult
      }
    }

    return 0
  })

  const receitasForSummary = isCreditCard
    ? currentItems.filter((item) => Number(item.amount) > 0)
    : activeTab === 'revenues'
      ? currentItems.map((item) => ({ ...item, amount: Math.abs(Number(item.amount)) }))
      : []
  const despesasForSummary = isCreditCard
    ? currentItems.filter((item) => Number(item.amount) < 0)
    : activeTab === 'expenses'
      ? currentItems.map((item) => ({ ...item, amount: -Math.abs(Number(item.amount)) }))
      : []
  const summaryReceitas = computeFlowTotals(receitasForSummary, true)
  const summaryDespesas = computeFlowTotals(despesasForSummary, true)

  // Função para renderizar o ícone de ordenação
  const getSortIcon = (field: SortField) => {
    const sortIndex = sortConfig.findIndex(s => s.field === field)

    if (sortIndex === -1) {
      // Não está ordenando por este campo
      return <ArrowUpDown size={14} className="opacity-30" />
    }

    const sort = sortConfig[sortIndex]
    const priority = sortConfig.length > 1 ? sortIndex + 1 : null

    return (
      <span className="inline-flex items-center gap-1">
        {sort.direction === 'asc' ? (
          <ArrowUp size={14} className="text-color-primary" />
        ) : (
          <ArrowDown size={14} className="text-color-primary" />
        )}
        {priority !== null && (
          <span className="text-xs font-bold text-color-primary">{priority}</span>
        )}
      </span>
    )
  }

  // Agrupa itens por cartão (apenas para credit_card)
  const groupedByCard = isCreditCard
    ? currentItems.reduce((acc, item) => {
        const cardKey = `${item.card_name || 'Sem cartão'}|${item.card_id || 0}`
        if (!acc[cardKey]) acc[cardKey] = []
        acc[cardKey].push(item)
        return acc
      }, {} as Record<string, BalanceItem[]>)
    : {}

  // Ordena grupos de cartão e seus itens
  const sortedCardGroups = Object.entries(groupedByCard)
    .map(([cardKey, items]) => {
      const [cardName] = cardKey.split('|')
      const cardNumber = items[0]?.card_number || ''
      const cardActive = items[0]?.card_active ?? true  // Default true se não informado
      const cardClosingDay = items[0]?.card_closing_day ?? items[0]?.card_due_day
      return { cardName, cardNumber, cardActive, cardClosingDay, items }
    })
    .sort((a, b) => {
      // Ordena cartões por número (últimos 4 dígitos)
      return (a.cardNumber || '').localeCompare(b.cardNumber || '', 'pt-BR')
    })

  return (
    <CadastroModalShell maxWidth="max-w-[95vw] xl:max-w-[90vw] 2xl:max-w-[85vw]" onBackdropClick={onClose}>
      <CadastroModalHeader
        isEdit={false}
        title={title}
        onClose={onClose}
        icon={getIcon()}
      />
      <CadastroModalBody
        chrome={
          isCreditCard ? (
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
                        if (firstMonth) setActiveTab(firstMonth)
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
                    const isActive = activeTab === month
                    const monthCount = groupedByMonth[month].length
                    return (
                      <button
                        key={month}
                        type="button"
                        onClick={() => setActiveTab(month)}
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
          ) : expenseItems.length > 0 || filteredRevenueItems.length > 0 ? (
            <CadastroModalTabs
              ariaLabel="Tipo de lançamento"
              active={activeTab}
              onChange={setActiveTab}
              className="mb-4 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden dark:border-gray-700 dark:bg-gray-800"
              barClassName="px-2"
              tabs={[
                ...(expenseItems.length > 0
                  ? [{ key: 'expenses', label: 'Despesas', badge: expenseItems.length }]
                  : []),
                ...(filteredRevenueItems.length > 0
                  ? [{ key: 'revenues', label: 'Receitas', badge: filteredRevenueItems.length }]
                  : []),
              ]}
            />
          ) : null
        }
      >
          <div className={`${cadastroSectionsStackCls} pt-1`}>
            <CadastroFormSection
              title="Resumo"
              hint="Receitas, despesas e resultado do período selecionado, com a divisão entre a sua parte e a da contraparte."
              icon={<Scale size={14} />}
              bodyClassName="p-0"
            >
              <BalanceFlowSummaryTable receitas={summaryReceitas} despesas={summaryDespesas} />
            </CadastroFormSection>

          {isCreditCard ? (
            // Renderiza tabelas separadas por cartão
            <>
              {sortedCardGroups.map(({ cardName, cardNumber, cardActive, cardClosingDay, items }) => {
                return (
                  <CadastroFormSection
                    key={cardName}
                    title={`${cardName}${cardNumber ? ` *** ${cardNumber.slice(-4)}` : ''} (${items.length} ${items.length === 1 ? 'item' : 'itens'})`}
                    icon={<CreditCard size={14} />}
                    bodyClassName="p-0"
                    trailing={
                      <div className="flex items-center gap-2">
                        {cardClosingDay && items[0]?.year_month && (() => {
                          const [year, month] = items[0].year_month!.split('-')
                          const lastDay = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate()
                          const day = Math.min(Math.max(cardClosingDay, 1), lastDay)
                          const closingDate = new Date(parseInt(year, 10), parseInt(month, 10) - 1, day, 23, 59, 59)
                          const formattedDate = closingDate.toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })
                          return (
                            <span className="text-xs text-gray-600 dark:text-gray-400 bg-gray-200 dark:bg-gray-600 px-2 py-1 rounded">
                              Fechou dia {formattedDate}
                            </span>
                          )
                        })()}
                        <span className={`inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                          cardActive
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                        }`}>
                          {cardActive ? '✅ Ativo' : '⏸️ Inativo'}
                        </span>
                      </div>
                    }
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1000px] text-sm">
                        <thead className={balanceTableHeadCls}>
                          <tr>
                            <th className={`${balanceThCenterCls} w-12`}>#</th>
                            <th
                              className={`${balanceThLeftCls} cursor-pointer select-none hover:bg-gray-200/60 dark:hover:bg-gray-700/60`}
                              onClick={() => handleSort('date')}
                              title="Clique para ordenar por Data"
                            >
                              <span className="inline-flex items-center gap-2">
                                Data
                                {getSortIcon('date')}
                              </span>
                            </th>
                            <th
                              className={`${balanceThLeftCls} cursor-pointer select-none hover:bg-gray-200/60 dark:hover:bg-gray-700/60`}
                              onClick={() => handleSort('description')}
                              title="Clique para ordenar por Descrição"
                            >
                              <span className="inline-flex items-center gap-2">
                                Descrição
                                {getSortIcon('description')}
                              </span>
                            </th>
                            <th
                              className={`${balanceThLeftCls} cursor-pointer select-none hover:bg-gray-200/60 dark:hover:bg-gray-700/60`}
                              onClick={() => handleSort('category')}
                              title="Clique para ordenar por Categoria"
                            >
                              <span className="inline-flex items-center gap-2">
                                Tag/Subtag
                                {getSortIcon('category')}
                              </span>
                            </th>
                            <th
                              className={`${balanceThLeftCls} cursor-pointer select-none hover:bg-gray-200/60 dark:hover:bg-gray-700/60`}
                              onClick={() => handleSort('amount')}
                              title="Clique para ordenar por Valor total"
                            >
                              <span className="inline-flex items-center gap-2">
                                Valor total
                                {getSortIcon('amount')}
                              </span>
                            </th>
                            <th
                              className={`${balanceThLeftCls} cursor-pointer select-none hover:bg-gray-200/60 dark:hover:bg-gray-700/60`}
                              onClick={() => handleSort('my_percentage')}
                              title="Clique para ordenar por %"
                            >
                              <span className="inline-flex items-center gap-2">
                                %
                                {getSortIcon('my_percentage')}
                              </span>
                            </th>
                            <th
                              className={`${balanceThLeftCls} cursor-pointer select-none hover:bg-gray-200/60 dark:hover:bg-gray-700/60`}
                              onClick={() => handleSort('my_value')}
                              title="Clique para ordenar por Minha parte"
                            >
                              <span className="inline-flex items-center gap-2">
                                Minha parte
                                {getSortIcon('my_value')}
                              </span>
                            </th>
                            <th
                              className={`${balanceThLeftCls} cursor-pointer select-none hover:bg-gray-200/60 dark:hover:bg-gray-700/60`}
                              onClick={() => handleSort('partner_value')}
                              title="Clique para ordenar por Contraparte"
                            >
                              <span className="inline-flex items-center gap-2">
                                Contraparte
                                {getSortIcon('partner_value')}
                              </span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item, index) => {
                            const myPercentage = Number(item.my_contribution_percentage ?? 0)
                            const partnerPercentage = Number(item.partner_contribution_percentage ?? 0)
                            const myValue = Math.abs(Number(item.amount)) * (myPercentage / 100)
                            const partnerValue = Math.abs(Number(item.amount)) * (partnerPercentage / 100)
                            const isNegative = Number(item.amount) < 0

                            return (
                              <tr key={item.id} className={listPageTableRowHoverCls}>
                                <td className={`${balanceTdCls} text-center text-sm text-gray-500 dark:text-gray-400`}>
                                  {index + 1}
                                </td>
                                <td className={`${balanceTdCls} whitespace-nowrap text-gray-600 dark:text-gray-400`}>
                                  {new Date(item.date).toLocaleDateString('pt-BR')}
                                </td>
                                <td className={`${balanceTdCls} font-medium text-gray-900 dark:text-white`}>
                                  {item.description}
                                  {item.current_installment && item.total_installments && item.total_installments > 1 && (
                                    <span className="ml-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                                      ({item.current_installment}/{item.total_installments})
                                    </span>
                                  )}
                                </td>
                                <td className={`${balanceTdCls} text-gray-500 dark:text-gray-400`}>
                                  {item.tag_name ? (
                                    <>{item.tag_name}{item.subtag_name && ` > ${item.subtag_name}`}</>
                                  ) : '—'}
                                </td>
                                <td className={`${balanceTdCls} text-right tabular-nums font-semibold whitespace-nowrap ${moneyToneCls(Number(item.amount))}`}>
                                  {formatSignedCurrency(Number(item.amount))}
                                </td>
                                <td className={`${balanceTdCls} font-medium text-gray-700 dark:text-gray-300`}>
                                  {myPercentage.toFixed(0)}%
                                </td>
                                <td className={`${balanceTdCls} text-right tabular-nums font-semibold whitespace-nowrap text-color-primary`}>
                                  {formatSignedCurrency(isNegative ? -myValue : myValue)}
                                </td>
                                <td className={`${balanceTdCls} text-right tabular-nums font-medium whitespace-nowrap text-color-secondary`}>
                                  {formatSignedCurrency(isNegative ? -partnerValue : partnerValue)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CadastroFormSection>
                )
              })}
            </>
          ) : (
            <CadastroFormSection
              title={activeTab === 'expenses' ? 'Despesas' : 'Receitas'}
              icon={isBenefitCard ? <Gift size={14} /> : <Receipt size={14} />}
              bodyClassName="p-0"
            >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className={balanceTableHeadCls}>
                  <tr>
                    <th className={`${balanceThCenterCls} w-12`}>#</th>
                    <th
                      className={`${balanceThLeftCls} cursor-pointer select-none hover:bg-gray-200/60 dark:hover:bg-gray-700/60`}
                      onClick={() => handleSort('date')}
                      title="Clique para ordenar por Data"
                    >
                      <span className="inline-flex items-center gap-2">
                        Data
                        {getSortIcon('date')}
                      </span>
                    </th>
                    <th
                      className={`${balanceThLeftCls} cursor-pointer select-none hover:bg-gray-200/60 dark:hover:bg-gray-700/60`}
                      onClick={() => handleSort('description')}
                      title="Clique para ordenar por Descrição"
                    >
                      <span className="inline-flex items-center gap-2">
                        Descrição
                        {getSortIcon('description')}
                      </span>
                    </th>
                    <th
                      className={`${balanceThLeftCls} cursor-pointer select-none hover:bg-gray-200/60 dark:hover:bg-gray-700/60`}
                      onClick={() => handleSort('category')}
                      title="Clique para ordenar por Categoria"
                    >
                      <span className="inline-flex items-center gap-2">
                        Tag/Subtag
                        {getSortIcon('category')}
                      </span>
                    </th>
                    <th
                      className={`${balanceThLeftCls} cursor-pointer select-none hover:bg-gray-200/60 dark:hover:bg-gray-700/60`}
                      onClick={() => handleSort('amount')}
                      title="Clique para ordenar por Valor total"
                    >
                      <span className="inline-flex items-center gap-2">
                        Valor total
                        {getSortIcon('amount')}
                      </span>
                    </th>
                    <th
                      className={`${balanceThLeftCls} cursor-pointer select-none hover:bg-gray-200/60 dark:hover:bg-gray-700/60`}
                      onClick={() => handleSort('my_percentage')}
                      title="Clique para ordenar por %"
                    >
                      <span className="inline-flex items-center gap-2">
                        %
                        {getSortIcon('my_percentage')}
                      </span>
                    </th>
                    <th
                      className={`${balanceThLeftCls} cursor-pointer select-none hover:bg-gray-200/60 dark:hover:bg-gray-700/60`}
                      onClick={() => handleSort('my_value')}
                      title="Clique para ordenar por Minha parte"
                    >
                      <span className="inline-flex items-center gap-2">
                        Minha parte
                        {getSortIcon('my_value')}
                      </span>
                    </th>
                    <th
                      className={`${balanceThLeftCls} cursor-pointer select-none hover:bg-gray-200/60 dark:hover:bg-gray-700/60`}
                      onClick={() => handleSort('partner_value')}
                      title="Clique para ordenar por Contraparte"
                    >
                      <span className="inline-flex items-center gap-2">
                        Contraparte
                        {getSortIcon('partner_value')}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {currentItems.map((item, index) => {
                    const myPercentage = Number(item.my_contribution_percentage ?? 0)
                    const partnerPercentage = Number(item.partner_contribution_percentage ?? 0)
                    const myValue = Math.abs(Number(item.amount)) * (myPercentage / 100)
                    const partnerValue = Math.abs(Number(item.amount)) * (partnerPercentage / 100)
                    const signedAmount =
                      activeTab === 'expenses' ? -Math.abs(Number(item.amount)) : Math.abs(Number(item.amount))

                    return (
                      <tr key={item.id} className={listPageTableRowHoverCls}>
                        <td className={`${balanceTdCls} text-center text-sm text-gray-500 dark:text-gray-400`}>
                          {index + 1}
                        </td>
                        <td className={`${balanceTdCls} whitespace-nowrap text-gray-600 dark:text-gray-400`}>
                          {new Date(item.date).toLocaleDateString('pt-BR')}
                        </td>
                        <td className={`${balanceTdCls} font-medium text-gray-900 dark:text-white`}>
                          {item.description}
                          {item.current_installment && item.total_installments && item.total_installments > 1 && (
                            <span className="ml-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                              ({item.current_installment}/{item.total_installments})
                            </span>
                          )}
                        </td>
                        <td className={`${balanceTdCls} text-gray-500 dark:text-gray-400`}>
                          {item.tag_name ? (
                            <>{item.tag_name}{item.subtag_name && ` > ${item.subtag_name}`}</>
                          ) : '—'}
                        </td>
                        <td className={`${balanceTdCls} text-right tabular-nums font-semibold whitespace-nowrap ${moneyToneCls(signedAmount)}`}>
                          {formatSignedCurrency(signedAmount)}
                        </td>
                        <td className={`${balanceTdCls} font-medium text-gray-700 dark:text-gray-300`}>
                          {myPercentage.toFixed(0)}%
                        </td>
                        <td className={`${balanceTdCls} text-right tabular-nums font-semibold whitespace-nowrap text-color-primary`}>
                          {formatSignedCurrency(activeTab === 'expenses' ? -myValue : myValue)}
                        </td>
                        <td className={`${balanceTdCls} text-right tabular-nums font-medium whitespace-nowrap text-color-secondary`}>
                          {formatSignedCurrency(activeTab === 'expenses' ? -partnerValue : partnerValue)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            </CadastroFormSection>
          )}
          </div>
      </CadastroModalBody>
      <CadastroModalFooter onClose={onClose} hideSave closeLabel="Fechar" />
    </CadastroModalShell>
  )
}

export default BalanceDetailsModal

