import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import LoadingSpinner from '../components/LoadingSpinner'
import { Layers, Search, X, ChevronDown, ChevronRight, Landmark, CreditCard, Gift, Filter, Calendar, Info, TrendingUp, TrendingDown, Minus, BarChart3, ArrowUp } from 'lucide-react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import '../styles/datepicker-custom.css'
import { dateToLocalString } from '../utils/dateUtils'
import { formatCurrency } from '../utils/currency'
import { MultiSelectDropdown, SourceMultiSelectDropdown } from '../components/MultiSelectDropdown'

// Interfaces
interface ExpenseDetail {
  id: number
  date: string
  description: string
  amount: number
  source: 'bank' | 'card' | 'benefit'
  card_number?: string | null
  card_name?: string | null
  category?: string | null
  subtag_id?: number | null
  subtag_name?: string | null
  tag_name?: string | null
  current_installment?: number | null
  total_installments?: number | null
  adjustment_type?: string | null
  ownership_percentage?: number | null
  shared_partner_id?: number | null
  shared_partner_name?: string | null
  shared_partner_bank?: string | null
  shared_partner_agency?: string | null
  shared_partner_account_number?: string | null
  account_id?: number | null
  account_name?: string | null
  bank_code?: string | null
  bank_name?: string | null
  year_month?: string | null  // Ano/mês da fatura (YYYY-MM) - usado apenas para faturas de cartão
}

interface GroupedExpenses {
  description: string
  items: ExpenseDetail[]
  totalAmount: number
  count: number
}

interface GroupStats {
  description: string
  periodStart: Date
  periodEnd: Date
  periodDays: number
  totalAmount: number
  count: number
  avgAmount: number
  avgIntervalDays: number
  trend: 'up' | 'down' | 'stable'
  trendPercentage: number
  maxAmount: number
  minAmount: number
  stdDeviation: number
  frequencyPerMonth: number
}

// Opções de fonte
const SOURCE_OPTIONS = [
  { id: 'bank', name: 'Extratos Bancários', icon: <Landmark size={14} />, color: 'var(--color-1)' },
  { id: 'card', name: 'Faturas de Cartão', icon: <CreditCard size={14} />, color: 'var(--color-2)' },
  { id: 'benefit', name: 'Cartões de Benefícios', icon: <Gift size={14} />, color: 'var(--color-3)' }
]

