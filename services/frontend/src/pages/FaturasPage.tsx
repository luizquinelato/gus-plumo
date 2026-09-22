import { useState, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageShell,
} from '../components/CadastroListPageLayout'
import FloatingFooterBar from '../components/FloatingFooterBar'
import LoadingSpinner from '../components/LoadingSpinner'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import EditExpenseModal from '../components/EditExpenseModal'
import BatchEditExpenseModal from '../components/BatchEditExpenseModal'
import Toast from '../components/Toast'
import { useConfirm } from '../hooks/useConfirm'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { CreditCard, Calendar, FileText, Receipt, Filter, X, Search, Gift, ArrowDownCircle, ArrowUpCircle, Tag, Tags, Users, ArrowUp, Edit2, Trash2, CheckSquare, Square, MinusSquare, ChevronDown, ChevronRight, Landmark, Link2 } from 'lucide-react'
import type { InvoiceMatchPreview } from '../types/invoiceReconcile'

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
  current_installment?: number | null
  total_installments?: number | null
  issuer?: 'btg' | 'mercadopago' | null
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

const ISSUER_FILTER_OPTIONS = [
  { id: 1, name: 'BTG', code: 'btg' as const },
  { id: 2, name: 'Mercado Pago', code: 'mercadopago' as const },
]

