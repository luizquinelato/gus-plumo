import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import axios from 'axios'
import { Plus, Edit2, Trash2, Tag, Tags, AlertCircle, Eye, EyeOff, X, ArrowUpCircle, ArrowDownCircle, Map, ArrowUpDown, Users, Zap, ArrowUp, ArrowDown, Filter, Loader2, Eraser, Download } from 'lucide-react'
import { exportTransactionMappingsToExcel } from '../../utils/exportToExcel'
import { useConfirm } from '../../hooks/useConfirm'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import Toast from '../../components/Toast'
import FloatingFooterBar from '../../components/FloatingFooterBar'
import {
  CadastroFilterField,
  CadastroListPageBody,
  CadastroListPageEmptyCard,
  CadastroListPageFilterCard,
  CadastroListPageHero,
  CadastroListPageLoading,
  CadastroListPageSearchField,
  cadastroFilterFieldCls,
  cadastroRowIconBtnCls,
  cadastroRowIconDangerCls,
  listPageTableChromeFooterCls,
  listPageTableRowHoverCls,
  listPageTableTdCls,
} from '../../components/CadastroListPageLayout'
import { ListPageTable } from '../../components/ListPageTable'
import {
  ListTableCheckboxCell,
  ListTableCheckboxHeader,
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableSortableHeader,
  ListTableStaticHeader,
  type ListTableSortDirection,
} from '../../components/ListTableSelectColumns'
import {
  CadastroFieldLabel,
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFieldsGrid,
  CadastroModalFieldsRow,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
  cadastroAccentControlCls,
  cadastroFieldCls,
  cadastroOptionLabelCls,
} from '../../components/CadastroFormLayout'
import SharedAccountDisplay from '../../components/SharedAccountDisplay'
import { MultiSelectDropdown, SourceMultiSelectDropdown } from '../../components/MultiSelectDropdown'
import { getIconComponent } from '../../utils/iconMapper'
import { formatAccountDisplay, sharingPartnerLabel, sharingPercentForKind } from '../../utils/accountFormatter'
import OwnershipPercentField from '../../components/OwnershipPercentField'
import { maskPercentInput } from '../../utils/percentInput'

interface Tag {
  id: number
  name: string
  description: string | null
  icon: string | null
  active: boolean
}

interface Subtag {
  id: number
  tag_id: number
  name: string
  description: string | null
  type: string  // 'receita' ou 'despesa'
  icon: string | null
  active: boolean
  tag_name: string | null
}

interface ExpenseSharing {
  id: number
  account_id: number
  shared_account_id: number
  my_contribution_percentage: number
  revenue_contribution_percentage?: number
  description: string | null
  active: boolean
  shared_account?: {
    id: number
    name?: string | null
    description?: string | null
    bank?: {
      id: number
      code: string
      name: string
      full_name?: string | null
    } | null
    agency?: number | null
    account_number?: string | null
  } | null
}

// Função para exibir label do parceiro no formato padrão
const getPartnerLabel = (partner: ExpenseSharing): string => sharingPartnerLabel(partner)

interface TransactionMapping {
  id: number
  original_description: string | null  // Pode ser null para pattern/regex
  mapped_description: string | null
  subtag_id: number
  subtag_name: string | null
  subtag_type: string | null  // 'receita' ou 'despesa'
  subtag_icon: string | null
  tag_name: string | null
  tag_icon: string | null
  shared_partner_id: number | null
  shared_partner_name: string | null
  shared_partner_bank: string | null
  shared_partner_agency: string | null
  shared_partner_account_number: string | null
  my_contribution_percentage: number | null
  revenue_contribution_percentage: number | null
  mapping_type: string  // 'exact', 'pattern', 'regex'
  pattern: string | null
  regex_pattern: string | null
  priority: number
  is_sensitive: boolean
  active: boolean
}

const MAPPING_REMAP_TYPE_ORDER: Record<string, number> = { regex: 0, pattern: 1, exact: 2 }

const SENSITIVE_MASK = '********'

function sensitivePayloadText(stored: string, revealed: string | null): string | undefined {
  const value = (revealed ?? stored).trim()
  if (!value || value === SENSITIVE_MASK) return undefined
  return value
}

function mappingListCriterion(
  mapping: TransactionMapping,
  revealed?: { original?: string; pattern?: string; regex?: string },
): { display: string; title: string } {
  if (mapping.mapping_type === 'exact') {
    const display =
      mapping.is_sensitive && revealed?.original ? revealed.original : mapping.original_description ?? ''
    return { display, title: display }
  }
  if (mapping.mapping_type === 'pattern') {
    const display = mapping.is_sensitive && revealed?.pattern ? revealed.pattern : mapping.pattern ?? ''
    return { display, title: display }
  }
  const display = mapping.is_sensitive && revealed?.regex ? revealed.regex : mapping.regex_pattern ?? ''
  return { display, title: display }
}

function sortMappingsForRemap(list: TransactionMapping[]): TransactionMapping[] {
  return [...list].sort((a, b) => {
    const ta = MAPPING_REMAP_TYPE_ORDER[a.mapping_type] ?? 99
    const tb = MAPPING_REMAP_TYPE_ORDER[b.mapping_type] ?? 99
    if (ta !== tb) return ta - tb
    return (a.priority ?? 0) - (b.priority ?? 0)
  })
}

const MATCH_FILTER_OPTIONS = [
  { id: 'exact', name: 'Exato' },
  { id: 'pattern', name: 'Padrão' },
  { id: 'regex', name: 'Regex' },
] as const

const TYPE_FILTER_OPTIONS = [
  { id: 'receita', name: 'Receita' },
  { id: 'despesa', name: 'Despesa' },
] as const

type MappingListQuery = {
  tag_ids?: number[]
  subtag_ids?: number[]
  subtag_types?: string[]
  mapping_types?: string[]
  expense_sharing_ids?: number[]
}

/** Envia filtro só quando há seleção parcial (vazio ou todos = sem filtro no servidor). */
function effectiveMultiFilter<T>(selected: T[], allCount: number): T[] | undefined {
  if (selected.length === 0 || selected.length >= allCount) return undefined
  return selected
}

function mappingListQueryParams(filters: MappingListQuery): Record<string, string> {
  const params: Record<string, string> = {}
  if (filters.tag_ids?.length) params.tag_ids = filters.tag_ids.join(',')
  if (filters.subtag_ids?.length) params.subtag_ids = filters.subtag_ids.join(',')
  if (filters.subtag_types?.length) params.subtag_types = filters.subtag_types.join(',')
  if (filters.mapping_types?.length) params.mapping_types = filters.mapping_types.join(',')
  if (filters.expense_sharing_ids?.length) params.expense_sharing_ids = filters.expense_sharing_ids.join(',')
  return params
}

type MappingSortField =
  | 'mapping_type'
  | 'match_value'
  | 'priority'
  | 'mapped_description'
  | 'subtag_type'
  | 'tag_name'
  | 'subtag_name'
  | 'shared_partner_name'

const MAPPING_TYPE_SORT_ORDER: Record<string, number> = { exact: 0, pattern: 1, regex: 2 }

function mappingMatchValue(m: TransactionMapping): string {
  if (m.mapping_type === 'exact') return (m.original_description ?? '').toLowerCase()
  if (m.mapping_type === 'pattern') return (m.pattern ?? '').toLowerCase()
  return (m.regex_pattern ?? '').toLowerCase()
}

function compareMappings(
  a: TransactionMapping,
  b: TransactionMapping,
  field: MappingSortField,
  direction: 'asc' | 'desc',
): number {
  const sign = direction === 'asc' ? 1 : -1

  const cmpString = (left: string, right: string) => left.localeCompare(right, 'pt-BR', { sensitivity: 'base' })

  switch (field) {
    case 'mapping_type': {
      const left = MAPPING_TYPE_SORT_ORDER[a.mapping_type] ?? 99
      const right = MAPPING_TYPE_SORT_ORDER[b.mapping_type] ?? 99
      return sign * (left - right)
    }
    case 'match_value':
      return sign * cmpString(mappingMatchValue(a), mappingMatchValue(b))
    case 'priority':
      return sign * ((a.priority ?? 0) - (b.priority ?? 0))
    case 'mapped_description':
      return sign * cmpString((a.mapped_description ?? '').toLowerCase(), (b.mapped_description ?? '').toLowerCase())
    case 'subtag_type':
      return sign * cmpString((a.subtag_type ?? '').toLowerCase(), (b.subtag_type ?? '').toLowerCase())
    case 'tag_name':
      return sign * cmpString((a.tag_name ?? '').toLowerCase(), (b.tag_name ?? '').toLowerCase())
    case 'subtag_name':
      return sign * cmpString((a.subtag_name ?? '').toLowerCase(), (b.subtag_name ?? '').toLowerCase())
    case 'shared_partner_name':
      return sign * cmpString((a.shared_partner_name ?? '').toLowerCase(), (b.shared_partner_name ?? '').toLowerCase())
    default:
      return 0
  }
}