const GrupoPage = () => {
  // Estados de filtro
  const [selectedSources, setSelectedSources] = useState<string[]>([]) // Vazio = busca todas as fontes
  const [startDate, setStartDate] = useState<Date | null>(null)
  const [endDate, setEndDate] = useState<Date | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  // Estados de dados
  const [expenses, setExpenses] = useState<ExpenseDetail[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Estados de expansão
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Estado para modal de estatísticas do grupo
  const [groupStatsModal, setGroupStatsModal] = useState<{
    isOpen: boolean
    stats: GroupStats | null
  }>({
    isOpen: false,
    stats: null
  })

  // Estado para botão Back to Top
  const [showBackToTop, setShowBackToTop] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // ESC para fechar modais
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (groupStatsModal.isOpen) {
          setGroupStatsModal(prev => ({ ...prev, isOpen: false }))
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [groupStatsModal.isOpen])

  // Detecta scroll para mostrar/esconder botão Back to Top
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const scrolled = container.scrollTop > 300
      setShowBackToTop(scrolled)
    }

    // Verifica scroll inicial
    handleScroll()

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [expenses])

  // Função para voltar ao topo
  const scrollToTop = () => {
    setShowBackToTop(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Formata data/hora
  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Formata apenas data
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  }

  // Calcula estatísticas do grupo
  const calculateGroupStats = (group: GroupedExpenses): GroupStats => {
    const items = group.items
    const amounts = items.map(i => Number(i.amount) || 0)
    const dates = items.map(i => new Date(i.date)).sort((a, b) => a.getTime() - b.getTime())

    // Período
    const periodStart = dates[0]
    const periodEnd = dates[dates.length - 1]
    const periodDays = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)))

    // Valores
    const totalAmount = amounts.reduce((sum, a) => sum + a, 0)
    const avgAmount = totalAmount / items.length
    const maxAmount = Math.max(...amounts)
    const minAmount = Math.min(...amounts)

    // Desvio padrão
    const variance = amounts.reduce((sum, a) => sum + Math.pow(a - avgAmount, 2), 0) / amounts.length
    const stdDeviation = Math.sqrt(variance)

    // Intervalo médio entre itens (em dias)
    let avgIntervalDays = 0
    if (dates.length > 1) {
      const intervals: number[] = []
      for (let i = 1; i < dates.length; i++) {
        const diffDays = (dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24)
        intervals.push(diffDays)
      }
      avgIntervalDays = intervals.reduce((sum, d) => sum + d, 0) / intervals.length
    }

    // Frequência por mês
    const frequencyPerMonth = periodDays > 0 ? (items.length / periodDays) * 30 : items.length

    // Tendência: compara média da primeira metade com a segunda metade
    let trend: 'up' | 'down' | 'stable' = 'stable'
    let trendPercentage = 0
    if (items.length >= 4) {
      const sortedByDate = [...items].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      const midPoint = Math.floor(sortedByDate.length / 2)
      const firstHalf = sortedByDate.slice(0, midPoint)
      const secondHalf = sortedByDate.slice(midPoint)

      const avgFirst = firstHalf.reduce((sum, i) => sum + (Number(i.amount) || 0), 0) / firstHalf.length
      const avgSecond = secondHalf.reduce((sum, i) => sum + (Number(i.amount) || 0), 0) / secondHalf.length

      if (avgFirst !== 0) {
        trendPercentage = ((avgSecond - avgFirst) / Math.abs(avgFirst)) * 100
        if (trendPercentage > 10) trend = 'up'
        else if (trendPercentage < -10) trend = 'down'
      }
    }

    return {
      description: group.description,
      periodStart,
      periodEnd,
      periodDays,
      totalAmount,
      count: items.length,
      avgAmount,
      avgIntervalDays,
      trend,
      trendPercentage,
      maxAmount,
      minAmount,
      stdDeviation,
      frequencyPerMonth
    }
  }

  // Carrega dados
  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()

      // Fontes - vazio = busca todas (combined)
      if (selectedSources.length === 0 || selectedSources.length === 3) {
        // Todas as fontes
        params.append('source', 'combined')
      } else if (selectedSources.length === 1) {
        const sourceMap: Record<string, string> = { bank: 'bank', card: 'cards', benefit: 'benefit' }
        params.append('source', sourceMap[selectedSources[0]])
      } else {
        // 2 fontes selecionadas
        params.append('sources', selectedSources.join(','))
      }

      // Datas
      if (startDate) params.append('start_date', dateToLocalString(startDate))
      if (endDate) params.append('end_date', dateToLocalString(endDate))

      params.append('limit', '10000')

      const response = await axios.get(`/api/reports/detailed?${params}`)
      setExpenses(response.data.expenses || [])
    } catch (err: any) {
      console.error('Erro ao carregar dados:', err)
      setError(err.response?.data?.detail || 'Erro ao carregar dados')
    } finally {
      setLoading(false)
    }
  }

  // Agrupa por descrição
  const groupedExpenses: GroupedExpenses[] = (() => {
    // Filtra por termo de busca
    const filtered = expenses.filter(exp => 
      !searchTerm || exp.description.toLowerCase().includes(searchTerm.toLowerCase())
    )

    // Agrupa por descrição
    const grouped = filtered.reduce((acc, exp) => {
      const desc = exp.description
      if (!acc[desc]) {
        acc[desc] = { description: desc, items: [], totalAmount: 0, count: 0 }
      }
      acc[desc].items.push(exp)
      acc[desc].totalAmount += Number(exp.amount) || 0
      acc[desc].count++
      return acc
    }, {} as Record<string, GroupedExpenses>)

    // Filtra apenas grupos com 2+ items e ordena por quantidade
    return Object.values(grouped)
      .filter(g => g.count >= 2)
      .sort((a, b) => b.count - a.count)
  })()

  // Toggle expansão
  const toggleGroup = (description: string) => {
    const newExpanded = new Set(expandedGroups)
    if (newExpanded.has(description)) {
      newExpanded.delete(description)
    } else {
      newExpanded.add(description)
    }
    setExpandedGroups(newExpanded)
  }

  const expandAll = () => setExpandedGroups(new Set(groupedExpenses.map(g => g.description)))
  const collapseAll = () => setExpandedGroups(new Set())

  const clearFilters = () => {
    setSelectedSources([]) // Vazio = busca todas as fontes
    setStartDate(null)
    setEndDate(null)
    setSearchTerm('')
  }

  // Verifica se há filtros ativos
  const hasActiveFilters =
    selectedSources.length > 0 || // alguma fonte específica selecionada
    startDate !== null ||
    endDate !== null ||
    searchTerm !== ''

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        <div className="p-8">
          {/* Sticky Header + Filtros */}
          <div className="sticky top-0 z-30 bg-gray-50 dark:bg-gray-900 -mx-8 px-8 pt-0 pb-4">
            {/* Header */}
            <div className="mb-4 pt-2">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <Layers className="w-8 h-8" />
                Relatório por Grupo
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-2">
                Transações agrupadas por descrição (apenas grupos com 2+ itens)
              </p>
            </div>

            {/* Filtros - Layout Compacto */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 transition-all hover:border-color-primary hover:shadow-md">
            {/* Header: Título + Link Limpar Filtros */}
            <div className="flex items-center justify-between mb-3">
              {/* Título */}
              <h3 className="flex items-center gap-2 text-base font-bold text-gray-800 dark:text-gray-200">
                <Filter size={18} className="text-color-primary" />
                Filtros
              </h3>
              {/* Link Limpar */}
              <button
                onClick={clearFilters}
                className={`flex items-center gap-1.5 text-sm font-semibold transition-all ${hasActiveFilters ? 'opacity-100 hover:opacity-80' : 'opacity-0 pointer-events-none'}`}
                style={{ color: 'var(--color-1)' }}
              >
                <X size={14} />
                Limpar filtros
              </button>
            </div>

            {/* Linha 1: Filtros principais + Botão Aplicar */}
            <div className="flex items-end gap-3">
              <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Fonte */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Landmark size={12} className="inline mr-1 text-color-primary" />
                    Fonte
                  </label>
                  <SourceMultiSelectDropdown
                    options={SOURCE_OPTIONS}
                    selectedIds={selectedSources}
                    onChange={setSelectedSources}
                    placeholder="Selecione..."
                  />
                </div>

                {/* Data Início */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Calendar size={12} className="inline mr-1 text-color-primary" />
                    Data Início
                  </label>
                  <DatePicker
                    selected={startDate}
                    onChange={(date) => setStartDate(date)}
                    dateFormat="dd/MM/yyyy"
                    placeholderText="Selecione..."
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none"
                    isClearable
                  />
                </div>

                {/* Data Fim */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Calendar size={12} className="inline mr-1 text-color-primary" />
                    Data Fim
                  </label>
                  <DatePicker
                    selected={endDate}
                    onChange={(date) => setEndDate(date)}
                    dateFormat="dd/MM/yyyy"
                    placeholderText="Selecione..."
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none"
                    isClearable
                  />
                </div>
              </div>

              {/* Botão Aplicar - fixo no canto direito */}
              <div className="flex items-end flex-shrink-0">
                <button
                  onClick={loadData}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all hover:opacity-90"
                  style={{ backgroundColor: 'var(--crud-create)', color: 'var(--on-crud-create)' }}
                >
                  <Filter size={14} />
                  Aplicar
                </button>
              </div>
            </div>
          </div>

          {/* Barra de Busca - abaixo do card de filtros */}
          <div className="mt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="Buscar por descrição do grupo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X size={20} />
                </button>
              )}
            </div>
          </div>

          {/* Controles de Expansão */}
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={expandAll}
              className="px-3 py-2 text-xs font-medium border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Expandir Tudo
            </button>
            <button
              onClick={collapseAll}
              className="px-3 py-2 text-xs font-medium border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Recolher Tudo
            </button>
          </div>
          </div>
          {/* Fim do Sticky Header */}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center h-64">
              <LoadingSpinner message="Carregando..." />
            </div>
          )}

          {/* Erro */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Estado inicial */}
          {!loading && !error && expenses.length === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-full">
                  <Layers className="h-12 w-12 text-gray-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Selecione os filtros</h3>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Configure os filtros acima e clique em "Aplicar" para visualizar os grupos.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Grupos */}
          {!loading && !error && expenses.length > 0 && (
            <div className={`space-y-2 ${showBackToTop ? 'pb-20' : ''}`}>
              {groupedExpenses.length === 0 ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  Nenhum grupo encontrado com 2+ itens
                </div>
              ) : (
                <>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Encontrados <span className="font-semibold text-gray-900 dark:text-white">{groupedExpenses.length}</span> grupos
                  </div>
                  {groupedExpenses.map((group) => {
                    const isExpanded = expandedGroups.has(group.description)
                    const isNegative = group.totalAmount < 0

                    return (
                      <div
                        key={group.description}
                        className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
                      >
                        {/* Header do Grupo */}
                        <div
                          className="flex items-center p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                          onClick={() => toggleGroup(group.description)}
                        >
                          {/* Botão expansão */}
                          <button className="mr-3 text-gray-500 dark:text-gray-400">
                            {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                          </button>

                          {/* Ícone tipo */}
                          <div className="p-2 rounded-lg mr-3 bg-color-primary-light">
                            <Layers size={20} className="text-color-primary" />
                          </div>

                          {/* Descrição */}
                          <div className="flex-1">
                            <span className="font-semibold text-gray-900 dark:text-white">
                              {group.description}
                            </span>
                          </div>

                          {/* Contador */}
                          <div className="text-sm text-gray-500 dark:text-gray-400 mr-4">
                            <span className="font-medium">{group.count}</span> {group.count === 1 ? 'item' : 'itens'}
                          </div>

                          {/* Total */}
                          <div className={`text-lg font-bold ${isNegative ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                            {formatCurrency(group.totalAmount)}
                          </div>

                          {/* Botão Info */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              const stats = calculateGroupStats(group)
                              setGroupStatsModal({ isOpen: true, stats })
                            }}
                            className="p-1.5 ml-2 text-gray-400 hover:text-color-primary hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all"
                            title="Ver estatísticas do grupo"
                          >
                            <Info size={18} />
                          </button>
                        </div>

                        {/* Items expandidos */}
                        {isExpanded && (
                          <div className="bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
                            {/* Cabeçalho */}
                            <div className="grid grid-cols-[40px_50px_1fr_1.5fr_1fr_1fr_1fr_100px] gap-2 p-2.5 px-4 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">#</span>
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Origem</span>
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Data/Hora</span>
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Conta/Cartão</span>
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Tag/Subtag</span>
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Compartilhamento</span>
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider text-right">Valor</span>
                            </div>

                            {/* Linhas */}
                            <div className="divide-y divide-gray-200 dark:divide-gray-700">
                              {group.items
                                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                .map((item, index) => (
                                <div
                                  key={`${item.source}-${item.id}`}
                                  className="grid grid-cols-[40px_50px_1fr_1.5fr_1fr_1fr_1fr_100px] gap-2 p-2.5 px-4 border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm items-center"
                                  onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = 'var(--color-1)' }}
                                  onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = '' }}
                                >
                                  {/* Número */}
                                  <span className="font-medium text-gray-500 dark:text-gray-400">#{index + 1}</span>

                                  {/* Origem (ícone + manual se aplicável) */}
                                  <div className="flex items-center gap-1">
                                    {item.source === 'bank' && <Landmark size={16} style={{ color: 'var(--color-1)' }} />}
                                    {item.source === 'card' && <CreditCard size={16} style={{ color: 'var(--color-2)' }} />}
                                    {item.source === 'benefit' && <Gift size={16} style={{ color: 'var(--color-3)' }} />}
                                    {/* Mostra "M" apenas para bank_statements manuais (sem category) */}
                                    {item.source === 'bank' && item.category === null && (
                                      <span
                                        className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-orange-500 text-white shadow-sm"
                                        title="Lançamento Manual"
                                      >
                                        M
                                      </span>
                                    )}
                                  </div>

                                  {/* Data/Hora */}
                                  <span className="text-gray-700 dark:text-gray-300 text-xs">
                                    {formatDateTime(item.date)}
                                  </span>

                                  {/* Conta/Cartão */}
                                  <div className="text-gray-600 dark:text-gray-400 text-xs truncate">
                                    {item.source === 'card' || item.source === 'benefit' ? (
                                      <>
                                        {item.card_name || '-'}
                                        {item.card_number && <span className="text-gray-400"> • ***{item.card_number.slice(-4)}</span>}
                                      </>
                                    ) : (
                                      item.account_name || '-'
                                    )}
                                  </div>

                                  {/* Tag/Subtag */}
                                  <div className="text-gray-700 dark:text-gray-300 text-xs truncate">
                                    {item.tag_name || '-'}
                                    {item.subtag_name && <span className="text-gray-400"> / {item.subtag_name}</span>}
                                  </div>

                                  {/* Compartilhamento */}
                                  <div className="flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                                    <SharedAccountDisplay
                                      account={item.shared_partner_name ? {
                                        id: item.shared_partner_id || 0,
                                        name: item.shared_partner_name,
                                        bank: item.shared_partner_bank ? { name: item.shared_partner_bank } : null,
                                        agency: item.shared_partner_agency,
                                        account_number: item.shared_partner_account_number
                                      } : null}
                                      ownershipPercentage={item.ownership_percentage}
                                    />
                                  </div>

                                  {/* Valor */}
                                  <div className="text-right">
                                    <span className={`font-semibold ${item.amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                      {formatCurrency(item.amount)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal de Estatísticas do Grupo */}
      {groupStatsModal.isOpen && groupStatsModal.stats && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <BarChart3 size={20} className="text-color-primary" />
                Estatísticas do Grupo
              </h3>
              <button
                onClick={() => setGroupStatsModal({ isOpen: false, stats: null })}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Descrição do grupo */}
            <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate" title={groupStatsModal.stats.description}>
                {groupStatsModal.stats.description}
              </p>
            </div>

            <div className="space-y-4">
              {/* Período */}
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar size={16} className="text-color-primary" />
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Período</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">De:</span>
                    <p className="font-medium text-gray-900 dark:text-white">{formatDate(groupStatsModal.stats.periodStart)}</p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Até:</span>
                    <p className="font-medium text-gray-900 dark:text-white">{formatDate(groupStatsModal.stats.periodEnd)}</p>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Duração:</span>
                    <p className="font-medium text-gray-900 dark:text-white">{groupStatsModal.stats.periodDays} dias</p>
                  </div>
                </div>
              </div>

              {/* Valores */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">Total</span>
                  <p className={`text-lg font-bold ${groupStatsModal.stats.totalAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {formatCurrency(groupStatsModal.stats.totalAmount)}
                  </p>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">Média por Item</span>
                  <p className={`text-lg font-bold ${groupStatsModal.stats.avgAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {formatCurrency(groupStatsModal.stats.avgAmount)}
                  </p>
                </div>
              </div>

              {/* Min/Max */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">Menor Valor</span>
                  <p className={`font-semibold ${groupStatsModal.stats.minAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {formatCurrency(groupStatsModal.stats.minAmount)}
                  </p>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">Maior Valor</span>
                  <p className={`font-semibold ${groupStatsModal.stats.maxAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {formatCurrency(groupStatsModal.stats.maxAmount)}
                  </p>
                </div>
              </div>

              {/* Frequência e Intervalo */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">Frequência</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {groupStatsModal.stats.frequencyPerMonth.toFixed(1)}x <span className="text-sm font-normal text-gray-500">por mês</span>
                  </p>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">Intervalo Médio</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {groupStatsModal.stats.avgIntervalDays.toFixed(1)} <span className="text-sm font-normal text-gray-500">dias</span>
                  </p>
                </div>
              </div>

              {/* Tendência */}
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">Tendência</span>
                    <div className="flex items-center gap-2 mt-1">
                      {groupStatsModal.stats.trend === 'up' && (
                        <>
                          <TrendingUp size={20} className="text-red-500" />
                          <span className="font-semibold text-red-600 dark:text-red-400">Crescimento</span>
                        </>
                      )}
                      {groupStatsModal.stats.trend === 'down' && (
                        <>
                          <TrendingDown size={20} className="text-green-500" />
                          <span className="font-semibold text-green-600 dark:text-green-400">Declínio</span>
                        </>
                      )}
                      {groupStatsModal.stats.trend === 'stable' && (
                        <>
                          <Minus size={20} className="text-gray-500" />
                          <span className="font-semibold text-gray-600 dark:text-gray-400">Estável</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-xl font-bold ${
                      groupStatsModal.stats.trend === 'up' ? 'text-red-600 dark:text-red-400' :
                      groupStatsModal.stats.trend === 'down' ? 'text-green-600 dark:text-green-400' :
                      'text-gray-600 dark:text-gray-400'
                    }`}>
                      {groupStatsModal.stats.trendPercentage > 0 ? '+' : ''}{groupStatsModal.stats.trendPercentage.toFixed(1)}%
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">variação média</p>
                  </div>
                </div>
              </div>

              {/* Desvio Padrão */}
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">Desvio Padrão</span>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {formatCurrency(Math.abs(groupStatsModal.stats.stdDeviation))}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {groupStatsModal.stats.stdDeviation < Math.abs(groupStatsModal.stats.avgAmount) * 0.3
                    ? '✓ Valores consistentes'
                    : '⚠ Alta variação nos valores'}
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setGroupStatsModal({ isOpen: false, stats: null })}
                className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                style={{ backgroundColor: 'var(--crud-cancel)', color: 'var(--on-crud-cancel)' }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barra Flutuante Back to Top */}
      {showBackToTop && (
        <div className="fixed bottom-0 left-64 right-0 z-50 bg-white dark:bg-gray-800 border-t-2 border-color-primary shadow-[0_-4px_12px_rgba(0,0,0,0.15)] px-6 py-3">
          <div className="flex items-center justify-end">
            <button
              onClick={scrollToTop}
              className="px-3 py-1.5 bg-color-primary text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold"
              title="Voltar ao topo"
            >
              <ArrowUp size={14} />
              Voltar ao Topo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default GrupoPage