const issuerChip = (issuer: 'btg' | 'mercadopago') =>
  issuer === 'mercadopago'
    ? { text: 'Mercado Pago', className: 'bg-[#FFE600] text-[#333333]' }
    : { text: 'BTG', className: 'bg-[#001E62] text-white' }

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
  const [selectedIssuerIds, setSelectedIssuerIds] = useState<number[]>([])

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
  const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false)

  // Seleção em lote
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [selectionType, setSelectionType] = useState<'despesa' | 'receita' | null>(null)

  // Seções de cartão expandidas (vazio = todas recolhidas)
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())
  const [paymentPreview, setPaymentPreview] = useState<InvoiceMatchPreview | null>(null)

  // Toast
  const [showToast, setShowToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')

  const { showConfirm, ConfirmComponent } = useConfirm()

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
      if (selectedIssuerIds.length > 0) {
        const issuerCodes = selectedIssuerIds
          .map(id => ISSUER_FILTER_OPTIONS.find(option => option.id === id)?.code)
          .filter((code): code is 'btg' | 'mercadopago' => Boolean(code))
        if (issuerCodes.length > 0) {
          params.issuers = issuerCodes.join(',')
        }
      }

      const response = await axios.get('/api/reports/invoices', { params })
      setInvoiceData(response.data)
      setExpandedCards(new Set())

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
    setSelectedIssuerIds([])
    setSearchTerm('')
    setSearchAmount('')
    setInvoiceData(null)
    setExpandedCards(new Set())
  }

  const getCardSectionKey = (cardName: string, cardNumber: string, cardId?: number) =>
    cardId != null ? `card:${cardId}` : `${cardName}|${cardNumber}`

  const toggleCardCollapse = (cardKey: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev)
      if (next.has(cardKey)) {
        next.delete(cardKey)
      } else {
        next.add(cardKey)
      }
      return next
    })
  }

  const expandAllCards = (cardKeys: string[]) => {
    setExpandedCards(new Set(cardKeys))
  }

  const collapseAllCards = () => {
    setExpandedCards(new Set())
  }

  // Verifica se há filtros ativos
  const hasActiveFilters = selectedCardIds.length > 0 || selectedYear !== '' || selectedMonth !== '' ||
    selectedTagIds.length > 0 || selectedSubtagIds.length > 0 || selectedPartnerIds.length > 0 ||
    selectedIssuerIds.length > 0 ||
    searchTerm !== '' || searchAmount !== ''

  const handleEdit = (item: InvoiceItem) => {
    setItemToEdit(item)
    setIsEditModalOpen(true)
  }

  const handleEditSuccess = () => {
    loadInvoiceData()
  }

  const handleShowToast = (message: string, type: 'success' | 'error') => {
    setToastMessage(message)
    setToastType(type)
    setShowToast(true)
  }

  const filteredItems = useMemo(() => {
    if (!invoiceData?.items) return []

    return invoiceData.items.filter(item => {
      const matchesText = !searchTerm || item.description.toLowerCase().includes(searchTerm.toLowerCase())

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
  }, [invoiceData, searchTerm, searchAmount])

  const currentItems = useMemo(() => {
    if (!activeMonth) return []
    return filteredItems.filter(item => item.year_month === activeMonth)
  }, [filteredItems, activeMonth])

  const getItemKey = (item: InvoiceItem) => `card:${item.id}`
  const getItemType = (item: InvoiceItem): 'despesa' | 'receita' =>
    Number(item.amount) < 0 ? 'despesa' : 'receita'

  const isItemSelected = (item: InvoiceItem) => selectedItems.has(getItemKey(item))

  const canSelectItem = (item: InvoiceItem) => {
    if (selectionType === null) return true
    return getItemType(item) === selectionType
  }

  const toggleItemSelection = (item: InvoiceItem) => {
    const key = getItemKey(item)
    const newSelected = new Set(selectedItems)

    if (newSelected.has(key)) {
      newSelected.delete(key)
      if (newSelected.size === 0) {
        setSelectionType(null)
      }
    } else {
      if (newSelected.size === 0) {
        setSelectionType(getItemType(item))
      }
      newSelected.add(key)
    }

    setSelectedItems(newSelected)
  }

  const selectAllFiltered = () => {
    if (currentItems.length === 0) return

    const targetType = selectionType || getItemType(currentItems[0])
    const newSelected = new Set<string>()

    currentItems.forEach(item => {
      if (getItemType(item) === targetType) {
        newSelected.add(getItemKey(item))
      }
    })

    setSelectedItems(newSelected)
    setSelectionType(targetType)
  }

  const clearSelection = () => {
    setSelectedItems(new Set())
    setSelectionType(null)
  }

  const getSelectedItemsForApi = () => {
    return Array.from(selectedItems).map(key => {
      const [, id] = key.split(':')
      return { id: parseInt(id), source: 'card' as const }
    })
  }

  const selectAllState = useMemo(() => {
    if (selectedItems.size === 0) return 'none'

    const targetType = selectionType || 'despesa'
    const selectableItems = currentItems.filter(item => getItemType(item) === targetType)

    if (selectableItems.length === 0) return 'none'

    const selectedCount = selectableItems.filter(item => selectedItems.has(getItemKey(item))).length
    if (selectedCount === 0) return 'none'
    if (selectedCount === selectableItems.length) return 'all'
    return 'partial'
  }, [selectedItems, currentItems, selectionType])

  const handleBatchDelete = async () => {
    const confirmed = await showConfirm({
      title: 'Excluir em Lote',
      message: `Tem certeza que deseja excluir ${selectedItems.size} registro(s)? Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      type: 'danger',
    })

    if (!confirmed) return

    try {
      await axios.delete('/api/expenses/batch-delete', {
        data: { items: getSelectedItemsForApi() },
      })
      handleShowToast(`${selectedItems.size} registro(s) excluído(s) com sucesso!`, 'success')
      clearSelection()
      loadInvoiceData()
    } catch (error: any) {
      console.error('Erro ao excluir em lote:', error)
      handleShowToast(error.response?.data?.detail || 'Erro ao excluir registros', 'error')
    }
  }

  useEffect(() => {
    setSelectedItems(new Set())
    setSelectionType(null)
  }, [activeMonth])

  useEffect(() => {
    if (!activeMonth) {
      setPaymentPreview(null)
      return
    }
    let cancelled = false
    axios
      .get<InvoiceMatchPreview>('/api/invoice-payment-matches/preview', {
        params: { year_month: activeMonth },
      })
      .then((response) => {
        if (!cancelled) setPaymentPreview(response.data)
      })
      .catch(() => {
        if (!cancelled) setPaymentPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeMonth, invoiceData])

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
      <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <CadastroListPageShell>
          <LoadingSpinner fullScreen message="Carregando filtros..." />
        </CadastroListPageShell>
      </div>
    )
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <CadastroListPageShell>
        <CadastroListPageBody
          scrollRef={scrollContainerRef}
          header={
            <CadastroListPageHero
              icon={<FileText className="w-8 h-8" />}
              title="Relatório de Faturas"
              subtitle="Visualize e analise suas faturas de cartão de crédito consolidadas"
            />
          }
          tabs={
            <div className="space-y-4">
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
              <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
                {/* Emissor */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Landmark size={12} className="inline mr-1 text-color-primary" />
                    Emissor
                  </label>
                  <MultiSelectDropdown
                    label="Emissor"
                    options={ISSUER_FILTER_OPTIONS.map(option => ({
                      id: option.id,
                      name: option.name,
                      icon: <Landmark size={14} />,
                      color: 'var(--color-1)'
                    }))}
                    selectedIds={selectedIssuerIds}
                    onChange={setSelectedIssuerIds}
                    placeholder="Selecione..."
                  />
                </div>

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
          }
        >
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
            <div className={`${selectedItems.size > 0 || showBackToTop ? 'pb-20' : ''}`}>
          {(() => {
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
            const monthItems = activeMonth ? (groupedByMonth[activeMonth] || []) : []

            // Agrupa itens por cartão
            const groupedByCard = monthItems.reduce((acc, item) => {
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
                const cardId = items[0]?.card_id
                const sectionKey = getCardSectionKey(cardName, cardNumber, cardId)
                return { cardName, cardNumber, items, sectionKey }
              })
              .sort((a, b) => {
                return (a.cardNumber || '').localeCompare(b.cardNumber || '', 'pt-BR')
              })
            const cardSectionKeys = sortedCardGroups.map(group => group.sectionKey)

            // Total geral do mês
            const totalAmount = monthItems.reduce((sum, item) => sum + Number(item.amount), 0)

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
                        {monthItems.length} trans.
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

                {/* Seleção em lote + controles de colapso */}
                {monthItems.length > 0 && (
                  <div className="flex items-center justify-between gap-3 mb-4 px-1">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          if (selectAllState === 'none') {
                            selectAllFiltered()
                          } else {
                            clearSelection()
                          }
                        }}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                        title={selectAllState === 'none' ? 'Selecionar todos do mês' : 'Limpar seleção'}
                      >
                        {selectAllState === 'none' && <Square size={18} className="text-gray-400" />}
                        {selectAllState === 'partial' && <MinusSquare size={18} className="text-blue-600" />}
                        {selectAllState === 'all' && <CheckSquare size={18} className="text-blue-600" />}
                      </button>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        Selecionar todos do mês ({monthItems.length} transações)
                      </span>
                    </div>
                    {sortedCardGroups.length > 1 && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => expandAllCards(cardSectionKeys)}
                          className="px-3 py-1.5 text-xs font-medium border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          Expandir Tudo
                        </button>
                        <button
                          onClick={collapseAllCards}
                          className="px-3 py-1.5 text-xs font-medium border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          Recolher Tudo
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Cards de Cartões */}
                <div className="space-y-3">
                  {sortedCardGroups.map(({ cardName, cardNumber, items, sectionKey }) => {
                    const cardTotal = items.reduce((sum, item) => sum + Number(item.amount), 0)
                    const isExpanded = expandedCards.has(sectionKey)
                    const issuerCodes = [...new Set(items.map(item => item.issuer).filter(Boolean))] as Array<'btg' | 'mercadopago'>
                    const chip = issuerCodes.length === 1 ? issuerChip(issuerCodes[0]) : null
                    const cardId = items[0]?.card_id
                    const paymentCycle = paymentPreview?.cycles.find((cycle) => cycle.card_ids.includes(cardId))

                    return (
                      <div key={sectionKey} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => toggleCardCollapse(sectionKey)}
                          className={`w-full flex items-center justify-between gap-4 px-5 py-3.5 text-left border-l-4 bg-gray-100 dark:bg-gray-700/60 hover:bg-gray-200/80 dark:hover:bg-gray-700 transition-colors ${isExpanded ? 'border-b border-gray-200 dark:border-gray-600' : ''}`}
                          style={{ borderLeftColor: 'var(--color-1)' }}
                          title={isExpanded ? 'Recolher transações deste cartão' : 'Expandir transações deste cartão'}
                          aria-expanded={isExpanded}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {isExpanded
                              ? <ChevronDown size={18} className="flex-shrink-0 text-gray-500 dark:text-gray-300" />
                              : <ChevronRight size={18} className="flex-shrink-0 text-gray-500 dark:text-gray-300" />}
                            <span
                              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                              style={{ backgroundColor: 'color-mix(in srgb, var(--color-1) 16%, transparent)' }}
                            >
                              <CreditCard size={16} style={{ color: 'var(--color-1)' }} />
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-bold text-base text-gray-900 dark:text-white truncate">
                                  {cardName}
                                </span>
                                {cardNumber && (
                                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-300 flex-shrink-0 tabular-nums">
                                    •••• {cardNumber.slice(-4)}
                                  </span>
                                )}
                                {chip && (
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${chip.className}`}>
                                    {chip.text}
                                  </span>
                                )}
                                {paymentCycle?.status === 'matched' && paymentCycle.match?.date && (
                                  <span
                                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                                    title={`Pagamento vinculado em ${formatDate(paymentCycle.match.date.includes('T') ? paymentCycle.match.date : `${paymentCycle.match.date}T12:00:00`)}`}
                                  >
                                    <Link2 size={10} />
                                    {formatDate(paymentCycle.match.date.includes('T') ? paymentCycle.match.date : `${paymentCycle.match.date}T12:00:00`)}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                {items.length} {items.length === 1 ? 'lançamento' : 'lançamentos'}
                              </p>
                            </div>
                          </div>
                          <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-white flex-shrink-0">
                            {formatCurrency(cardTotal)}
                          </span>
                        </button>

                        {/* Tabela de Itens */}
                        {isExpanded && (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700">
                              <tr>
                                <th className="px-2 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-10"></th>
                                <th className="px-3 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-12">#</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-28">Data</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">Descrição</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider min-w-[280px] w-72">Tag/Subtag</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-40">Compartilhamento</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-32">Valor</th>
                                <th className="px-3 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-16">Ações</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((item, idx) => (
                                <tr
                                  key={item.id}
                                  className={`border-t border-t-gray-200 dark:border-t-gray-700 border-l-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all ${
                                    isItemSelected(item)
                                      ? 'border-l-blue-600 bg-blue-50 dark:bg-blue-900/20'
                                      : 'border-l-gray-300 dark:border-l-gray-600'
                                  } ${idx % 2 === 0 && !isItemSelected(item) ? 'bg-white dark:bg-gray-800' : ''} ${idx % 2 !== 0 && !isItemSelected(item) ? 'bg-gray-50/50 dark:bg-gray-700/20' : ''}`}
                                  onMouseEnter={(e) => {
                                    if (!isItemSelected(item)) {
                                      e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!isItemSelected(item)) {
                                      e.currentTarget.style.borderLeftColor = ''
                                    }
                                  }}
                                >
                                  <td className="px-2 py-3 text-center w-10">
                                    <button
                                      onClick={() => toggleItemSelection(item)}
                                      disabled={!canSelectItem(item)}
                                      className={`p-1 rounded transition-colors ${
                                        !canSelectItem(item)
                                          ? 'opacity-30 cursor-not-allowed'
                                          : 'hover:bg-gray-200 dark:hover:bg-gray-600'
                                      }`}
                                      title={
                                        !canSelectItem(item)
                                          ? `Não é possível selecionar ${getItemType(item) === 'despesa' ? 'despesas' : 'receitas'} junto com ${selectionType}`
                                          : isItemSelected(item)
                                            ? 'Remover seleção'
                                            : 'Selecionar'
                                      }
                                    >
                                      {isItemSelected(item) ? (
                                        <CheckSquare size={18} className="text-blue-600" />
                                      ) : (
                                        <Square size={18} className={canSelectItem(item) ? 'text-gray-400' : 'text-gray-300'} />
                                      )}
                                    </button>
                                  </td>
                                  <td className="px-3 py-3 text-sm text-center text-gray-500 dark:text-gray-400 w-12">
                                    {idx + 1}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white whitespace-nowrap w-28">
                                    {formatDate(item.date)}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                                    {item.description}
                                    {item.current_installment && item.total_installments && (
                                      <span className="ml-1.5 text-xs text-gray-500 dark:text-gray-400 font-medium">
                                        ({item.current_installment}/{item.total_installments})
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 min-w-[280px] w-72">
                                    {item.tag_name && item.subtag_name
                                      ? `${item.tag_name} > ${item.subtag_name}`
                                      : item.tag_name || '-'}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-left w-40">
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
                                  <td className={`px-4 py-3 text-sm text-right font-semibold w-32 ${Number(item.amount) < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                    {formatCurrency(Number(item.amount))}
                                  </td>
                                  <td className="px-3 py-3 text-center w-16">
                                    <button
                                      onClick={() => handleEdit(item)}
                                      disabled={selectedItems.size > 0}
                                      className={`transition-colors ${
                                        selectedItems.size > 0
                                          ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                          : 'text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300'
                                      }`}
                                      title={selectedItems.size > 0 ? 'Limpe a seleção para editar' : 'Editar tag/subtag e compartilhamento'}
                                    >
                                      <Edit2 size={15} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )
          })()}
            </div>
          )}
        </CadastroListPageBody>
      </CadastroListPageShell>

      {/* Barra Flutuante de Ações em Lote */}
      {selectedItems.size > 0 && (
        <FloatingFooterBar>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-medium text-color-primary">
                {selectedItems.size} {selectionType === 'receita' ? 'receita(s)' : 'despesa(s)'} selecionada(s)
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
                onClick={handleBatchDelete}
                className="px-3 py-1.5 text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold"
                style={{ backgroundColor: 'var(--crud-delete)' }}
              >
                <Trash2 size={14} />
                Excluir
              </button>
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
        </FloatingFooterBar>
      )}

      {/* Barra Flutuante Back to Top */}
      {showBackToTop && selectedItems.size === 0 && (
        <FloatingFooterBar>
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
        </FloatingFooterBar>
      )}

      <ConfirmComponent />

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
          loadInvoiceData()
          if (message) {
            handleShowToast(message, 'success')
          }
        }}
      />

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