const TransactionMappingsTab = () => {
  const [tags, setTags] = useState<Tag[]>([])
  const [subtags, setSubtags] = useState<Subtag[]>([])
  const [partners, setPartners] = useState<ExpenseSharing[]>([])
  const [mappings, setMappings] = useState<TransactionMapping[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingMapping, setEditingMapping] = useState<TransactionMapping | null>(null)
  const [draftTagFilters, setDraftTagFilters] = useState<number[]>([])
  const [draftSubtagFilters, setDraftSubtagFilters] = useState<number[]>([])
  const [draftTypeFilters, setDraftTypeFilters] = useState<string[]>([])
  const [draftMatchFilters, setDraftMatchFilters] = useState<string[]>([])
  const [draftSharedFilters, setDraftSharedFilters] = useState<number[]>([])
  const [appliedTagFilters, setAppliedTagFilters] = useState<number[]>([])
  const [appliedSubtagFilters, setAppliedSubtagFilters] = useState<number[]>([])
  const [appliedTypeFilters, setAppliedTypeFilters] = useState<string[]>([])
  const [appliedMatchFilters, setAppliedMatchFilters] = useState<string[]>([])
  const [appliedSharedFilters, setAppliedSharedFilters] = useState<number[]>([])
  const [filtersApplied, setFiltersApplied] = useState(false)
  const [filtersApplying, setFiltersApplying] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedMappings, setSelectedMappings] = useState<Set<number>>(new Set())  // IDs dos mapeamentos selecionados
  const [isDeletingSelected, setIsDeletingSelected] = useState(false)
  const [modalTypeFilter, setModalTypeFilter] = useState<'receita' | 'despesa'>('despesa')  // Filtro de tipo no modal
  const [applyToExistingRecords, setApplyToExistingRecords] = useState(true)  // Switch para aplicar a registros existentes (padrão: true)
  const [revealedOriginal, setRevealedOriginal] = useState<string | null>(null)
  const [revealedMapped, setRevealedMapped] = useState<string | null>(null)
  const [revealedPattern, setRevealedPattern] = useState<string | null>(null)
  const [revealedRegex, setRevealedRegex] = useState<string | null>(null)
  const [isRevealing, setIsRevealing] = useState(false)  // Estado de carregamento ao revelar
  const [showPasswordModal, setShowPasswordModal] = useState(false)  // Modal de confirmação de senha
  const [password, setPassword] = useState('')  // Senha digitada
  const [isValidatingPassword, setIsValidatingPassword] = useState(false)  // Estado de validação de senha
  const [canEditSensitive, setCanEditSensitive] = useState(false)  // Permite editar após validar senha
  const [passwordModalAction, setPasswordModalAction] = useState<'reveal' | 'save' | 'unsensitive'>('reveal')  // Ação do modal de senha
  const [revealingTableRowId, setRevealingTableRowId] = useState<number | null>(null)
  const revealingTableRowIdRef = useRef<number | null>(null)
  /** Evita fechar o modal de edição no mesmo clique que dispensa o modal de senha (stacked modals). */
  const skipMappingModalBackdropCloseRef = useRef(false)
  const [revealedTableRows, setRevealedTableRows] = useState<
    Record<number, { original?: string; mapped?: string; pattern?: string; regex?: string }>
  >({})
  const [originalFormData, setOriginalFormData] = useState<typeof formData | null>(null)  // Dados originais para comparação
  const [regexError, setRegexError] = useState<string | null>(null)  // Erro de validação do regex

  // Estados para rodapé flutuante
  const [showBackToTop, setShowBackToTop] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  // Estados de paginação
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(100)
  const [sortField, setSortField] = useState<MappingSortField | null>(null)
  const [sortDirection, setSortDirection] = useState<ListTableSortDirection>('asc')

  // Estados para batch remap (executar todos)
  const [showBatchRemapModal, setShowBatchRemapModal] = useState(false)
  const [isBatchRemapping, setIsBatchRemapping] = useState(false)
  const [batchRemapOptions, setBatchRemapOptions] = useState({
    overwrite_sharing: false  // Por padrão, NÃO sobrescrever compartilhamento existente (false = ignorar, true = sobrescrever)
  })
  const [isClearingClassifications, setIsClearingClassifications] = useState(false)

  // Estados para batch edit (editar todas)
  const [showBatchEditModal, setShowBatchEditModal] = useState(false)
  const [isBatchEditing, setIsBatchEditing] = useState(false)
  const [batchEditData, setBatchEditData] = useState({
    tag_id: 0,
    subtag_id: 0,
    shared_partner_id: 0,
    my_contribution_percentage: 50 as number | null,
    revenue_contribution_percentage: 50 as number | null,
    apply_tag_subtag: true,  // Tag e Subtag juntos
    skip_sharing: true       // true = ignorar/manter atual, false = alterar
  })

  const { showConfirm, ConfirmComponent } = useConfirm()

  // Toast state
  interface ToastState {
    show: boolean
    message: string
    type: 'success' | 'error' | 'warning'
  }

  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  // Form state
  const [formData, setFormData] = useState({
    original_description: '',
    mapped_description: '',
    tag_id: 0,
    subtag_id: 0,
    shared_partner_id: 0,
    my_contribution_percentage: null as number | null,
    revenue_contribution_percentage: null as number | null,
    mapping_type: 'exact' as 'exact' | 'pattern' | 'regex',
    pattern: '',
    regex_pattern: '',
    priority: 0,
    is_sensitive: false
  })

  const closePasswordModal = useCallback(() => {
    skipMappingModalBackdropCloseRef.current = true
    window.setTimeout(() => {
      skipMappingModalBackdropCloseRef.current = false
    }, 300)

    setShowPasswordModal(false)
    setPassword('')
    setRevealingTableRowId(null)
    revealingTableRowIdRef.current = null
    if (passwordModalAction === 'unsensitive') {
      setFormData((prev) => ({ ...prev, is_sensitive: true }))
    }
  }, [passwordModalAction])

  // Função para fechar o modal
  const closeModal = () => {
    setShowPasswordModal(false)
    setPassword('')
    setShowAddModal(false)
    setShowEditModal(false)
    setEditingMapping(null)
    setOriginalFormData(null)  // Limpar dados originais
    setFormData({
      original_description: '',
      mapped_description: '',
      tag_id: 0,
      subtag_id: 0,
      shared_partner_id: 0,
      my_contribution_percentage: null,
      revenue_contribution_percentage: null,
      mapping_type: 'exact',
      pattern: '',
      regex_pattern: '',
      priority: 0,
      is_sensitive: false
    })
    setModalTypeFilter('despesa')
    setApplyToExistingRecords(false)
    setRevealedOriginal(null)
    setRevealedMapped(null)
    setRevealedPattern(null)
    setRevealedRegex(null)
    setIsRevealing(false)
    setCanEditSensitive(false)
    setRegexError(null)  // Limpar erro de regex
  }

  // Função para verificar se houve mudanças no formulário
  const hasFormChanges = (): boolean => {
    if (!originalFormData) return true  // Se não há dados originais, permitir salvar (modo criação)

    return (
      formData.original_description !== originalFormData.original_description ||
      formData.mapped_description !== originalFormData.mapped_description ||
      formData.tag_id !== originalFormData.tag_id ||
      formData.subtag_id !== originalFormData.subtag_id ||
      formData.shared_partner_id !== originalFormData.shared_partner_id ||
      formData.my_contribution_percentage !== originalFormData.my_contribution_percentage ||
      formData.revenue_contribution_percentage !== originalFormData.revenue_contribution_percentage ||
      formData.mapping_type !== originalFormData.mapping_type ||
      formData.pattern !== originalFormData.pattern ||
      formData.regex_pattern !== originalFormData.regex_pattern ||
      formData.priority !== originalFormData.priority ||
      formData.is_sensitive !== originalFormData.is_sensitive
    )
  }

  // Hook para fechar modal com ESC (apenas quando modal de senha NÃO está aberto)
  useEscapeKey(closeModal, (showAddModal || showEditModal) && !showPasswordModal)

  // Handler de ESC para o modal de senha (intercepta antes do modal principal)
  useEffect(() => {
    if (!showPasswordModal) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        closePasswordModal()
      }
    }

    // Usar capture phase para interceptar antes de outros handlers
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [showPasswordModal, closePasswordModal])

  // Hook para submeter com Enter (desativado quando modal de senha está aberto)
  useEffect(() => {
    if (!showAddModal && !showEditModal) return
    if (showPasswordModal) return  // Não interceptar ENTER quando modal de senha está aberto

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const target = e.target as HTMLElement
        if (target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT') {
          e.preventDefault()
          const form = document.querySelector('form')
          if (form) {
            form.requestSubmit()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showAddModal, showEditModal, showPasswordModal])

  const loadCatalog = useCallback(async () => {
    const [tagsRes, subtagsRes, partnersRes] = await Promise.all([
      axios.get('/api/expenses/tags'),
      axios.get('/api/expenses/subtags'),
      axios.get('/api/expense-sharing/'),
    ])
    setTags(tagsRes.data)
    setSubtags(subtagsRes.data)
    setPartners(partnersRes.data)
  }, [])

  const fetchMappingsFromServer = useCallback(
    async (filters: MappingListQuery, options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false
      try {
        if (silent) setFiltersApplying(true)
        else setIsLoading(true)
        const mappingsRes = await axios.get('/api/expenses/mappings', {
          params: mappingListQueryParams(filters),
        })
        setMappings(mappingsRes.data)
      } catch (error) {
        console.error('Erro ao carregar mapeamentos:', error)
        showToast('Não foi possível carregar os mapeamentos.', 'error')
      } finally {
        if (silent) setFiltersApplying(false)
        else setIsLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    void (async () => {
      try {
        setIsLoading(true)
        await loadCatalog()
      } catch (error) {
        console.error('Erro ao carregar cadastros:', error)
      } finally {
        setIsLoading(false)
      }
    })()
  }, [loadCatalog])

  // Limpar seleções e resetar página quando os filtros mudam
  useEffect(() => {
    setSelectedMappings(new Set())
    setCurrentPage(1)
  }, [appliedTagFilters, appliedSubtagFilters, appliedTypeFilters, appliedMatchFilters, appliedSharedFilters, searchTerm, filtersApplied])

  // Validar regex quando o valor mudar (não validar placeholder criptografado ********)
  useEffect(() => {
    if (formData.mapping_type !== 'regex') {
      setRegexError(null)
      return
    }

    const pattern = (revealedRegex ?? formData.regex_pattern).trim()
    if (!pattern || pattern === SENSITIVE_MASK) {
      setRegexError(null)
      return
    }

    try {
      new RegExp(pattern, 'i')
      setRegexError(null)
    } catch (e: any) {
      setRegexError(e.message)
    }
  }, [formData.regex_pattern, formData.mapping_type, revealedRegex])

  // Scroll listener para Back to Top
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const scrollHandler = () => {
      setShowBackToTop(container.scrollTop > 300)
    }

    scrollHandler()
    container.addEventListener('scroll', scrollHandler)
    return () => container.removeEventListener('scroll', scrollHandler)
  }, [mappings, isLoading])

  // Função para voltar ao topo
  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const loadData = useCallback(async () => {
    try {
      await loadCatalog()
      if (filtersApplied) {
        await fetchMappingsFromServer(
          {
            tag_ids: effectiveMultiFilter(appliedTagFilters, tags.length),
            subtag_ids: effectiveMultiFilter(appliedSubtagFilters, subtags.length),
            subtag_types: effectiveMultiFilter(appliedTypeFilters, TYPE_FILTER_OPTIONS.length),
            mapping_types: effectiveMultiFilter(appliedMatchFilters, MATCH_FILTER_OPTIONS.length),
            expense_sharing_ids: effectiveMultiFilter(appliedSharedFilters, partners.length),
          },
          { silent: true },
        )
      }
    } catch (error) {
      console.error('Erro ao recarregar dados:', error)
    }
  }, [
    loadCatalog,
    fetchMappingsFromServer,
    filtersApplied,
    appliedTagFilters,
    appliedSubtagFilters,
    appliedTypeFilters,
    appliedMatchFilters,
    appliedSharedFilters,
    tags.length,
    subtags.length,
    partners.length,
  ])

  const handleSubmit = async (e?: React.FormEvent, skipPasswordCheck = false) => {
    if (e) e.preventDefault()

    // Validação: Se is_sensitive=True, mapped_description é obrigatória
    if (formData.is_sensitive && !formData.mapped_description.trim()) {
      showToast('Descrição personalizada é obrigatória para mapeamentos sensíveis', 'error')
      return
    }

    // Validação: Se for regex, verificar se é válido
    if (formData.mapping_type === 'regex' && regexError) {
      showToast('Expressão regular inválida. Corrija antes de salvar.', 'error')
      return
    }

    // Se for sensível E não estiver pulando verificação, exigir senha antes de salvar
    if (formData.is_sensitive && !skipPasswordCheck) {
      setPasswordModalAction('save')
      setShowPasswordModal(true)
      return
    }

    try {
      // Descrição original sempre em lowercase, mapeada mantém o formato original
      const payload = {
        original_description: formData.mapping_type === 'exact' ? formData.original_description.toLowerCase() : null,
        mapped_description: formData.mapped_description.trim() || null,
        subtag_id: formData.subtag_id,
        expense_sharing_id: formData.shared_partner_id || null,
        my_contribution_percentage: formData.my_contribution_percentage,
        revenue_contribution_percentage: formData.revenue_contribution_percentage,
        mapping_type: formData.mapping_type,
        pattern: formData.mapping_type === 'pattern' ? formData.pattern.trim() || null : null,
        regex_pattern: formData.mapping_type === 'regex' ? formData.regex_pattern.trim() || null : null,
        priority: formData.priority,
        is_sensitive: formData.is_sensitive,
        apply_to_existing: applyToExistingRecords  // Enviar flag para backend
      }

      await axios.post('/api/expenses/mappings', payload)
      showToast('Mapeamento criado com sucesso!', 'success')
      closeModal()
      void loadData()
    } catch (error: any) {
      console.error('Erro ao criar mapeamento:', error)
      const errorMessage = error?.response?.data?.detail || 'Não foi possível criar o mapeamento. Verifique os dados e tente novamente.'
      showToast(errorMessage, 'error')
    }
  }

  const handleEdit = (mapping: TransactionMapping) => {
    setEditingMapping(mapping)

    // Encontrar a tag_id da subtag selecionada
    const selectedSubtag = subtags.find(st => st.id === mapping.subtag_id)

    // Calcula prioridade pelo tipo (para mapeamentos legados com prioridade fora do range 0-2)
    const mappingType = mapping.mapping_type as 'exact' | 'pattern' | 'regex'
    const priorityMap = { exact: 0, pattern: 1, regex: 2 }
    const normalizedPriority = (mapping.priority >= 0 && mapping.priority <= 2)
      ? mapping.priority
      : priorityMap[mappingType]

    const initialData = {
      original_description: mapping.original_description || '',
      mapped_description: mapping.mapped_description || '',
      tag_id: selectedSubtag?.tag_id || 0,
      subtag_id: mapping.subtag_id,
      shared_partner_id: mapping.shared_partner_id || 0,
      my_contribution_percentage: mapping.my_contribution_percentage ?? null,
      revenue_contribution_percentage: mapping.revenue_contribution_percentage ?? null,
      mapping_type: mappingType,
      pattern: mapping.pattern || '',
      regex_pattern: mapping.regex_pattern || '',
      priority: normalizedPriority,
      is_sensitive: mapping.is_sensitive || false
    }

    setFormData(initialData)
    setOriginalFormData(initialData)  // Salvar dados originais para comparação
    setApplyToExistingRecords(true)  // Default: aplicar a todos os registros
    setRevealedOriginal(null)
    setRevealedMapped(null)
    setRevealedPattern(null)
    setRevealedRegex(null)
    setIsRevealing(false)  // Reset revealing state
    setCanEditSensitive(false)  // Reset edit permission
    // Definir o tipo do modal baseado na subtag
    setModalTypeFilter(mapping.subtag_type as 'receita' | 'despesa' || 'despesa')
    setShowEditModal(true)
  }

  const clearRevealedSensitiveFields = () => {
    setRevealedOriginal(null)
    setRevealedMapped(null)
    setRevealedPattern(null)
    setRevealedRegex(null)
  }

  const applyRevealedFromApi = (data: {
    revealed_original?: string | null
    revealed_mapped?: string | null
    revealed_pattern?: string | null
    revealed_regex?: string | null
  }) => {
    if (data.revealed_original != null) setRevealedOriginal(data.revealed_original)
    if (data.revealed_mapped != null) setRevealedMapped(data.revealed_mapped)
    if (data.revealed_pattern != null) setRevealedPattern(data.revealed_pattern)
    if (data.revealed_regex != null) setRevealedRegex(data.revealed_regex)
  }

  const handleRevealSensitiveFields = () => {
    if (!editingMapping) return

    if (revealedOriginal || revealedMapped || revealedPattern || revealedRegex) {
      clearRevealedSensitiveFields()
      setCanEditSensitive(false)
      if (originalFormData && editingMapping?.is_sensitive) {
        setFormData((prev) => ({
          ...prev,
          original_description: originalFormData.original_description,
          mapped_description: originalFormData.mapped_description,
          pattern: originalFormData.pattern,
          regex_pattern: originalFormData.regex_pattern,
        }))
      }
      return
    }

    setPasswordModalAction('reveal')
    setShowPasswordModal(true)
  }

  // Validar senha antes de desmarcar flag sensível ou revelar valores
  const handlePasswordValidation = async () => {
    if (!password.trim()) {
      showToast('Digite sua senha', 'error')
      return
    }

    setIsValidatingPassword(true)
    try {
      await axios.post('/api/expenses/validate-password', { password })

      setShowPasswordModal(false)
      setPassword('')

      // Ação baseada no tipo de modal
      if (passwordModalAction === 'reveal') {
        // Revelar valores descriptografados (modal ou tabela)
        // Usa ref para evitar problemas de closure com valor desatualizado
        const currentRevealingId = revealingTableRowIdRef.current
        if (currentRevealingId) {
          // Revelar na tabela
          setIsRevealing(true)
          try {
            const response = await axios.get(`/api/expenses/mappings/${currentRevealingId}/reveal`)
            setRevealedTableRows(prev => ({
              ...prev,
              [currentRevealingId]: {
                original: response.data.revealed_original,
                mapped: response.data.revealed_mapped,
                pattern: response.data.revealed_pattern,
                regex: response.data.revealed_regex,
              },
            }))
            // Não mostrar toast - apenas revelar
          } catch (error) {
            console.error('Erro ao revelar valores:', error)
            showToast('Não foi possível revelar os valores criptografados', 'error')
          } finally {
            setIsRevealing(false)
            setRevealingTableRowId(null)
            revealingTableRowIdRef.current = null
          }
        } else if (editingMapping) {
          // Revelar no modal
          setIsRevealing(true)
          try {
            const response = await axios.get(`/api/expenses/mappings/${editingMapping.id}/reveal`)
            applyRevealedFromApi(response.data)
            setCanEditSensitive(true)
            setFormData((prev) => ({
              ...prev,
              original_description: response.data.revealed_original ?? prev.original_description,
              mapped_description: response.data.revealed_mapped ?? prev.mapped_description,
              pattern: response.data.revealed_pattern ?? prev.pattern,
              regex_pattern: response.data.revealed_regex ?? prev.regex_pattern,
            }))
          } catch (error) {
            console.error('Erro ao revelar valores:', error)
            showToast('Não foi possível revelar os valores criptografados', 'error')
          } finally {
            setIsRevealing(false)
          }
        }
      } else if (passwordModalAction === 'unsensitive') {
        // Desmarcar flag sensível e permitir edição
        setCanEditSensitive(true)

        // Revelar valores descriptografados
        if (editingMapping) {
          const response = await axios.get(`/api/expenses/mappings/${editingMapping.id}/reveal`)
          applyRevealedFromApi(response.data)

          setFormData(prev => ({
            ...prev,
            original_description: response.data.revealed_original || '',
            mapped_description: response.data.revealed_mapped || '',
            pattern: response.data.revealed_pattern || prev.pattern,
            regex_pattern: response.data.revealed_regex || prev.regex_pattern,
            is_sensitive: false,
          }))
        }

        // Não mostrar toast - apenas desmarcar e revelar
      } else if (passwordModalAction === 'save') {
        // Salvar mapeamento sensível - passar skipPasswordCheck=true para evitar loop infinito
        if (showEditModal) {
          await handleUpdate(undefined, true)
        } else {
          await handleSubmit(undefined, true)
        }
      }
    } catch (error: any) {
      console.error('Erro ao validar senha:', error)
      const errorMessage = error?.response?.data?.detail || 'Senha incorreta'
      showToast(errorMessage, 'error')
    } finally {
      setIsValidatingPassword(false)
    }
  }

  // Handler para mudança do checkbox sensível
  const handleSensitiveToggle = (checked: boolean) => {
    // Se está marcando como sensível, apenas atualiza
    if (checked) {
      setFormData(prev => ({ ...prev, is_sensitive: true }))
      return
    }

    // Se está desmarcando e o mapeamento original era sensível, pedir senha
    if (editingMapping && editingMapping.is_sensitive) {
      setPasswordModalAction('unsensitive')
      setShowPasswordModal(true)
    } else {
      // Se não era sensível, apenas desmarca
      setFormData(prev => ({ ...prev, is_sensitive: false }))
    }
  }

  const handleRevealTableRow = async (mappingId: number) => {
    // Se já está revelado, ocultar
    if (revealedTableRows[mappingId]) {
      const newRevealed = { ...revealedTableRows }
      delete newRevealed[mappingId]
      setRevealedTableRows(newRevealed)
      return
    }

    // Exigir senha para revelar
    setRevealingTableRowId(mappingId)
    revealingTableRowIdRef.current = mappingId  // Atualiza a ref também
    setPasswordModalAction('reveal')
    setShowPasswordModal(true)
  }

  const editingMappingType = editingMapping?.mapping_type as 'exact' | 'pattern' | 'regex' | undefined
  /** Trocar exato ↔ padrão ↔ regex = novo critério; não exige revelar o valor antigo criptografado. */
  const mappingCriterionTypeChanged = Boolean(
    showEditModal && editingMapping && formData.mapping_type !== editingMappingType,
  )
  const sensitiveCriteriaLocked = Boolean(
    showEditModal && editingMapping?.is_sensitive && !canEditSensitive && !mappingCriterionTypeChanged,
  )

  const handleUpdate = async (e?: React.FormEvent, skipPasswordCheck = false) => {
    if (e) e.preventDefault()
    if (!editingMapping) return

    // Validação: Se is_sensitive=True, mapped_description é obrigatória
    if (formData.is_sensitive && !formData.mapped_description.trim()) {
      showToast('Descrição personalizada é obrigatória para mapeamentos sensíveis', 'error')
      return
    }

    // Validação: Se for regex, verificar se é válido
    if (formData.mapping_type === 'regex' && regexError) {
      showToast('Expressão regular inválida. Corrija antes de salvar.', 'error')
      return
    }

    // REGRA: Só exigir senha se o mapeamento ORIGINAL já era sensível
    // Se não era sensível, pode editar livremente (inclusive marcar como sensível)
    // skipPasswordCheck permite pular quando já foi validada
    if (
      editingMapping.is_sensitive &&
      formData.is_sensitive &&
      !skipPasswordCheck &&
      !mappingCriterionTypeChanged
    ) {
      setPasswordModalAction('save')
      setShowPasswordModal(true)
      return
    }

    try {
      const mappedText = sensitivePayloadText(formData.mapped_description, revealedMapped)
      const payload: Record<string, unknown> = {
        subtag_id: formData.subtag_id,
        expense_sharing_id: formData.shared_partner_id || null,
        my_contribution_percentage: formData.my_contribution_percentage,
        revenue_contribution_percentage: formData.revenue_contribution_percentage,
        mapping_type: formData.mapping_type,
        priority: formData.priority,
        is_sensitive: formData.is_sensitive,
        apply_to_existing: applyToExistingRecords,
      }
      if (mappedText !== undefined) payload.mapped_description = mappedText

      if (formData.mapping_type === 'exact') {
        const original = sensitivePayloadText(formData.original_description, revealedOriginal)
        if (original !== undefined) payload.original_description = original.toLowerCase()
      } else {
        payload.original_description = null
      }

      if (formData.mapping_type === 'pattern') {
        const pattern = sensitivePayloadText(formData.pattern, revealedPattern)
        if (pattern !== undefined) payload.pattern = pattern
        payload.regex_pattern = null
      } else if (formData.mapping_type === 'regex') {
        const regex = sensitivePayloadText(formData.regex_pattern, revealedRegex)
        if (regex !== undefined) payload.regex_pattern = regex
        payload.pattern = null
      } else {
        payload.pattern = null
        payload.regex_pattern = null
      }

      await axios.put(`/api/expenses/mappings/${editingMapping.id}`, payload)

      if (applyToExistingRecords) {
        showToast('Mapeamento atualizado e aplicado a todos os registros existentes com esta descrição!', 'success')
      } else {
        showToast('Mapeamento atualizado com sucesso!', 'success')
      }

      closeModal()
      void loadData()
    } catch (error: any) {
      console.error('Erro ao atualizar mapeamento:', error)
      const errorMessage = error?.response?.data?.detail || 'Não foi possível atualizar o mapeamento. Verifique os dados e tente novamente.'
      showToast(errorMessage, 'error')
    }
  }

  const handleDelete = async (id: number) => {
    showConfirm(
      'Deletar Mapeamento',
      'Tem certeza que deseja deletar este mapeamento?',
      async () => {
        try {
          await axios.delete(`/api/expenses/mappings/${id}`)
          showToast('Mapeamento deletado com sucesso!', 'success')
          void loadData()
        } catch (error) {
          console.error('Erro ao deletar mapeamento:', error)
          showToast('Não foi possível deletar o mapeamento', 'error')
        }
      },
      'Deletar',
      'Cancelar'
    )
  }

  // Funções de seleção
  const toggleSelectMapping = (id: number) => {
    setSelectedMappings(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  // toggleSelectAll será definido após filteredMappings

  const handleDeleteSelected = async () => {
    if (selectedMappings.size === 0) return

    showConfirm(
      'Deletar Mapeamentos Selecionados',
      `Tem certeza que deseja deletar ${selectedMappings.size} mapeamento(s)?`,
      async () => {
        setIsDeletingSelected(true)
        try {
          const deletePromises = Array.from(selectedMappings).map(id =>
            axios.delete(`/api/expenses/mappings/${id}`)
          )
          await Promise.all(deletePromises)
          showToast(`${selectedMappings.size} mapeamento(s) deletado(s) com sucesso!`, 'success')
          setSelectedMappings(new Set())
          void loadData()
        } catch (error) {
          console.error('Erro ao deletar mapeamentos:', error)
          showToast('Não foi possível deletar alguns mapeamentos', 'error')
        } finally {
          setIsDeletingSelected(false)
        }
      },
      'Deletar',
      'Cancelar'
    )
  }

  // Função para remapear um mapeamento específico
  const [remappingId, setRemappingId] = useState<number | null>(null)
  const [showRemapModal, setShowRemapModal] = useState(false)
  const [remapMapping, setRemapMapping] = useState<TransactionMapping | null>(null)
  const [remapOptions, setRemapOptions] = useState({
    skip_subtag_if_null: false,
    overwrite_sharing: false  // Por padrão, NÃO sobrescrever compartilhamento existente (false = ignorar, true = sobrescrever)
  })

  // Abre o modal de reaplicação
  const openRemapModal = (mapping: TransactionMapping) => {
    setRemapMapping(mapping)
    // Se o mapeamento não tem compartilhamento, default = não sobrescrever (ignorar)
    setRemapOptions({
      skip_subtag_if_null: false,  // Subtag é obrigatória no mapeamento, sempre vai ter
      overwrite_sharing: false     // Por padrão, não sobrescrever
    })
    setShowRemapModal(true)
  }

  const closeSingleRemapModal = () => {
    if (remappingId != null) return
    setShowRemapModal(false)
    setRemapMapping(null)
  }

  const closeBatchRemapModal = () => {
    if (isBatchRemapping) return
    setShowBatchRemapModal(false)
  }

  // Executa o remapeamento com opções
  const handleRemap = async () => {
    if (!remapMapping || remappingId != null) return

    setRemappingId(remapMapping.id)

    try {
      // overwrite_sharing: true = sobrescrever (skip_sharing_if_null: false)
      // overwrite_sharing: false = ignorar (skip_sharing_if_null: true)
      const skipSharingIfNull = remapMapping.shared_partner_id === null ? !remapOptions.overwrite_sharing : false
      const response = await axios.post(`/api/expenses/mappings/${remapMapping.id}/remap`, {
        skip_subtag_if_null: remapOptions.skip_subtag_if_null,
        skip_sharing_if_null: skipSharingIfNull
      })
      const data = response.data
      const mappingDesc = remapMapping.original_description || remapMapping.pattern || remapMapping.regex_pattern || 'N/A'

      if (data.total_records_updated === 0) {
        showToast(`Nenhum registro encontrado para "${mappingDesc.substring(0, 30)}..."`, 'warning')
      } else {
        showToast(
          `${data.total_records_updated} registro(s) atualizado(s): ` +
          `${data.bank_statements} extratos, ` +
          `${data.credit_card_invoices} faturas, ` +
          `${data.benefit_statements} benefícios.`,
          'success'
        )
      }
    } catch (error: any) {
      console.error('Erro ao remapear:', error)
      const errorMessage = error?.response?.data?.detail || 'Não foi possível remapear. Tente novamente.'
      showToast(errorMessage, 'error')
    } finally {
      setRemappingId(null)
      setShowRemapModal(false)
      setRemapMapping(null)
    }
  }

  // Executa a edição em lote (todos os selecionados)
  const handleBatchEdit = async () => {
    if (selectedMappings.size === 0) return

    // Validação: pelo menos uma opção deve estar marcada
    if (!batchEditData.apply_tag_subtag && batchEditData.skip_sharing) {
      showToast('Selecione pelo menos uma opção para aplicar', 'error')
      return
    }

    // Validação: se aplicar tag/subtag, deve selecionar ambos
    if (batchEditData.apply_tag_subtag && (!batchEditData.tag_id || !batchEditData.subtag_id)) {
      showToast('Selecione uma tag e uma subtag', 'error')
      return
    }

    setIsBatchEditing(true)

    try {
      const mappingIds = Array.from(selectedMappings)

      // Monta payload para bulk update
      const payload: {
        mapping_ids: number[]
        subtag_id?: number
        expense_sharing_id?: number | null
        my_contribution_percentage?: number | null
        update_sharing: boolean
      } = {
        mapping_ids: mappingIds,
        update_sharing: !batchEditData.skip_sharing
      }

      // Tag e Subtag são alterados juntos
      if (batchEditData.apply_tag_subtag) {
        payload.subtag_id = batchEditData.subtag_id
      }

      // Compartilhamento: só altera se NÃO estiver marcado para ignorar
      if (!batchEditData.skip_sharing) {
        payload.expense_sharing_id = batchEditData.shared_partner_id || 0  // 0 = remover compartilhamento
        payload.my_contribution_percentage = batchEditData.my_contribution_percentage
        payload.revenue_contribution_percentage = batchEditData.revenue_contribution_percentage
      }

      const response = await axios.patch('/api/expenses/mappings/bulk-update', payload)

      // Fecha o modal após salvar com sucesso
      setShowBatchEditModal(false)

      // Exibe o toast após fechar o modal
      if (response.data.errors?.length > 0) {
        showToast(`${response.data.updated} mapeamento(s) editado(s), ${response.data.errors.length} erro(s)`, 'warning')
      } else {
        showToast(`${response.data.updated} mapeamento(s) editado(s) com sucesso!`, 'success')
      }

      void loadData()
    } catch (error) {
      console.error('Erro ao executar batch edit:', error)
      showToast('Erro ao editar mapeamentos em lote', 'error')
    } finally {
      setIsBatchEditing(false)
      setSelectedMappings(new Set())
      // Reset form
      setBatchEditData({
        tag_id: 0,
        subtag_id: 0,
        shared_partner_id: 0,
        my_contribution_percentage: 50,
        apply_tag_subtag: true,
        skip_sharing: true
      })
    }
  }

  const tagFilterOptions = useMemo(
    () => tags.map((tag) => ({ id: tag.id, name: tag.name })),
    [tags],
  )

  const partnerFilterOptions = useMemo(
    () =>
      [...partners]
        .sort((a, b) => getPartnerLabel(a).localeCompare(getPartnerLabel(b)))
        .map((partner) => ({ id: partner.id, name: getPartnerLabel(partner) })),
    [partners],
  )

  const draftSubtagFilterOptions = useMemo(() => {
    let list = subtags
    const tagScope = effectiveMultiFilter(draftTagFilters, tags.length)
    if (tagScope?.length) {
      const allowedTags = new Set(tagScope)
      list = list.filter((s) => allowedTags.has(s.tag_id))
    }
    return list.map((subtag) => ({
      id: subtag.id,
      name: `${subtag.type === 'receita' ? '↑ ' : '↓ '}${subtag.name}`,
      groupKey: String(subtag.tag_id),
      groupName: subtag.tag_name ?? undefined,
    }))
  }, [subtags, draftTagFilters, tags.length])

  useEffect(() => {
    const allowed = new Set(draftSubtagFilterOptions.map((o) => o.id))
    setDraftSubtagFilters((prev) => {
      const next = prev.filter((id) => allowed.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [draftSubtagFilterOptions])

  const hasActiveFilters =
    filtersApplied ||
    draftMatchFilters.length > 0 ||
    draftTypeFilters.length > 0 ||
    draftTagFilters.length > 0 ||
    draftSubtagFilters.length > 0 ||
    draftSharedFilters.length > 0

  const applyListFilters = async () => {
    const query: MappingListQuery = {
      tag_ids: effectiveMultiFilter(draftTagFilters, tags.length),
      subtag_ids: effectiveMultiFilter(draftSubtagFilters, subtags.length),
      subtag_types: effectiveMultiFilter(draftTypeFilters, TYPE_FILTER_OPTIONS.length),
      mapping_types: effectiveMultiFilter(draftMatchFilters, MATCH_FILTER_OPTIONS.length),
      expense_sharing_ids: effectiveMultiFilter(draftSharedFilters, partners.length),
    }
    setSearchTerm('')
    setAppliedTagFilters([...draftTagFilters])
    setAppliedSubtagFilters([...draftSubtagFilters])
    setAppliedTypeFilters([...draftTypeFilters])
    setAppliedMatchFilters([...draftMatchFilters])
    setAppliedSharedFilters([...draftSharedFilters])
    setFiltersApplied(true)
    setSelectedMappings(new Set())
    setCurrentPage(1)
    await fetchMappingsFromServer(query, { silent: true })
  }

  const clearFilters = () => {
    setDraftTagFilters([])
    setDraftSubtagFilters([])
    setDraftTypeFilters([])
    setDraftMatchFilters([])
    setDraftSharedFilters([])
    setAppliedTagFilters([])
    setAppliedSubtagFilters([])
    setAppliedTypeFilters([])
    setAppliedMatchFilters([])
    setAppliedSharedFilters([])
    setSearchTerm('')
    setFiltersApplied(false)
    setMappings([])
    setSelectedMappings(new Set())
    setCurrentPage(1)
  }

  const filteredMappings = useMemo(() => {
    if (!filtersApplied) return []
    const term = searchTerm.trim().toLowerCase()
    if (!term) return mappings
    return mappings.filter((m) =>
      m.original_description?.toLowerCase().includes(term) ||
      m.mapped_description?.toLowerCase().includes(term) ||
      m.tag_name?.toLowerCase().includes(term) ||
      m.subtag_name?.toLowerCase().includes(term) ||
      m.pattern?.toLowerCase().includes(term) ||
      m.regex_pattern?.toLowerCase().includes(term),
    )
  }, [filtersApplied, mappings, searchTerm])

  const sortedFilteredMappings = useMemo(() => {
    if (!sortField) return filteredMappings
    return [...filteredMappings].sort((a, b) => compareMappings(a, b, sortField, sortDirection))
  }, [filteredMappings, sortField, sortDirection])

  const paginatedMappings = useMemo(() => {
    if (itemsPerPage === 0) return sortedFilteredMappings
    const start = (currentPage - 1) * itemsPerPage
    return sortedFilteredMappings.slice(start, start + itemsPerPage)
  }, [sortedFilteredMappings, currentPage, itemsPerPage])

  const handleSort = useCallback(
    (field: MappingSortField) => {
      if (sortField === field) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortField(field)
        setSortDirection('asc')
      }
      setCurrentPage(1)
    },
    [sortField],
  )

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, sortField, sortDirection])

  const mappingExportFilterSummary = useMemo(() => {
    if (!filtersApplied) return ''

    const summarize = (
      selected: (string | number)[],
      allCount: number,
      label: string,
      resolve: (id: string | number) => string,
    ): string | null => {
      if (selected.length === 0 || selected.length >= allCount) return null
      if (selected.length <= 3) return `${label}: ${selected.map(resolve).join(', ')}`
      return `${label}: ${selected.length} selecionados`
    }

    const parts: string[] = []
    const matchPart = summarize(appliedMatchFilters, MATCH_FILTER_OPTIONS.length, 'Match', (id) =>
      MATCH_FILTER_OPTIONS.find((o) => o.id === id)?.name ?? String(id),
    )
    if (matchPart) parts.push(matchPart)
    const typePart = summarize(appliedTypeFilters, TYPE_FILTER_OPTIONS.length, 'Tipo', (id) =>
      TYPE_FILTER_OPTIONS.find((o) => o.id === id)?.name ?? String(id),
    )
    if (typePart) parts.push(typePart)
    const tagPart = summarize(appliedTagFilters, tags.length, 'Tag', (id) =>
      tags.find((t) => t.id === id)?.name ?? String(id),
    )
    if (tagPart) parts.push(tagPart)
    const subtagPart = summarize(appliedSubtagFilters, subtags.length, 'Subtag', (id) =>
      subtags.find((s) => s.id === id)?.name ?? String(id),
    )
    if (subtagPart) parts.push(subtagPart)
    const sharedPart = summarize(appliedSharedFilters, partners.length, 'Compart.', (id) => {
      const partner = partners.find((p) => p.id === id)
      return partner ? getPartnerLabel(partner) : String(id)
    })
    if (sharedPart) parts.push(sharedPart)

    return parts.length > 0 ? parts.join('; ') : 'Todos'
  }, [
    filtersApplied,
    appliedMatchFilters,
    appliedTypeFilters,
    appliedTagFilters,
    appliedSubtagFilters,
    appliedSharedFilters,
    tags,
    subtags,
    partners,
  ])

  const handleExportExcel = () => {
    if (!filtersApplied) {
      showToast('Aplique os filtros antes de exportar.', 'warning')
      return
    }
    if (sortedFilteredMappings.length === 0) {
      showToast('Nenhum mapeamento para exportar.', 'warning')
      return
    }
    try {
      exportTransactionMappingsToExcel(sortedFilteredMappings, {
        filterSummary: mappingExportFilterSummary,
        searchTerm: searchTerm.trim() || undefined,
      })
      showToast('Excel exportado com sucesso.', 'success')
    } catch (error) {
      console.error('Erro ao exportar Excel de mapeamentos:', error)
      showToast('Não foi possível exportar o Excel.', 'error')
    }
  }

  // Estado do checkbox "selecionar todos": 'none' | 'partial' | 'all'
  const selectAllState = selectedMappings.size === 0
    ? 'none'
    : selectedMappings.size === filteredMappings.length
      ? 'all'
      : 'partial'

  const toggleSelectAll = () => {
    if (selectAllState === 'none') {
      setSelectedMappings(new Set(filteredMappings.map(m => m.id)))
    } else {
      setSelectedMappings(new Set())
    }
  }

  // Verifica se todos os selecionados são do mesmo tipo (receita/despesa)
  // Retorna o tipo comum ou null se misturados
  const selectedMappingsType = (() => {
    if (selectedMappings.size === 0) return null
    const selectedItems = filteredMappings.filter(m => selectedMappings.has(m.id))
    if (selectedItems.length === 0) return null
    const firstType = selectedItems[0].subtag_type
    const allSameType = selectedItems.every(m => m.subtag_type === firstType)
    return allSameType ? firstType : null
  })()

  // Bulk edit só habilitado se todos forem do mesmo tipo
  const canBatchEdit = selectedMappings.size > 0 && selectedMappingsType !== null

  const runRemapMappings = async (
    mappingsToRemap: TransactionMapping[],
    emptyMessage: string,
  ) => {
    if (mappingsToRemap.length === 0) return

    setIsBatchRemapping(true)
    let totalUpdated = 0
    let totalBankStatements = 0
    let totalCreditCardInvoices = 0
    let totalBenefitStatements = 0
    let errors = 0

    try {
      for (const mapping of sortMappingsForRemap(mappingsToRemap)) {
        try {
          const skipSharingIfNull = mapping.shared_partner_id === null
            ? !batchRemapOptions.overwrite_sharing
            : false
          const response = await axios.post(`/api/expenses/mappings/${mapping.id}/remap`, {
            skip_subtag_if_null: false,
            skip_sharing_if_null: skipSharingIfNull,
          })
          const data = response.data
          totalUpdated += data.total_records_updated
          totalBankStatements += data.bank_statements
          totalCreditCardInvoices += data.credit_card_invoices
          totalBenefitStatements += data.benefit_statements
        } catch (error) {
          console.error(`Erro ao remapear mapping ${mapping.id}:`, error)
          errors++
        }
      }

      if (totalUpdated === 0 && errors === 0) {
        showToast(emptyMessage, 'warning')
      } else if (errors > 0) {
        showToast(
          `${totalUpdated} registro(s) atualizado(s), ${errors} erro(s). ` +
            `${totalBankStatements} extratos, ${totalCreditCardInvoices} faturas, ${totalBenefitStatements} benefícios.`,
          'warning',
        )
      } else {
        showToast(
          `${totalUpdated} registro(s) atualizado(s): ` +
            `${totalBankStatements} extratos, ${totalCreditCardInvoices} faturas, ${totalBenefitStatements} benefícios.`,
          'success',
        )
      }
    } catch (error) {
      console.error('Erro ao executar remap:', error)
      showToast('Erro ao aplicar mapeamentos', 'error')
    } finally {
      setIsBatchRemapping(false)
    }
  }

  const handleBatchRemap = async () => {
    if (selectedMappings.size === 0) return
    await runRemapMappings(
      filteredMappings.filter((m) => selectedMappings.has(m.id)),
      'Nenhum registro encontrado para os mapeamentos selecionados',
    )
    setShowBatchRemapModal(false)
    setSelectedMappings(new Set())
  }

  const handleClearTransactionClassifications = () => {
    if (isClearingClassifications) return
    showConfirm({
      title: 'Limpar categorias nas transações',
      message:
        'Remove tag/subtag (subtag_id) de todos os lançamentos de extrato, fatura e benefício desta conta.\n\n' +
        'Os mapeamentos e o cadastro de tags/subtags não são apagados.\n\n' +
        'Use depois "Executar selecionados" para reaplicar as regras.',
      confirmText: 'Limpar categorias',
      cancelText: 'Cancelar',
      type: 'danger',
    }).then(async (confirmed) => {
      if (!confirmed) return
      setIsClearingClassifications(true)
      try {
        const response = await axios.post('/api/expenses/mappings/clear-transaction-classifications')
        const data = response.data
        const total = data.total_records_updated ?? 0
        if (total === 0) {
          showToast('Nenhum lançamento categorizado encontrado para limpar.', 'warning')
        } else {
          showToast(
            `${total} lançamento(s) atualizado(s): ` +
              `${data.bank_statements} extratos, ${data.credit_card_invoices} faturas, ${data.benefit_statements} benefícios.`,
            'success',
          )
        }
      } catch (error: unknown) {
        console.error('Erro ao limpar categorias:', error)
        const detail =
          axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string'
            ? error.response.data.detail
            : 'Não foi possível limpar as categorias. Tente novamente.'
        showToast(detail, 'error')
      } finally {
        setIsClearingClassifications(false)
      }
    })
  }

  const pageHeader = (
    <CadastroListPageHero
      icon={<Map className="w-8 h-8" />}
      title="Mapeamento de Transações"
      subtitle="Configure como suas transações são categorizadas automaticamente"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={!filtersApplied || sortedFilteredMappings.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-100"
            title="Exportar listagem atual (filtros, busca e ordenação) para Excel"
          >
            <Download size={18} />
            Exportar Excel
          </button>
          <button
            type="button"
            onClick={handleClearTransactionClassifications}
            disabled={isClearingClassifications}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-100"
            title="Remove categorias (tag/subtag) de extrato, fatura e benefício desta conta"
          >
            {isClearingClassifications ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Eraser size={18} />
            )}
            {isClearingClassifications ? 'Limpando...' : 'Limpar categorias'}
          </button>
          <button
            type="button"
            onClick={() => {
              setModalTypeFilter('despesa')
              setShowAddModal(true)
            }}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--crud-create)' }}
          >
            <Plus size={20} />
            Novo Mapeamento
          </button>
        </div>
      }
    />
  )

  const pageTabs = (
    <CadastroListPageFilterCard
      hasActiveFilters={hasActiveFilters}
      onClearFilters={clearFilters}
      onApply={() => void applyListFilters()}
      applying={filtersApplying}
      resultHint={
        filtersApplied
          ? `${filteredMappings.length} mapeamento${filteredMappings.length === 1 ? '' : 's'}`
          : undefined
      }
      gridClass="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
    >
      <CadastroFilterField label="Match" icon={<ArrowUpDown size={12} />}>
        <SourceMultiSelectDropdown
          label="Match"
          options={[...MATCH_FILTER_OPTIONS]}
          selectedIds={draftMatchFilters}
          onChange={setDraftMatchFilters}
          placeholder="Todos"
        />
      </CadastroFilterField>
      <CadastroFilterField label="Tipo" icon={<ArrowUpCircle size={12} />}>
        <SourceMultiSelectDropdown
          label="Tipo"
          options={[...TYPE_FILTER_OPTIONS]}
          selectedIds={draftTypeFilters}
          onChange={setDraftTypeFilters}
          placeholder="Todos"
        />
      </CadastroFilterField>
      <CadastroFilterField label="Tag" icon={<Tag size={12} />}>
        <MultiSelectDropdown
          label="Tag"
          options={tagFilterOptions}
          selectedIds={draftTagFilters}
          onChange={setDraftTagFilters}
          placeholder="Todos"
        />
      </CadastroFilterField>
      <CadastroFilterField label="Subtag" icon={<Tags size={12} />}>
        <MultiSelectDropdown
          label="Subtag"
          options={draftSubtagFilterOptions}
          selectedIds={draftSubtagFilters}
          onChange={setDraftSubtagFilters}
          placeholder="Todos"
          groupByKey={draftTagFilters.length !== 1}
          disabled={tagFilterOptions.length === 0}
        />
      </CadastroFilterField>
      <CadastroFilterField label="Compartilhamento" icon={<Users size={12} />}>
        <MultiSelectDropdown
          label="Compartilhamento"
          options={partnerFilterOptions}
          selectedIds={draftSharedFilters}
          onChange={setDraftSharedFilters}
          placeholder="Todos"
          icon={<Users size={14} className="text-gray-500" />}
          disabled={partnerFilterOptions.length === 0}
        />
      </CadastroFilterField>
    </CadastroListPageFilterCard>
  )

  return (
    <>
      <CadastroListPageBody
        scrollRef={scrollContainerRef}
        contentOverflow="auto"
        header={pageHeader}
        tabs={pageTabs}
      >
        {isLoading ? (
          <CadastroListPageLoading label="Carregando mapeamentos…" />
        ) : !filtersApplied ? (
          <CadastroListPageEmptyCard
            icon={<Filter size={32} className="text-gray-400" />}
            title="Nenhum filtro aplicado"
            description="Ajuste os filtros acima e clique em Aplicar para listar os mapeamentos."
          />
        ) : (
          <div className="space-y-3">
            {mappings.length > 0 ? (
              <CadastroListPageSearchField
                value={searchTerm}
                onChange={setSearchTerm}
                placeholder="Buscar por descrição, padrão, tag ou subtag..."
              />
            ) : null}
            {mappings.length === 0 ? (
              <CadastroListPageEmptyCard
                icon={<Map size={32} className="text-gray-400" />}
                title="Nenhum mapeamento neste filtro"
                description="Altere os filtros acima e clique em Aplicar, ou limpe os filtros."
              />
            ) : filteredMappings.length === 0 ? (
              <CadastroListPageEmptyCard
                icon={<Map size={32} className="text-gray-400" />}
                title={searchTerm.trim() ? 'Nenhum resultado na busca' : 'Nenhum mapeamento neste filtro'}
                description={
                  searchTerm.trim()
                    ? 'Tente outro termo ou limpe a busca.'
                    : 'Altere os filtros acima e clique em Aplicar, ou limpe os filtros.'
                }
              />
            ) : (
              <div className={selectedMappings.size > 0 || showBackToTop ? 'mb-20' : undefined}>
                <ListPageTable
                  leadingMode="bulk"
                  minWidth={1280}
                  colsRest={
                    <>
                      <ListTableSpacerCol />
                      <col style={{ width: 48, minWidth: 44 }} />
                      <col style={{ width: '22%', minWidth: 200 }} />
                      <col style={{ width: 72, minWidth: 64 }} />
                      <col style={{ width: '14%', minWidth: 140 }} />
                      <col style={{ width: 48, minWidth: 44 }} />
                      <col style={{ width: '12%', minWidth: 110 }} />
                      <col style={{ width: '12%', minWidth: 120 }} />
                      <col style={{ width: '16%', minWidth: 150 }} />
                      <col style={{ width: 120, minWidth: 108 }} />
                    </>
                  }
                  head={
                    <tr>
                      <ListTableCheckboxHeader state={selectAllState} onToggle={toggleSelectAll} />
                      <ListTableIndexHeader />
                      <ListTableSpacerHeader />
                      <ListTableSortableHeader
                        label="Match"
                        align="center"
                        active={sortField === 'mapping_type'}
                        direction={sortDirection}
                        onToggle={() => handleSort('mapping_type')}
                      />
                      <ListTableSortableHeader
                        label="Descrição original"
                        active={sortField === 'match_value'}
                        direction={sortDirection}
                        onToggle={() => handleSort('match_value')}
                      />
                      <ListTableSortableHeader
                        label="Prioridade"
                        align="center"
                        active={sortField === 'priority'}
                        direction={sortDirection}
                        onToggle={() => handleSort('priority')}
                      />
                      <ListTableSortableHeader
                        label="Descrição mapeada"
                        active={sortField === 'mapped_description'}
                        direction={sortDirection}
                        onToggle={() => handleSort('mapped_description')}
                      />
                      <ListTableSortableHeader
                        label="Tipo"
                        align="center"
                        active={sortField === 'subtag_type'}
                        direction={sortDirection}
                        onToggle={() => handleSort('subtag_type')}
                      />
                      <ListTableSortableHeader
                        label="Tag"
                        active={sortField === 'tag_name'}
                        direction={sortDirection}
                        onToggle={() => handleSort('tag_name')}
                      />
                      <ListTableSortableHeader
                        label="Subtag"
                        active={sortField === 'subtag_name'}
                        direction={sortDirection}
                        onToggle={() => handleSort('subtag_name')}
                      />
                      <ListTableSortableHeader
                        label="Compart."
                        active={sortField === 'shared_partner_name'}
                        direction={sortDirection}
                        onToggle={() => handleSort('shared_partner_name')}
                      />
                      <ListTableStaticHeader label="Ações" />
                    </tr>
                  }
                  footer={
                    <div className={`${listPageTableChromeFooterCls} flex flex-wrap items-center justify-between gap-3`}>
                      <div className="flex items-center gap-2 text-sm">
                        <label className="text-gray-600 dark:text-gray-400">Itens por página:</label>
                        <select
                          value={itemsPerPage}
                          onChange={(e) => {
                            setItemsPerPage(Number(e.target.value))
                            setCurrentPage(1)
                          }}
                          className={cadastroFilterFieldCls}
                        >
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                          <option value={200}>200</option>
                          <option value={0}>Todos</option>
                        </select>
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Mostrando{' '}
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {itemsPerPage === 0
                            ? filteredMappings.length
                            : Math.min(
                                itemsPerPage,
                                Math.max(0, filteredMappings.length - (currentPage - 1) * itemsPerPage),
                              )}
                        </span>{' '}
                        de{' '}
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {filteredMappings.length}
                        </span>{' '}
                        {filteredMappings.length === 1 ? 'mapeamento' : 'mapeamentos'}
                      </div>
                      {itemsPerPage > 0 && Math.ceil(filteredMappings.length / itemsPerPage) > 1 ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-900 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"
                          >
                            Anterior
                          </button>
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            Página{' '}
                            <span className="font-semibold text-gray-900 dark:text-white">{currentPage}</span> de{' '}
                            <span className="font-semibold text-gray-900 dark:text-white">
                              {Math.ceil(filteredMappings.length / itemsPerPage)}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setCurrentPage((prev) =>
                                Math.min(Math.ceil(filteredMappings.length / itemsPerPage), prev + 1),
                              )
                            }
                            disabled={currentPage >= Math.ceil(filteredMappings.length / itemsPerPage)}
                            className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-900 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"
                          >
                            Próxima
                          </button>
                        </div>
                      ) : (
                        <span className="w-px shrink-0 sm:invisible" aria-hidden />
                      )}
                    </div>
                  }
                >
                  {paginatedMappings.map((mapping, index) => {
                    const isSelected = selectedMappings.has(mapping.id)
                    const lineNumber =
                      itemsPerPage === 0 ? index + 1 : (currentPage - 1) * itemsPerPage + index + 1
                    const { display: originalDisplay, title: originalTitle } = mappingListCriterion(
                      mapping,
                      revealedTableRows[mapping.id],
                    )

                    return (
                      <tr
                        key={mapping.id}
                        className={`${listPageTableRowHoverCls} ${
                          isSelected
                            ? 'table-row-selected bg-[color-mix(in_srgb,var(--color-1)_7%,transparent)]'
                            : ''
                        }`}
                      >
                        <ListTableCheckboxCell
                          checked={isSelected}
                          onToggle={() => toggleSelectMapping(mapping.id)}
                        />
                        <ListTableIndexCell index={lineNumber} />
                        <ListTableSpacerCell />
                        <td className={`${listPageTableTdCls} text-center`}>
                          <span
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-xs font-bold"
                            style={{
                              backgroundColor:
                                mapping.mapping_type === 'exact'
                                  ? 'var(--color-1)'
                                  : mapping.mapping_type === 'pattern'
                                    ? 'var(--color-2)'
                                    : 'var(--color-4)',
                              color:
                                mapping.mapping_type === 'exact'
                                  ? 'var(--on-color-1)'
                                  : mapping.mapping_type === 'pattern'
                                    ? 'var(--on-color-2)'
                                    : 'var(--on-color-4)',
                            }}
                            title={
                              mapping.mapping_type === 'exact'
                                ? 'Exato'
                                : mapping.mapping_type === 'pattern'
                                  ? 'Padrão'
                                  : 'Regex'
                            }
                          >
                            {mapping.mapping_type === 'exact'
                              ? 'E'
                              : mapping.mapping_type === 'pattern'
                                ? 'P'
                                : 'R'}
                          </span>
                        </td>
                        <td className={`${listPageTableTdCls} align-top whitespace-normal`}>
                          <span
                            className="block break-all font-mono text-sm leading-snug text-gray-900 dark:text-white"
                            title={originalTitle}
                          >
                            {originalDisplay}
                          </span>
                        </td>
                        <td className={`${listPageTableTdCls} text-center`}>
                          {mapping.priority === 0 ? (
                            <span className="text-xs font-medium text-green-700 dark:text-green-300">Alta</span>
                          ) : mapping.priority === 1 ? (
                            <span className="text-xs font-medium text-yellow-700 dark:text-yellow-300">Média</span>
                          ) : (
                            <span className="text-xs font-medium text-red-700 dark:text-red-300">Baixa</span>
                          )}
                        </td>
                        <td className={listPageTableTdCls}>
                          <span
                            className="block truncate text-sm text-gray-600 dark:text-gray-300"
                            title={
                              mapping.is_sensitive && revealedTableRows[mapping.id]?.mapped
                                ? revealedTableRows[mapping.id].mapped
                                : mapping.mapped_description || ''
                            }
                          >
                            {mapping.is_sensitive && revealedTableRows[mapping.id]?.mapped
                              ? revealedTableRows[mapping.id].mapped
                              : mapping.mapped_description || '—'}
                          </span>
                        </td>
                        <td className={`${listPageTableTdCls} text-center`}>
                          {mapping.subtag_type === 'receita' ? (
                            <ArrowUp
                              size={16}
                              className="inline text-[var(--color-success)]"
                              aria-label="Receita"
                            />
                          ) : (
                            <ArrowDown
                              size={16}
                              className="inline text-[var(--color-danger)]"
                              aria-label="Despesa"
                            />
                          )}
                        </td>
                        <td className={`${listPageTableTdCls} align-top whitespace-normal`}>
                          <div className="flex min-w-0 items-start gap-1.5">
                            {(() => {
                              const TagIcon = getIconComponent(mapping.tag_icon || 'Tag')
                              return <TagIcon size={14} className="mt-0.5 shrink-0 text-gray-500" />
                            })()}
                            <span className="break-words text-sm leading-snug text-gray-700 dark:text-gray-200">
                              {mapping.tag_name || '—'}
                            </span>
                          </div>
                        </td>
                        <td className={`${listPageTableTdCls} align-top whitespace-normal`}>
                          <div className="flex min-w-0 items-start gap-1.5">
                            {(() => {
                              const SubtagIcon = getIconComponent(mapping.subtag_icon || 'Tags')
                              return <SubtagIcon size={14} className="mt-0.5 shrink-0 text-gray-500" />
                            })()}
                            <span className="break-words text-sm leading-snug text-gray-700 dark:text-gray-200">
                              {mapping.subtag_name || '—'}
                            </span>
                          </div>
                        </td>
                        <td className={listPageTableTdCls}>
                          {mapping.shared_partner_name ? (
                            <SharedAccountDisplay
                              account={{
                                id: 0,
                                name: mapping.shared_partner_name,
                                bank: mapping.shared_partner_bank ? { name: mapping.shared_partner_bank } : null,
                                agency: mapping.shared_partner_agency,
                                account_number: mapping.shared_partner_account_number,
                              }}
                              ownershipPercentage={
                                mapping.subtag_type === 'receita'
                                  ? (mapping.revenue_contribution_percentage ?? mapping.my_contribution_percentage)
                                  : mapping.my_contribution_percentage
                              }
                            />
                          ) : (
                            <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
                          )}
                        </td>
                        <td className={listPageTableTdCls}>
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleEdit(mapping)}
                              className={cadastroRowIconBtnCls}
                              title="Editar mapeamento"
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => openRemapModal(mapping)}
                              disabled={remappingId === mapping.id}
                              className={`${cadastroRowIconBtnCls} disabled:opacity-50`}
                              title="Aplicar mapeamento às transações existentes"
                            >
                              {remappingId === mapping.id ? (
                                <Loader2 size={15} className="animate-spin" />
                              ) : (
                                <Zap size={15} />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(mapping.id)}
                              className={cadastroRowIconDangerCls}
                              title="Deletar mapeamento"
                            >
                              <Trash2 size={15} />
                            </button>
                            {mapping.is_sensitive && (
                              <button
                                type="button"
                                onClick={() => handleRevealTableRow(mapping.id)}
                                className={cadastroRowIconBtnCls}
                                title={
                                  revealedTableRows[mapping.id]
                                    ? 'Ocultar valores'
                                    : 'Revelar valores (requer senha)'
                                }
                              >
                                {revealedTableRows[mapping.id] ? (
                                  <EyeOff size={15} />
                                ) : (
                                  <Eye size={15} />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </ListPageTable>
              </div>
            )}
          </div>
        )}
      </CadastroListPageBody>

      {/* Modal de Adicionar/Editar */}
      {(showAddModal || showEditModal) && (
        <CadastroModalShell
          maxWidth="max-w-6xl"
          onBackdropClick={() => {
            if (showPasswordModal || skipMappingModalBackdropCloseRef.current) return
            closeModal()
          }}
          zClass="z-[60]"
        >
          <CadastroModalHeader
            isEdit={showEditModal}
            title={showEditModal ? 'Editar Mapeamento' : 'Novo Mapeamento'}
            subtitle="Configure como uma descrição deve ser categorizada automaticamente"
            onClose={closeModal}
            icon={<Map size={18} />}
          />
          <form onSubmit={showEditModal ? handleUpdate : handleSubmit} className="flex min-h-0 flex-1 flex-col" id="mapping-form">
            <CadastroModalBody>
              <CadastroFormSection title="Aplicação" icon={<Zap size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow>
                    <label className={`${cadastroOptionLabelCls} items-start`}>
                      <div className="relative mt-0.5 flex-shrink-0">
                        <input
                          type="checkbox"
                          checked={applyToExistingRecords}
                          onChange={(e) => setApplyToExistingRecords(e.target.checked)}
                          className="peer sr-only"
                        />
                        <div className={`h-6 w-11 rounded-full transition-all duration-200 ${
                          applyToExistingRecords
                            ? 'bg-[var(--color-1)]'
                            : 'bg-gray-300 dark:bg-gray-600'
                        }`}>
                          <div className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                            applyToExistingRecords ? 'translate-x-5' : 'translate-x-0'
                          }`} />
                        </div>
                      </div>
                      <span>
                        <span className="block text-sm font-medium">Aplicar a todos os registros existentes</span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                          Atualiza tag, subtag e compartilhamento em <strong>todos</strong> os registros que correspondem a este mapeamento
                        </span>
                      </span>
                    </label>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>

              <CadastroFormSection title="Critério" icon={<Map size={14} />}>
                <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow cols={2}>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Tipo de Mapeamento</CadastroFieldLabel>
                    <select
                      required
                      value={formData.mapping_type}
                      onChange={(e) => {
                        const newType = e.target.value as 'exact' | 'pattern' | 'regex'
                        const priorityMap = { exact: 0, pattern: 1, regex: 2 }
                        setFormData((prev) => {
                          const next = {
                            ...prev,
                            mapping_type: newType,
                            priority: priorityMap[newType],
                          }
                          if (newType === 'exact') {
                            next.pattern = ''
                            next.regex_pattern = ''
                          } else if (newType === 'pattern') {
                            next.original_description = ''
                            next.regex_pattern = ''
                          } else {
                            next.original_description = ''
                            next.pattern = ''
                          }
                          return next
                        })
                        setRevealedOriginal(null)
                        setRevealedPattern(null)
                        setRevealedRegex(null)
                        if (editingMapping?.is_sensitive && newType !== editingMapping.mapping_type) {
                          setCanEditSensitive(false)
                        }
                      }}
                      className={`${cadastroFieldCls} mt-0.5`}
                    >
                      <option value="exact">Exato (correspondência completa)</option>
                      <option value="pattern">Padrão (contém texto)</option>
                      <option value="regex">Regex (expressão regular)</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {formData.mapping_type === 'exact' && 'Prioridade Alta - Corresponde exatamente à descrição completa'}
                      {formData.mapping_type === 'pattern' && 'Prioridade Média - Corresponde se a descrição contém o padrão'}
                      {formData.mapping_type === 'regex' && 'Prioridade Baixa - Corresponde usando expressão regular'}
                    </p>
                    {mappingCriterionTypeChanged && (
                      <p className="mt-1 text-xs text-[var(--color-1)] dark:text-[color-mix(in_srgb,var(--color-1)_85%,white)]">
                        Tipo alterado: informe o novo critério abaixo (sem senha). A descrição personalizada sensível
                        continua protegida até revelar.
                      </p>
                    )}
                  </label>
                  <label className="block min-w-0">
                    <CadastroFieldLabel>Prioridade</CadastroFieldLabel>
                    <select
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: Number(e.target.value) })}
                      disabled
                      className={`${cadastroFieldCls} mt-0.5 cursor-not-allowed bg-gray-100 dark:bg-gray-600`}
                    >
                      <option value={0}>Alta</option>
                      <option value={1}>Média</option>
                      <option value={2}>Baixa</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Determinada pelo tipo de mapeamento
                    </p>
                  </label>
                </CadastroModalFieldsRow>

                {formData.mapping_type === 'exact' && (
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Descrição Original</CadastroFieldLabel>
                      {sensitiveCriteriaLocked ? (
                        <div className="relative mt-0.5">
                          <input
                            type="text"
                            value={revealedOriginal || formData.original_description}
                            readOnly
                            className={`${cadastroFieldCls} bg-gray-100 pr-10 dark:bg-gray-600`}
                            placeholder="********"
                          />
                          <button
                            type="button"
                            onClick={handleRevealSensitiveFields}
                            disabled={isRevealing}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-600 transition-colors hover:text-gray-800 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
                            title={revealedOriginal ? 'Ocultar valores' : 'Revelar valores (requer senha)'}
                          >
                            {isRevealing ? (
                              <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-600" />
                            ) : revealedOriginal ? (
                              <EyeOff size={16} />
                            ) : (
                              <Eye size={16} />
                            )}
                          </button>
                        </div>
                      ) : (
                        <input
                          type="text"
                          required
                          value={revealedOriginal || formData.original_description}
                          onChange={(e) => setFormData({ ...formData, original_description: e.target.value })}
                          className={`${cadastroFieldCls} mt-0.5`}
                          placeholder="Ex: NETFLIX, SPOTIFY, etc."
                        />
                      )}
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Como aparece no extrato ou fatura (correspondência exata)
                      </p>
                    </label>
                  </CadastroModalFieldsRow>
                )}

                {formData.mapping_type === 'pattern' && (
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Padrão de Texto</CadastroFieldLabel>
                      {sensitiveCriteriaLocked ? (
                        <div className="relative mt-0.5">
                          <input
                            type="text"
                            value={revealedPattern || formData.pattern}
                            readOnly
                            className={`${cadastroFieldCls} bg-gray-100 pr-10 dark:bg-gray-600`}
                            placeholder="********"
                          />
                          <button
                            type="button"
                            onClick={handleRevealSensitiveFields}
                            disabled={isRevealing}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-600 transition-colors hover:text-gray-800 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
                            title={revealedPattern ? 'Ocultar valores' : 'Revelar valores (requer senha)'}
                          >
                            {isRevealing ? (
                              <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-600" />
                            ) : revealedPattern ? (
                              <EyeOff size={16} />
                            ) : (
                              <Eye size={16} />
                            )}
                          </button>
                        </div>
                      ) : (
                        <input
                          type="text"
                          required
                          value={revealedPattern || formData.pattern}
                          onChange={(e) => {
                            setFormData({ ...formData, pattern: e.target.value })
                            if (revealedPattern) setRevealedPattern(e.target.value)
                          }}
                          className={`${cadastroFieldCls} mt-0.5`}
                          placeholder="Ex: UBER, IFOOD, etc."
                        />
                      )}
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Texto que deve estar contido na descrição (case-insensitive)
                      </p>
                    </label>
                  </CadastroModalFieldsRow>
                )}

                {formData.mapping_type === 'regex' && (
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Expressão Regular</CadastroFieldLabel>
                      <div className="relative mt-0.5">
                        <span className="pointer-events-none absolute left-3 top-2.5 select-none font-mono text-sm font-bold text-purple-600 dark:text-purple-400">
                          /
                        </span>
                        <textarea
                          required
                          rows={4}
                          readOnly={sensitiveCriteriaLocked}
                          value={revealedRegex || formData.regex_pattern}
                          onChange={(e) => {
                            setFormData({ ...formData, regex_pattern: e.target.value })
                            if (revealedRegex) setRevealedRegex(e.target.value)
                          }}
                          className={`${cadastroFieldCls} min-h-[5.5rem] max-h-64 w-full resize-y py-2 pl-6 pr-10 font-mono text-sm leading-relaxed break-all whitespace-pre-wrap ${
                            sensitiveCriteriaLocked ? 'bg-gray-100 dark:bg-gray-600' : ''
                          } ${
                            (() => {
                              const d = (revealedRegex ?? formData.regex_pattern).trim()
                              if (!d || (d === SENSITIVE_MASK && !revealedRegex)) return ''
                              if (regexError) return 'border-red-500 dark:border-red-400'
                              return 'border-purple-500 dark:border-purple-400'
                            })()
                          }`}
                          placeholder={'^PAG.*PIX\n\\b(?!mercado\\s*livre\\b).*mercado'}
                          spellCheck={false}
                          autoComplete="off"
                        />
                        {sensitiveCriteriaLocked ? (
                          <button
                            type="button"
                            onClick={handleRevealSensitiveFields}
                            disabled={isRevealing}
                            className="absolute right-3 top-2.5 p-1.5 text-gray-600 transition-colors hover:text-gray-800 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
                            title={revealedRegex ? 'Ocultar valores' : 'Revelar valores (requer senha)'}
                          >
                            {isRevealing ? (
                              <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-600" />
                            ) : revealedRegex ? (
                              <EyeOff size={16} />
                            ) : (
                              <Eye size={16} />
                            )}
                          </button>
                        ) : (
                          <span className="pointer-events-none absolute right-3 top-2.5 select-none font-mono text-sm font-bold text-purple-600 dark:text-purple-400">
                            /i
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        {(() => {
                          const regexDisplay = (revealedRegex ?? formData.regex_pattern).trim()
                          if (!regexDisplay) {
                            return (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                Padrão regex para correspondência avançada (case-insensitive)
                              </span>
                            )
                          }
                          if (regexDisplay === SENSITIVE_MASK && !revealedRegex) {
                            return (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                Expressão criptografada — use o ícone de olho para revelar e validar.
                              </span>
                            )
                          }
                          if (regexError) {
                            return (
                              <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                                <span>❌</span> {regexError}
                              </span>
                            )
                          }
                          return (
                            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                              <span>✅</span> Regex válido
                            </span>
                          )
                        })()}
                      </div>
                    </label>
                  </CadastroModalFieldsRow>
                )}
                </CadastroModalFieldsGrid>
              </CadastroFormSection>

              <CadastroFormSection title="Categorização" icon={<Tag size={14} />}>
                <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow>
                  <div>
                    <CadastroFieldLabel required>Tipo de Transação</CadastroFieldLabel>
                    <div className="mt-1.5 flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setModalTypeFilter('receita')
                          setFormData({ ...formData, tag_id: 0, subtag_id: 0 })
                        }}
                        className={`flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 transition-all ${
                          modalTypeFilter === 'receita'
                            ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-green-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        <ArrowUpCircle size={20} className={modalTypeFilter === 'receita' ? 'text-green-600 dark:text-green-400' : ''} />
                        <span className="font-medium">Receita</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setModalTypeFilter('despesa')
                          setFormData({ ...formData, tag_id: 0, subtag_id: 0 })
                        }}
                        className={`flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 transition-all ${
                          modalTypeFilter === 'despesa'
                            ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-red-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        <ArrowDownCircle size={20} className={modalTypeFilter === 'despesa' ? 'text-red-600 dark:text-red-400' : ''} />
                        <span className="font-medium">Despesa</span>
                      </button>
                    </div>
                  </div>
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow cols={2}>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Tag (Categoria Principal)</CadastroFieldLabel>
                    <select
                      required
                      value={formData.tag_id}
                      onChange={(e) => {
                        const newTagId = Number(e.target.value)
                        setFormData({ ...formData, tag_id: newTagId, subtag_id: 0 })
                      }}
                      className={`${cadastroFieldCls} mt-0.5`}
                    >
                      <option value={0}>Selecione uma tag...</option>
                      {tags.map(tag => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Subtag (Subcategoria)</CadastroFieldLabel>
                    <select
                      required
                      value={formData.subtag_id}
                      onChange={(e) => setFormData({ ...formData, subtag_id: Number(e.target.value) })}
                      disabled={!formData.tag_id}
                      className={`${cadastroFieldCls} mt-0.5 disabled:cursor-not-allowed disabled:bg-gray-100 dark:disabled:bg-gray-700`}
                    >
                      <option value={0}>Selecione uma subtag...</option>
                      {subtags
                        .filter(subtag => subtag.tag_id === formData.tag_id && subtag.type === modalTypeFilter)
                        .map(subtag => (
                          <option key={subtag.id} value={subtag.id}>
                            {subtag.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>

              <CadastroFormSection title="Regras" icon={<Users size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow cols={2}>
                    <label className="block min-w-0">
                      <CadastroFieldLabel>Compartilhamento</CadastroFieldLabel>
                      <select
                        value={formData.shared_partner_id}
                        onChange={(e) => {
                          const selectedId = Number(e.target.value)
                          setFormData({ ...formData, shared_partner_id: selectedId })
                          if (selectedId > 0) {
                            const selectedSharing = partners.find(p => p.id === selectedId)
                            if (selectedSharing) {
                              setFormData(prev => ({
                                ...prev,
                                shared_partner_id: selectedId,
                                my_contribution_percentage: sharingPercentForKind(selectedSharing, 'expense'),
                                revenue_contribution_percentage: sharingPercentForKind(selectedSharing, 'revenue'),
                              }))
                            }
                          } else {
                            setFormData(prev => ({
                              ...prev,
                              shared_partner_id: 0,
                              my_contribution_percentage: null,
                              revenue_contribution_percentage: null,
                            }))
                          }
                        }}
                        className={`${cadastroFieldCls} mt-0.5`}
                      >
                        <option value={0}>Nenhum (Próprio)</option>
                        {[...partners].sort((a, b) => getPartnerLabel(a).localeCompare(getPartnerLabel(b))).map(sharing => (
                          <option key={sharing.id} value={sharing.id}>
                            {getPartnerLabel(sharing)}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Para despesas compartilhadas com parceiro
                      </p>
                    </label>
                    <OwnershipPercentField
                      context="mappingExpense"
                      value={
                        formData.my_contribution_percentage != null
                          ? String(formData.my_contribution_percentage)
                          : ''
                      }
                      onChange={(raw) => {
                        const masked = maskPercentInput(raw)
                        if (masked === '') {
                          setFormData({ ...formData, my_contribution_percentage: null })
                          return
                        }
                        const n = parseFloat(masked)
                        if (!Number.isNaN(n) && n >= 0 && n <= 100) {
                          setFormData({ ...formData, my_contribution_percentage: n })
                        }
                      }}
                      disabled={formData.shared_partner_id === 0}
                      showProprioBadge={formData.shared_partner_id > 0}
                      hint={
                        formData.shared_partner_id > 0
                          ? 'Override de despesa neste mapeamento. Vazio usa cartão ou config de compartilhamento.'
                          : 'Selecione um compartilhamento primeiro.'
                      }
                    />
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <OwnershipPercentField
                      context="mappingRevenue"
                      value={
                        formData.revenue_contribution_percentage != null
                          ? String(formData.revenue_contribution_percentage)
                          : ''
                      }
                      onChange={(raw) => {
                        const masked = maskPercentInput(raw)
                        if (masked === '') {
                          setFormData({ ...formData, revenue_contribution_percentage: null })
                          return
                        }
                        const n = parseFloat(masked)
                        if (!Number.isNaN(n) && n >= 0 && n <= 100) {
                          setFormData({ ...formData, revenue_contribution_percentage: n })
                        }
                      }}
                      disabled={formData.shared_partner_id === 0}
                      showProprioBadge={formData.shared_partner_id > 0}
                      hint={
                        formData.shared_partner_id > 0
                          ? 'Override de receita neste mapeamento. Vazio usa cartão ou config de compartilhamento.'
                          : 'Selecione um compartilhamento primeiro.'
                      }
                    />
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className={`${cadastroOptionLabelCls} items-start`}>
                      <div className="relative mt-0.5 flex-shrink-0">
                        <input
                          type="checkbox"
                          checked={formData.is_sensitive}
                          onChange={(e) => handleSensitiveToggle(e.target.checked)}
                          className="peer sr-only"
                        />
                        <div className={`h-5 w-9 rounded-full transition-all duration-200 ${
                          formData.is_sensitive
                            ? 'bg-red-600 dark:bg-red-500'
                            : 'bg-gray-300 dark:bg-gray-600'
                        }`}>
                          <div className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
                            formData.is_sensitive ? 'translate-x-4' : 'translate-x-0'
                          }`} />
                        </div>
                      </div>
                      <span>
                        <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">
                          Marcar como sensível (criptografar critério e descrição)
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                          O critério (exato, padrão ou regex) e a descrição personalizada ficam criptografados e só
                          aparecem com senha
                        </span>
                      </span>
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required={formData.is_sensitive}>Descrição Personalizada</CadastroFieldLabel>
                      {editingMapping?.is_sensitive && !canEditSensitive ? (
                        <div className="relative mt-0.5">
                          <input
                            type="text"
                            value={revealedMapped || formData.mapped_description}
                            readOnly
                            className={`${cadastroFieldCls} bg-gray-100 pr-10 dark:bg-gray-600`}
                            placeholder="********"
                          />
                          <button
                            type="button"
                            onClick={handleRevealSensitiveFields}
                            disabled={isRevealing}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-600 transition-colors hover:text-gray-800 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
                            title={revealedMapped ? 'Ocultar valores' : 'Revelar valores (requer senha)'}
                          >
                            {isRevealing ? (
                              <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-600" />
                            ) : revealedMapped ? (
                              <EyeOff size={16} />
                            ) : (
                              <Eye size={16} />
                            )}
                          </button>
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={formData.mapped_description}
                          onChange={(e) => setFormData({ ...formData, mapped_description: e.target.value })}
                          className={`${cadastroFieldCls} mt-0.5`}
                          placeholder="Ex: Entretenimento"
                        />
                      )}
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {formData.is_sensitive
                          ? 'Obrigatório para mapeamentos sensíveis - substitui a descrição original na visualização'
                          : 'Substitui a descrição original na visualização (deixe em branco para usar a original)'}
                      </p>
                    </label>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={closeModal}
              onSave={() => {
                const form = document.getElementById('mapping-form') as HTMLFormElement | null
                form?.requestSubmit()
              }}
              disabled={showEditModal && !hasFormChanges()}
              saveLabel={showEditModal ? 'Atualizar Mapeamento' : 'Criar Mapeamento'}
            />
          </form>
        </CadastroModalShell>
      )}

      {/* Password Modal */}
      {showPasswordModal && (
        <CadastroModalShell
          maxWidth="max-w-md"
          onBackdropClick={closePasswordModal}
          zClass="z-[110]"
        >
          <CadastroModalHeader
            isEdit={false}
            title="Confirmação de Senha"
            subtitle={
              passwordModalAction === 'reveal'
                ? 'Para visualizar os dados descriptografados, digite sua senha.'
                : passwordModalAction === 'save'
                  ? 'Para salvar este mapeamento sensível, digite sua senha.'
                  : 'Para desmarcar a flag de sensível e visualizar os dados descriptografados, digite sua senha.'
            }
            onClose={closePasswordModal}
            icon={<AlertCircle size={18} />}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handlePasswordValidation()
            }}
            className="flex min-h-0 flex-1 flex-col"
            id="mapping-password-form"
          >
            <CadastroModalBody>
              <CadastroFormSection title="Senha" icon={<AlertCircle size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Senha</CadastroFieldLabel>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${cadastroFieldCls} mt-0.5`}
                        placeholder="Digite sua senha"
                        autoFocus
                      />
                    </label>
                  </CadastroModalFieldsRow>
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={closePasswordModal}
              onSave={() => {
                const form = document.getElementById('mapping-password-form') as HTMLFormElement | null
                form?.requestSubmit()
              }}
              saving={isValidatingPassword}
              saveLabel="Confirmar"
            />
          </form>
        </CadastroModalShell>
      )}

      {/* Modal de Reaplicar Mapeamento */}
      {showRemapModal && remapMapping && (
        <CadastroModalShell maxWidth="max-w-md" onBackdropClick={closeSingleRemapModal} zClass="z-[60]">
          <CadastroModalHeader
            isEdit={false}
            title="Aplicar Mapeamento"
            onClose={closeSingleRemapModal}
            icon={<Zap size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection
              title="O que será aplicado"
              hint="Nas transações que corresponderem a este mapeamento."
              icon={<Zap size={14} />}
            >
              <div className="space-y-3">
              <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                {remapMapping.original_description || remapMapping.pattern || remapMapping.regex_pattern || 'N/A'}
              </p>
              <label className={`${cadastroOptionLabelCls} items-start`}>
                <input
                  type="checkbox"
                  checked
                  disabled
                  className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                />
                <span>
                  <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">
                    Aplicar tag e subtag
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-gray-500 dark:text-gray-400">
                    Sempre executado. As transações recebem {remapMapping.tag_name || 'a tag'} → {remapMapping.subtag_name || 'a subtag'}.
                  </span>
                </span>
              </label>
              <label className={`${cadastroOptionLabelCls} items-start`}>
                <input
                  type="checkbox"
                  checked={remapOptions.overwrite_sharing}
                  onChange={(event) => setRemapOptions((prev) => ({
                    ...prev,
                    overwrite_sharing: event.target.checked,
                  }))}
                  className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                />
                <span>
                  <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">
                    Sobrescrever compartilhamento
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-gray-500 dark:text-gray-400">
                    {remapMapping.shared_partner_id
                      ? `Aplica ${remapMapping.shared_partner_name} (${remapMapping.my_contribution_percentage ?? 100}%) nas transações que já tiverem outro compartilhamento. Desmarcado, o valor atual é mantido.`
                      : 'Remove o compartilhamento das transações que já tiverem um. Desmarcado, o valor atual é mantido.'}
                  </span>
                </span>
              </label>
              </div>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeSingleRemapModal}
            onSave={() => void handleRemap()}
            saving={remappingId != null}
            saveLabel={remappingId != null ? 'Aplicando...' : 'Aplicar'}
            saveIcon={
              remappingId != null ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Zap size={15} />
              )
            }
          />
        </CadastroModalShell>
      )}

      {/* Modal de Executar selecionados */}
      {showBatchRemapModal && selectedMappings.size > 0 && (
        <CadastroModalShell maxWidth="max-w-md" onBackdropClick={closeBatchRemapModal} zClass="z-[60]">
          <CadastroModalHeader
            isEdit={false}
            title={`Executar ${selectedMappings.size} Mapeamento(s)`}
            subtitle={`Ordem: regex → padrão → exato. Aplica tag, subtag e compartilhamento em extrato, fatura e benefício.`}
            onClose={closeBatchRemapModal}
            icon={<Zap size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection
              title="O que será aplicado"
              hint="Nas transações que corresponderem aos mapeamentos selecionados."
              icon={<Zap size={14} />}
            >
              <div className="space-y-3">
              <label className={`${cadastroOptionLabelCls} items-start`}>
                <input
                  type="checkbox"
                  checked
                  disabled
                  className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                />
                <span>
                  <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">
                    Aplicar tag e subtag
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-gray-500 dark:text-gray-400">
                    Sempre executado. Cada mapeamento aplica a própria tag e subtag.
                  </span>
                </span>
              </label>
              <label className={`${cadastroOptionLabelCls} items-start`}>
                <input
                  type="checkbox"
                  checked={batchRemapOptions.overwrite_sharing}
                  disabled={isBatchRemapping}
                  onChange={(event) => setBatchRemapOptions((prev) => ({
                    ...prev,
                    overwrite_sharing: event.target.checked,
                  }))}
                  className={`${cadastroAccentControlCls} mt-0.5 h-4 w-4 rounded border-gray-300`}
                />
                <span>
                  <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">
                    Sobrescrever compartilhamento
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-gray-500 dark:text-gray-400">
                    Aplica o compartilhamento do mapeamento (ou remove, se ele não tiver um) nas transações que já tiverem outro. Desmarcado, o valor atual é mantido.
                  </span>
                </span>
              </label>
              {isBatchRemapping && (
                <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <Loader2 size={16} className="animate-spin shrink-0 text-[var(--color-1)]" />
                  Executando mapeamentos…
                </p>
              )}
              </div>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={closeBatchRemapModal}
            onSave={() => void handleBatchRemap()}
            saving={isBatchRemapping}
            saveLabel={isBatchRemapping ? 'Executando...' : 'Executar selecionados'}
            saveIcon={
              isBatchRemapping ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Zap size={15} />
              )
            }
          />
        </CadastroModalShell>
      )}

      {/* Modal de Editar Todas */}
      {showBatchEditModal && selectedMappings.size > 0 && (
        <CadastroModalShell maxWidth="max-w-lg" onBackdropClick={() => setShowBatchEditModal(false)} zClass="z-[60]">
          <CadastroModalHeader
            isEdit={true}
            title={`Editar ${selectedMappings.size} Mapeamento(s)`}
            subtitle="Marque os campos que deseja alterar. Campos desmarcados manterão os valores atuais do banco."
            onClose={() => setShowBatchEditModal(false)}
            icon={<Edit2 size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Campos" icon={<Edit2 size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow>
                  <label className={cadastroOptionLabelCls}>
                    <input
                      type="checkbox"
                      checked={batchEditData.apply_tag_subtag}
                      onChange={(e) => setBatchEditData(prev => ({ ...prev, apply_tag_subtag: e.target.checked }))}
                      className={`${cadastroAccentControlCls} h-4 w-4 rounded border-gray-300`}
                    />
                    Alterar Tag/Subtag
                    {selectedMappingsType && (
                      <span className={`ml-1 text-xs ${selectedMappingsType === 'receita' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                        ({selectedMappingsType === 'receita' ? 'Receita' : 'Despesa'})
                      </span>
                    )}
                  </label>
                  {batchEditData.apply_tag_subtag && (
                    <div className="mt-2 space-y-2">
                      <select
                        value={batchEditData.tag_id}
                        onChange={(e) => {
                          setBatchEditData(prev => ({ ...prev, tag_id: Number(e.target.value), subtag_id: 0 }))
                        }}
                        className={cadastroFieldCls}
                      >
                        <option value={0}>Selecione uma tag...</option>
                        {tags
                          .filter(tag => subtags.some(s => s.tag_id === tag.id && s.type === selectedMappingsType))
                          .map(tag => (
                            <option key={tag.id} value={tag.id}>{tag.name}</option>
                          ))}
                      </select>
                      <select
                        value={batchEditData.subtag_id}
                        onChange={(e) => setBatchEditData(prev => ({ ...prev, subtag_id: Number(e.target.value) }))}
                        className={cadastroFieldCls}
                        disabled={!batchEditData.tag_id}
                      >
                        <option value={0}>Selecione uma subtag...</option>
                        {subtags
                          .filter(s => s.tag_id === batchEditData.tag_id && s.type === selectedMappingsType)
                          .map(subtag => (
                            <option key={subtag.id} value={subtag.id}>{subtag.name}</option>
                          ))}
                      </select>
                    </div>
                  )}
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow>
                  <label className={cadastroOptionLabelCls}>
                    <input
                      type="checkbox"
                      checked={!batchEditData.skip_sharing}
                      onChange={(e) => setBatchEditData(prev => ({ ...prev, skip_sharing: !e.target.checked }))}
                      className={`${cadastroAccentControlCls} h-4 w-4 rounded border-gray-300`}
                    />
                    Alterar Compartilhamento
                  </label>
                  {!batchEditData.skip_sharing && (
                    <div className="mt-2 space-y-2">
                      <select
                        value={batchEditData.shared_partner_id}
                        onChange={(e) => {
                          const selectedId = Number(e.target.value)
                          if (selectedId > 0) {
                            const selectedSharing = partners.find(p => p.id === selectedId)
                            if (selectedSharing) {
                              setBatchEditData(prev => ({
                                ...prev,
                                shared_partner_id: selectedId,
                                my_contribution_percentage: sharingPercentForKind(selectedSharing, 'expense'),
                                revenue_contribution_percentage: sharingPercentForKind(selectedSharing, 'revenue'),
                              }))
                            }
                          } else {
                            setBatchEditData(prev => ({
                              ...prev,
                              shared_partner_id: 0,
                              my_contribution_percentage: 50,
                              revenue_contribution_percentage: 50,
                            }))
                          }
                        }}
                        className={cadastroFieldCls}
                      >
                        <option value={0}>Nenhum (remover compartilhamento)</option>
                        {[...partners].sort((a, b) => getPartnerLabel(a).localeCompare(getPartnerLabel(b))).map(partner => (
                          <option key={partner.id} value={partner.id}>
                            {getPartnerLabel(partner)}
                          </option>
                        ))}
                      </select>
                      {batchEditData.shared_partner_id > 0 && (
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-2">
                            <CadastroFieldLabel>Despesa</CadastroFieldLabel>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={batchEditData.my_contribution_percentage ?? 50}
                              onChange={(e) => {
                                const val = Math.min(100, Math.max(0, Number(e.target.value) || 0))
                                setBatchEditData(prev => ({ ...prev, my_contribution_percentage: val }))
                              }}
                              className={`${cadastroFieldCls} w-20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                            />
                            <span className="text-sm text-gray-500">%</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <CadastroFieldLabel>Receita</CadastroFieldLabel>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={batchEditData.revenue_contribution_percentage ?? 50}
                              onChange={(e) => {
                                const val = Math.min(100, Math.max(0, Number(e.target.value) || 0))
                                setBatchEditData(prev => ({ ...prev, revenue_contribution_percentage: val }))
                              }}
                              className={`${cadastroFieldCls} w-20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                            />
                            <span className="text-sm text-gray-500">%</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CadastroModalFieldsRow>
              </CadastroModalFieldsGrid>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={() => setShowBatchEditModal(false)}
            onSave={handleBatchEdit}
            saving={isBatchEditing}
            saveLabel="Aplicar Edição"
            saveIcon={<Edit2 size={15} />}
          />
        </CadastroModalShell>
      )}

      {/* Barra Flutuante de Ações - Com seleção */}
      {selectedMappings.size > 0 && (
        <FloatingFooterBar>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-medium text-color-primary">
                {selectedMappings.size} mapeamento(s) selecionado(s)
              </span>
              <button
                onClick={() => setSelectedMappings(new Set())}
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex items-center gap-1"
              >
                <X size={14} />
                Limpar
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowBatchEditModal(true)}
                disabled={isBatchEditing || !canBatchEdit}
                className="px-3 py-1.5 text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--crud-edit)' }}
                title={!canBatchEdit ? 'Selecione apenas mapeamentos do mesmo tipo (receita ou despesa)' : 'Editar mapeamentos selecionados'}
              >
                <Edit2 size={14} />
                {isBatchEditing ? 'Editando...' : 'Editar Todas'}
              </button>
              <button
                onClick={() => setShowBatchRemapModal(true)}
                disabled={isBatchRemapping}
                className="px-3 py-1.5 text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-2)' }}
              >
                {isBatchRemapping ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Zap size={14} />
                )}
                {isBatchRemapping ? 'Executando...' : 'Executar selecionados'}
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={isDeletingSelected}
                className="px-3 py-1.5 text-white rounded-lg transition-colors flex items-center gap-1.5 hover:opacity-90 text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: 'var(--crud-delete)' }}
              >
                <Trash2 size={14} />
                {isDeletingSelected ? 'Deletando...' : `Deletar (${selectedMappings.size})`}
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
        </FloatingFooterBar>
      )}

      {/* Barra Flutuante Back to Top - Aparece só quando não há seleção */}
      {showBackToTop && selectedMappings.size === 0 && (
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

      {/* Dialogs */}
      <ConfirmComponent />

      {/* Toast */}
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}
    </>
  )
}

export default TransactionMappingsTab

