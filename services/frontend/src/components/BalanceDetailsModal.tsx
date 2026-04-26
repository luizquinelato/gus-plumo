import { useState, useEffect } from 'react'
import { X, Receipt, CreditCard, Gift, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

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
  card_closing_day?: number  // Dia de fechamento do cartão (1-31)
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

  // Formata year_month para "ANO-NOME_MES"
  const formatYearMonth = (yearMonth: string) => {
    if (yearMonth === 'Sem mês') return yearMonth
    const [year, month] = yearMonth.split('-')
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
    return `${year}-${monthNames[parseInt(month) - 1]}`
  }

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

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

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

  // Para cartões: mantém o sinal (negativo/positivo)
  // Para extrato/benefícios: usa valor absoluto
  const totalAmount = isCreditCard
    ? currentItems.reduce((sum, item) => sum + Number(item.amount), 0)
    : currentItems.reduce((sum, item) => sum + Math.abs(Number(item.amount)), 0)

  const totalMyValue = isCreditCard
    ? currentItems.reduce((sum, item) => {
        const myPercentage = Number(item.my_contribution_percentage ?? 0)
        return sum + (Number(item.amount) * (myPercentage / 100))
      }, 0)
    : currentItems.reduce((sum, item) => {
        const myPercentage = Number(item.my_contribution_percentage ?? 0)
        return sum + (Math.abs(Number(item.amount)) * (myPercentage / 100))
      }, 0)

  const totalPartnerValue = isCreditCard
    ? currentItems.reduce((sum, item) => {
        const partnerPercentage = Number(item.partner_contribution_percentage ?? 0)
        return sum + (Number(item.amount) * (partnerPercentage / 100))
      }, 0)
    : currentItems.reduce((sum, item) => {
        const partnerPercentage = Number(item.partner_contribution_percentage ?? 0)
        return sum + (Math.abs(Number(item.amount)) * (partnerPercentage / 100))
      }, 0)

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
      const cardClosingDay = items[0]?.card_closing_day  // Dia de fechamento do cartão
      return { cardName, cardNumber, cardActive, cardClosingDay, items }
    })
    .sort((a, b) => {
      // Ordena cartões por número (últimos 4 dígitos)
      return (a.cardNumber || '').localeCompare(b.cardNumber || '', 'pt-BR')
    })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-[95vw] xl:max-w-[90vw] 2xl:max-w-[85vw] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            {getIcon()}
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        {isCreditCard ? (
          // Tabs hierárquicas: Anos (linha 1) e Meses (linha 2)
          <div className="flex-shrink-0">
            {/* Linha 1: Abas de Anos */}
            <div className="flex border-b border-gray-200 dark:border-gray-700 px-6 overflow-x-auto bg-gray-100 dark:bg-gray-800">
              {sortedYears.map(year => {
                const totalItemsInYear = groupedByYear[year].reduce((sum, month) => sum + groupedByMonth[month].length, 0)
                return (
                  <button
                    key={year}
                    onClick={() => {
                      setActiveYear(year)
                      // Ao trocar de ano, seleciona o primeiro mês desse ano
                      const firstMonth = groupedByYear[year]?.[0]
                      if (firstMonth) setActiveTab(firstMonth)
                    }}
                    className={`px-4 py-2 text-xs font-bold transition-all whitespace-nowrap flex-shrink-0 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white ${
                      activeYear === year
                        ? 'border-b-2 border-color-primary'
                        : 'border-b-2 border-transparent'
                    }`}
                  >
                    {year} <span className="text-[10px] font-normal opacity-70">({totalItemsInYear})</span>
                  </button>
                )
              })}
            </div>

            {/* Linha 2: Abas de Meses do Ano Selecionado */}
            <div className="flex border-b border-gray-200 dark:border-gray-700 px-6 bg-gray-50 dark:bg-gray-700">
              {monthsOfActiveYear.map(month => (
                <button
                  key={month}
                  onClick={() => setActiveTab(month)}
                  className={`flex-1 px-2 py-2.5 text-sm font-semibold transition-all whitespace-nowrap text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white ${
                    activeTab === month
                      ? 'border-b-2 border-color-secondary'
                      : 'border-b-2 border-transparent'
                  }`}
                >
                  {formatMonthOnly(month)} <span className="text-xs font-normal opacity-60">({groupedByMonth[month].length})</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          // Tabs de Despesas/Receitas para extrato e benefícios
          <div className="flex border-b border-gray-200 dark:border-gray-700 px-6 overflow-x-auto flex-shrink-0">
            {expenseItems.length > 0 && (
              <button
                onClick={() => setActiveTab('expenses')}
                className={`px-6 py-3 text-sm font-semibold transition-all flex-shrink-0 ${
                  activeTab === 'expenses'
                    ? `text-color-${accountColor} border-b-2 border-color-${accountColor}`
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Despesas ({expenseItems.length})
              </button>
            )}
            {filteredRevenueItems.length > 0 && (
              <button
                onClick={() => setActiveTab('revenues')}
                className={`px-6 py-3 text-sm font-semibold transition-all flex-shrink-0 ${
                  activeTab === 'revenues'
                    ? `text-color-${accountColor} border-b-2 border-color-${accountColor}`
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Receitas ({filteredRevenueItems.length})
              </button>
            )}
          </div>
        )}

        {/* Espaçamento fixo (não rola) */}
        <div className="px-6 pt-6 flex-shrink-0"></div>

        {/* Content (área rolável) */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {isCreditCard ? (
            // Renderiza tabelas separadas por cartão
            <div className="space-y-6">
              {sortedCardGroups.map(({ cardName, cardNumber, cardActive, cardClosingDay, items }) => {
                // Calcula totais mantendo o sinal (negativo ou positivo)
                const cardTotal = items.reduce((sum, item) => sum + Number(item.amount), 0)
                const cardMyTotal = items.reduce((sum, item) => {
                  const myPercentage = Number(item.my_contribution_percentage ?? 0)
                  return sum + (Number(item.amount) * (myPercentage / 100))
                }, 0)
                const cardPartnerTotal = items.reduce((sum, item) => {
                  const partnerPercentage = Number(item.partner_contribution_percentage ?? 0)
                  return sum + (Number(item.amount) * (partnerPercentage / 100))
                }, 0)

                return (
                  <div key={cardName} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    {/* Header do Cartão */}
                    <div className="bg-gray-100 dark:bg-gray-700 p-4 border-b border-gray-200 dark:border-gray-600">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CreditCard size={18} className="text-color-primary" />
                          <span className="font-bold text-gray-900 dark:text-white text-lg">
                            {cardName} {cardNumber ? `*** ${cardNumber.slice(-4)}` : ''}
                          </span>
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            ({items.length} {items.length === 1 ? 'item' : 'itens'})
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Data de Fechamento */}
                          {cardClosingDay && items[0]?.year_month && (() => {
                            const [year, month] = items[0].year_month.split('-')
                            const closingDate = new Date(parseInt(year), parseInt(month) - 1, cardClosingDay, 23, 59, 59)
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
                          {/* Badge de Ativo/Inativo */}
                          <span className={`inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                            cardActive
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                          }`}>
                            {cardActive ? '✅ Ativo' : '⏸️ Inativo'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Tabela do Cartão */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[900px]">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                          <tr className="border-b border-gray-300 dark:border-gray-600">
                            <th
                              className="text-left p-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                              onClick={() => handleSort('date')}
                              title="Clique para ordenar por Data"
                            >
                              <div className="flex items-center gap-2">
                                Data
                                {getSortIcon('date')}
                              </div>
                            </th>
                            <th
                              className="text-left p-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                              onClick={() => handleSort('description')}
                              title="Clique para ordenar por Descrição"
                            >
                              <div className="flex items-center gap-2">
                                Descrição
                                {getSortIcon('description')}
                              </div>
                            </th>
                            <th
                              className="text-left p-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                              onClick={() => handleSort('category')}
                              title="Clique para ordenar por Categoria"
                            >
                              <div className="flex items-center gap-2">
                                Categoria
                                {getSortIcon('category')}
                              </div>
                            </th>
                            <th
                              className="text-right p-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                              onClick={() => handleSort('amount')}
                              title="Clique para ordenar por Valor Total"
                            >
                              <div className="flex items-center justify-end gap-2">
                                Valor Total
                                {getSortIcon('amount')}
                              </div>
                            </th>
                            <th
                              className="text-center p-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                              onClick={() => handleSort('my_percentage')}
                              title="Clique para ordenar por Minha Parte %"
                            >
                              <div className="flex items-center justify-center gap-2">
                                Minha Parte
                                {getSortIcon('my_percentage')}
                              </div>
                            </th>
                            <th
                              className="text-right p-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                              onClick={() => handleSort('my_value')}
                              title="Clique para ordenar por Meu Valor"
                            >
                              <div className="flex items-center justify-end gap-2">
                                Meu Valor
                                {getSortIcon('my_value')}
                              </div>
                            </th>
                            <th
                              className="text-right p-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                              onClick={() => handleSort('partner_value')}
                              title="Clique para ordenar por Valor Contraparte"
                            >
                              <div className="flex items-center justify-end gap-2">
                                Valor Contraparte
                                {getSortIcon('partner_value')}
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => {
                            const myPercentage = Number(item.my_contribution_percentage ?? 0)
                            const partnerPercentage = Number(item.partner_contribution_percentage ?? 0)
                            const myValue = Math.abs(Number(item.amount)) * (myPercentage / 100)
                            const partnerValue = Math.abs(Number(item.amount)) * (partnerPercentage / 100)
                            const isNegative = Number(item.amount) < 0

                            return (
                              <tr
                                key={item.id}
                                className="border-l-4 border-l-gray-300 dark:border-l-gray-600 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.borderLeftColor = ''
                                }}
                              >
                                <td className="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                  {new Date(item.date).toLocaleDateString('pt-BR')}
                                </td>
                                <td className="p-3 text-gray-900 dark:text-white font-medium">
                                  {item.description}{item.current_installment && item.total_installments && item.total_installments > 1 ? ` ${item.current_installment}/${item.total_installments}` : ''}
                                </td>
                                <td className="p-3 text-gray-500 dark:text-gray-400">
                                  {item.tag_name ? (
                                    <>{item.tag_name}{item.subtag_name && ` > ${item.subtag_name}`}</>
                                  ) : '-'}
                                </td>
                                <td className={`p-3 text-right font-semibold whitespace-nowrap ${
                                  isNegative
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-green-600 dark:text-green-400'
                                }`}>
                                  {isNegative ? '-' : '+'}{formatCurrency(Math.abs(Number(item.amount)))}
                                </td>
                                <td className="p-3 text-center text-gray-700 dark:text-gray-300 font-medium">
                                  {myPercentage.toFixed(0)}%
                                </td>
                                <td className="p-3 text-right font-semibold whitespace-nowrap text-color-primary">
                                  {isNegative ? '-' : '+'}{formatCurrency(myValue)}
                                </td>
                                <td className="p-3 text-right font-medium whitespace-nowrap text-color-secondary">
                                  {isNegative ? '-' : '+'}{formatCurrency(partnerValue)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot className="bg-gray-50 dark:bg-gray-800 font-semibold border-t-2 border-gray-300 dark:border-gray-600">
                          <tr>
                            <td colSpan={3} className="p-3 text-right text-gray-700 dark:text-gray-300">
                              Subtotal {cardName}:
                            </td>
                            <td className={`p-3 text-right whitespace-nowrap ${
                              cardTotal < 0
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-green-600 dark:text-green-400'
                            }`}>
                              {cardTotal < 0 ? '-' : ''}{formatCurrency(Math.abs(cardTotal))}
                            </td>
                            <td className="p-3"></td>
                            <td className={`p-3 text-right whitespace-nowrap ${
                              cardMyTotal < 0
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-green-600 dark:text-green-400'
                            }`}>
                              {cardMyTotal < 0 ? '-' : ''}{formatCurrency(Math.abs(cardMyTotal))}
                            </td>
                            <td className={`p-3 text-right whitespace-nowrap ${
                              cardPartnerTotal < 0
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-green-600 dark:text-green-400'
                            }`}>
                              {cardPartnerTotal < 0 ? '-' : ''}{formatCurrency(Math.abs(cardPartnerTotal))}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            // Renderiza tabela única para extrato e benefícios
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                  <tr className="border-b border-gray-300 dark:border-gray-600">
                    <th
                      className="text-left p-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                      onClick={() => handleSort('date')}
                      title="Clique para ordenar por Data"
                    >
                      <div className="flex items-center gap-2">
                        Data
                        {getSortIcon('date')}
                      </div>
                    </th>
                    <th
                      className="text-left p-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                      onClick={() => handleSort('description')}
                      title="Clique para ordenar por Descrição"
                    >
                      <div className="flex items-center gap-2">
                        Descrição
                        {getSortIcon('description')}
                      </div>
                    </th>
                    <th
                      className="text-left p-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                      onClick={() => handleSort('category')}
                      title="Clique para ordenar por Categoria"
                    >
                      <div className="flex items-center gap-2">
                        Categoria
                        {getSortIcon('category')}
                      </div>
                    </th>
                    <th
                      className="text-right p-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                      onClick={() => handleSort('amount')}
                      title="Clique para ordenar por Valor Total"
                    >
                      <div className="flex items-center justify-end gap-2">
                        Valor Total
                        {getSortIcon('amount')}
                      </div>
                    </th>
                    <th
                      className="text-center p-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                      onClick={() => handleSort('my_percentage')}
                      title="Clique para ordenar por Minha Parte %"
                    >
                      <div className="flex items-center justify-center gap-2">
                        Minha Parte
                        {getSortIcon('my_percentage')}
                      </div>
                    </th>
                    <th
                      className="text-right p-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                      onClick={() => handleSort('my_value')}
                      title="Clique para ordenar por Meu Valor"
                    >
                      <div className="flex items-center justify-end gap-2">
                        Meu Valor
                        {getSortIcon('my_value')}
                      </div>
                    </th>
                    <th
                      className="text-right p-3 font-semibold text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                      onClick={() => handleSort('partner_value')}
                      title="Clique para ordenar por Valor Contraparte"
                    >
                      <div className="flex items-center justify-end gap-2">
                        Valor Contraparte
                        {getSortIcon('partner_value')}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {currentItems.map((item) => {
                    const myPercentage = Number(item.my_contribution_percentage ?? 0)
                    const partnerPercentage = Number(item.partner_contribution_percentage ?? 0)
                    const myValue = Math.abs(Number(item.amount)) * (myPercentage / 100)
                    const partnerValue = Math.abs(Number(item.amount)) * (partnerPercentage / 100)

                    return (
                      <tr
                        key={item.id}
                        className="border-l-4 border-l-gray-300 dark:border-l-gray-600 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderLeftColor = ''
                        }}
                      >
                        <td className="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {new Date(item.date).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="p-3 text-gray-900 dark:text-white font-medium">
                          {item.description}{item.current_installment && item.total_installments && item.total_installments > 1 ? ` ${item.current_installment}/${item.total_installments}` : ''}
                        </td>
                        <td className="p-3 text-gray-500 dark:text-gray-400">
                          {item.tag_name ? (
                            <>{item.tag_name}{item.subtag_name && ` > ${item.subtag_name}`}</>
                          ) : '-'}
                        </td>
                        <td className={`p-3 text-right font-semibold whitespace-nowrap ${
                          activeTab === 'expenses'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-green-600 dark:text-green-400'
                        }`}>
                          {activeTab === 'expenses' ? '-' : '+'}{formatCurrency(Math.abs(Number(item.amount)))}
                        </td>
                        <td className="p-3 text-center text-gray-700 dark:text-gray-300 font-medium">
                          {myPercentage.toFixed(0)}%
                        </td>
                        <td className="p-3 text-right font-semibold whitespace-nowrap text-color-primary">
                          {activeTab === 'expenses' ? '-' : '+'}{formatCurrency(myValue)}
                        </td>
                        <td className="p-3 text-right font-medium whitespace-nowrap text-color-secondary">
                          {activeTab === 'expenses' ? '-' : '+'}{formatCurrency(partnerValue)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Espaçamento fixo antes do rodapé (não rola) */}
        <div className="px-6 pb-6 flex-shrink-0"></div>

        {/* Footer com Total */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-6 bg-gray-50 dark:bg-gray-700 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            {/* Legenda */}
            <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
              {!isCreditCard && !isBenefitCard && (
                <div className="flex items-center gap-1.5">
                  <Receipt size={14} className="text-color-primary" />
                  <span>Transações</span>
                </div>
              )}
              {isCreditCard && (
                <div className="flex items-center gap-1.5">
                  <CreditCard size={14} className="text-color-primary" />
                  <span>Cartão de Crédito</span>
                </div>
              )}
              {isBenefitCard && (
                <div className="flex items-center gap-1.5">
                  <Gift size={14} className="text-green-600 dark:text-green-400" />
                  <span>Cartão Benefício</span>
                </div>
              )}
            </div>

            {/* Totais */}
            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total ({currentItems.length} {currentItems.length === 1 ? 'item' : 'itens'})</div>
                <span className={`text-lg font-bold ${
                  isCreditCard
                    ? (totalAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400')
                    : (activeTab === 'expenses' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400')
                }`}>
                  {isCreditCard
                    ? (totalAmount < 0 ? '-' : '') + formatCurrency(Math.abs(totalAmount))
                    : (activeTab === 'expenses' ? '-' : '+') + formatCurrency(totalAmount)
                  }
                </span>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Minha Parte</div>
                <span className="text-lg font-bold text-color-primary">
                  {isCreditCard
                    ? (totalMyValue < 0 ? '-' : '') + formatCurrency(Math.abs(totalMyValue))
                    : (activeTab === 'expenses' ? '-' : '+') + formatCurrency(totalMyValue)
                  }
                </span>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Contraparte</div>
                <span className="text-lg font-bold text-color-secondary">
                  {isCreditCard
                    ? (totalPartnerValue < 0 ? '-' : '') + formatCurrency(Math.abs(totalPartnerValue))
                    : (activeTab === 'expenses' ? '-' : '+') + formatCurrency(totalPartnerValue)
                  }
                </span>
              </div>
            </div>
          </div>

          {/* Botão Fechar */}
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-all font-semibold"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BalanceDetailsModal

