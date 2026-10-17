import { useState, useEffect, useMemo, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageShell,
  reportRowActionBtnClass,
} from '../components/CadastroListPageLayout'
import FloatingFooterBar from '../components/FloatingFooterBar'
import Badge from '../components/Badge'
import LoadingSpinner from '../components/LoadingSpinner'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import EditExpenseModal from '../components/EditExpenseModal'
import BatchEditExpenseModal from '../components/BatchEditExpenseModal'
import BatchMoveInvoiceCardModal from '../components/BatchMoveInvoiceCardModal'
import ManualInvoiceItemModal, { type ManualInvoiceItemContext } from '../components/ManualInvoiceItemModal'
import SortableDateHeader from '../components/SortableDateHeader'
import Toast from '../components/Toast'
import ClosureEditImpactSummaryModal from '../components/ClosureEditImpactSummaryModal'
import type { ClosureEditImpact } from '../types/closureEditImpact'
import type { ExpenseEditSuccessPayload } from '../utils/closureEditImpact'
import {
  sortRowsByDate,
  toggleDateSortDirection,
  type DateSortDirection,
} from '../utils/tableDateSort'
import { useConfirm } from '../hooks/useConfirm'
import { MultiSelectDropdown, SourceMultiSelectDropdown } from '../components/MultiSelectDropdown'
import { CreditCard, Calendar, FileText, Receipt, Filter, X, Search, Tag, Tags, Users, ArrowUp, Edit2, Trash2, CheckSquare, Square, MinusSquare, ChevronDown, ChevronRight, Landmark, Link2, Layers, Plus, ArrowRightLeft, ArrowUpDown } from 'lucide-react'
import type { InvoiceMatchPreview } from '../types/invoiceReconcile'
import { descriptionMatchesSearch, resolveDescriptionSearchState } from '../utils/descriptionSearch'
import { CadastroListHeaderActions } from '../components/CadastroExcelMenu'
import type { FaturaReportExportItem } from '../utils/exportToExcel'
import FaturasExportModal from '../components/FaturasExportModal'

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
  invoice_group_id?: number | null
  invoice_group_name?: string | null
  active?: boolean
}

function isCreditCardForInvoiceReport(type?: string | null): boolean {
  return (type ?? 'credito') === 'credito'
}

interface InvoiceGroup {
  id: number
  name: string
}

interface InvoiceAmountTotals {
  totalAmount: number
  totalCount: number
  totalIncome: number
  totalIncomeCount: number
  totalExpenses: number
  totalExpensesCount: number
}

interface InvoiceCardBucket {
  cardId: number
  cardName: string
  cardNumber: string
  items: InvoiceItem[]
  total: number
  count: number
  groupId: number | null
  sectionKey: string
}

type InvoiceDisplaySection =
  | { kind: 'group'; group: InvoiceGroup; cards: InvoiceCardBucket[]; total: number; count: number }
  | { kind: 'card'; card: InvoiceCardBucket }

type ShareMode = 'all' | 'mine' | 'own' | 'partner'

/** Divide o valor do item entre "minha parte" e a parte do parceiro. */
function itemShares(item: InvoiceItem): { mine: number; partner: number } {
  const amount = Number(item.amount)
  const pct = item.ownership_percentage == null ? 100 : Number(item.ownership_percentage)
  const mine = Math.round(amount * pct) / 100
  return { mine, partner: Math.round((amount - mine) * 100) / 100 }
}

/** Valor usado nos totais: total do item em "all"; minha parte em "mine"/"own"; parte da contraparte em "partner". */
function itemBasisParts(
  item: InvoiceItem,
  mode: ShareMode,
  partnerIds: number[] = [],
): { mine: number; partner: number } {
  const shares = itemShares(item)
  if (mode === 'all') return shares
  if (mode === 'partner') return { mine: 0, partner: shares.partner }
  if (item.shared_partner_id != null && partnerIds.includes(item.shared_partner_id)) {
    // "Minha parte" + conta filtrada: minha parte + parte da contraparte = total do item
    // "Próprio" + conta filtrada: só a parte da contraparte (o "próprio" são os itens sem compartilhamento)
    return mode === 'mine' ? shares : { mine: 0, partner: shares.partner }
  }
  return { mine: shares.mine, partner: 0 }
}

function itemBasisAmount(item: InvoiceItem, mode: ShareMode, partnerIds: number[] = []): number {
  const { mine, partner } = itemBasisParts(item, mode, partnerIds)
  return mine + partner
}

function computeInvoiceAmountTotals(
  items: InvoiceItem[],
  mode: ShareMode = 'all',
  partnerIds: number[] = [],
): InvoiceAmountTotals {
  let totalIncome = 0
  let totalIncomeCount = 0
  let totalExpenses = 0
  let totalExpensesCount = 0
  for (const item of items) {
    const amount = itemBasisAmount(item, mode, partnerIds)
    if (amount > 0) {
      totalIncome += amount
      totalIncomeCount += 1
    } else if (amount < 0) {
      totalExpenses += amount
      totalExpensesCount += 1
    }
  }
  return {
    totalAmount: totalIncome + totalExpenses,
    totalCount: items.length,
    totalIncome,
    totalIncomeCount,
    totalExpenses,
    totalExpensesCount,
  }
}

function buildFaturaExportItems(items: InvoiceItem[]): FaturaReportExportItem[] {
  return items.map((item) => ({
    date: item.date,
    description: item.description,
    amount: item.amount,
    card_number: item.card_number,
    card_name: item.card_name,
    tag_name: item.tag_name,
    subtag_name: item.subtag_name,
    current_installment: item.current_installment,
    total_installments: item.total_installments,
    year_month: item.year_month,
    ownership_percentage: item.ownership_percentage,
    shared_partner_name: item.shared_partner_name,
    issuer: item.issuer,
  }))
}

const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const

function formatYearMonthLabel(yearMonth: string): string {
  if (yearMonth === 'Sem mês') return yearMonth
  const [year, month] = yearMonth.split('-')
  const monthIndex = parseInt(month, 10) - 1
  if (!year || monthIndex < 0 || monthIndex > 11) return yearMonth
  return `${MONTH_SHORT[monthIndex]} ${year}`
}

function formatMonthOnly(yearMonth: string): string {
  if (yearMonth === 'Sem mês') return yearMonth
  const [, month] = yearMonth.split('-')
  const monthIndex = parseInt(month, 10) - 1
  if (monthIndex < 0 || monthIndex > 11) return yearMonth
  return MONTH_SHORT[monthIndex]
}

function getCardSectionKey(cardName: string, cardNumber: string, cardId?: number) {
  return cardId != null ? `card:${cardId}` : `${cardName}|${cardNumber}`
}

