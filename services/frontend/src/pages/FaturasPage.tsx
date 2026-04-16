import { useState, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import LoadingSpinner from '../components/LoadingSpinner'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import EditExpenseModal from '../components/EditExpenseModal'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { CreditCard, Calendar, FileText, Receipt, Filter, X, Search, Gift, ArrowDownCircle, ArrowUpCircle, Tag, Tags, Users, ArrowUp, Edit2 } from 'lucide-react'

// Interface para state de navegação
interface NavigationState {
  yearMonth?: string
  selectAllCards?: boolean
}

interface CreditCardOption {
  id: number
  name: string
  number: string
  type: string
}

interface TagOption {
  id: number
  name: string
  count?: number
}

interface SubtagOption {
  id: number
  name: string
  tag_id: number
  tag_name: string
  tag_type: string
  count?: number
}

interface Bank {
  id: number
  code: string
  name: string
}

interface SharedAccount {
  id: number
  name?: string
  description?: string
  bank?: Bank
  agency?: string
  account_number?: string
}

interface PartnerOption {
  id: number
  account_id: number
  shared_account_id: number
  my_contribution_percentage: number
  description?: string
  active: boolean
  shared_account?: SharedAccount
}

interface InvoiceItem {
  id: number
  date: string
  description: string
  amount: number
  subtag_id?: number | null
  tag_name?: string
  subtag_name?: string
  year_month: string
  card_id: number
  card_name: string
  card_number: string
  // Campos de compartilhamento
  shared_partner_id?: number | null
  shared_partner_name?: string
  shared_partner_bank?: string
  shared_partner_agency?: string
  shared_partner_account_number?: string
  ownership_percentage?: number
}

interface InvoiceData {
  items: InvoiceItem[]
}

const FaturasPage = () => {
  // Hook para ler navigation state
  const location = useLocation()
  const navigationState = location.state as NavigationState | null

  // Estados de filtros
  const [selectedCardIds, setSelectedCardIds] = useState<number[]>([])
  const [selectedYear, setSelectedYear] = useState<string>('')
  const [selectedMonth, setSelectedMonth] = useState<string>('')
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [selectedSubtagIds, setSelectedSubtagIds] = useState<number[]>([])
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<number[]>([])

  // Estados de busca
  const [searchTerm, setSearchTerm] = useState('')
  const [searchAmount, setSearchAmount] = useState('')

  // Flag para controlar se os filtros iniciais já foram aplicados
  const [initialFiltersApplied, setInitialFiltersApplied] = useState(false)
  // Flag para auto-aplicar filtros quando vindo da HomePage
  const [shouldAutoApply, setShouldAutoApply] = useState(false)

  // Estados de dados
  const [cards, setCards] = useState<CreditCardOption[]>([])
  const [cardsLoading, setCardsLoading] = useState(true)
  const [tagsLoading, setTagsLoading] = useState(true)
  const [subtagsLoading, setSubtagsLoading] = useState(true)
  const [partnersLoading, setPartnersLoading] = useState(true)
  const [tags, setTags] = useState<TagOption[]>([])
  const [subtags, setSubtags] = useState<SubtagOption[]>([])
  const [partners, setPartners] = useState<PartnerOption[]>([])
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Verifica se todos os filtros estão carregados
  const filtersLoading = cardsLoading || tagsLoading || subtagsLoading || partnersLoading

  // Estados de abas
  const [activeYear, setActiveYear] = useState<string>('')
  const [activeMonth, setActiveMonth] = useState<string>('')

  // Estados do modal de edição
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [itemToEdit, setItemToEdit] = useState<InvoiceItem | null>(null)

  // Estado para botão Back to Top
  const [showBackToTop, setShowBackToTop] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Ref para subtags originais
  const originalSubtagsRef = useRef<SubtagOption[]>([])

  // Gerar opções de anos e meses
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: 10 }, (_, i) => (currentYear - i).toString())
  const monthOptions = [
    { value: '01', label: 'Janeiro' },
    { value: '02', label: 'Fevereiro' },
    { value: '03', label: 'Março' },
    { value: '04', label: 'Abril' },
    { value: '05', label: 'Maio' },
    { value: '06', label: 'Junho' },
    { value: '07', label: 'Julho' },
    { value: '08', label: 'Agosto' },
    { value: '09', label: 'Setembro' },
    { value: '10', label: 'Outubro' },
    { value: '11', label: 'Novembro' },
    { value: '12', label: 'Dezembro' }
  ]

  // Filtra subtags baseado nas tags selecionadas (só mostra se tag selecionada)
  const filteredSubtags = useMemo(() => {
    if (selectedTagIds.length === 0) {
      return [] // Não mostra subtags se nenhuma tag está selecionada
    }
    return originalSubtagsRef.current.filter(s => selectedTagIds.includes(s.tag_id))
  }, [selectedTagIds, subtags])

  // Opções de compartilhamento ordenadas alfabeticamente com "(Vazio)" primeiro
  const partnerOptions = useMemo(() => {
    const options = partners
      .map(p => ({
        id: p.id,
        name: p.shared_account?.name || p.shared_account?.description || `Conta #${p.shared_account_id}`
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

    // Adiciona "(Vazio)" como primeira opção
    return [{ id: -1, name: '(Vazio)' }, ...options]
  }, [partners])

  // Carrega cartões ao montar
  useEffect(() => {
    loadCards()
  }, [])

  // Carrega tags
  useEffect(() => {
    const loadTags = async () => {
      setTagsLoading(true)
      try {
        const response = await axios.get('/api/reports/tags')
        setTags(response.data)
      } catch (error) {
        console.error('Erro ao carregar tags:', error)
      } finally {
        setTagsLoading(false)
      }
    }
    loadTags()
  }, [])

  // Carrega subtags
  useEffect(() => {
    const loadSubtags = async () => {
      setSubtagsLoading(true)
      try {
        const response = await axios.get('/api/reports/subtags')
        setSubtags(response.data)
        originalSubtagsRef.current = response.data
      } catch (error) {
        console.error('Erro ao carregar subtags:', error)
      } finally {
        setSubtagsLoading(false)
      }
    }
    loadSubtags()
  }, [])

  // Carrega parceiros
  useEffect(() => {
    const loadPartners = async () => {
      setPartnersLoading(true)
      try {
        const response = await axios.get('/api/expense-sharing/')
        setPartners(response.data)
      } catch (error) {
        console.error('Erro ao carregar parceiros:', error)
      } finally {
        setPartnersLoading(false)
      }
    }
    loadPartners()
  }, [])

  // Aplica filtros do navigation state (quando vindo da HomePage)
  useEffect(() => {
    if (navigationState && !initialFiltersApplied && cards.length > 0) {
      // Aplica ano/mês se fornecido
      if (navigationState.yearMonth) {
        const [year, month] = navigationState.yearMonth.split('-')
        setSelectedYear(year)
        setSelectedMonth(month)
        setActiveYear(year)
        setActiveMonth(navigationState.yearMonth)
      }
      // Seleciona todos os cartões se solicitado
      if (navigationState.selectAllCards) {
        setSelectedCardIds(cards.map(c => c.id))
      }
      setInitialFiltersApplied(true)
      // Marca que deve auto-aplicar os filtros
      setShouldAutoApply(true)

      // Limpa o state da navegação para evitar reaplicação
      window.history.replaceState({}, document.title)
    }
  }, [navigationState, initialFiltersApplied, cards])

  const loadCards = async () => {
    setCardsLoading(true)
    try {
      const response = await axios.get('/api/cartoes')
      setCards(response.data.map((c: any) => ({
        id: c.id,
        name: c.name || 'Sem nome',
        number: c.number,
        type: c.type || 'crédito'
      })))
    } catch (error) {
      console.error('Erro ao carregar cartões:', error)
    } finally {
      setCardsLoading(false)
    }
  }

  const loadInvoiceData = async () => {
    setLoading(true)
    setError(null)
    try {
      // Monta parâmetros de filtro
      const params: Record<string, string | undefined> = {}

      // Adiciona cartões se selecionados
      if (selectedCardIds.length > 0) {
        params.card_ids = selectedCardIds.join(',')
      }

      // Adiciona ano/mês se selecionados
      if (selectedYear) {
        params.year = selectedYear
      }
      if (selectedMonth) {
        params.month = selectedMonth
      }

      // Adiciona filtros de tags/subtags/parceiros
      if (selectedTagIds.length > 0) {
        params.tag_ids = selectedTagIds.join(',')
      }
      if (selectedSubtagIds.length > 0) {
        params.subtag_ids = selectedSubtagIds.join(',')
      }
      // Filtra parceiros: -1 = "(Vazio)" = include_empty_sharing
      const hasEmptySharing = selectedPartnerIds.includes(-1)
      const realPartnerIds = selectedPartnerIds.filter(id => id !== -1)
      if (realPartnerIds.length > 0) {
        params.partner_ids = realPartnerIds.join(',')
      }
      if (hasEmptySharing) {
        params.include_empty_sharing = 'true'
      }

      const response = await axios.get('/api/reports/invoices', { params })
      setInvoiceData(response.data)

      // Define ano e mês inicial para as abas
      if (response.data.items.length > 0) {
        const firstItem = response.data.items[0]
        const year = firstItem.year_month.split('-')[0]
        setActiveYear(year)
        setActiveMonth(firstItem.year_month)
      }
    } catch (error: any) {
      console.error('Erro ao carregar faturas:', error)
      // Trata erro de validação do Pydantic (array de objetos)
      const detail = error.response?.data?.detail
      if (Array.isArray(detail)) {
        setError(detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join(', '))
      } else if (typeof detail === 'string') {
        setError(detail)
      } else {
        setError('Erro ao carregar faturas')
      }
    } finally {
      setLoading(false)
    }
  }

  // Auto-aplica filtros quando vindo da HomePage
  useEffect(() => {
    if (shouldAutoApply) {
      setShouldAutoApply(false)
      loadInvoiceData()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoApply])

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
  }, [invoiceData])

  // Função para voltar ao topo
  const scrollToTop = () => {
    setShowBackToTop(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const clearFilters = () => {
    setSelectedCardIds([])
    setSelectedYear('')
    setSelectedMonth('')
    setSelectedTagIds([])
    setSelectedSubtagIds([])
    setSelectedPartnerIds([])
    setSearchTerm('')
    setSearchAmount('')
    setInvoiceData(null)
  }

  // Verifica se há filtros ativos
  const hasActiveFilters = selectedCardIds.length > 0 || selectedYear !== '' || selectedMonth !== '' ||
    selectedTagIds.length > 0 || selectedSubtagIds.length > 0 || selectedPartnerIds.length > 0 ||
    searchTerm !== '' || searchAmount !== ''

  const handleEdit = (item: InvoiceItem) => {
    setItemToEdit(item)
    setIsEditModalOpen(true)
  }

  const handleEditSuccess = () => {
    loadInvoiceData()
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('pt-BR')
  }

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = date.getFullYear()
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${day}/${month}/${year} ${hours}:${minutes}`
  }

  // Mostra loading inicial enquanto os filtros estão carregando
  if (filtersLoading) {
    return (
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <LoadingSpinner fullScreen message="Carregando filtros..." />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        <div className="p-8">
          {/* Sticky Header + Filtros */}
          <div className="sticky top-0 z-30 bg-gray-50 dark:bg-gray-900 -mx-8 px-8 pt-0 pb-4">
            {/* Header */}
            <div className="mb-4 pt-2">
              <div className="flex items-center gap-3 mb-2">
                <FileText size={32} className="text-color-primary" />
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                  Relatório de Faturas
                </h1>
              </div>
              <p className="text-gray-600 dark:text-gray-400">
                Visualize e analise suas faturas de cartão de crédito consolidadas
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
            <div className="flex flex-col lg:flex-row gap-3">
              {/* Grid de Filtros - ocupa o espaço disponível */}
              <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {/* Cartões */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <CreditCard size={12} className="inline mr-1 text-color-primary" />
                    Cartões
                  </label>
                  <MultiSelectDropdown
                    label="Cartões"
                    options={cards.map(c => ({
                      id: c.id,
                      name: `${c.name} • ${c.number}`,
                      icon: c.type === 'beneficios' ? <Gift size={14} /> : <CreditCard size={14} />,
                      color: c.type === 'beneficios' ? 'var(--color-3)' : 'var(--color-2)'
                    }))}
                    selectedIds={selectedCardIds}
                    onChange={setSelectedCardIds}
                    placeholder="Selecione..."
                  />
                </div>

                {/* Ano */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Calendar size={12} className="inline mr-1 text-color-primary" />
                    Ano
                  </label>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="w-full px-2 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:border-color-primary focus:outline-none transition-all"
                  >
                    <option value="">Selecione...</option>
                    {yearOptions.map(year => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>

                {/* Mês */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Calendar size={12} className="inline mr-1 text-color-primary" />
                    Mês
                  </label>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-full px-2 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:border-color-primary focus:outline-none transition-all"
                  >
                    <option value="">Selecione...</option>
                    {monthOptions.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                {/* Tag */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Tag size={12} className="inline mr-1 text-color-primary" />
                    Tag
                  </label>
                  <MultiSelectDropdown
                    label="Tag"
                    options={tags}
                    selectedIds={selectedTagIds}
                    onChange={setSelectedTagIds}
                    placeholder="Selecione..."
                  />
                </div>

                {/* Subtag */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Tags size={12} className="inline mr-1 text-color-primary" />
                    Subtag
                  </label>
                  <MultiSelectDropdown
                    label="Subtag"
                    options={filteredSubtags}
                    selectedIds={selectedSubtagIds}
                    onChange={setSelectedSubtagIds}
                    placeholder="Selecione..."
                  />
                </div>

                {/* Compartilhamento */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Users size={12} className="inline mr-1 text-color-primary" />
                    Compartilhamento
                  </label>
                  <MultiSelectDropdown
                    label="Compartilhamento"
                    options={partnerOptions}
                    selectedIds={selectedPartnerIds}
                    onChange={setSelectedPartnerIds}
                    placeholder="Selecione..."
                    icon={<Users size={14} className="text-gray-500" />}
                  />
                </div>
              </div>

              {/* Botão Aplicar - fixo no canto direito */}
              <div className="flex items-end flex-shrink-0">
                <button
                  onClick={loadInvoiceData}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all hover:opacity-90"
                  style={{ backgroundColor: 'var(--crud-create)', color: 'var(--on-crud-create)' }}
                >
                  <Filter size={14} />
                  Aplicar
                </button>
              </div>
            </div>
          </div>

          {/* Barra de Busca - 2 campos lado a lado */}
          <div className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Busca por Descrição */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text"
                  placeholder="Buscar por descrição..."
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

              {/* Busca por Valor Exato */}
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 font-semibold text-sm">R$</span>
                <input
                  type="text"
                  placeholder="Buscar por valor exato (ex: 109,70)..."
                  value={searchAmount}
                  onChange={(e) => setSearchAmount(e.target.value)}
                  className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none"
                />
                {searchAmount && (
                  <button
                    onClick={() => setSearchAmount('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <X size={20} />
                  </button>
                )}
              </div>
            </div>
          </div>
          </div>
          {/* Fim do Sticky Header */}

          {/* Loading */}
          {loading && (
            <div className="flex justify-center items-center py-12">
              <LoadingSpinner message="Carregando faturas..." />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {/* Estado Inicial */}
          {!loading && !error && !invoiceData && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-full">
                  <Receipt className="h-12 w-12 text-gray-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Selecione os filtros</h3>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Configure os filtros acima e clique em "Aplicar" para visualizar as faturas.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Conteúdo com Abas */}
          {!loading && !error && invoiceData && invoiceData.items.length > 0 && (
            <div className={`${showBackToTop ? 'pb-20' : ''}`}>
          {(() => {
            // Filtra itens por busca de texto e valor
            const filteredItems = invoiceData.items.filter(item => {
              // Filtro de texto
              const matchesText = !searchTerm || item.description.toLowerCase().includes(searchTerm.toLowerCase())

              // Filtro de valor
              let matchesAmount = true
              if (searchAmount && searchAmount.trim() !== '') {
                const normalizedSearch = searchAmount.trim().replace(',', '.')
                const searchValue = parseFloat(normalizedSearch)
                if (!isNaN(searchValue)) {
                  matchesAmount = Math.abs(Math.abs(item.amount) - searchValue) < 0.01
                }
              }

              return matchesText && matchesAmount
            })

            // Agrupa itens por year_month
            const groupedByMonth = filteredItems.reduce((acc, item) => {
              const month = item.year_month || 'Sem mês'
              if (!acc[month]) acc[month] = []
              acc[month].push(item)
              return acc
            }, {} as Record<string, InvoiceItem[]>)

            // Ordena os meses cronologicamente (do mais novo para o mais antigo)
            const sortedMonths = Object.keys(groupedByMonth).sort((a, b) => {
              if (a === 'Sem mês') return 1
              if (b === 'Sem mês') return -1
              return b.localeCompare(a)
            })

            // Agrupa meses por ano
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

            // Lista de anos ordenados (do mais novo para o mais antigo)
            const sortedYears = Object.keys(groupedByYear).sort((a, b) => {
              if (a === 'Sem ano') return 1
              if (b === 'Sem ano') return -1
              return b.localeCompare(a)
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

            // Itens do mês ativo
            const currentItems = activeMonth ? (groupedByMonth[activeMonth] || []) : []

            // Agrupa itens por cartão
            const groupedByCard = currentItems.reduce((acc, item) => {
              const cardKey = `${item.card_name}|${item.card_number}`
              if (!acc[cardKey]) acc[cardKey] = []
              acc[cardKey].push(item)
              return acc
            }, {} as Record<string, InvoiceItem[]>)

            // Ordena grupos de cartão por número
            const sortedCardGroups = Object.entries(groupedByCard)
              .map(([cardKey, items]) => {
                const [cardName] = cardKey.split('|')
                const cardNumber = items[0]?.card_number || ''
                return { cardName, cardNumber, items }
              })
              .sort((a, b) => {
                return (a.cardNumber || '').localeCompare(b.cardNumber || '', 'pt-BR')
              })

            // Total geral do mês
            const totalAmount = currentItems.reduce((sum, item) => sum + Number(item.amount), 0)

            // Total geral (todos os itens filtrados)
            const totalAllItems = filteredItems.reduce((sum, item) => sum + Number(item.amount), 0)

            return (
              <>
                {/* Cards de Resumo - Compactos */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  {/* Total Geral */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <ArrowDownCircle className={`w-5 h-5 ${totalAllItems < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`} />
                        <div>
                          <p className="text-xs text-gray-600 dark:text-gray-400">Total Período</p>
                          <p className={`text-lg font-bold ${totalAllItems < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                            {formatCurrency(totalAllItems)}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-500">
                        {filteredItems.length} trans.
                      </span>
                    </div>
                  </div>

                  {/* Total do Mês Selecionado */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CreditCard className={`w-5 h-5 ${totalAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`} />
                        <div>
                          <p className="text-xs text-gray-600 dark:text-gray-400">Mês Selecionado</p>
                          <p className={`text-lg font-bold ${totalAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                            {formatCurrency(totalAmount)}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-500">
                        {currentItems.length} trans.
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card de Abas - Separado */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-4">
                  {/* Linha 1: Abas de Anos */}
                  <div className="flex border-b border-gray-200 dark:border-gray-700 px-6 overflow-x-auto bg-gray-100 dark:bg-gray-800 rounded-t-xl">
                    {sortedYears.map(year => {
                      const totalItemsInYear = groupedByYear[year].reduce((sum, month) => sum + groupedByMonth[month].length, 0)
                      return (
                        <button
                          key={year}
                          onClick={() => {
                            setActiveYear(year)
                            const firstMonth = groupedByYear[year]?.[0]
                            if (firstMonth) setActiveMonth(firstMonth)
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
                  <div className="flex px-6 bg-gray-50 dark:bg-gray-700 rounded-b-xl">
                    {monthsOfActiveYear.map(month => (
                      <button
                        key={month}
                        onClick={() => setActiveMonth(month)}
                        className={`flex-1 px-2 py-2.5 text-sm font-semibold transition-all whitespace-nowrap text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white ${
                          activeMonth === month
                            ? 'border-b-2 border-color-secondary'
                            : 'border-b-2 border-transparent'
                        }`}
                      >
                        {formatMonthOnly(month)} <span className="text-xs font-normal opacity-60">({groupedByMonth[month].length})</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cards de Cartões - Separados e com scroll pela página */}
                <div className="space-y-8">
                  {sortedCardGroups.map(({ cardName, cardNumber, items }, cardIndex) => {
                    const cardTotal = items.reduce((sum, item) => sum + Number(item.amount), 0)
                    // Intercalar cores 1-5 para os headers dos cartões
                    const colorIndex = (cardIndex % 5) + 1

                    return (
                      <div key={`${cardName}-${cardNumber}`} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                        {/* Header do Cartão - Com cor intercalada */}
                        <div
                          className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700"
                          style={{
                            backgroundColor: `var(--color-${colorIndex})`,
                            color: `var(--on-color-${colorIndex})`
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <CreditCard size={20} />
                            <span className="font-bold text-lg">
                              {cardName} {cardNumber ? `*** ${cardNumber.slice(-4)}` : ''}
                            </span>
                            <span className="text-xs opacity-80">
                              ({items.length} transações)
                            </span>
                          </div>
                          <span className="text-xl font-bold">
                            {formatCurrency(cardTotal)}
                          </span>
                        </div>

                        {/* Tabela de Itens */}
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50 dark:bg-gray-700/30">
                              <tr>
                                <th className="px-3 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 w-12">#</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 w-28">Data</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300">Descrição</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 w-48">Tag/Subtag</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 w-40">Compartilhamento</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 w-32">Valor</th>
                                <th className="px-3 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 w-16">Ações</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                              {items.map((item, idx) => (
                                <tr
                                  key={item.id}
                                  className={`border-l-4 border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all ${idx % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50/50 dark:bg-gray-700/20'}`}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.borderLeftColor = ''
                                  }}
                                >
                                  <td className="px-3 py-2.5 text-sm text-center text-gray-500 dark:text-gray-400 w-12">
                                    {idx + 1}
                                  </td>
                                  <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white whitespace-nowrap w-28">
                                    {formatDate(item.date)}
                                  </td>
                                  <td className="px-4 py-2.5 text-sm text-gray-900 dark:text-white">
                                    {item.description}
                                  </td>
                                  <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 w-48">
                                    {item.tag_name && item.subtag_name
                                      ? `${item.tag_name} > ${item.subtag_name}`
                                      : item.tag_name || '-'}
                                  </td>
                                  <td className="px-4 py-2.5 text-sm text-left w-40">
                                    <SharedAccountDisplay
                                      account={item.shared_partner_name ? {
                                        id: 0,
                                        name: item.shared_partner_name,
                                        bank: item.shared_partner_bank ? { name: item.shared_partner_bank } : null,
                                        agency: item.shared_partner_agency,
                                        account_number: item.shared_partner_account_number
                                      } : null}
                                      ownershipPercentage={item.ownership_percentage}
                                    />
                                  </td>
                                  <td className={`px-4 py-2.5 text-sm text-right font-semibold w-32 ${Number(item.amount) < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                    {formatCurrency(Number(item.amount))}
                                  </td>
                                  <td className="px-3 py-2.5 text-center w-16">
                                    <button
                                      onClick={() => handleEdit(item)}
                                      className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors"
                                      title="Editar tag/subtag e compartilhamento"
                                    >
                                      <Edit2 size={15} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Card de Total do Mês */}
                <div className="mt-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold text-gray-900 dark:text-white">Total do Mês</span>
                    <span className={`text-2xl font-bold ${totalAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      {formatCurrency(totalAmount)}
                    </span>
                  </div>
                </div>
              </>
            )
          })()}
            </div>
          )}
        </div>
      </div>

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

      {/* Modal de Edição */}
      <EditExpenseModal
        isOpen={isEditModalOpen}
        onClose={() => { setIsEditModalOpen(false); setItemToEdit(null) }}
        limitedMode={true}
        expense={itemToEdit ? {
          id: itemToEdit.id,
          source: 'card',
          description: itemToEdit.description,
          amount: Number(itemToEdit.amount),
          date: itemToEdit.date,
          subtag_id: itemToEdit.subtag_id ?? null,
          subtag_name: itemToEdit.subtag_name ?? null,
          category: null,
          card_number: itemToEdit.card_number,
          ownership_percentage: itemToEdit.ownership_percentage ?? null,
          shared_partner_id: itemToEdit.shared_partner_id ?? null
        } : null}
        onSuccess={handleEditSuccess}
      />
    </div>
  )
}

export default FaturasPage

