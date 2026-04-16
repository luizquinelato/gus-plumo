import { useState, useEffect, useRef, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import LoadingSpinner from '../components/LoadingSpinner'
import SplitExpenseModal from '../components/SplitExpenseModal'
import EditExpenseModal from '../components/EditExpenseModal'
import BatchEditExpenseModal from '../components/BatchEditExpenseModal'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import { MultiSelectDropdown, SourceMultiSelectDropdown } from '../components/MultiSelectDropdown'
import { FileText, Edit2, Trash2, Split, ArrowDownCircle, ArrowUpCircle, Search, X, Filter, Calendar, Landmark, CreditCard, Gift, ArrowUpDown, ArrowUp, ArrowDown, CheckSquare, Square, MinusSquare, Database, Tag, Tags, Users, TrendingUp, BarChart3, Download, Wallet, PlusCircle, ArrowLeftRight, Building2, AlertTriangle, ArrowRight } from 'lucide-react'
import 'react-datepicker/dist/react-datepicker.css'
import '../styles/datepicker-custom.css'
import { useConfirm } from '../hooks/useConfirm'
import { dateToLocalString } from '../utils/dateUtils'
import ExportModal from '../components/ExportModal'
import SendToLoanModal from '../components/SendToLoanModal'
import ManualTransactionModal from '../components/ManualTransactionModal'
import Toast from '../components/Toast'
// import { formatAccountDisplay } from '../utils/accountFormatter'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

// Interface para state de navegação
interface NavigationState {
  startDate?: string
  endDate?: string
  sources?: string[]
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
  tag_type: string  // "receita" ou "despesa"
  count?: number
  icon?: React.ReactNode
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

interface ExpenseDetail {
  id: number
  date: string
  description: string
  amount: number
  source: string
  card_number: string | null
  card_name: string | null
  category: string | null
  subtag_id: number | null
  subtag_name: string | null
  tag_name: string | null
  current_installment: number | null
  total_installments: number | null
  adjustment_type: string | null
  ownership_percentage: number | null
  expense_sharing_id: number | null  // ID da configuração de compartilhamento
  shared_partner_id: number | null  // ID da conta parceira (destino da inversão)
  shared_partner_name: string | null
  shared_partner_bank: string | null
  shared_partner_agency: string | null
  shared_partner_account_number: string | null
  account_id: number | null
  account_name: string | null
  bank_code: string | null
  bank_name: string | null
  account_agency: string | null
  account_number: string | null
  year_month: string | null  // Ano/mês da fatura (YYYY-MM) - usado apenas para faturas de cartão
  migrated_from_account_id: number | null  // ID da conta de origem - indica item invertido/migrado
}

interface DetailedReport {
  total_amount: number
  total_count: number
  total_income: number
  total_income_count: number
  total_expenses: number
  total_expenses_count: number
  expenses_trend: 'up' | 'down' | 'stable' | null
  income_trend: 'up' | 'down' | 'stable' | null
  expenses: ExpenseDetail[]
}

interface MonthlyData {
  year: number
  month: number
  year_month: string
  total: number
  count: number
  income: number
  expenses: number
}

interface DailyData {
  date: string
  total: number
  count: number
  income: number
  expenses: number
}

interface TimeSeriesData {
  data: (MonthlyData | DailyData)[]
  total_amount: number
  total_count: number
  total_income: number
  total_income_count: number
  total_expenses: number
  total_expenses_count: number
  start_date: string
  end_date: string
  granularity: 'monthly' | 'daily'
}

// Opções de fonte de dados para o dropdown
const SOURCE_OPTIONS = [
  { id: 'bank', name: 'Extratos Bancários', icon: <Landmark size={14} />, color: 'var(--color-1)' },
  { id: 'card', name: 'Faturas de Cartão', icon: <CreditCard size={14} />, color: 'var(--color-2)' },
  { id: 'benefit', name: 'Cartões de Benefícios', icon: <Gift size={14} />, color: 'var(--color-3)' }
]

// Opções de origem para o dropdown
const ORIGIN_OPTIONS = [
  { id: 'manual', name: 'Manual', icon: <PlusCircle size={14} />, color: 'var(--color-5)' },
  { id: 'inverted', name: 'Invertido', icon: <ArrowLeftRight size={14} />, color: 'var(--color-4)' }
]

const ExtratoPage = () => {
  // Hook para ler navigation state
  const location = useLocation()
  const navigationState = location.state as NavigationState | null

  // Estados de filtros
  // Fonte de dados - agora como array de IDs selecionados (vazio = busca todas as fontes)
  const [selectedSources, setSelectedSources] = useState<string[]>([])

  // Origem (manual/invertido) - array de IDs selecionados (vazio = busca todas as origens)
  const [selectedOrigins, setSelectedOrigins] = useState<string[]>([])

  // Compatibilidade com código existente (vazio = todas as fontes)
  const sourceBankStatements = selectedSources.length === 0 || selectedSources.includes('bank')
  const sourceCardInvoices = selectedSources.length === 0 || selectedSources.includes('card')
  const sourceBenefits = selectedSources.length === 0 || selectedSources.includes('benefit')

  // Inicializa sem filtro de data (null = sem filtro, carrega tudo)
  const [startDate, setStartDate] = useState<Date | null>(null)
  const [endDate, setEndDate] = useState<Date | null>(null)
  const [selectedCardIds, setSelectedCardIds] = useState<number[]>([])
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<number[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [selectedSubtagIds, setSelectedSubtagIds] = useState<number[]>([])
  const [selectedTransactionType, setSelectedTransactionType] = useState<'all' | 'despesa' | 'receita'>('all')
  const [appliedTransactionType, setAppliedTransactionType] = useState<'all' | 'despesa' | 'receita'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [searchAmount, setSearchAmount] = useState('')

  // Flag para controlar se os filtros iniciais já foram aplicados
  const [initialFiltersApplied, setInitialFiltersApplied] = useState(false)
  // Flag para auto-aplicar filtros quando vindo da HomePage
  const [shouldAutoApply, setShouldAutoApply] = useState(false)

  // Estados de dados
  const [detailedReport, setDetailedReport] = useState<DetailedReport | null>(null)
  const [timeSeriesData, setTimeSeriesData] = useState<TimeSeriesData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cards, setCards] = useState<any[]>([])
  const [cardsLoading, setCardsLoading] = useState(true)
  const [partners, setPartners] = useState<PartnerOption[]>([])
  const [partnersLoading, setPartnersLoading] = useState(true)
  const [tags, setTags] = useState<TagOption[]>([])
  const [tagsLoading, setTagsLoading] = useState(true)
  const [subtags, setSubtags] = useState<SubtagOption[]>([])
  const [subtagsLoading, setSubtagsLoading] = useState(true)
  const [subtagsLoaded, setSubtagsLoaded] = useState(false)

  // Verifica se todos os filtros estão carregados
  const filtersLoading = cardsLoading || partnersLoading || tagsLoading || subtagsLoading

  // Estado da aba ativa (extrato ou gráficos)
  const [activeTab, setActiveTab] = useState<'extrato' | 'graficos'>('extrato')

  // Estados de modais
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false)
  const [expenseToSplit, setExpenseToSplit] = useState<any>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [expenseToEdit, setExpenseToEdit] = useState<any>(null)
  const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false)
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const [isLoanModalOpen, setIsLoanModalOpen] = useState(false)
  const [expenseToLoan, setExpenseToLoan] = useState<any>(null)
  const [isManualTransactionModalOpen, setIsManualTransactionModalOpen] = useState(false)

  // Modal unificado de inversão (individual ou batch)
  const [isInvertModalOpen, setIsInvertModalOpen] = useState(false)
  const [invertItems, setInvertItems] = useState<ExpenseDetail[]>([])  // Itens a inverter (1 ou mais)
  const [invertLoading, setInvertLoading] = useState(false)

  // Estados de seleção em lote
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set()) // "source:id" format
  const [selectionType, setSelectionType] = useState<'despesa' | 'receita' | null>(null)

  // Estados de paginação
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(100)

  // Estados de ordenação
  const [sortField, setSortField] = useState<string | null>('date')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  // Estado para botão Back to Top
  const [showBackToTop, setShowBackToTop] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Estados de UI
  // (showFilters removido - filtros agora sempre visíveis)
  const [showToast, setShowToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')

  // Hooks
  const { showConfirm, ConfirmComponent } = useConfirm()

  // Aplica filtros do navigation state (quando vindo da HomePage)
  useEffect(() => {
    if (navigationState && !initialFiltersApplied) {
      // Aplica datas se fornecidas
      if (navigationState.startDate) {
        setStartDate(new Date(navigationState.startDate))
      }
      if (navigationState.endDate) {
        setEndDate(new Date(navigationState.endDate))
      }
      // Aplica fontes se fornecidas
      if (navigationState.sources && navigationState.sources.length > 0) {
        setSelectedSources(navigationState.sources)
      }
      setInitialFiltersApplied(true)
      // Marca que deve auto-aplicar os filtros
      setShouldAutoApply(true)

      // Limpa o state da navegação para evitar reaplicação
      window.history.replaceState({}, document.title)
    }
  }, [navigationState, initialFiltersApplied])

  // Ref para armazenar subtags originais (sem count)
  const originalSubtagsRef = useRef<SubtagOption[]>([])

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
        // Armazena subtags originais na ref
        originalSubtagsRef.current = response.data
        setSubtagsLoaded(true)
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

  // Atualiza count de tags e subtags baseado nos resultados filtrados
  useEffect(() => {
    if (!detailedReport || !detailedReport.expenses || detailedReport.expenses.length === 0) {
      // Se não há resultados, reseta os counts para 0
      setTags(prevTags =>
        prevTags.map(tag => ({
          ...tag,
          count: 0
        }))
      )
      setSubtags(prevSubtags =>
        prevSubtags.map(subtag => ({
          ...subtag,
          count: 0
        }))
      )
      return
    }

    // Aguarda subtags serem carregadas
    if (!subtagsLoaded || originalSubtagsRef.current.length === 0) {
      return
    }

    // Calcula count para cada tag
    const tagCounts = new Map<number, number>()
    const subtagCounts = new Map<number, number>()

    detailedReport.expenses.forEach(expense => {
      if (expense.subtag_id) {
        // Incrementa count da subtag
        subtagCounts.set(expense.subtag_id, (subtagCounts.get(expense.subtag_id) || 0) + 1)

        // Encontra a tag da subtag e incrementa count da tag
        // Usa originalSubtagsRef para evitar dependência circular
        const subtagData = originalSubtagsRef.current.find(s => s.id === expense.subtag_id)
        if (subtagData) {
          tagCounts.set(subtagData.tag_id, (tagCounts.get(subtagData.tag_id) || 0) + 1)
        }
      }
    })

    // Atualiza tags com count
    setTags(prevTags =>
      prevTags.map(tag => ({
        ...tag,
        count: tagCounts.get(tag.id) || 0
      }))
    )

    // Atualiza subtags com count
    setSubtags(prevSubtags =>
      prevSubtags.map(subtag => ({
        ...subtag,
        count: subtagCounts.get(subtag.id) || 0
      }))
    )
  }, [detailedReport, subtagsLoaded])



  // Carrega cartões
  useEffect(() => {
    const loadCards = async () => {
      setCardsLoading(true)
      try {
        const response = await axios.get('/api/cartoes/')
        setCards(response.data)
      } catch (error) {
        console.error('Erro ao carregar cartões:', error)
      } finally {
        setCardsLoading(false)
      }
    }
    loadCards()
  }, [])

  // Removido: useEffect de filtro automático
  // Agora o usuário deve clicar em "Aplicar" para carregar os dados

  const loadDetailedReport = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()

      // Determina as fontes selecionadas
      const sources = []
      if (sourceBankStatements) sources.push('bank')
      if (sourceCardInvoices) sources.push('cards')
      if (sourceBenefits) sources.push('benefits')

      if (sources.length === 0) {
        // Não mostra erro, apenas limpa os dados
        setDetailedReport(null)
        setLoading(false)
        return
      }

      params.append('source', sources.join(','))

      // Apenas envia datas se ambas estiverem definidas
      if (startDate && endDate) {
        const startDateStr = dateToLocalString(startDate)
        const endDateStr = dateToLocalString(endDate)
        console.log('📅 Filtro de datas:', { startDate, endDate, startDateStr, endDateStr })
        params.append('start_date', startDateStr)
        params.append('end_date', endDateStr)
      }

      params.append('limit', '10000')

      // Trata opção "Vazio" (id=-1) para tags
      const hasEmptyTag = selectedTagIds.includes(-1)
      const realTagIds = selectedTagIds.filter(id => id !== -1)
      if (hasEmptyTag) params.append('include_empty_tag', 'true')
      if (realTagIds.length > 0) params.append('tag_ids', realTagIds.join(','))

      if (selectedSubtagIds.length > 0) params.append('subtag_ids', selectedSubtagIds.join(','))

      // Trata opção "Vazio" (id=-1) para compartilhamento
      const hasEmptySharing = selectedPartnerIds.includes(-1)
      const realPartnerIds = selectedPartnerIds.filter(id => id !== -1)
      if (hasEmptySharing) params.append('include_empty_sharing', 'true')
      if (realPartnerIds.length > 0) params.append('partner_ids', realPartnerIds.join(','))

      if (selectedCardIds.length > 0) params.append('card_ids', selectedCardIds.join(','))

      // Filtro de origem (manual/invertido)
      if (selectedOrigins.length > 0) params.append('origin', selectedOrigins.join(','))

      const url = `/api/reports/detailed?${params}`

      const response = await axios.get(url)

      setDetailedReport(response.data)
      setCurrentPage(1)
    } catch (error: any) {
      console.error('Erro ao carregar relatório detalhado:', error)
      const errorMessage = error.response?.data?.detail || error.message || 'Erro desconhecido ao carregar dados'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const loadTimeSeriesData = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()

      // Determina as fontes selecionadas
      const sources = []
      if (sourceBankStatements) sources.push('bank')
      if (sourceCardInvoices) sources.push('cards')
      if (sourceBenefits) sources.push('benefits')

      if (sources.length === 0) {
        setTimeSeriesData(null)
        setLoading(false)
        return
      }

      // Mapeia para o formato esperado pela API
      if (sources.length === 3 || sources.length === 0) {
        params.append('source', 'combined')
      } else if (sources.includes('bank') && !sources.includes('cards')) {
        params.append('source', 'bank')
      } else if (sources.includes('cards') && !sources.includes('bank')) {
        params.append('source', 'cards')
      } else {
        params.append('source', 'combined')
      }

      // Apenas envia datas se ambas estiverem definidas (mesmo comportamento do Extrato)
      if (startDate && endDate) {
        params.append('start_date', dateToLocalString(startDate))
        params.append('end_date', dateToLocalString(endDate))
      }
      // Se não tiver datas, não envia filtro → backend retorna todos os dados

      // Filtros opcionais - Trata opção "Vazio" (id=-1) para tags
      const hasEmptyTag = selectedTagIds.includes(-1)
      const realTagIds = selectedTagIds.filter(id => id !== -1)
      if (hasEmptyTag) params.append('include_empty_tag', 'true')
      if (realTagIds.length > 0) params.append('tag_ids', realTagIds.join(','))

      if (selectedSubtagIds.length > 0) params.append('subtag_ids', selectedSubtagIds.join(','))

      // Trata opção "Vazio" (id=-1) para compartilhamento
      const hasEmptySharing = selectedPartnerIds.includes(-1)
      const realPartnerIds = selectedPartnerIds.filter(id => id !== -1)
      if (hasEmptySharing) params.append('include_empty_sharing', 'true')
      if (realPartnerIds.length > 0) params.append('partner_ids', realPartnerIds.join(','))

      const response = await axios.get(`/api/reports/time-series?${params}`)
      setTimeSeriesData(response.data)
    } catch (error: any) {
      console.error('Erro ao carregar dados de gráfico:', error)
      const errorMessage = error.response?.data?.detail || error.message || 'Erro ao carregar gráficos'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  // Função para aplicar filtros - carrega dados de ambas as abas
  const handleApplyFilters = () => {
    setAppliedTransactionType(selectedTransactionType)
    loadDetailedReport()
    loadTimeSeriesData()
  }

  // Auto-aplica filtros quando vindo da HomePage
  useEffect(() => {
    if (shouldAutoApply) {
      setShouldAutoApply(false)
      handleApplyFilters()
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
  }, [detailedReport])

  // Função para voltar ao topo
  const scrollToTop = () => {
    setShowBackToTop(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const clearFilters = () => {
    // Limpa todos os filtros (incluindo datas e fontes)
    setSelectedSources([]) // Vazio = busca todas as fontes
    setSelectedOrigins([]) // Vazio = busca todas as origens
    setStartDate(null)
    setEndDate(null)
    setSelectedCardIds([])
    setSelectedPartnerIds([])
    setSelectedTagIds([])
    setSelectedSubtagIds([])
    setSelectedTransactionType('all')
    setAppliedTransactionType('all')
    setSearchTerm('')
    setSearchAmount('')
  }

  const handleEdit = (expense: ExpenseDetail) => {
    setExpenseToEdit(expense)
    setIsEditModalOpen(true)
  }

  const handleSplit = (expense: ExpenseDetail) => {
    setExpenseToSplit(expense)
    setIsSplitModalOpen(true)
  }

  const handleShowToast = (message: string, type: 'success' | 'error') => {
    setToastMessage(message)
    setToastType(type)
    setShowToast(true)
  }

  const handleDelete = async (expense: ExpenseDetail) => {
    showConfirm(
      'Deletar Despesa',
      'Tem certeza que deseja excluir esta despesa? Esta ação não pode ser desfeita.',
      async () => {
        try {
          let endpoint = ''
          if (expense.source === 'bank') {
            endpoint = `/api/expenses/bank-statements/${expense.id}`
          } else if (expense.source === 'card') {
            endpoint = `/api/expenses/credit-card-invoices/${expense.id}`
          } else if (expense.source === 'benefit') {
            endpoint = `/api/benefit-card-statements/${expense.id}`
          }

          await axios.delete(endpoint)
          handleShowToast('Despesa excluída com sucesso!', 'success')
          loadDetailedReport()
        } catch (error) {
          console.error('Erro ao excluir despesa:', error)
          handleShowToast('Erro ao excluir despesa', 'error')
        }
      },
      'Deletar',
      'Cancelar'
    )
  }

  const handleEditSuccess = () => {
    loadDetailedReport()
  }

  const handleSplitSuccess = () => {
    loadDetailedReport()
  }

  const handleSendToLoan = (expense: ExpenseDetail) => {
    setExpenseToLoan(expense)
    setIsLoanModalOpen(true)
  }

  const handleLoanSuccess = (message?: string) => {
    if (message) {
      handleShowToast(message, 'success')
    }
    loadDetailedReport()
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  const formatDateChart = (dateStr: string, granularity: 'monthly' | 'daily') => {
    if (granularity === 'monthly') {
      const [year, month] = dateStr.split('-')
      const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
      return `${monthNames[parseInt(month) - 1]}/${year}`
    } else {
      const date = new Date(dateStr)
      return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    }
  }

  const formatDateTime = (dateStr: string) => {
    // Parse a data como está no banco (sem conversão de timezone)
    const date = new Date(dateStr)

    // Extrai os componentes da data diretamente (sem conversão de timezone)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')

    return `${day}/${month}/${year} ${hours}:${minutes}`
  }

  // Filtra despesas por termo de busca, valor e tipo (receita/despesa)
  let filteredExpenses = detailedReport?.expenses.filter(expense => {
    // Filtro por descrição
    const matchesDescription = !searchTerm || expense.description.toLowerCase().includes(searchTerm.toLowerCase())

    // Filtro por tipo (receita/despesa) - usa o valor APLICADO
    let matchesType = true
    if (appliedTransactionType !== 'all') {
      const isExpense = expense.amount < 0
      matchesType = appliedTransactionType === 'despesa' ? isExpense : !isExpense
    }

    // Filtro por valor exato (aceita tanto 109.70 quanto 109,70)
    let matchesAmount = true
    if (searchAmount && searchAmount.trim() !== '') {
      // Normaliza o valor digitado (troca vírgula por ponto)
      const normalizedSearch = searchAmount.trim().replace(',', '.')
      const searchValue = parseFloat(normalizedSearch)

      if (!isNaN(searchValue)) {
        // Arredonda ambos os valores para 2 casas decimais para comparação precisa
        const expenseValueRounded = Math.round(Math.abs(expense.amount) * 100) / 100
        const searchValueRounded = Math.round(searchValue * 100) / 100
        matchesAmount = expenseValueRounded === searchValueRounded
      } else {
        // Se o valor digitado não é um número válido, não filtra
        matchesAmount = true
      }
    }

    return matchesDescription && matchesAmount && matchesType
  }) || []

  // Reseta para página 1 quando os filtros de busca mudam
  // (evita mostrar página vazia ou valores negativos)
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, searchAmount])

  // Aplica ordenação se houver campo selecionado
  if (sortField) {
    filteredExpenses = [...filteredExpenses].sort((a, b) => {
      let aValue: any = a[sortField as keyof ExpenseDetail]
      let bValue: any = b[sortField as keyof ExpenseDetail]

      // Trata valores nulos
      if (aValue === null || aValue === undefined) return 1
      if (bValue === null || bValue === undefined) return -1

      // Ordenação por data
      if (sortField === 'date') {
        aValue = new Date(aValue).getTime()
        bValue = new Date(bValue).getTime()
      }
      // Ordenação por valor numérico
      else if (sortField === 'amount') {
        aValue = Number(aValue)
        bValue = Number(bValue)
      }
      // Ordenação por string (descrição, tag, subtag, conta, parceiro, terceiro)
      else {
        aValue = String(aValue).toLowerCase()
        bValue = String(bValue).toLowerCase()
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
  }

  // Função para alternar ordenação
  const handleSort = (field: string) => {
    if (sortField === field) {
      // Se já está ordenando por este campo, inverte a direção
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // Se é um novo campo, ordena ascendente
      setSortField(field)
      setSortDirection('asc')
    }
  }

  // ==================== FUNÇÕES DE SELEÇÃO EM LOTE ====================

  // Gera chave única para item selecionado
  const getItemKey = (expense: ExpenseDetail) => `${expense.source}:${expense.id}`

  // Verifica se item está selecionado
  const isItemSelected = (expense: ExpenseDetail) => selectedItems.has(getItemKey(expense))

  // Verifica se item pode ser selecionado (baseado no tipo já selecionado)
  const canSelectItem = (expense: ExpenseDetail) => {
    if (selectionType === null) return true
    const itemType = expense.amount < 0 ? 'despesa' : 'receita'
    return itemType === selectionType
  }

  // Toggle seleção de um item
  const toggleItemSelection = (expense: ExpenseDetail) => {
    const key = getItemKey(expense)
    const newSelected = new Set(selectedItems)

    if (newSelected.has(key)) {
      newSelected.delete(key)
      // Se não há mais itens selecionados, reseta o tipo
      if (newSelected.size === 0) {
        setSelectionType(null)
      }
    } else {
      // Define o tipo na primeira seleção
      if (newSelected.size === 0) {
        setSelectionType(expense.amount < 0 ? 'despesa' : 'receita')
      }
      newSelected.add(key)
    }

    setSelectedItems(newSelected)
  }

  // Seleciona todos os itens filtrados (do mesmo tipo)
  const selectAllFiltered = () => {
    if (filteredExpenses.length === 0) return

    // Determina o tipo baseado no primeiro item ou no tipo já selecionado
    const targetType = selectionType || (filteredExpenses[0].amount < 0 ? 'despesa' : 'receita')

    const newSelected = new Set<string>()
    filteredExpenses.forEach(expense => {
      const itemType = expense.amount < 0 ? 'despesa' : 'receita'
      if (itemType === targetType) {
        newSelected.add(getItemKey(expense))
      }
    })

    setSelectedItems(newSelected)
    setSelectionType(targetType)
  }

  // Limpa toda a seleção
  const clearSelection = () => {
    setSelectedItems(new Set())
    setSelectionType(null)
  }

  // Converte seleção para formato do backend
  const getSelectedItemsForApi = () => {
    return Array.from(selectedItems).map(key => {
      const [source, id] = key.split(':')
      return { id: parseInt(id), source: source as 'bank' | 'card' | 'benefit' }
    })
  }

  // Calcula estado do checkbox "selecionar todos"
  const selectAllState = useMemo(() => {
    if (selectedItems.size === 0) return 'none'

    const targetType = selectionType || 'despesa'
    const selectableItems = filteredExpenses.filter(e =>
      (e.amount < 0 ? 'despesa' : 'receita') === targetType
    )

    if (selectableItems.length === 0) return 'none'

    const selectedCount = selectableItems.filter(e => selectedItems.has(getItemKey(e))).length
    if (selectedCount === 0) return 'none'
    if (selectedCount === selectableItems.length) return 'all'
    return 'partial'
  }, [selectedItems, filteredExpenses, selectionType])

  // Handler para exclusão em lote
  const handleBatchDelete = async () => {
    const confirmed = await showConfirm({
      title: 'Excluir em Lote',
      message: `Tem certeza que deseja excluir ${selectedItems.size} registro(s)? Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      type: 'danger'
    })

    if (!confirmed) return

    try {
      await axios.delete('/api/expenses/batch-delete', {
        data: { items: getSelectedItemsForApi() }
      })
      setToastMessage(`${selectedItems.size} registro(s) excluído(s) com sucesso!`)
      setToastType('success')
      setShowToast(true)
      clearSelection()
      loadDetailedReport()
    } catch (error: any) {
      console.error('Erro ao excluir em lote:', error)
      setToastMessage(error.response?.data?.detail || 'Erro ao excluir registros')
      setToastType('error')
      setShowToast(true)
    }
  }

  // Verifica se TODOS os itens selecionados possuem compartilhamento (shared_partner_id) e NÃO são invertidos
  const allSelectedHaveSharing = useMemo(() => {
    if (selectedItems.size === 0) return false
    const selectedExpenses = filteredExpenses.filter(e => selectedItems.has(getItemKey(e)))
    // Item deve ter compartilhamento E não ser um item já invertido (migrated_from_account_id indica item invertido)
    return selectedExpenses.every(e =>
      e.shared_partner_id !== null &&
      e.shared_partner_id > 0 &&
      !e.migrated_from_account_id  // Bloqueia itens já invertidos
    )
  }, [selectedItems, filteredExpenses])

  // Abre o modal de inversão para um único item (botão na linha)
  const handleOpenInvertModal = (expense: ExpenseDetail) => {
    setInvertItems([expense])
    setIsInvertModalOpen(true)
  }

  // Abre o modal de inversão para itens selecionados em lote
  const handleOpenBatchInvertModal = () => {
    const selectedExpenses = filteredExpenses.filter(e => selectedItems.has(getItemKey(e)))
    setInvertItems(selectedExpenses)
    setIsInvertModalOpen(true)
  }

  // Fecha o modal de inversão
  const handleCloseInvertModal = () => {
    setIsInvertModalOpen(false)
    setInvertItems([])
  }

  // Executa a inversão (unificado para individual ou batch)
  const handleInvert = async () => {
    if (invertItems.length === 0) return

    // Verifica se todos os itens têm compartilhamento (shared_partner_id)
    const itemsWithSharing = invertItems.filter(e => e.shared_partner_id)
    if (itemsWithSharing.length === 0) {
      setToastMessage('Nenhum item possui compartilhamento configurado')
      setToastType('error')
      setShowToast(true)
      return
    }

    try {
      setInvertLoading(true)

      // Monta os itens para a API - cada um com seu target_account_id (shared_partner_id)
      const itemsForApi = itemsWithSharing.map(expense => {
        // Mapeia source para o formato esperado pelo backend
        let source = expense.source
        if (source === 'transaction') source = 'bank'

        return {
          id: expense.id,
          source,
          target_account_id: expense.shared_partner_id!
        }
      })

      const response = await axios.post('/api/expenses/batch-invert-sharing', {
        items: itemsForApi
      })

      handleCloseInvertModal()
      clearSelection()
      loadDetailedReport()
      setToastMessage(response.data.message || `${response.data.updated_count} registro(s) invertido(s) com sucesso!`)
      setToastType('success')
      setShowToast(true)
    } catch (error: any) {
      console.error('Erro ao inverter compartilhamento:', error)
      // Trata erro de validação do Pydantic (array de objetos)
      const detail = error.response?.data?.detail
      let errorMsg = 'Erro ao inverter compartilhamento'
      if (typeof detail === 'string') {
        errorMsg = detail
      } else if (Array.isArray(detail) && detail.length > 0) {
        errorMsg = detail[0]?.msg || errorMsg
      }
      setToastMessage(errorMsg)
      setToastType('error')
      setShowToast(true)
    } finally {
      setInvertLoading(false)
    }
  }

  // Filtra subtags baseado nas tags selecionadas e adiciona ícone de tipo
  // Só mostra subtags quando pelo menos uma tag está selecionada
  // Agrupa por tag_name quando múltiplas tags estão selecionadas
  const filteredSubtags = selectedTagIds.length > 0
    ? subtags.filter(st => selectedTagIds.includes(st.tag_id)).map(st => ({
        ...st,
        icon: st.tag_type === 'receita'
          ? <ArrowDownCircle size={14} className="text-green-600 dark:text-green-400" />
          : <ArrowUpCircle size={14} className="text-red-600 dark:text-red-400" />,
        // Adiciona informações de agrupamento para quando múltiplas tags estão selecionadas
        groupKey: st.tag_name,
        groupName: st.tag_name
      }))
    : [] // Não mostra subtags se nenhuma tag está selecionada

  // Componente helper para cabeçalhos ordenáveis
  const SortableHeader = ({ field, label, className = "", style, align = "left" }: { field: string, label: string, className?: string, style?: React.CSSProperties, align?: "left" | "right" | "center" }) => (
    <th
      className={`px-4 py-3 text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors ${className}`}
      style={style}
      onClick={() => handleSort(field)}
    >
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
        <span>{label}</span>
        {sortField === field ? (
          sortDirection === 'asc' ? (
            <ArrowUp size={14} className="text-color-primary" />
          ) : (
            <ArrowDown size={14} className="text-color-primary" />
          )
        ) : (
          <ArrowUpDown size={14} className="text-gray-400 opacity-50" />
        )}
      </div>
    </th>
  )

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
          {/* Header (não sticky - rola para fora) */}
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <FileText className="w-8 h-8" />
                Extrato de Transações
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-2">
                Visualize e gerencie todas as suas transações
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsManualTransactionModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-color-primary text-white rounded-lg hover:opacity-90 transition-opacity"
              >
                <PlusCircle size={18} />
                Novo Lançamento
              </button>
              <button
                onClick={() => {
                  if (!filteredExpenses || filteredExpenses.length === 0) {
                    handleShowToast('Nenhum dado para exportar', 'error')
                    return
                  }
                  setIsExportModalOpen(true)
                }}
                disabled={!filteredExpenses || filteredExpenses.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-color-primary text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download size={18} />
                Exportar Excel
              </button>
            </div>
          </div>

          {/* Filtros - Layout Compacto em 2 Linhas */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-6 p-4 transition-all hover:border-color-primary hover:shadow-md">
            {/* Header: Título + Link Limpar Filtros */}
            {(() => {
              const hasActiveFilters =
                selectedCardIds.length > 0 ||
                selectedPartnerIds.length > 0 ||
                selectedTagIds.length > 0 ||
                selectedSubtagIds.length > 0 ||
                selectedSources.length > 0 ||
                selectedOrigins.length > 0 ||
                selectedTransactionType !== 'all' ||
                startDate !== null ||
                endDate !== null

              return (
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
              )
            })()}

            {/* Linha 1: Filtros principais (grid com colunas iguais) */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
              {/* Fonte de Dados */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  <Database size={12} className="inline mr-1 text-color-primary" />
                  Fonte
                </label>
                <SourceMultiSelectDropdown
                  label="Fonte"
                  options={SOURCE_OPTIONS}
                  selectedIds={selectedSources}
                  onChange={setSelectedSources}
                  placeholder="Selecione..."
                />
              </div>

              {/* Origem (Manual/Invertido) */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  <ArrowRight size={12} className="inline mr-1 text-color-primary" />
                  Origem
                </label>
                <SourceMultiSelectDropdown
                  label="Origem"
                  options={ORIGIN_OPTIONS}
                  selectedIds={selectedOrigins}
                  onChange={setSelectedOrigins}
                  placeholder="Selecione..."
                />
              </div>

              {/* Cartão */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  <CreditCard size={12} className="inline mr-1 text-color-primary" />
                  Cartão
                </label>
                <MultiSelectDropdown
                  label="Cartão"
                  options={cards.map(c => ({
                    id: c.id,
                    name: `${c.name || 'Sem nome'} • ${c.number}`,
                    icon: c.type === 'beneficios' ? <Gift size={14} /> : <CreditCard size={14} />,
                    color: c.type === 'beneficios' ? 'var(--color-3)' : 'var(--color-2)'
                  }))}
                  selectedIds={selectedCardIds}
                  onChange={setSelectedCardIds}
                  placeholder="Selecione..."
                />
              </div>

              {/* Tipo (Receita/Despesa) */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  <ArrowUpDown size={12} className="inline mr-1 text-color-primary" />
                  Tipo
                </label>
                <select
                  value={selectedTransactionType}
                  onChange={(e) => setSelectedTransactionType(e.target.value as 'all' | 'despesa' | 'receita')}
                  className="w-full px-2 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-color-primary focus:border-color-primary transition-all"
                >
                  <option value="all">Selecione...</option>
                  <option value="despesa">Despesas</option>
                  <option value="receita">Receitas</option>
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
                  options={[
                    { id: -1, name: '(Vazio)', count: undefined },
                    ...tags
                  ]}
                  selectedIds={selectedTagIds}
                  onChange={(newTagIds) => {
                    setSelectedTagIds(newTagIds)
                    // Limpa subtags que não pertencem mais às tags selecionadas
                    // Ignora ID -1 (Vazio) na validação de subtags
                    const realTagIds = newTagIds.filter(id => id !== -1)
                    if (realTagIds.length === 0) {
                      setSelectedSubtagIds([])
                    } else {
                      const validSubtagIds = subtags
                        .filter(st => realTagIds.includes(st.tag_id))
                        .map(st => st.id)
                      setSelectedSubtagIds(prev => prev.filter(id => validSubtagIds.includes(id)))
                    }
                  }}
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
                  placeholder={selectedTagIds.length === 0 ? "Selecione uma tag primeiro" : "Selecione..."}
                  groupByKey={selectedTagIds.length > 1}
                  disabled={selectedTagIds.length === 0}
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
                  options={[
                    { id: -1, name: '(Vazio)' },
                    ...partners
                      .map(p => ({
                        id: p.id,
                        name: p.shared_account?.name || p.shared_account?.description || `Conta #${p.shared_account_id}`
                      }))
                      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
                  ]}
                  selectedIds={selectedPartnerIds}
                  onChange={setSelectedPartnerIds}
                  placeholder="Selecione..."
                  icon={<Users size={14} className="text-gray-500" />}
                />
              </div>
            </div>

            {/* Linha 2: Períodos + Datas + Botões */}
            <div className="flex flex-wrap items-end gap-3">
              {/* Períodos Pré-definidos */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Períodos:</span>
                <button
                  onClick={() => {
                    const now = new Date()
                    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
                    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
                    setStartDate(start)
                    setEndDate(end)
                  }}
                  className="px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-700 dark:hover:text-blue-400 transition-all"
                >
                  Mês Atual
                </button>
                <button
                  onClick={() => {
                    const now = new Date()
                    const start = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate(), 0, 0, 0, 0)
                    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
                    setStartDate(start)
                    setEndDate(end)
                  }}
                  className="px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-700 dark:hover:text-blue-400 transition-all"
                >
                  3 Meses
                </button>
                <button
                  onClick={() => {
                    const now = new Date()
                    const start = new Date(now.getFullYear(), now.getMonth() - 5, now.getDate(), 0, 0, 0, 0)
                    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
                    setStartDate(start)
                    setEndDate(end)
                  }}
                  className="px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-700 dark:hover:text-blue-400 transition-all"
                >
                  6 Meses
                </button>
                <button
                  onClick={() => {
                    const now = new Date()
                    const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0)
                    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
                    setStartDate(start)
                    setEndDate(end)
                  }}
                  className="px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-700 dark:hover:text-blue-400 transition-all"
                >
                  Ano Atual
                </button>
                <button
                  onClick={() => {
                    const now = new Date()
                    const start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 0, 0, 0, 0)
                    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
                    setStartDate(start)
                    setEndDate(end)
                  }}
                  className="px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-700 dark:hover:text-blue-400 transition-all"
                >
                  1 Ano
                </button>
              </div>

              {/* Separador visual */}
              <div className="hidden lg:block w-px h-6 bg-gray-300 dark:bg-gray-600"></div>

              {/* Data de Início */}
              <div className="flex-1 flex items-center gap-2 min-w-[180px]">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap flex items-center gap-1">
                  <Calendar size={12} className="text-color-primary" />
                  Início
                </label>
                <input
                  type="date"
                  value={startDate ? dateToLocalString(startDate) : ''}
                  onChange={(e) => {
                    const value = e.target.value
                    // Só atualiza quando tiver data completa válida (YYYY-MM-DD)
                    // Ignora valores vazios ou parciais durante digitação
                    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                      const newDate = new Date(value + 'T00:00:00')
                      if (!isNaN(newDate.getTime())) {
                        setStartDate(newDate)
                      }
                    }
                  }}
                  max={endDate ? dateToLocalString(endDate) : undefined}
                  style={{ colorScheme: 'light dark' }}
                  className="flex-1 px-2 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-color-primary focus:border-color-primary transition-all"
                />
              </div>

              {/* Data de Fim */}
              <div className="flex-1 flex items-center gap-2 min-w-[180px]">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap flex items-center gap-1">
                  <Calendar size={12} className="text-color-primary" />
                  Fim
                </label>
                <input
                  type="date"
                  value={endDate ? dateToLocalString(endDate) : ''}
                  onChange={(e) => {
                    const value = e.target.value
                    // Só atualiza quando tiver data completa válida (YYYY-MM-DD)
                    // Ignora valores vazios ou parciais durante digitação
                    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                      const newDate = new Date(value + 'T23:59:59')
                      if (!isNaN(newDate.getTime())) {
                        setEndDate(newDate)
                      }
                    }
                  }}
                  min={startDate ? dateToLocalString(startDate) : undefined}
                  style={{ colorScheme: 'light dark' }}
                  className="flex-1 px-2 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-color-primary focus:border-color-primary transition-all"
                />
              </div>

              {/* Botão Aplicar */}
              <button
                onClick={handleApplyFilters}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all hover:opacity-90"
                style={{ backgroundColor: 'var(--crud-create)', color: 'var(--on-crud-create)' }}
              >
                <Filter size={14} />
                Aplicar
              </button>
            </div>
          </div>

          {/* ===== ÁREA STICKY: Abas + Totais + Busca ===== */}
          <div className="sticky top-0 z-30 bg-gray-50 dark:bg-gray-900 -mx-8 px-8 pb-4 pt-2 shadow-sm">
            {/* Abas: Extrato / Gráficos */}
            <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-4">
              <button
                onClick={() => setActiveTab('extrato')}
                className={`flex items-center gap-2 px-4 py-2.5 font-medium text-sm transition-all border-b-2 ${
                  activeTab === 'extrato'
                    ? 'text-color-primary border-color-primary'
                    : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
                }`}
              >
                <FileText size={16} />
                Extrato
              </button>
              <button
                onClick={() => setActiveTab('graficos')}
                className={`flex items-center gap-2 px-4 py-2.5 font-medium text-sm transition-all border-b-2 ${
                  activeTab === 'graficos'
                    ? 'text-color-primary border-color-primary'
                    : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
                }`}
              >
                <BarChart3 size={16} />
                Gráficos
              </button>
            </div>

            {/* Conteúdo sticky da aba Extrato: Cards de resumo + Busca */}
            {activeTab === 'extrato' && !loading && !error && detailedReport && (
              <>
                {/* Cards de Resumo */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                  {/* Despesas */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <ArrowUpCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                        <div>
                          <p className="text-xs text-gray-600 dark:text-gray-400">Despesas</p>
                          <p className="text-lg font-bold text-red-600 dark:text-red-400">
                            {formatCurrency(Math.abs(detailedReport.total_expenses))}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-500">
                        {detailedReport.total_expenses_count} trans.
                      </span>
                    </div>
                  </div>

                  {/* Receitas */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <ArrowDownCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                        <div>
                          <p className="text-xs text-gray-600 dark:text-gray-400">Receitas</p>
                          <p className="text-lg font-bold text-green-600 dark:text-green-400">
                            {formatCurrency(detailedReport.total_income)}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-500">
                        {detailedReport.total_income_count} trans.
                      </span>
                    </div>
                  </div>

                  {/* Total Líquido */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <TrendingUp className="w-5 h-5 text-color-primary" />
                        <div>
                          <p className="text-xs text-gray-600 dark:text-gray-400">Total Líquido</p>
                          <p className={`text-lg font-bold ${
                            detailedReport.total_amount >= 0
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}>
                            {formatCurrency(detailedReport.total_amount)}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-500">
                        {detailedReport.total_count} trans.
                      </span>
                    </div>
                  </div>
                </div>

                {/* Barra de Busca */}
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
                        <X size={18} />
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
                        <X size={18} />
                      </button>
                    )}
                  </div>
                </div>

              </>
            )}
          </div>
          {/* ===== FIM DA ÁREA STICKY ===== */}

          {/* Mensagem de Erro */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-red-800 dark:text-red-300">Erro ao carregar dados</h3>
                  <p className="text-sm text-red-700 dark:text-red-400 mt-1">{error}</p>
                </div>
                <button
                  onClick={() => setError(null)}
                  className="flex-shrink-0 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          )}

          {/* ========== ABA EXTRATO ========== */}
          {activeTab === 'extrato' && (
            <>
              {/* Loading */}
          {loading && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-white"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Carregando...</p>
            </div>
          )}

          {/* Tabela de Transações */}
          {!loading && detailedReport && filteredExpenses.length > 0 && (
            <div className={`${selectedItems.size > 0 || showBackToTop ? 'pb-20' : ''}`}>
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <table className="w-full table-auto">
                  <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                    <tr>
                      {/* Checkbox Selecionar Todos */}
                      <th className="px-2 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap w-10">
                        <button
                          onClick={() => {
                            if (selectAllState === 'none') {
                              selectAllFiltered()
                            } else {
                              clearSelection()
                            }
                          }}
                          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                          title={selectAllState === 'none' ? 'Selecionar todos' : 'Limpar seleção'}
                        >
                          {selectAllState === 'none' && <Square size={18} className="text-gray-400" />}
                          {selectAllState === 'partial' && <MinusSquare size={18} className="text-blue-600" />}
                          {selectAllState === 'all' && <CheckSquare size={18} className="text-blue-600" />}
                        </button>
                      </th>
                      <th className="px-2 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">#</th>
                      <th className="px-2 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">Origem</th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-color-primary" onClick={() => handleSort('date')}>
                        Data {sortField === 'date' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:text-color-primary" onClick={() => handleSort('description')}>
                        Descrição {sortField === 'description' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-color-primary" onClick={() => handleSort('amount')}>
                        Valor {sortField === 'amount' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:text-color-primary" onClick={() => handleSort('tag_name')}>
                        Tag {sortField === 'tag_name' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:text-color-primary" onClick={() => handleSort('subtag_name')}>
                        Subtag {sortField === 'subtag_name' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap min-w-[180px] cursor-pointer hover:text-color-primary" onClick={() => handleSort('shared_partner_name')}>
                        Compartilhamento {sortField === 'shared_partner_name' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap min-w-[160px] sticky right-0 bg-gray-50 dark:bg-gray-700 z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)]">
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {filteredExpenses
                        .slice(
                          itemsPerPage === 0 ? 0 : (currentPage - 1) * itemsPerPage,
                          itemsPerPage === 0 ? filteredExpenses.length : currentPage * itemsPerPage
                        )
                        .map((expense, index) => {
                          const lineNumber = itemsPerPage === 0
                            ? index + 1
                            : (currentPage - 1) * itemsPerPage + index + 1
                          return (
                            <tr
                              key={`${expense.source}-${expense.id}`}
                              className={`border-l-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all ${
                                isItemSelected(expense)
                                  ? 'border-l-blue-600 bg-blue-50 dark:bg-blue-900/20'
                                  : 'border-l-gray-300 dark:border-l-gray-600'
                              }`}
                              onMouseEnter={(e) => {
                                if (!isItemSelected(expense)) {
                                  e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!isItemSelected(expense)) {
                                  e.currentTarget.style.borderLeftColor = ''
                                }
                              }}
                            >
                              {/* Checkbox de Seleção */}
                              <td className="px-2 py-4 text-left whitespace-nowrap">
                                <button
                                  onClick={() => toggleItemSelection(expense)}
                                  disabled={!canSelectItem(expense)}
                                  className={`p-1 rounded transition-colors ${
                                    !canSelectItem(expense)
                                      ? 'opacity-30 cursor-not-allowed'
                                      : 'hover:bg-gray-200 dark:hover:bg-gray-600'
                                  }`}
                                  title={
                                    !canSelectItem(expense)
                                      ? `Não é possível selecionar ${expense.amount < 0 ? 'despesas' : 'receitas'} junto com ${selectionType}`
                                      : isItemSelected(expense)
                                        ? 'Remover seleção'
                                        : 'Selecionar'
                                  }
                                >
                                  {isItemSelected(expense) ? (
                                    <CheckSquare size={18} className="text-blue-600" />
                                  ) : (
                                    <Square size={18} className={canSelectItem(expense) ? 'text-gray-400' : 'text-gray-300'} />
                                  )}
                                </button>
                              </td>

                              {/* Número da Linha */}
                              <td className="px-2 py-4 text-left whitespace-nowrap">
                                <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{lineNumber}</span>
                              </td>

                              {/* Origem */}
                              <td className="px-2 py-4 text-left whitespace-nowrap">
                                <div className="flex items-center gap-1">
                                  {expense.source === 'bank' ? (
                                    <Landmark className="inline" style={{ color: 'var(--color-1)' }} size={20} aria-label="Extrato Bancário" />
                                  ) : expense.source === 'card' ? (
                                    <CreditCard className="inline" style={{ color: 'var(--color-2)' }} size={20} aria-label="Fatura de Cartão" />
                                  ) : (
                                    <Gift className="inline" style={{ color: 'var(--color-3)' }} size={20} aria-label="Benefício" />
                                  )}
                                  {/* Mostra ícone de inversão para itens migrados */}
                                  {expense.migrated_from_account_id && (
                                    <ArrowLeftRight
                                      size={16}
                                      className="text-cyan-600 dark:text-cyan-400"
                                      aria-label="Item Invertido/Migrado"
                                      title="Item invertido de outra conta"
                                    />
                                  )}
                                  {/* Mostra "M" apenas para bank_statements manuais (sem category e não migrado) */}
                                  {expense.source === 'bank' && expense.category === null && !expense.migrated_from_account_id && (
                                    <span
                                      className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-orange-500 text-white shadow-sm"
                                      title="Lançamento Manual"
                                    >
                                      M
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Data */}
                              <td className="px-3 py-4 text-left whitespace-nowrap">
                                <span className="text-sm text-gray-900 dark:text-white">{formatDateTime(expense.date)}</span>
                              </td>

                              {/* Descrição */}
                              <td className="px-3 py-4 text-left">
                                <div className="flex flex-col min-w-0">
                                  <span className="text-sm text-gray-900 dark:text-white truncate" title={expense.description}>
                                    {expense.description}
                                    {expense.current_installment && expense.total_installments && (
                                      <span className="text-xs text-gray-500 dark:text-gray-400"> • {expense.current_installment}/{expense.total_installments}x</span>
                                    )}
                                  </span>
                                  {expense.card_number && (
                                    <span className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-4)' }}>
                                      {expense.card_name && `${expense.card_name} • `}
                                      ****{expense.card_number}
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Valor */}
                              <td className="px-3 py-4 text-left whitespace-nowrap">
                                <span className={`text-sm ${expense.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                  {formatCurrency(expense.amount)}
                                </span>
                              </td>

                              {/* Tag */}
                              <td className="px-3 py-4 text-left">
                                <span className="text-sm text-gray-900 dark:text-white truncate block" title={expense.tag_name || undefined}>
                                  {expense.tag_name || '-'}
                                </span>
                              </td>

                              {/* Subtag */}
                              <td className="px-3 py-4 text-left">
                                <span className="text-sm text-gray-900 dark:text-white truncate block" title={expense.subtag_name || undefined}>
                                  {expense.subtag_name || '-'}
                                </span>
                              </td>

                              {/* Compartilhamento */}
                              <td className="px-3 py-4 text-left min-w-[180px]">
                                <SharedAccountDisplay
                                  account={expense.shared_partner_name ? {
                                    id: expense.shared_partner_id || 0,
                                    name: expense.shared_partner_name,
                                    bank: expense.shared_partner_bank ? { name: expense.shared_partner_bank } : null,
                                    agency: expense.shared_partner_agency,
                                    account_number: expense.shared_partner_account_number
                                  } : null}
                                  ownershipPercentage={expense.ownership_percentage}
                                />
                              </td>

                              {/* Ações */}
                              <td className={`px-4 py-4 text-left whitespace-nowrap sticky right-0 z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)] ${
                                isItemSelected(expense)
                                  ? 'bg-blue-50 dark:bg-blue-900/20'
                                  : 'bg-white dark:bg-gray-800'
                              }`}>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleEdit(expense)}
                                    disabled={selectedItems.size > 0}
                                    className={`p-2 rounded-lg transition-colors ${
                                      selectedItems.size > 0
                                        ? 'text-gray-400 cursor-not-allowed'
                                        : 'text-color-primary hover:opacity-80 hover:bg-color-primary-light'
                                    }`}
                                    title={selectedItems.size > 0 ? 'Limpe a seleção para editar' : 'Editar'}
                                  >
                                    <Edit2 size={18} />
                                  </button>
                                  <button
                                    onClick={() => handleSplit(expense)}
                                    disabled={selectedItems.size > 0}
                                    className={`p-2 rounded-lg transition-colors ${
                                      selectedItems.size > 0
                                        ? 'text-gray-400 cursor-not-allowed'
                                        : 'text-purple-600 dark:text-purple-400 hover:text-purple-900 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20'
                                    }`}
                                    title={selectedItems.size > 0 ? 'Limpe a seleção para dividir' : 'Dividir'}
                                  >
                                    <Split size={18} />
                                  </button>
                                  <button
                                    onClick={() => handleSendToLoan(expense)}
                                    disabled={selectedItems.size > 0}
                                    className={`p-2 rounded-lg transition-colors ${
                                      selectedItems.size > 0
                                        ? 'text-gray-400 cursor-not-allowed'
                                        : 'text-amber-600 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                    }`}
                                    title={selectedItems.size > 0 ? 'Limpe a seleção para empréstimo' : 'Enviar para Empréstimo'}
                                  >
                                    <Wallet size={18} />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleOpenInvertModal(expense)
                                    }}
                                    disabled={selectedItems.size > 0 || !expense.shared_partner_id || !!expense.migrated_from_account_id}
                                    className={`p-2 rounded-lg transition-colors ${
                                      selectedItems.size > 0 || !expense.shared_partner_id || !!expense.migrated_from_account_id
                                        ? 'text-gray-400 cursor-not-allowed'
                                        : 'text-cyan-600 dark:text-cyan-400 hover:text-cyan-900 dark:hover:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-900/20'
                                    }`}
                                    title={
                                      selectedItems.size > 0
                                        ? 'Limpe a seleção para inverter'
                                        : expense.migrated_from_account_id
                                          ? 'Item já foi invertido'
                                          : !expense.shared_partner_id
                                            ? 'Item não possui compartilhamento'
                                            : 'Inverter compartilhamento'
                                    }
                                  >
                                    <ArrowLeftRight size={18} />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(expense)}
                                    disabled={selectedItems.size > 0}
                                    className={`p-2 rounded-lg transition-colors ${
                                      selectedItems.size > 0
                                        ? 'text-gray-400 cursor-not-allowed'
                                        : 'text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20'
                                    }`}
                                    title={selectedItems.size > 0 ? 'Limpe a seleção para excluir' : 'Excluir'}
                                  >
                                    <Trash2 size={18} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>

                    {/* Rodapé com Totais e Paginação */}
                    <tfoot className="bg-gray-50 dark:bg-gray-700 border-t-2 border-gray-300 dark:border-gray-600">
                      <tr>
                        <td colSpan={10} className="px-6 py-4">
                          {/* Layout: Esquerda | Centro | Direita */}
                          <div className="grid grid-cols-3 items-center gap-4">
                            {/* ESQUERDA: Seletor de itens por página */}
                            <div className="flex items-center gap-2 text-sm justify-start">
                              <label className="text-gray-600 dark:text-gray-400">Transações por página:</label>
                              <select
                                value={itemsPerPage}
                                onChange={(e) => {
                                  setItemsPerPage(Number(e.target.value))
                                  setCurrentPage(1)
                                }}
                                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              >
                                <option value={50}>50</option>
                                <option value={100}>100</option>
                                <option value={200}>200</option>
                                <option value={0}>Todos</option>
                              </select>
                            </div>

                            {/* CENTRO: Informações de totais */}
                            <div className="flex items-center justify-center gap-3 text-sm text-gray-600 dark:text-gray-400">
                              <div>
                                Mostrando <span className="font-semibold text-gray-900 dark:text-white">
                                  {itemsPerPage === 0 ? filteredExpenses.length : Math.min(itemsPerPage, filteredExpenses.length - (currentPage - 1) * itemsPerPage)}
                                </span> de <span className="font-semibold text-gray-900 dark:text-white">{filteredExpenses.length}</span> {filteredExpenses.length === 1 ? 'transação' : 'transações'}
                              </div>
                            </div>

                            {/* DIREITA: Navegação de páginas */}
                            <div className="flex items-center justify-end">
                              {itemsPerPage > 0 && Math.ceil(filteredExpenses.length / itemsPerPage) > 1 && (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={currentPage === 1}
                                    className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  >
                                    Anterior
                                  </button>
                                  <span className="text-sm text-gray-600 dark:text-gray-400">
                                    Página <span className="font-semibold text-gray-900 dark:text-white">{currentPage}</span> de <span className="font-semibold text-gray-900 dark:text-white">{Math.ceil(filteredExpenses.length / itemsPerPage)}</span>
                                  </span>
                                  <button
                                    onClick={() => setCurrentPage(prev => Math.min(Math.ceil(filteredExpenses.length / itemsPerPage), prev + 1))}
                                    disabled={currentPage >= Math.ceil(filteredExpenses.length / itemsPerPage)}
                                    className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  >
                                    Próxima
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
          )}

          {/* Empty State - Nenhuma transação encontrada */}
          {!loading && !error && detailedReport && filteredExpenses.length === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-full">
                  <FileText className="h-12 w-12 text-gray-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Nenhuma transação encontrada</h3>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Não há transações que correspondam aos filtros selecionados.
                  </p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Tente ajustar os filtros ou o termo de busca.
                  </p>
                </div>
                <button
                  onClick={clearFilters}
                  className="mt-2 px-4 py-2 text-white rounded-lg transition-colors hover:opacity-90"
                  style={{ backgroundColor: 'var(--crud-cancel)' }}
                >
                  Limpar Filtros
                </button>
              </div>
            </div>
          )}



          {/* Estado Inicial - Aguardando primeira busca */}
          {!loading && !error && !detailedReport && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-full">
                  <Search className="h-12 w-12 text-gray-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Selecione os filtros</h3>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Configure os filtros acima e clique em "Aplicar" para visualizar as transações.
                  </p>
                  {startDate && endDate && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-500">
                      Período atual: <span className="font-medium text-gray-700 dark:text-gray-300">
                        {startDate.toLocaleDateString('pt-BR')} - {endDate.toLocaleDateString('pt-BR')}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
            </>
          )}

          {/* ========== ABA GRÁFICOS ========== */}
          {activeTab === 'graficos' && (
            <>
              {/* Loading */}
              {loading && (
                <div className="flex items-center justify-center h-64">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-color-primary"></div>
                </div>
              )}

              {/* Estado Inicial - Sem dados */}
              {!loading && !error && !timeSeriesData && (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-full">
                      <BarChart3 className="h-12 w-12 text-gray-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Selecione os filtros</h3>
                      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                        Configure os filtros acima e clique em "Aplicar" para visualizar os gráficos.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Conteúdo dos Gráficos */}
              {!loading && !error && timeSeriesData && (
                <div className="space-y-6">
                  {/* Cards de Resumo - Gráficos */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Despesas */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <ArrowUpCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                          <div>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Despesas</p>
                            <p className="text-lg font-bold text-red-600 dark:text-red-400">
                              {formatCurrency(Math.abs(timeSeriesData.total_expenses))}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-500">
                          {timeSeriesData.total_expenses_count} trans.
                        </span>
                      </div>
                    </div>

                    {/* Receitas */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <ArrowDownCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                          <div>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Receitas</p>
                            <p className="text-lg font-bold text-green-600 dark:text-green-400">
                              {formatCurrency(timeSeriesData.total_income)}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-500">
                          {timeSeriesData.total_income_count} trans.
                        </span>
                      </div>
                    </div>

                    {/* Total Líquido */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 transition-all hover:border-color-primary hover:shadow-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <TrendingUp className="w-5 h-5 text-color-primary" />
                          <div>
                            <p className="text-xs text-gray-600 dark:text-gray-400">Total Líquido</p>
                            <p className={`text-lg font-bold ${
                              timeSeriesData.total_amount >= 0
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-600 dark:text-red-400'
                            }`}>
                              {formatCurrency(timeSeriesData.total_amount)}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-500">
                          {timeSeriesData.total_count} trans.
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Gráfico de Linha - Evolução Temporal */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                      <TrendingUp size={20} className="text-color-primary" />
                      Evolução Temporal
                    </h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={timeSeriesData.data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey={timeSeriesData.granularity === 'monthly' ? 'year_month' : 'date'}
                          tickFormatter={(value) => formatDateChart(value, timeSeriesData.granularity)}
                          stroke="#6b7280"
                          fontSize={12}
                        />
                        <YAxis
                          tickFormatter={(value) => formatCurrency(value)}
                          stroke="#6b7280"
                          fontSize={12}
                        />
                        <Tooltip
                          formatter={(value) => value !== undefined ? formatCurrency(Number(value)) : ''}
                          labelFormatter={(label) => formatDateChart(String(label), timeSeriesData.granularity)}
                          contentStyle={{
                            backgroundColor: 'var(--bg-card)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px'
                          }}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="income" stroke="#10b981" name="Receitas" strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="expenses" stroke="#ef4444" name="Despesas" strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="total" stroke="#3b82f6" name="Líquido" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Gráfico de Barras - Comparativo */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                      <BarChart3 size={20} className="text-color-primary" />
                      Comparativo de Receitas vs Despesas
                    </h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={timeSeriesData.data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey={timeSeriesData.granularity === 'monthly' ? 'year_month' : 'date'}
                          tickFormatter={(value) => formatDateChart(value, timeSeriesData.granularity)}
                          stroke="#6b7280"
                          fontSize={12}
                        />
                        <YAxis
                          tickFormatter={(value) => formatCurrency(value)}
                          stroke="#6b7280"
                          fontSize={12}
                        />
                        <Tooltip
                          formatter={(value) => value !== undefined ? formatCurrency(Number(value)) : ''}
                          labelFormatter={(label) => formatDateChart(String(label), timeSeriesData.granularity)}
                          contentStyle={{
                            backgroundColor: 'var(--bg-card)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px'
                          }}
                        />
                        <Legend />
                        <Bar dataKey="income" fill="#10b981" name="Receitas" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="expenses" fill="#ef4444" name="Despesas" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modal de Split */}
      <SplitExpenseModal
        isOpen={isSplitModalOpen}
        onClose={() => {
          setIsSplitModalOpen(false)
          setExpenseToSplit(null)
        }}
        expense={expenseToSplit}
        onSuccess={handleSplitSuccess}
      />

      {/* Modal de Edição */}
      <EditExpenseModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false)
          setExpenseToEdit(null)
        }}
        expense={expenseToEdit}
        onSuccess={handleEditSuccess}
      />

      {/* Toast Notification */}
      {showToast && (
        <Toast
          message={toastMessage}
          type={toastType}
          onClose={() => setShowToast(false)}
        />
      )}

      {/* Modal de Edição em Lote */}
      <BatchEditExpenseModal
        isOpen={isBatchEditModalOpen}
        onClose={() => setIsBatchEditModalOpen(false)}
        selectedItems={getSelectedItemsForApi()}
        expenseType={selectionType || 'despesa'}
        onSuccess={(message) => {
          clearSelection()
          loadDetailedReport()
          if (message) {
            handleShowToast(message, 'success')
          }
        }}
      />

      {/* Modal de Exportação */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        expenses={filteredExpenses || []}
        onSuccess={(message) => handleShowToast(message, 'success')}
        onError={(message) => handleShowToast(message, 'error')}
      />

      {/* Modal de Enviar para Empréstimo */}
      <SendToLoanModal
        isOpen={isLoanModalOpen}
        onClose={() => {
          setIsLoanModalOpen(false)
          setExpenseToLoan(null)
        }}
        expense={expenseToLoan}
        onSuccess={handleLoanSuccess}
      />

      {/* Modal de Lançamento Manual */}
      <ManualTransactionModal
        isOpen={isManualTransactionModalOpen}
        onClose={() => setIsManualTransactionModalOpen(false)}
        onSuccess={loadDetailedReport}
      />

      {/* Modal Unificado de Inversão de Compartilhamento */}
      {isInvertModalOpen && invertItems.length > 0 && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                handleCloseInvertModal()
              } else if (e.key === 'Enter') {
                handleInvert()
              }
            }}
            tabIndex={0}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <ArrowLeftRight size={20} className="text-cyan-600 dark:text-cyan-400" />
                Inverter Compartilhamento
              </h3>
              <button
                onClick={handleCloseInvertModal}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-4 space-y-4">
              {/* Mensagem unificada */}
              {(() => {
                const cardCount = invertItems.filter(e => e.source === 'card').length
                const benefitCount = invertItems.filter(e => e.source === 'benefit').length
                const bankCount = invertItems.filter(e => e.source === 'transaction' || e.source === 'bank').length
                const convertCount = cardCount + benefitCount
                const uniquePartners = new Set(invertItems.map(e => e.shared_partner_id).filter(id => id))
                const partnerCount = uniquePartners.size
                const total = invertItems.length

                // Monta descrição dos itens
                let itemsDescription = ''
                if (total === 1) {
                  if (cardCount > 0) itemsDescription = '1 item de cartão'
                  else if (benefitCount > 0) itemsDescription = '1 item de benefício'
                  else itemsDescription = '1 item'
                } else {
                  itemsDescription = `${total} itens`
                }

                // Destino
                const destino = partnerCount > 1
                  ? `${partnerCount} contas parceiras`
                  : 'a conta parceira'

                return (
                  <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                      <div className="text-sm text-amber-800 dark:text-amber-200 space-y-1">
                        <p>
                          <strong>{itemsDescription}</strong> {total === 1 ? 'será migrado' : 'serão migrados'} para <strong>{destino}</strong>.
                        </p>
                        {convertCount > 0 && (
                          <p className="text-amber-700 dark:text-amber-300">
                            {convertCount === total ? (total === 1 ? 'Será convertido' : 'Serão convertidos') : `${convertCount} ${convertCount === 1 ? 'será convertido' : 'serão convertidos'}`} para extrato bancário.
                          </p>
                        )}
                        <p className="text-amber-700 dark:text-amber-300 font-medium mt-2">
                          ⚠️ Esta ação não poderá ser desfeita.
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button
                onClick={handleCloseInvertModal}
                className="px-4 py-2 rounded-lg transition-colors text-white hover:opacity-90"
                style={{ backgroundColor: 'var(--crud-cancel)' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleInvert}
                disabled={invertLoading}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                  !invertLoading
                    ? 'bg-cyan-500 text-white hover:bg-cyan-600'
                    : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                }`}
              >
                {invertLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    Invertendo...
                  </>
                ) : (
                  <>
                    <ArrowLeftRight size={16} />
                    Confirmar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmComponent />

      {/* Barra Flutuante de Ações em Lote - Fixed no rodapé, respeita o sidebar */}
      {selectedItems.size > 0 && (
        <div className="fixed bottom-0 left-64 right-0 z-50 bg-white dark:bg-gray-800 border-t-2 border-color-primary shadow-[0_-4px_12px_rgba(0,0,0,0.15)] px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-medium text-color-primary">
                {selectedItems.size} {selectionType === 'despesa' ? 'despesa(s)' : 'receita(s)'} selecionada(s)
              </span>
              <button
                onClick={clearSelection}
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex items-center gap-1"
              >
                <X size={14} />
                Limpar
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsBatchEditModalOpen(true)}
                className="px-3 py-1.5 text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold"
                style={{ backgroundColor: 'var(--crud-edit)' }}
              >
                <Edit2 size={14} />
                Editar em Lote
              </button>
              <button
                onClick={handleOpenBatchInvertModal}
                disabled={!allSelectedHaveSharing || invertLoading}
                className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 text-sm font-semibold ${
                  allSelectedHaveSharing && !invertLoading
                    ? 'bg-cyan-500 text-white hover:bg-cyan-600'
                    : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                }`}
                title={!allSelectedHaveSharing ? 'Todos os itens devem ter compartilhamento e não podem ser itens já invertidos' : 'Inverter compartilhamento'}
              >
                <ArrowLeftRight size={14} />
                Inverter
              </button>
              <button
                onClick={handleBatchDelete}
                className="px-3 py-1.5 text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold"
                style={{ backgroundColor: 'var(--crud-delete)' }}
              >
                <Trash2 size={14} />
                Excluir
              </button>
              {/* Botão Back to Top dentro da barra de ações */}
              {showBackToTop && (
                <button
                  onClick={scrollToTop}
                  className="px-3 py-1.5 bg-color-primary text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold"
                  title="Voltar ao topo"
                >
                  <ArrowUp size={14} />
                  Topo
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Barra Flutuante Back to Top - Aparece só quando não há seleção */}
      {showBackToTop && selectedItems.size === 0 && (
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

export default ExtratoPage