/** Líquido da fatura: positivo = receita (verde), negativo = despesa (vermelho). */
function invoiceNetAmountClass(amount: number): string {
  if (amount > 0) return 'text-green-600 dark:text-green-400'
  if (amount < 0) return 'text-red-600 dark:text-red-400'
  return 'text-gray-900 dark:text-white'
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

/** Emissor dominante do cartão (mês atual → histórico no filtro → BTG). */
function resolveCardIssuer(
  cardId: number,
  monthItems: InvoiceItem[],
  allItems: InvoiceItem[],
): 'btg' | 'mercadopago' {
  const dominant = (items: InvoiceItem[]): 'btg' | 'mercadopago' | null => {
    const counts: Partial<Record<'btg' | 'mercadopago', number>> = {}
    for (const item of items) {
      if (item.issuer === 'btg' || item.issuer === 'mercadopago') {
        counts[item.issuer] = (counts[item.issuer] ?? 0) + 1
      }
    }
    const entries = (Object.entries(counts) as Array<['btg' | 'mercadopago', number]>).sort(
      (a, b) => b[1] - a[1],
    )
    return entries[0]?.[0] ?? null
  }
  return dominant(monthItems) ?? dominant(allItems.filter((i) => i.card_id === cardId)) ?? 'btg'
}

const FaturasPage = () => {
  // Hook para ler navigation state
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigationState = location.state as NavigationState | null

  // Estados de filtros
  const [selectedCardIds, setSelectedCardIds] = useState<number[]>([])
  const [selectedYears, setSelectedYears] = useState<string[]>([])
  const [selectedMonths, setSelectedMonths] = useState<string[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [selectedSubtagIds, setSelectedSubtagIds] = useState<number[]>([])
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<number[]>([])
  const [selectedIssuerIds, setSelectedIssuerIds] = useState<number[]>([])
  const [selectedTransactionType, setSelectedTransactionType] = useState<'all' | 'despesa' | 'receita'>('all')
  const [appliedTransactionType, setAppliedTransactionType] = useState<'all' | 'despesa' | 'receita'>('all')
  const [appliedShareMode, setAppliedShareMode] = useState<ShareMode>('all')
  const [appliedPartnerNames, setAppliedPartnerNames] = useState<string[]>([])
  const [appliedPartnerIds, setAppliedPartnerIds] = useState<number[]>([])

  // Estados de busca
  const [searchTerm, setSearchTerm] = useState('')
  const [searchAmount, setSearchAmount] = useState('')
  const [dateSortDirection, setDateSortDirection] = useState<DateSortDirection>('desc')

  // Flag para controlar se os filtros iniciais já foram aplicados
  const [initialFiltersApplied, setInitialFiltersApplied] = useState(false)
  // Flag para auto-aplicar filtros quando vindo da HomePage
  const [shouldAutoApply, setShouldAutoApply] = useState(false)

  // Estados de dados
  const [cards, setCards] = useState<CreditCardOption[]>([])
  const [invoiceGroups, setInvoiceGroups] = useState<InvoiceGroup[]>([])
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
  const [batchEditSharingOnly, setBatchEditSharingOnly] = useState(false)
  const [isBatchMoveCardModalOpen, setIsBatchMoveCardModalOpen] = useState(false)
  const [moveCardModalItems, setMoveCardModalItems] = useState<{ id: number; source: 'card' }[]>([])
  const [moveCardModalExcludeId, setMoveCardModalExcludeId] = useState<number | null>(null)
  const [manualInvoiceContext, setManualInvoiceContext] = useState<ManualInvoiceItemContext | null>(null)

  // Seleção em lote
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())

  // Seções de cartão expandidas (vazio = todas recolhidas)
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())
  const [paymentPreview, setPaymentPreview] = useState<InvoiceMatchPreview | null>(null)

  // Toast
  const [showToast, setShowToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const [closureSummary, setClosureSummary] = useState<{
    baseMessage: string
    impact: ClosureEditImpact
  } | null>(null)

  const handleExpenseEditSuccess = (result: ExpenseEditSuccessPayload) => {
    loadInvoiceData({ preserveTabs: true, preserveExpandedCards: true })
    if (result.closureImpact) {
      setClosureSummary({ baseMessage: result.message, impact: result.closureImpact })
    } else {
      handleShowToast(result.message, 'success')
    }
  }

  const { showConfirm, ConfirmComponent } = useConfirm()

  // Estado para botão Back to Top
  const [showBackToTop, setShowBackToTop] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)

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

    // Adiciona "Próprio" (sem compartilhamento) como primeira opção
    return [
      { id: -2, name: 'Minha Parte (próprio + compartilhado)' },
      { id: -1, name: 'Próprio (100% meu)' },
      ...options,
    ]
  }, [partners])

  const tagOptions = useMemo(
    () => [{ id: -1, name: '(Vazio)', count: undefined as number | undefined }, ...tags],
    [tags],
  )

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

  // Aplica filtros do navigation state ou da URL (Home, Extrato, nova aba)
  useEffect(() => {
    if (initialFiltersApplied || cards.length === 0) return

    const yearMonthFromUrl = searchParams.get('yearMonth') ?? undefined
    const selectAllParam = searchParams.get('selectAllCards')
    const selectAllFromUrl = selectAllParam === '1' || selectAllParam === 'true'
    const yearMonth = navigationState?.yearMonth ?? yearMonthFromUrl
    const selectAllCards = navigationState?.selectAllCards === true || selectAllFromUrl

    if (!yearMonth && !selectAllCards) return

    if (yearMonth) {
      const [year, month] = yearMonth.split('-')
      setSelectedYears([year])
      setSelectedMonths([month.padStart(2, '0')])
      setActiveYear(year)
      setActiveMonth(yearMonth)
    }
    if (selectAllCards) {
      setSelectedCardIds(cards.map((c) => c.id))
    }
    setInitialFiltersApplied(true)
    setShouldAutoApply(true)

    if (yearMonthFromUrl || selectAllParam) {
      const next = new URLSearchParams(searchParams)
      next.delete('yearMonth')
      next.delete('selectAllCards')
      setSearchParams(next, { replace: true })
    } else if (navigationState) {
      window.history.replaceState({}, document.title)
    }
  }, [navigationState, initialFiltersApplied, cards, searchParams, setSearchParams])

  const loadCards = async () => {
    setCardsLoading(true)
    try {
      const [cartoesRes, groupsRes] = await Promise.all([
        axios.get('/api/cartoes', { params: { incluir_inativos: true } }),
        axios.get('/api/cartoes/invoice-groups'),
      ])
      const creditCards = (
        cartoesRes.data as Array<{
          id: number
          name?: string
          number: string
          type?: string
          invoice_group_id?: number | null
          invoice_group_name?: string | null
          active?: boolean
        }>
      ).filter((c) => isCreditCardForInvoiceReport(c.type))

      setCards(
        creditCards.map((c) => ({
          id: c.id,
          name: c.name || 'Sem nome',
          number: c.number,
          type: c.type || 'credito',
          invoice_group_id: c.invoice_group_id ?? null,
          invoice_group_name: c.invoice_group_name ?? null,
          active: c.active !== false,
        })),
      )
      setSelectedCardIds((prev) => prev.filter((id) => creditCards.some((c) => c.id === id)))
      setInvoiceGroups(groupsRes.data)
    } catch (error) {
      console.error('Erro ao carregar cartões:', error)
    } finally {
      setCardsLoading(false)
    }
  }

  type InvoiceFilterSnapshot = {
    selectedCardIds: number[]
    selectedYears: string[]
    selectedMonths: string[]
    selectedTagIds: number[]
    selectedSubtagIds: number[]
    selectedPartnerIds: number[]
    selectedIssuerIds: number[]
  }

  const buildInvoiceRequestParams = (filters: InvoiceFilterSnapshot) => {
    const params: Record<string, string | undefined> = {}

    if (filters.selectedCardIds.length > 0) {
      params.card_ids = filters.selectedCardIds.join(',')
    }
    if (filters.selectedYears.length > 0) {
      params.years = filters.selectedYears.join(',')
    }
    if (filters.selectedMonths.length > 0) {
      params.months = filters.selectedMonths.join(',')
    }

    const hasEmptyTag = filters.selectedTagIds.includes(-1)
    const realTagIds = filters.selectedTagIds.filter((id) => id !== -1)
    if (realTagIds.length > 0) {
      params.tag_ids = realTagIds.join(',')
    }
    if (hasEmptyTag) {
      params.include_empty_tag = 'true'
    }
    if (filters.selectedSubtagIds.length > 0) {
      params.subtag_ids = filters.selectedSubtagIds.join(',')
    }

    const hasEmptySharing = filters.selectedPartnerIds.includes(-1)
    const realPartnerIds = filters.selectedPartnerIds.filter((id) => id !== -1)
    if (realPartnerIds.length > 0) {
      params.partner_ids = realPartnerIds.join(',')
    }
    if (hasEmptySharing) {
      params.include_empty_sharing = 'true'
    }
    if (filters.selectedIssuerIds.length > 0) {
      const issuerCodes = filters.selectedIssuerIds
        .map((id) => ISSUER_FILTER_OPTIONS.find((option) => option.id === id)?.code)
        .filter((code): code is 'btg' | 'mercadopago' => Boolean(code))
      if (issuerCodes.length > 0) {
        params.issuers = issuerCodes.join(',')
      }
    }

    return params
  }

  type LoadInvoiceDataOptions = {
    /** Mantém ano/mês das abas de período (ex.: após incluir ou editar lançamento). */
    preserveTabs?: boolean
    /** Não recolhe os painéis de cartão ao recarregar. */
    preserveExpandedCards?: boolean
    /** Usado ao limpar filtros antes do React aplicar o setState. */
    filters?: InvoiceFilterSnapshot
  }

  const loadInvoiceData = async (options?: LoadInvoiceDataOptions) => {
    setLoading(true)
    setError(null)
    setAppliedTransactionType(options?.filters ? 'all' : selectedTransactionType)
    const tabsToRestore = options?.preserveTabs
      ? { year: activeYear, month: activeMonth }
      : null
    const filters = options?.filters ?? {
      selectedCardIds,
      selectedYears,
      selectedMonths,
      selectedTagIds,
      selectedSubtagIds,
      selectedPartnerIds,
      selectedIssuerIds,
    }
    const realPartnerIdsApplied = filters.selectedPartnerIds.filter((id) => id > 0)
    setAppliedShareMode(
      filters.selectedPartnerIds.includes(-2)
        ? 'mine'
        : filters.selectedPartnerIds.includes(-1)
          ? 'own'
          : realPartnerIdsApplied.length > 0
            ? 'partner'
            : 'all',
    )
    setAppliedPartnerIds(realPartnerIdsApplied)
    setAppliedPartnerNames(
      partnerOptions.filter((o) => realPartnerIdsApplied.includes(o.id)).map((o) => o.name),
    )
    try {
      const params = buildInvoiceRequestParams(filters)

      const response = await axios.get('/api/reports/invoices', { params })
      setInvoiceData(response.data)
      if (!options?.preserveExpandedCards) {
        setExpandedCards(new Set())
      }

      // Define ano e mês das abas de período
      if (tabsToRestore?.month) {
        setActiveYear(tabsToRestore.month.split('-')[0])
        setActiveMonth(tabsToRestore.month)
      } else if (tabsToRestore?.year) {
        setActiveYear(tabsToRestore.year)
      } else if (response.data.items.length > 0) {
        const firstItem = response.data.items[0]
        const year = firstItem.year_month.split('-')[0]
        setActiveYear(year)
        setActiveMonth(firstItem.year_month)
      } else if (filters.selectedYears.length === 1 && filters.selectedMonths.length === 1) {
        setActiveYear(filters.selectedYears[0])
        setActiveMonth(`${filters.selectedYears[0]}-${filters.selectedMonths[0].padStart(2, '0')}`)
      } else if (filters.selectedYears.length === 1) {
        setActiveYear(filters.selectedYears[0])
        setActiveMonth('')
      } else {
        setActiveYear('')
        setActiveMonth('')
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

  const clearFilters = () => {
    setSelectedCardIds([])
    setSelectedYears([])
    setSelectedMonths([])
    setSelectedTagIds([])
    setSelectedSubtagIds([])
    setSelectedPartnerIds([])
    setSelectedIssuerIds([])
    setSelectedTransactionType('all')
    setSearchTerm('')
    setSearchAmount('')
  }

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
  const hasActiveFilters = selectedCardIds.length > 0 || selectedYears.length > 0 || selectedMonths.length > 0 ||
    selectedTagIds.length > 0 || selectedSubtagIds.length > 0 || selectedPartnerIds.length > 0 ||
    selectedIssuerIds.length > 0 || selectedTransactionType !== 'all' ||
    searchTerm !== '' || searchAmount !== ''

  const handleEdit = (item: InvoiceItem) => {
    setItemToEdit(item)
    setIsEditModalOpen(true)
  }

  const handleShowToast = (message: string, type: 'success' | 'error') => {
    setToastMessage(message)
    setToastType(type)
    setShowToast(true)
  }

  const [exportModalFormat, setExportModalFormat] = useState<'excel' | 'pdf' | null>(null)

  const descriptionSearch = useMemo(() => resolveDescriptionSearchState(searchTerm), [searchTerm])

  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const creditCardIds = useMemo(() => new Set(cards.map((c) => c.id)), [cards])

  const filteredItems = useMemo(() => {
    if (!invoiceData?.items) return []

    return invoiceData.items.filter(item => {
      if (creditCardIds.size > 0 && !creditCardIds.has(item.card_id)) {
        return false
      }

      if (appliedTransactionType !== 'all') {
        const isExpense = Number(item.amount) < 0
        if ((appliedTransactionType === 'despesa') !== isExpense) return false
      }

      const matchesText = descriptionMatchesSearch(item.description, searchTerm)

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
  }, [invoiceData, searchTerm, searchAmount, creditCardIds, appliedTransactionType])

  const currentItems = useMemo(() => {
    if (!activeMonth) return []
    return filteredItems.filter(item => item.year_month === activeMonth)
  }, [filteredItems, activeMonth])

  const activeMonthTotals = useMemo(
    () => computeInvoiceAmountTotals(currentItems, appliedShareMode, appliedPartnerIds),
    [currentItems, appliedShareMode, appliedPartnerIds],
  )

  const filteredScopeTotals = useMemo(
    () => computeInvoiceAmountTotals(filteredItems, appliedShareMode, appliedPartnerIds),
    [filteredItems, appliedShareMode, appliedPartnerIds],
  )

  // --color-1 é reservado para "Próprio"/"Minha parte"; cada conta usa --color-2..5 (cíclico).
  const badgeColorStyle = (n: number) => {
    const idx = ((n - 1) % 5) + 1
    return { backgroundColor: `var(--color-${idx})`, color: `var(--on-color-${idx})` }
  }
  const accountBadgeStyle = (index: number) => badgeColorStyle(2 + (index % 4))
  const badgeClass =
    'ml-2 inline-flex items-center rounded px-2 py-0.5 text-xs font-medium normal-case'

  const shareBadge =
    appliedShareMode === 'all' ? null : appliedShareMode === 'partner' ? (
      <>
        {appliedPartnerNames.map((name, i) => (
          <span key={name} className={badgeClass} style={accountBadgeStyle(i)}>
            {name}
          </span>
        ))}
      </>
    ) : (
      <>
        <span className={badgeClass} style={badgeColorStyle(1)}>
          {appliedShareMode === 'mine' ? 'Minha parte' : 'Próprio'}
        </span>
        {(appliedShareMode === 'mine' || appliedShareMode === 'own') &&
          appliedPartnerNames.map((name, i) => (
            <span key={name} className={badgeClass} style={accountBadgeStyle(i)}>
              {name}
            </span>
          ))}
      </>
    )

  const sumParts = (items: InvoiceItem[]) =>
    items.reduce(
      (acc, i) => {
        const p = appliedShareMode === 'partner' ? itemShares(i) : itemBasisParts(i, appliedShareMode, appliedPartnerIds)
        return { mine: acc.mine + p.mine, partner: acc.partner + p.partner }
      },
      { mine: 0, partner: 0 },
    )

  const renderScorecardParts = (items: InvoiceItem[]) => {
    const parts = sumParts(items)
    const total = parts.mine + parts.partner
    return (
      <div className="mt-1 flex items-stretch divide-x divide-gray-200 tabular-nums dark:divide-gray-600">
        <div className="pr-3">
          <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Minha parte</p>
          <p className={`text-sm font-semibold ${invoiceNetAmountClass(parts.mine)}`}>{formatCurrency(parts.mine)}</p>
        </div>
        <div className="px-3">
          <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Compartilhado</p>
          <p className={`text-sm font-semibold ${invoiceNetAmountClass(parts.partner)}`}>{formatCurrency(parts.partner)}</p>
        </div>
        <div className="pl-3">
          <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Total</p>
          <p className={`text-sm font-semibold ${invoiceNetAmountClass(total)}`}>{formatCurrency(total)}</p>
        </div>
      </div>
    )
  }

  const invoicePeriodIndex = useMemo(() => {
    const groupedByMonth = filteredItems.reduce((acc, item) => {
      const month = item.year_month || 'Sem mês'
      if (!acc[month]) acc[month] = []
      acc[month].push(item)
      return acc
    }, {} as Record<string, InvoiceItem[]>)

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

    return { groupedByMonth, sortedYears, groupedByYear }
  }, [filteredItems])

  const monthsOfActiveYear = activeYear
    ? invoicePeriodIndex.groupedByYear[activeYear] || []
    : []

  const activeYearItems = useMemo(() => {
    if (!activeYear) return []
    const monthSet = new Set(monthsOfActiveYear)
    return filteredItems.filter((item) => monthSet.has(item.year_month || ''))
  }, [filteredItems, activeYear, monthsOfActiveYear])

  const activeYearTotals = useMemo(
    () => computeInvoiceAmountTotals(activeYearItems, appliedShareMode, appliedPartnerIds),
    [activeYearItems, appliedShareMode, appliedPartnerIds],
  )

  const monthCardBuckets = useMemo((): InvoiceCardBucket[] => {
    const byCard = new Map<number, InvoiceItem[]>()
    for (const item of currentItems) {
      const list = byCard.get(item.card_id) || []
      list.push(item)
      byCard.set(item.card_id, list)
    }
    return Array.from(byCard.entries())
      .map(([cardId, items]) => {
        const meta = cardsById.get(cardId)
        const cardName = items[0]?.card_name || meta?.name || 'Cartão'
        const cardNumber = items[0]?.card_number || meta?.number || ''
        return {
          cardId,
          cardName,
          cardNumber,
          items,
          total: items.reduce((sum, i) => sum + itemBasisAmount(i, appliedShareMode, appliedPartnerIds), 0),
          count: items.length,
          groupId: meta?.invoice_group_id ?? null,
          sectionKey: getCardSectionKey(cardName, cardNumber, cardId),
        }
      })
      .sort((a, b) => (a.cardNumber || '').localeCompare(b.cardNumber || '', 'pt-BR'))
  }, [currentItems, cardsById, appliedShareMode, appliedPartnerIds])

  const invoiceDisplaySections = useMemo((): InvoiceDisplaySection[] => {
    const sections: InvoiceDisplaySection[] = []
    const assigned = new Set<number>()

    for (const group of invoiceGroups) {
      const cardsInGroup = monthCardBuckets.filter((b) => b.groupId === group.id)
      if (cardsInGroup.length === 0) continue
      cardsInGroup.forEach((c) => assigned.add(c.cardId))
      sections.push({
        kind: 'group',
        group,
        cards: cardsInGroup,
        total: cardsInGroup.reduce((s, c) => s + c.total, 0),
        count: cardsInGroup.reduce((s, c) => s + c.count, 0),
      })
    }

    for (const bucket of monthCardBuckets) {
      if (!assigned.has(bucket.cardId)) {
        sections.push({ kind: 'card', card: bucket })
      }
    }

    return sections
  }, [invoiceGroups, monthCardBuckets])

  const cardSectionKeys = useMemo(
    () => monthCardBuckets.map((b) => b.sectionKey),
    [monthCardBuckets],
  )

  /** Cartões com lançamentos no mês ativo, independente dos filtros de tela (tipo, tag, etc.). */
  const invoiceCardMoveOptions = useMemo(() => {
    if (!activeMonth || !invoiceData?.items) return []
    const byCard = new Map<number, { cardId: number; cardName: string; cardNumber: string }>()
    for (const item of invoiceData.items) {
      if (item.year_month !== activeMonth || byCard.has(item.card_id)) continue
      if (creditCardIds.size > 0 && !creditCardIds.has(item.card_id)) continue
      const meta = cardsById.get(item.card_id)
      byCard.set(item.card_id, {
        cardId: item.card_id,
        cardName: item.card_name || meta?.name || 'Cartão',
        cardNumber: item.card_number || meta?.number || '',
      })
    }
    return Array.from(byCard.values()).sort((a, b) =>
      (a.cardNumber || '').localeCompare(b.cardNumber || '', 'pt-BR'),
    )
  }, [invoiceData, activeMonth, cardsById, creditCardIds])

  const expandedCardsKey = useMemo(
    () => [...expandedCards].sort().join('\0'),
    [expandedCards],
  )

  // Detecta scroll para mostrar/esconder botão Back to Top
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const updateBackToTop = () => {
      setShowBackToTop(container.scrollTop > 300)
    }

    updateBackToTop()
    container.addEventListener('scroll', updateBackToTop, { passive: true })

    let resizeObserver: ResizeObserver | undefined
    const contentEl = scrollContentRef.current
    if (contentEl && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateBackToTop)
      resizeObserver.observe(contentEl)
    }

    return () => {
      container.removeEventListener('scroll', updateBackToTop)
      resizeObserver?.disconnect()
    }
  }, [
    filtersLoading,
    loading,
    invoiceData,
    filteredItems.length,
    activeMonth,
    expandedCardsKey,
    invoiceDisplaySections.length,
  ])

  const scrollToTop = () => {
    setShowBackToTop(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const getItemKey = (item: InvoiceItem) => `card:${item.id}`
  const getItemType = (item: InvoiceItem): 'despesa' | 'receita' =>
    Number(item.amount) < 0 ? 'despesa' : 'receita'

  const isItemSelected = (item: InvoiceItem) => selectedItems.has(getItemKey(item))

  const selectedInvoiceItems = useMemo(() => {
    if (selectedItems.size === 0) return [] as InvoiceItem[]
    const idSet = new Set(
      Array.from(selectedItems).map((key) => parseInt(key.split(':')[1], 10)),
    )
    return filteredItems.filter((item) => idSet.has(item.id))
  }, [selectedItems, filteredItems])

  const batchCardMoveOptions = useMemo(() => {
    const sourceCards = new Set(selectedInvoiceItems.map((item) => item.card_id))
    if (sourceCards.size !== 1) return invoiceCardMoveOptions
    const [sourceCardId] = sourceCards
    return invoiceCardMoveOptions.filter((c) => c.cardId !== sourceCardId)
  }, [selectedInvoiceItems, invoiceCardMoveOptions])

  /** Tag/subtag em lote exige um único tipo (receita vs despesa); null = seleção mista. */
  const batchEditExpenseType = useMemo((): 'despesa' | 'receita' | null => {
    if (selectedInvoiceItems.length === 0) return null
    let hasDespesa = false
    let hasReceita = false
    for (const item of selectedInvoiceItems) {
      if (getItemType(item) === 'receita') hasReceita = true
      else hasDespesa = true
      if (hasDespesa && hasReceita) return null
    }
    return hasReceita ? 'receita' : 'despesa'
  }, [selectedInvoiceItems])

  const toggleItemSelection = (item: InvoiceItem) => {
    const key = getItemKey(item)
    const newSelected = new Set(selectedItems)

    if (newSelected.has(key)) {
      newSelected.delete(key)
    } else {
      newSelected.add(key)
    }

    setSelectedItems(newSelected)
  }

  const selectAllFiltered = () => {
    if (currentItems.length === 0) return

    const newSelected = new Set(selectedItems)
    currentItems.forEach((item) => {
      newSelected.add(getItemKey(item))
    })

    setSelectedItems(newSelected)
  }

  const selectAllGlobalFiltered = () => {
    if (filteredItems.length === 0) return

    const newSelected = new Set<string>()
    filteredItems.forEach((item) => {
      newSelected.add(getItemKey(item))
    })
    setSelectedItems(newSelected)
  }

  const clearSelection = () => {
    setSelectedItems(new Set())
  }

  const getSelectedItemsForApi = () => {
    return Array.from(selectedItems).map(key => {
      const [, id] = key.split(':')
      return { id: parseInt(id), source: 'card' as const }
    })
  }

  const openMoveCardModal = (
    items: { id: number; source: 'card' }[],
    excludeCardId: number | null = null,
  ) => {
    setMoveCardModalItems(items)
    setMoveCardModalExcludeId(excludeCardId)
    setIsBatchMoveCardModalOpen(true)
  }

  const closeMoveCardModal = () => {
    setIsBatchMoveCardModalOpen(false)
    setMoveCardModalItems([])
    setMoveCardModalExcludeId(null)
  }

  const selectAllState = useMemo(() => {
    if (selectedItems.size === 0 || currentItems.length === 0) return 'none'

    const selectedCount = currentItems.filter((item) =>
      selectedItems.has(getItemKey(item)),
    ).length
    if (selectedCount === 0) return 'none'
    if (selectedCount === currentItems.length) return 'all'
    return 'partial'
  }, [selectedItems, currentItems])

  const selectAllGlobalState = useMemo(() => {
    if (filteredItems.length === 0) return 'none'

    const selectedCount = filteredItems.filter((item) =>
      selectedItems.has(getItemKey(item)),
    ).length
    if (selectedCount === 0) return 'none'
    if (selectedCount === filteredItems.length) return 'all'
    return 'partial'
  }, [selectedItems, filteredItems])

  const allFilteredSelected = selectAllGlobalState === 'all'

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
      loadInvoiceData({ preserveTabs: true, preserveExpandedCards: true })
    } catch (error: any) {
      console.error('Erro ao excluir em lote:', error)
      handleShowToast(error.response?.data?.detail || 'Erro ao excluir registros', 'error')
    }
  }

  const handleDeleteItem = async (item: InvoiceItem) => {
    const confirmed = await showConfirm({
      title: 'Excluir lançamento',
      message: `Excluir "${item.description}" (${formatCurrency(Number(item.amount))})? Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      type: 'danger',
    })

    if (!confirmed) return

    try {
      await axios.delete(`/api/expenses/credit-card-invoices/${item.id}`)
      handleShowToast('Lançamento excluído com sucesso!', 'success')
      loadInvoiceData({ preserveTabs: true, preserveExpandedCards: true })
    } catch (error: unknown) {
      console.error('Erro ao excluir lançamento:', error)
      const detail = axios.isAxiosError(error) ? error.response?.data?.detail : null
      handleShowToast(typeof detail === 'string' ? detail : 'Erro ao excluir lançamento', 'error')
    }
  }

  useEffect(() => {
    setSelectedItems(new Set())
    setExpandedCards(new Set())
  }, [activeMonth, activeYear])

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

  const renderInvoiceCardPanel = (bucket: InvoiceCardBucket) => {
    const { cardName, cardNumber, items, sectionKey, cardId } = bucket
    // No filtro "Compartilhado", o painel mostra as duas partes reais e o total é a soma delas.
    const cardParts = items.reduce(
      (acc, i) => {
        const p = appliedShareMode === 'partner' ? itemShares(i) : itemBasisParts(i, appliedShareMode, appliedPartnerIds)
        return { mine: acc.mine + p.mine, partner: acc.partner + p.partner }
      },
      { mine: 0, partner: 0 },
    )
    const cardTotal = cardParts.mine + cardParts.partner
    const sortedItems = sortRowsByDate(
      items,
      (item) => item.date,
      dateSortDirection,
      (a, b) => a.id - b.id,
    )
    const isExpanded = expandedCards.has(sectionKey)
    const issuerCodes = [...new Set(items.map((item) => item.issuer).filter(Boolean))] as Array<
      'btg' | 'mercadopago'
    >
    const chip = issuerCodes.length === 1 ? issuerChip(issuerCodes[0]) : null
    const paymentCycle = paymentPreview?.cycles.find((cycle) => cycle.card_ids.includes(cardId))
    const cardMeta = cardsById.get(cardId)
    const canManualAdjust = Boolean(activeMonth) && isCreditCardForInvoiceReport(cardMeta?.type)
    const openManualAdjust = (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      if (!activeMonth || !canManualAdjust) return
      setManualInvoiceContext({
        cardId,
        cardName,
        cardNumber,
        yearMonth: activeMonth,
        issuer: resolveCardIssuer(cardId, items, filteredItems),
      })
    }

    return (
      <div
        key={sectionKey}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
      >
        <div
          className={`flex items-stretch border-l-4 bg-gray-100 dark:bg-gray-700/60 ${isExpanded ? 'border-b border-gray-200 dark:border-gray-600' : ''}`}
          style={{ borderLeftColor: 'var(--color-1)' }}
        >
          <button
            type="button"
            onClick={() => toggleCardCollapse(sectionKey)}
            className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-2.5 text-left hover:bg-gray-200/80 dark:hover:bg-gray-700 transition-colors"
            title={isExpanded ? 'Recolher transações deste cartão' : 'Expandir transações deste cartão'}
            aria-expanded={isExpanded}
          >
            {isExpanded ? (
              <ChevronDown size={16} className="flex-shrink-0 text-gray-500 dark:text-gray-300" />
            ) : (
              <ChevronRight size={16} className="flex-shrink-0 text-gray-500 dark:text-gray-300" />
            )}
            <span
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-1) 16%, transparent)' }}
            >
              <CreditCard size={15} style={{ color: 'var(--color-1)' }} />
            </span>
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="font-bold text-sm text-gray-900 dark:text-white truncate">{cardName}</span>
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
              <Badge variant="count" tone="brand3" label={String(items.length)} />
              {paymentCycle?.status === 'matched' && paymentCycle.match?.date && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                  title={`Pagamento vinculado em ${formatDate(paymentCycle.match.date.includes('T') ? paymentCycle.match.date : `${paymentCycle.match.date}T12:00:00`)}`}
                >
                  <Link2 size={10} />
                  {formatDate(
                    paymentCycle.match.date.includes('T')
                      ? paymentCycle.match.date
                      : `${paymentCycle.match.date}T12:00:00`,
                  )}
                </span>
              )}
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-2 border-l border-gray-200 px-3 dark:border-gray-600">
            {shareBadge ? (
              <>
                {shareBadge}
                <div className="self-stretch border-l border-gray-200 dark:border-gray-600" aria-hidden="true" />
              </>
            ) : null}
            <div className="flex items-stretch divide-x divide-gray-200 text-right tabular-nums dark:divide-gray-600">
              <div className="px-3">
                <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Minha parte</p>
                <p className={`text-sm font-semibold ${invoiceNetAmountClass(cardParts.mine)}`}>
                  {formatCurrency(cardParts.mine)}
                </p>
              </div>
              <div className="px-3">
                <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Compartilhado</p>
                <p className={`text-sm font-semibold ${invoiceNetAmountClass(cardParts.partner)}`}>
                  {formatCurrency(cardParts.partner)}
                </p>
              </div>
              <div className="pl-3">
                <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Total</p>
                <p className={`text-base font-bold ${invoiceNetAmountClass(cardTotal)}`}>
                  {formatCurrency(cardTotal)}
                </p>
              </div>
            </div>
            {canManualAdjust ? (
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={openManualAdjust}
                className={reportRowActionBtnClass(true)}
                title="Adicionar lançamento manual nesta fatura"
                aria-label="Adicionar lançamento"
              >
                <Plus size={18} />
              </button>
            ) : null}
          </div>
        </div>

        {isExpanded && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-10"></th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-12">
                    #
                  </th>
                  <SortableDateHeader
                    sortDirection={dateSortDirection}
                    onToggle={() => setDateSortDirection(toggleDateSortDirection(dateSortDirection))}
                    className="px-4 py-3 text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-28"
                  />
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    Descrição
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-36">
                    Tag
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-36">
                    Subtag
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-40">
                    Compartilhamento
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-32">
                    Minha parte
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-32">
                    Compartilhado
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-32">
                    Total
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider w-28">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item, idx) => (
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
                        className="p-1 rounded transition-colors hover:bg-gray-200 dark:hover:bg-gray-600"
                        title={isItemSelected(item) ? 'Remover seleção' : 'Selecionar'}
                      >
                        {isItemSelected(item) ? (
                          <CheckSquare size={18} className="text-blue-600" />
                        ) : (
                          <Square size={18} className="text-gray-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-sm text-center text-gray-500 dark:text-gray-400 w-12">{idx + 1}</td>
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
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white w-36">{item.tag_name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white w-36">{item.subtag_name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-left w-40">
                      <SharedAccountDisplay
                        account={
                          item.shared_partner_name
                            ? {
                                id: 0,
                                name: item.shared_partner_name,
                                bank: item.shared_partner_bank ? { name: item.shared_partner_bank } : null,
                                agency: item.shared_partner_agency,
                                account_number: item.shared_partner_account_number,
                              }
                            : null
                        }
                        ownershipPercentage={item.ownership_percentage}
                      />
                    </td>
                    <td
                      className={`px-4 py-3 text-sm text-right w-32 ${itemShares(item).mine < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}
                    >
                      {formatCurrency(itemShares(item).mine)}
                    </td>
                    <td
                      className={`px-4 py-3 text-sm text-right w-32 ${itemShares(item).partner < 0 ? 'text-red-600 dark:text-red-400' : itemShares(item).partner > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}
                    >
                      {formatCurrency(itemShares(item).partner)}
                    </td>
                    <td
                      className={`px-4 py-3 text-sm text-right font-semibold w-32 ${Number(item.amount) < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}
                    >
                      {formatCurrency(Number(item.amount))}
                    </td>
                    <td className="px-3 py-3 text-center w-28">
                      <div className="flex items-center justify-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleEdit(item)}
                          disabled={selectedItems.size > 0}
                          className={reportRowActionBtnClass(selectedItems.size === 0)}
                          title={
                            selectedItems.size > 0
                              ? 'Limpe a seleção para editar'
                              : 'Editar lançamento'
                          }
                        >
                          <Edit2 size={18} />
                        </button>
                        {invoiceCardMoveOptions.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              openMoveCardModal([{ id: item.id, source: 'card' }], cardId)
                            }
                            disabled={selectedItems.size > 0}
                            className={reportRowActionBtnClass(selectedItems.size === 0)}
                            title={
                              selectedItems.size > 0
                                ? 'Limpe a seleção para mover'
                                : 'Mover para outro cartão desta fatura'
                            }
                          >
                            <ArrowRightLeft size={18} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleDeleteItem(item)}
                          disabled={selectedItems.size > 0}
                          className={reportRowActionBtnClass(selectedItems.size === 0, 'danger')}
                          title={selectedItems.size > 0 ? 'Limpe a seleção para excluir' : 'Excluir lançamento'}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
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
              actions={
                <CadastroListHeaderActions
                  menu={{
                    menuTitle: 'Exportar',
                    onExportExcel: () => {
                      if (!filteredItems.length) {
                        handleShowToast('Nenhum dado para exportar', 'error')
                        return
                      }
                      setExportModalFormat('excel')
                    },
                    extraItems: [
                      {
                        id: 'pdf',
                        label: 'Exportar PDF',
                        icon: <FileText size={16} />,
                        onClick: () => {
                          if (!filteredItems.length) {
                            handleShowToast('Nenhum dado para exportar', 'error')
                            return
                          }
                          setExportModalFormat('pdf')
                        },
                      },
                    ],
                  }}
                >
                  {null}
                </CadastroListHeaderActions>
              }
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
              <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
                {/* Ano */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Calendar size={12} className="inline mr-1 text-color-primary" />
                    Ano
                  </label>
                  <SourceMultiSelectDropdown
                    label="Ano"
                    options={yearOptions.map((year) => ({
                      id: year,
                      name: year,
                      icon: <Calendar size={14} />,
                      color: 'var(--color-1)',
                    }))}
                    selectedIds={selectedYears}
                    onChange={setSelectedYears}
                    placeholder="Selecione..."
                  />
                </div>

                {/* Mês */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    <Calendar size={12} className="inline mr-1 text-color-primary" />
                    Mês
                  </label>
                  <SourceMultiSelectDropdown
                    label="Mês"
                    options={monthOptions.map((m) => ({
                      id: m.value,
                      name: m.label,
                      icon: <Calendar size={14} />,
                      color: 'var(--color-1)',
                    }))}
                    selectedIds={selectedMonths}
                    onChange={setSelectedMonths}
                    placeholder="Selecione..."
                  />
                </div>

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
                      badge: c.active === false ? 'Inativo' : undefined,
                      icon: <CreditCard size={14} />,
                      color: 'var(--color-2)',
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
                    options={tagOptions}
                    selectedIds={selectedTagIds}
                    onChange={(ids) => {
                      setSelectedTagIds(ids)
                      if (!ids.some((id) => id !== -1)) {
                        setSelectedSubtagIds([])
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
                  onClick={() => loadInvoiceData()}
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
            <div className="flex flex-col gap-4 md:flex-row md:items-start">
              {/* Busca por Descrição */}
              <div className="min-w-0 flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    type="text"
                    placeholder="Buscar descrição (texto ou regex)…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <X size={20} />
                    </button>
                  )}
                </div>
                {searchTerm.trim() ? (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {descriptionSearch.mode === 'pattern' ? 'Busca por texto (contém)' : 'Busca por regex'}
                    {descriptionSearch.regexError ? ` — ${descriptionSearch.regexError}` : ''}
                  </p>
                ) : null}
              </div>

              {/* Busca por Valor Exato */}
              <div className="relative w-full shrink-0 md:w-[8.75rem]">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex w-8 items-center justify-center text-xs font-semibold leading-none text-gray-400">
                  R$
                </span>
                <input
                  type="text"
                  placeholder="0,00"
                  value={searchAmount}
                  onChange={(e) => setSearchAmount(e.target.value)}
                  className="h-[38px] w-full rounded-lg border border-gray-300 bg-white py-2 pl-8 pr-8 text-sm text-gray-900 focus:border-color-primary focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
                {searchAmount && (
                  <button
                    type="button"
                    onClick={() => setSearchAmount('')}
                    className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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

          {!loading && !error && invoiceData && filteredItems.length === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-full">
                  <Receipt className="h-12 w-12 text-gray-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Nenhuma transação encontrada
                  </h3>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Não há faturas que correspondam aos filtros selecionados.
                  </p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Tente ajustar os filtros ou o termo de busca.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-2 px-4 py-2 text-white rounded-lg transition-colors hover:opacity-90"
                  style={{ backgroundColor: 'var(--crud-cancel)' }}
                >
                  Limpar Filtros
                </button>
              </div>
            </div>
          )}

          {/* Relatório por período */}
          {!loading && !error && invoiceData && filteredItems.length > 0 && (
            <div
              ref={scrollContentRef}
              className={`${selectedItems.size > 0 || showBackToTop ? 'pb-20' : ''}`}
            >
              <>
                <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Total geral (filtro)
                      {shareBadge}
                    </p>
                    {renderScorecardParts(filteredItems)}
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {filteredScopeTotals.totalCount}{' '}
                      {filteredScopeTotals.totalCount === 1 ? 'lançamento' : 'lançamentos'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Total {activeYear || '—'}
                      {shareBadge}
                    </p>
                    {renderScorecardParts(activeYearItems)}
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {activeYearTotals.totalCount}{' '}
                      {activeYearTotals.totalCount === 1 ? 'lançamento' : 'lançamentos'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {activeMonth ? formatYearMonthLabel(activeMonth) : 'Mês'}
                      {shareBadge}
                    </p>
                    {renderScorecardParts(currentItems)}
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {activeMonthTotals.totalCount}{' '}
                      {activeMonthTotals.totalCount === 1 ? 'lançamento' : 'lançamentos'}
                      {activeMonth && activeMonthTotals.totalCount > 0 ? (
                        <span className="ml-2">
                          <span className="text-red-600 dark:text-red-400">
                            desp. {formatCurrency(Math.abs(activeMonthTotals.totalExpenses))}
                          </span>
                          <span className="text-gray-400 dark:text-gray-500"> · </span>
                          <span className="text-green-600 dark:text-green-400">
                            rec. {formatCurrency(activeMonthTotals.totalIncome)}
                          </span>
                        </span>
                      ) : null}
                    </p>
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
                  <div className="flex min-w-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (selectAllGlobalState === 'none') {
                          selectAllGlobalFiltered()
                        } else {
                          clearSelection()
                        }
                      }}
                      className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                      title={
                        selectAllGlobalState === 'none'
                          ? 'Selecionar todos os lançamentos visíveis no filtro'
                          : 'Limpar seleção global'
                      }
                    >
                      {selectAllGlobalState === 'none' && <Square size={18} className="text-gray-400" />}
                      {selectAllGlobalState === 'partial' && <MinusSquare size={18} className="text-blue-600" />}
                      {selectAllGlobalState === 'all' && <CheckSquare size={18} className="text-blue-600" />}
                    </button>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      Selecionar todos do filtro ({filteredItems.length}{' '}
                      {filteredItems.length === 1 ? 'lançamento' : 'lançamentos'})
                    </span>
                  </div>
                  {allFilteredSelected ? (
                    <span className="text-xs font-medium text-[var(--color-1)]">
                      Edição em lote disponível: compartilhamento
                    </span>
                  ) : null}
                </div>

                <div className="mb-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
                    <Calendar size={16} style={{ color: 'var(--color-1)' }} />
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Período da fatura</span>
                  </div>
                  <div className="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700 px-2">
                    {invoicePeriodIndex.sortedYears.map((year) => {
                      const totalItemsInYear = invoicePeriodIndex.groupedByYear[year].reduce(
                        (sum, month) => sum + invoicePeriodIndex.groupedByMonth[month].length,
                        0,
                      )
                      const isActive = activeYear === year
                      return (
                        <button
                          key={year}
                          type="button"
                          onClick={() => {
                            setActiveYear(year)
                            const firstMonth = invoicePeriodIndex.groupedByYear[year]?.[0]
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
                        const monthCount = invoicePeriodIndex.groupedByMonth[month].length
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

                {currentItems.length > 0 && (
                  <div className="flex items-center justify-between gap-3 mb-4 px-1">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          if (selectAllState === 'none' || selectAllState === 'partial') {
                            selectAllFiltered()
                          } else {
                            setSelectedItems((prev) => {
                              const next = new Set(prev)
                              currentItems.forEach((item) => next.delete(getItemKey(item)))
                              return next
                            })
                          }
                        }}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                        title={
                          selectAllState === 'all'
                            ? 'Desmarcar lançamentos deste mês'
                            : 'Selecionar todos do mês'
                        }
                      >
                        {selectAllState === 'none' && <Square size={18} className="text-gray-400" />}
                        {selectAllState === 'partial' && <MinusSquare size={18} className="text-blue-600" />}
                        {selectAllState === 'all' && <CheckSquare size={18} className="text-blue-600" />}
                      </button>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        Selecionar todos do mês ({currentItems.length} transações)
                      </span>
                    </div>
                    {monthCardBuckets.length > 1 && (
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

                <div className="space-y-4">
                  {invoiceDisplaySections.map((section) =>
                    section.kind === 'group' ? (
                      <div key={`group-${section.group.id}`} className="space-y-2">
                        <div className="flex items-center justify-between gap-3 px-1 py-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <Layers size={18} style={{ color: 'var(--color-1)' }} />
                            <span className="text-sm font-bold text-gray-900 dark:text-white truncate">
                              {section.group.name}
                            </span>
                            <Badge variant="count" tone="brand1" label={String(section.count)} />
                            <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">fatura conjunta</span>
                          </div>
                          <span className={`text-sm font-bold tabular-nums ${invoiceNetAmountClass(section.total)}`}>
                            {formatCurrency(section.total)}
                          </span>
                        </div>
                        <div
                          className="space-y-3 pl-3 border-l-2"
                          style={{ borderColor: 'color-mix(in srgb, var(--color-1) 25%, transparent)' }}
                        >
                          {section.cards.map((card) => renderInvoiceCardPanel(card))}
                        </div>
                      </div>
                    ) : (
                      renderInvoiceCardPanel(section.card)
                    ),
                  )}
                </div>
              </>
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
                {selectedItems.size} lançamento(s) selecionado(s)
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
              {allFilteredSelected ? (
                <button
                  type="button"
                  onClick={() => {
                    setBatchEditSharingOnly(true)
                    setIsBatchEditModalOpen(true)
                  }}
                  className="px-3 py-1.5 text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold"
                  style={{ backgroundColor: 'var(--crud-edit)' }}
                  title="Alterar compartilhamento de todos os lançamentos selecionados no filtro"
                >
                  <Users size={14} />
                  Compartilhamento em lote
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setBatchEditSharingOnly(false)
                    setIsBatchEditModalOpen(true)
                  }}
                  className="px-3 py-1.5 text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold"
                  style={{ backgroundColor: 'var(--crud-edit)' }}
                  title={
                    batchCardMoveOptions.length > 0
                      ? 'Editar categoria, compartilhamento e cartão em lote'
                      : 'Editar categoria e compartilhamento em lote'
                  }
                >
                  <Edit2 size={14} />
                  Editar em Lote
                </button>
              )}
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

      <FaturasExportModal
        isOpen={exportModalFormat !== null}
        format={exportModalFormat ?? 'excel'}
        onClose={() => setExportModalFormat(null)}
        items={buildFaturaExportItems(filteredItems)}
        onSuccess={(message) => handleShowToast(message, 'success')}
        onError={(message) => handleShowToast(message, 'error')}
      />

      {showToast && (
        <Toast
          message={toastMessage}
          type={toastType}
          onClose={() => setShowToast(false)}
        />
      )}

      <ClosureEditImpactSummaryModal
        isOpen={closureSummary != null}
        baseMessage={closureSummary?.baseMessage ?? ''}
        impact={closureSummary?.impact ?? null}
        onClose={() => setClosureSummary(null)}
      />

      {/* Modal de Edição em Lote */}
      <BatchEditExpenseModal
        isOpen={isBatchEditModalOpen}
        onClose={() => {
          setIsBatchEditModalOpen(false)
          setBatchEditSharingOnly(false)
        }}
        selectedItems={getSelectedItemsForApi()}
        expenseType={batchEditExpenseType}
        sharingOnly={batchEditSharingOnly}
        cardMoveOptions={batchCardMoveOptions}
        onSuccess={(result) => {
          clearSelection()
          handleExpenseEditSuccess(result)
        }}
      />

      <BatchMoveInvoiceCardModal
        isOpen={isBatchMoveCardModalOpen}
        onClose={closeMoveCardModal}
        selectedItems={moveCardModalItems}
        availableCards={invoiceCardMoveOptions}
        excludeCardId={moveCardModalExcludeId}
        onSuccess={(message) => {
          clearSelection()
          closeMoveCardModal()
          loadInvoiceData({ preserveTabs: true, preserveExpandedCards: true })
          if (message) {
            handleShowToast(message, 'success')
          }
        }}
      />

      <ManualInvoiceItemModal
        isOpen={manualInvoiceContext !== null}
        context={manualInvoiceContext}
        onClose={() => setManualInvoiceContext(null)}
        onSuccess={handleExpenseEditSuccess}
      />

      <EditExpenseModal
        isOpen={isEditModalOpen}
        onClose={() => { setIsEditModalOpen(false); setItemToEdit(null) }}
        invoiceItemMode
        cardMoveOptions={
          itemToEdit ? invoiceCardMoveOptions.filter((c) => c.cardId !== itemToEdit.card_id) : []
        }
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
          shared_partner_id: itemToEdit.shared_partner_id ?? null,
          current_installment: itemToEdit.current_installment ?? null,
          total_installments: itemToEdit.total_installments ?? null,
        } : null}
        onSuccess={handleExpenseEditSuccess}
      />
    </div>
  )
}

export default FaturasPage

