import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import {
  CadastroListPageBody,
  CadastroListPageHero,
  CadastroListPageShell,
  CadastroListPageSearchField,
  CadastroListPageTabs,
  cadastroFilterFieldCls,
} from '../components/CadastroListPageLayout'
import CuradoriaBulkApplyPanel from '../components/curadoria/CuradoriaBulkApplyPanel'
import CuradoriaGroupCard from '../components/curadoria/CuradoriaGroupCard'
import { cadastroAccentControlCls, cadastroOptionLabelCls } from '../components/CadastroFormLayout'
import {
  CadastroFormSection,
  CadastroModalBody,
  CadastroModalFooter,
  CadastroModalHeader,
  CadastroModalShell,
} from '../components/CadastroFormLayout'
import FloatingFooterBar from '../components/FloatingFooterBar'
import ListPagination from '../components/ListPagination'
import Toast from '../components/Toast'
import LoadingSpinner from '../components/LoadingSpinner'
import {
  Check,
  Loader2,
  Save,
  ArrowUp,
  ArrowDown,
  X,
  AlertTriangle,
  Sparkles,
  Link2,
  Unlink,
} from 'lucide-react'
import GroupDetailsModal from '../components/GroupDetailsModal.tsx'
import { sharingPercentForKind } from '../utils/accountFormatter'
import {
  DESCRIPTION_START_FILTER_DIGITS,
  DESCRIPTION_START_FILTER_LETTERS,
  descriptionMatchesStartFilter,
} from '../utils/descriptionSearch'

// ==================== INTERFACES ====================

interface Tag {
  id: number
  name: string
}

interface Subtag {
  id: number
  tag_id: number
  name: string
  tag_name: string
  type: string
}

interface Account {
  id: number
  name: string
  description: string | null
}

interface Partner {
  id: number
  account_id: number
  shared_account_id: number
  my_contribution_percentage: number
  revenue_contribution_percentage?: number
  description: string | null
  active: boolean
  shared_account: Account | null
}

interface UnmappedRecord {
  id: number
  date: string
  description: string
  amount: number
  source: 'bank' | 'card' | 'benefit'
  card_number?: string
  card_owner?: string
  category?: string
  tag_id?: number | null
  subtag_id?: number | null
  expense_sharing_id?: number | null
  ownership_percentage?: number | null
  current_installment?: number | null
  total_installments?: number | null
  year_month?: string | null
}

interface GroupedRecord {
  groupKey: string
  description: string
  tipo: 'receita' | 'despesa'
  count: number
  totalAmount: number
  records: UnmappedRecord[]
  tag_id: number | null
  subtag_id: number | null
  expense_sharing_id: number | null
  ownership_percentage: number | null
}

interface TransactionMapping {
  id: number
  original_description: string
  mapped_description: string | null
  subtag_id: number
  subtag_name: string | null
  subtag_type: string | null  // 'receita' ou 'despesa'
  tag_name: string | null
  mapping_type?: string  // 'exact' | 'pattern' | 'regex'
  pattern?: string | null
  regex_pattern?: string | null
  active: boolean
  created_at: string | null
  last_updated_at: string | null
}

type CuradoriaGroupBaseline = {
  tag_id: number | null
  subtag_id: number | null
  expense_sharing_id: number | null
  ownership_percentage: number | null
  createMapping: boolean
  overwriteSharing: boolean
  recordTags: string
}

function buildCuradoriaGroupBaseline(
  group: GroupedRecord,
  createMapping: boolean,
  overwrite: boolean,
): CuradoriaGroupBaseline {
  const recordTags = group.records
    .map(
      (r) =>
        `${r.id}:${r.tag_id ?? ''}:${r.subtag_id ?? ''}:${r.expense_sharing_id ?? ''}:${r.ownership_percentage ?? ''}`,
    )
    .sort()
    .join('|')
  return {
    tag_id: group.tag_id,
    subtag_id: group.subtag_id,
    expense_sharing_id: group.expense_sharing_id,
    ownership_percentage: group.ownership_percentage,
    createMapping,
    overwriteSharing: overwrite,
    recordTags,
  }
}

function curadoriaGroupHasPendingSave(
  group: GroupedRecord,
  baseline: CuradoriaGroupBaseline | undefined,
  createMapping: boolean,
  overwrite: boolean,
): boolean {
  if (!group.tag_id || !group.subtag_id) return false
  if (!baseline) return true
  const current = buildCuradoriaGroupBaseline(group, createMapping, overwrite)
  return (
    current.tag_id !== baseline.tag_id ||
    current.subtag_id !== baseline.subtag_id ||
    current.expense_sharing_id !== baseline.expense_sharing_id ||
    current.ownership_percentage !== baseline.ownership_percentage ||
    current.createMapping !== baseline.createMapping ||
    current.overwriteSharing !== baseline.overwriteSharing ||
    current.recordTags !== baseline.recordTags
  )
}

// ==================== COMPONENTE PRINCIPAL ====================

const CuradoriaPage = () => {
  // Estados principais
  const [tags, setTags] = useState<Tag[]>([])
  const [subtags, setSubtags] = useState<Subtag[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [mappings, setMappings] = useState<TransactionMapping[]>([])
  const [groupedRecords, setGroupedRecords] = useState<GroupedRecord[]>([])

  // Estados de controle
  const [savedGroups, setSavedGroups] = useState<Set<string>>(new Set())
  const [createMappings, setCreateMappings] = useState<Record<string, boolean>>({})
  const [overwriteSharing, setOverwriteSharing] = useState<Record<string, boolean>>({}) // Controla se deve sobrescrever compartilhamento
  const [groupsNeedingApply, setGroupsNeedingApply] = useState<Set<string>>(new Set())
  const [groupsWithWarning, setGroupsWithWarning] = useState<Set<string>>(new Set()) // Grupos editados manualmente
  const [hasAnyChanges, setHasAnyChanges] = useState(false) // Rastreia se houve qualquer mudança
  const [isSaving, setIsSaving] = useState<string | null>(null)
  const [isSavingAll, setIsSavingAll] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Estados globais de tag/subtag
  const [globalReceitaTag, setGlobalReceitaTag] = useState<number | null>(null)
  const [globalReceitaSubtag, setGlobalReceitaSubtag] = useState<number | null>(null)
  const [globalDespesaTag, setGlobalDespesaTag] = useState<number | null>(null)
  const [globalDespesaSubtag, setGlobalDespesaSubtag] = useState<number | null>(null)
  const [globalCreateMapping, setGlobalCreateMapping] = useState(false)

  // Estados globais de compartilhamento
  const [globalReceitaSharing, setGlobalReceitaSharing] = useState<number | null>(null)
  const [, setGlobalReceitaPercentage] = useState<string>('')
  const [globalDespesaSharing, setGlobalDespesaSharing] = useState<number | null>(null)
  const [, setGlobalDespesaPercentage] = useState<string>('')

  // Modal de detalhes
  const [detailsModalGroup, setDetailsModalGroup] = useState<GroupedRecord | null>(null)

  // Estados de paginação
  const [itemsPerPage, setItemsPerPage] = useState(100)
  const [currentPage, setCurrentPage] = useState(1)

  // Estados de ordenação
  const [sortColumn, setSortColumn] = useState<'count' | 'tipo' | 'totalAmount' | 'description' | null>('count')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [pendingSortColumn, setPendingSortColumn] = useState<'count' | 'tipo' | 'totalAmount' | 'description' | null>(null)

  // Estado do modal de confirmação de reordenação
  const [showReorderConfirmation, setShowReorderConfirmation] = useState(false)

  type CuradoriaTab = 'receita' | 'despesa'
  const [activeCuradoriaTab, setActiveCuradoriaTab] = useState<CuradoriaTab>('despesa')

  // Estado de busca
  const [searchTerm, setSearchTerm] = useState('')
  const [startsWithFilter, setStartsWithFilter] = useState<string | null>(null)
  const [detectedMode, setDetectedMode] = useState<'pattern' | 'regex'>('pattern')
  const [regexError, setRegexError] = useState<string | null>(null)

  // Reagrupamento virtual - estados separados para despesa e receita
  const [isRegrouped, setIsRegrouped] = useState(false)
  const [virtualGroupTag, setVirtualGroupTag] = useState<number | null>(null)
  const [virtualGroupSubtag, setVirtualGroupSubtag] = useState<number | null>(null)
  // Estados separados para grupo virtual de receita (quando há ambos os tipos)
  const [virtualReceitaTag, setVirtualReceitaTag] = useState<number | null>(null)
  const [virtualReceitaSubtag, setVirtualReceitaSubtag] = useState<number | null>(null)
  // Estados de compartilhamento para grupos virtuais
  const [virtualGroupSharing, setVirtualGroupSharing] = useState<number | null>(null)
  const [virtualGroupPercentage, setVirtualGroupPercentage] = useState<string>('')
  const [virtualReceitaSharing, setVirtualReceitaSharing] = useState<number | null>(null)
  const [virtualReceitaPercentage, setVirtualReceitaPercentage] = useState<string>('')

  // Toast notifications
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' | 'warning' }>({
    show: false,
    message: '',
    type: 'success'
  })

  // Estado para botão Back to Top
  const [showBackToTop, setShowBackToTop] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const groupBaselinesRef = useRef<Record<string, CuradoriaGroupBaseline>>({})

  const showSuccess = useCallback((message: string) => {
    setToast({ show: true, message, type: 'success' })
  }, [])

  const showError = useCallback((message: string) => {
    setToast({ show: true, message, type: 'error' })
  }, [])

  const showWarning = useCallback((message: string) => {
    setToast({ show: true, message, type: 'warning' })
  }, [])

  const closeToast = useCallback(() => {
    setToast(prev => ({ ...prev, show: false }))
  }, [])

  // Atalho de teclado para o modal de confirmação
  useEffect(() => {
    if (!showReorderConfirmation) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelReorder()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showReorderConfirmation])

  // ==================== CARREGAMENTO DE DADOS ====================

  useEffect(() => {
    loadData()
  }, [])

  // Detecta automaticamente se a busca é pattern ou regex
  useEffect(() => {
    if (!searchTerm.trim()) {
      setDetectedMode('pattern')
      setRegexError(null)
      setIsRegrouped(false) // Reseta reagrupamento ao limpar busca
      return
    }

    // Detecta caracteres especiais de regex
    const regexChars = /[.*+?^${}()|[\]\\]/
    const isRegex = regexChars.test(searchTerm)

    setDetectedMode(isRegex ? 'regex' : 'pattern')

    // Se for regex, valida
    if (isRegex) {
      try {
        new RegExp(searchTerm, 'i')
        setRegexError(null)
      } catch (e: any) {
        setRegexError(e.message)
      }
    } else {
      setRegexError(null)
    }
  }, [searchTerm])

  const loadData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [recordsRes, tagsRes, subtagsRes, mappingsRes, partnersRes] = await Promise.all([
        axios.get('/api/expenses/unmapped-records'),
        axios.get('/api/expenses/tags'),
        axios.get('/api/expenses/subtags'),
        axios.get('/api/expenses/mappings'),
        axios.get('/api/expense-sharing/')
      ])

      setTags(tagsRes.data)
      setSubtags(subtagsRes.data)
      setMappings(mappingsRes.data)
      setPartners(partnersRes.data)

      groupRecords(recordsRes.data)
    } catch (error: any) {
      console.error('Erro ao carregar dados:', error)
      setError(error.response?.data?.detail || 'Erro ao carregar dados')
    } finally {
      setIsLoading(false)
    }
  }

  // Sincronizar globalCreateMapping com novos grupos após reload
  useEffect(() => {
    if (globalCreateMapping && groupedRecords.length > 0) {
      const updatedMappings: Record<string, boolean> = {}
      groupedRecords.forEach(group => {
        if (!savedGroups.has(group.groupKey)) {
          updatedMappings[group.groupKey] = true
        }
      })
      setCreateMappings(updatedMappings)
    }
  }, [groupedRecords, globalCreateMapping, savedGroups])

  // ==================== AGRUPAMENTO DE REGISTROS ====================

  const groupRecords = useCallback((recordsList: UnmappedRecord[]) => {
    const groups = new Map<string, GroupedRecord>()

    recordsList.forEach(record => {
      const tipo: 'receita' | 'despesa' = record.amount >= 0 ? 'receita' : 'despesa'
      const groupKey = `${record.description.toLowerCase().trim()}|${tipo}`

      if (groups.has(groupKey)) {
        const group = groups.get(groupKey)!
        group.records.push(record)
        group.count = group.records.length
        group.totalAmount += record.amount

        // Atualizar tag_id e subtag_id se o registro atual tiver valores
        if (record.tag_id && !group.tag_id) {
          group.tag_id = record.tag_id
        }
        if (record.subtag_id && !group.subtag_id) {
          group.subtag_id = record.subtag_id
        }
        // Atualizar expense_sharing_id e ownership_percentage se o registro atual tiver valores
        if (record.expense_sharing_id && !group.expense_sharing_id) {
          group.expense_sharing_id = record.expense_sharing_id
          group.ownership_percentage = record.ownership_percentage || null
        }
      } else {
        groups.set(groupKey, {
          groupKey,
          description: record.description,
          tipo,
          count: 1,
          totalAmount: record.amount,
          records: [record],
          tag_id: record.tag_id || null,
          subtag_id: record.subtag_id || null,
          expense_sharing_id: record.expense_sharing_id || null,
          ownership_percentage: record.ownership_percentage || null
        })
      }
    })

    const groupedArray = Array.from(groups.values()).sort((a, b) => b.count - a.count)
    setGroupedRecords(groupedArray)

    // Inicializar createMappings com false para todos os grupos (dropdowns habilitados)
    const initialMappings: Record<string, boolean> = {}
    // Inicializar overwriteSharing com false para todos os grupos (não sobrescreve por padrão)
    const initialOverwriteSharing: Record<string, boolean> = {}
    groupedArray.forEach(group => {
      initialMappings[group.groupKey] = false
      initialOverwriteSharing[group.groupKey] = false
    })
    setCreateMappings(initialMappings)
    setOverwriteSharing(initialOverwriteSharing)

    const baselines: Record<string, CuradoriaGroupBaseline> = {}
    groupedArray.forEach((group) => {
      baselines[group.groupKey] = buildCuradoriaGroupBaseline(group, false, false)
    })
    groupBaselinesRef.current = baselines

    // Limpar estados de avisos e "precisando aplicar" ao recarregar
    setGroupsNeedingApply(new Set())
    setGroupsWithWarning(new Set())
  }, [])

  // ==================== FUNÇÕES AUXILIARES ====================

  const getFilteredTags = useCallback((tipo: 'receita' | 'despesa') => {
    // Filtra tags que têm pelo menos uma subtag do tipo especificado
    return tags.filter(tag =>
      subtags.some(s => s.tag_id === tag.id && s.type === tipo)
    )
  }, [tags, subtags])

  const getFilteredSubtags = useCallback((tagId: number | null, tipo: 'receita' | 'despesa') => {
    if (!tagId) return []
    return subtags.filter(s => s.tag_id === tagId && s.type === tipo)
  }, [subtags])

  /** Regra de mapeamento **exata** no cadastro (transaction_mappings), não indica subtag nos lançamentos. */
  const getExistingMapping = useCallback((description: string, tipo?: 'receita' | 'despesa') => {
    const normalizedDesc = description.toLowerCase().trim()

    const isExactMapping = (m: TransactionMapping) => {
      const kind = m.mapping_type ?? 'exact'
      return kind === 'exact'
    }

    const descriptionMatches = (m: TransactionMapping) =>
      Boolean(m.original_description) &&
      m.original_description.toLowerCase() === normalizedDesc

    if (tipo) {
      return mappings.find(
        (m) => isExactMapping(m) && descriptionMatches(m) && m.subtag_type === tipo,
      )
    }

    return mappings.find((m) => isExactMapping(m) && descriptionMatches(m))
  }, [mappings])

  const receitaGroupsCount = useMemo(
    () => groupedRecords.filter((g) => g.tipo === 'receita').length,
    [groupedRecords],
  )

  const despesaGroupsCount = useMemo(
    () => groupedRecords.filter((g) => g.tipo === 'despesa').length,
    [groupedRecords],
  )

  // Filtro por inicial + busca (pattern / regex)
  const filteredGroups = useMemo(() => {
    let list = groupedRecords
    if (startsWithFilter) {
      list = list.filter((group) => descriptionMatchesStartFilter(group.description, startsWithFilter))
    }

    if (!searchTerm.trim()) return list

    if (detectedMode === 'pattern') {
      // Busca simples por substring (case-insensitive)
      const lowerSearch = searchTerm.toLowerCase().trim()
      return list.filter((group) => group.description.toLowerCase().includes(lowerSearch))
    }

    try {
      const regex = new RegExp(searchTerm, 'i')
      return list.filter((group) => regex.test(group.description))
    } catch {
      return []
    }
  }, [groupedRecords, searchTerm, detectedMode, startsWithFilter])

  // Aplicar ordenação aos grupos filtrados
  const sortedGroups = useMemo(() => {
    if (!sortColumn) return filteredGroups

    const sorted = [...filteredGroups].sort((a, b) => {
      let comparison = 0

      switch (sortColumn) {
        case 'count':
          comparison = a.count - b.count
          break
        case 'tipo':
          comparison = a.tipo.localeCompare(b.tipo)
          break
        case 'totalAmount':
          comparison = a.totalAmount - b.totalAmount
          break
        case 'description':
          comparison = a.description.localeCompare(b.description)
          break
        default:
          comparison = 0
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })

    return sorted
  }, [filteredGroups, sortColumn, sortDirection])

  // Criar grupo(s) virtual(is) quando reagrupado - SEPARADOS POR TIPO
  const displayGroups = useMemo(() => {
    if (!isRegrouped || filteredGroups.length === 0) {
      return sortedGroups
    }

    // Separar registros por tipo (despesa vs receita)
    const despesaRecords: UnmappedRecord[] = []
    const receitaRecords: UnmappedRecord[] = []
    let despesaTotalAmount = 0
    let receitaTotalAmount = 0

    filteredGroups.forEach(group => {
      if (group.tipo === 'despesa') {
        despesaRecords.push(...group.records)
        despesaTotalAmount += group.totalAmount
      } else {
        receitaRecords.push(...group.records)
        receitaTotalAmount += group.totalAmount
      }
    })

    const virtualGroups: GroupedRecord[] = []

    // Criar grupo virtual de DESPESAS (se houver)
    if (despesaRecords.length > 0) {
      virtualGroups.push({
        groupKey: `virtual_despesa_${searchTerm}`,
        description: `🔗 GRUPO VIRTUAL (Despesas): ${detectedMode === 'pattern' ? 'Padrão' : 'Regex'} "${searchTerm}"`,
        count: despesaRecords.length,
        records: despesaRecords,
        tipo: 'despesa',
        totalAmount: despesaTotalAmount,
        tag_id: virtualGroupTag,
        subtag_id: virtualGroupSubtag,
        expense_sharing_id: virtualGroupSharing,
        ownership_percentage: virtualGroupPercentage ? parseFloat(virtualGroupPercentage) : null
      })
    }

    // Criar grupo virtual de RECEITAS (se houver)
    if (receitaRecords.length > 0) {
      virtualGroups.push({
        groupKey: `virtual_receita_${searchTerm}`,
        description: `🔗 GRUPO VIRTUAL (Receitas): ${detectedMode === 'pattern' ? 'Padrão' : 'Regex'} "${searchTerm}"`,
        count: receitaRecords.length,
        records: receitaRecords,
        tipo: 'receita',
        totalAmount: receitaTotalAmount,
        tag_id: virtualReceitaTag,
        subtag_id: virtualReceitaSubtag,
        expense_sharing_id: virtualReceitaSharing,
        ownership_percentage: virtualReceitaPercentage ? parseFloat(virtualReceitaPercentage) : null
      })
    }

    return virtualGroups
  }, [isRegrouped, filteredGroups, sortedGroups, searchTerm, detectedMode, virtualGroupTag, virtualGroupSubtag, virtualReceitaTag, virtualReceitaSubtag, virtualGroupSharing, virtualGroupPercentage, virtualReceitaSharing, virtualReceitaPercentage])

  const tabDisplayGroups = useMemo(
    () => displayGroups.filter((g) => g.tipo === activeCuradoriaTab),
    [displayGroups, activeCuradoriaTab],
  )

  // Calcular grupos paginados (após ordenação)
  const paginatedGroups = useMemo(() => {
    if (itemsPerPage === 0) return tabDisplayGroups
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return tabDisplayGroups.slice(startIndex, endIndex)
  }, [tabDisplayGroups, currentPage, itemsPerPage])


  /** Grupos com tag/subtag completos e estado diferente do carregamento (alinhado ao "Salvar todos"). */
  const savePendingCount = useMemo(() => {
    if (isRegrouped && (virtualGroupSubtag || virtualReceitaSubtag)) {
      return (virtualGroupSubtag ? 1 : 0) + (virtualReceitaSubtag ? 1 : 0)
    }
    const baselines = groupBaselinesRef.current
    return groupedRecords.reduce((count, group) => {
      if (group.groupKey.startsWith('virtual_')) return count
      const createMapping = createMappings[group.groupKey] ?? false
      const overwrite = overwriteSharing[group.groupKey] ?? false
      if (
        curadoriaGroupHasPendingSave(group, baselines[group.groupKey], createMapping, overwrite)
      ) {
        return count + 1
      }
      return count
    }, 0)
  }, [
    groupedRecords,
    createMappings,
    overwriteSharing,
    isRegrouped,
    virtualGroupSubtag,
    virtualReceitaSubtag,
  ])

  // Resetar para página 1 quando filtros mudarem ou dados recarregarem
  useEffect(() => {
    setCurrentPage(1)
  }, [
    groupedRecords.length,
    itemsPerPage,
    sortColumn,
    sortDirection,
    activeCuradoriaTab,
    searchTerm,
    startsWithFilter,
  ])

  // Detecta scroll para mostrar botão "Voltar ao Topo"
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
  }, [groupedRecords])

  // Função para voltar ao topo
  const scrollToTop = () => {
    setShowBackToTop(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Função para limpar todas as seleções
  const handleClearAllSelections = useCallback(() => {
    // Resetar todos os grupos para valores originais (sem tag/subtag/compartilhamento)
    setGroupedRecords(prev => {
      const next = prev.map(group => ({
        ...group,
        tag_id: null,
        subtag_id: null,
        expense_sharing_id: null,
        ownership_percentage: null,
        records: group.records.map(record => ({
          ...record,
          tag_id: null,
          subtag_id: null,
          expense_sharing_id: null,
          ownership_percentage: null
        }))
      }))
      const baselines: Record<string, CuradoriaGroupBaseline> = {}
      next.forEach((group) => {
        baselines[group.groupKey] = buildCuradoriaGroupBaseline(group, false, false)
      })
      groupBaselinesRef.current = baselines
      return next
    })

    // Limpar todos os estados relacionados
    setCreateMappings({})
    setOverwriteSharing({})
    setGroupsNeedingApply(new Set())
    setGroupsWithWarning(new Set())
    setHasAnyChanges(false)
    setGlobalReceitaTag(null)
    setGlobalReceitaSubtag(null)
    setGlobalDespesaTag(null)
    setGlobalDespesaSubtag(null)
    setGlobalCreateMapping(false)

    // Limpar estados globais de compartilhamento
    setGlobalReceitaSharing(null)
    setGlobalReceitaPercentage('')
    setGlobalDespesaSharing(null)
    setGlobalDespesaPercentage('')

    // Limpar tags/subtags/compartilhamento dos grupos virtuais (despesa e receita)
    setVirtualGroupTag(null)
    setVirtualGroupSubtag(null)
    setVirtualReceitaTag(null)
    setVirtualReceitaSubtag(null)
    setVirtualGroupSharing(null)
    setVirtualGroupPercentage('')
    setVirtualReceitaSharing(null)
    setVirtualReceitaPercentage('')

    showSuccess('Todas as seleções foram removidas')
  }, [showSuccess])

  // Função para alternar ordenação (com verificação de seleções pendentes)
  const handleSort = useCallback((column: 'count' | 'tipo' | 'totalAmount' | 'description') => {
    // Se há mudanças pendentes, mostrar confirmação
    if (hasAnyChanges) {
      setPendingSortColumn(column)
      setShowReorderConfirmation(true)
      return
    }

    // Se não há mudanças, ordenar diretamente
    if (sortColumn === column) {
      // Se já está ordenando por essa coluna, inverte a direção
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      // Se é uma nova coluna, define como descendente por padrão
      setSortColumn(column)
      setSortDirection('desc')
    }
  }, [sortColumn, hasAnyChanges])

  // Função para aplicar a ordenação (após confirmação)
  const applySort = useCallback(() => {
    if (!pendingSortColumn) return

    if (sortColumn === pendingSortColumn) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(pendingSortColumn)
      setSortDirection('desc')
    }

    setPendingSortColumn(null)
    setShowReorderConfirmation(false)
  }, [sortColumn, pendingSortColumn])



  // ==================== HANDLERS ====================

  const handleGroupTagChange = useCallback((groupKey: string, tagId: number | null) => {
    const currentGroup = groupedRecords.find(g => g.groupKey === groupKey)
    if (!currentGroup) return

    // Verificar se o grupo JÁ TINHA tag/subtag antes da edição
    const hadPreviousValues = currentGroup.tag_id !== null && currentGroup.subtag_id !== null

    // Se tagId é null, limpar tag e subtag
    if (tagId === null) {
      setGroupedRecords(prev => prev.map(group => {
        if (group.groupKey !== groupKey) return group
        return {
          ...group,
          tag_id: null,
          subtag_id: null
        }
      }))

      // Marcar que houve mudanças
      setHasAnyChanges(true)

      // Remover de "precisando aplicar" e avisos
      setGroupsNeedingApply(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })
      setGroupsWithWarning(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })
      setCreateMappings(prev => ({ ...prev, [groupKey]: false }))
      return
    }

    // Verificar se a subtag atual pertence à nova tag
    const currentSubtag = currentGroup.subtag_id ? subtags.find(s => s.id === currentGroup.subtag_id) : null
    const subtagBelongsToNewTag = currentSubtag?.tag_id === tagId
    const willHaveSubtag = subtagBelongsToNewTag

    setGroupedRecords(prev => prev.map(group => {
      if (group.groupKey !== groupKey) return group

      // Verificar se a subtag atual pertence à nova tag
      const currentSubtag = group.subtag_id ? subtags.find(s => s.id === group.subtag_id) : null
      const subtagBelongsToNewTag = currentSubtag?.tag_id === tagId

      return {
        ...group,
        tag_id: tagId,
        subtag_id: subtagBelongsToNewTag ? group.subtag_id : null
      }
    }))

    // Marcar que houve mudanças
    setHasAnyChanges(true)

    // Se JÁ TINHA valores antes E ainda terá subtag depois da mudança
    if (hadPreviousValues && willHaveSubtag) {
      setGroupsNeedingApply(prev => new Set(prev).add(groupKey))
      setGroupsWithWarning(prev => new Set(prev).add(groupKey))
      // REMOVIDO: Não desmarcar o checkbox "Mapear" ao editar tag
    }
    // Se JÁ TINHA valores mas a subtag será removida (não pertence à nova tag)
    else if (hadPreviousValues && !willHaveSubtag) {
      // Remover de "precisando aplicar" pois não tem subtag
      setGroupsNeedingApply(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })
      // Remover o aviso também, pois sem subtag não há nada para aplicar
      setGroupsWithWarning(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })
      // REMOVIDO: Não desmarcar o checkbox "Mapear" ao editar tag
    }
  }, [groupedRecords, subtags])

  const handleGroupSubtagChange = useCallback((groupKey: string, subtagId: number | null) => {
    const currentGroup = groupedRecords.find(g => g.groupKey === groupKey)
    if (!currentGroup) return

    setGroupedRecords(prev => prev.map(group => {
      if (group.groupKey !== groupKey) return group

      if (!subtagId) {
        return { ...group, subtag_id: null }
      }

      const subtag = subtags.find(s => s.id === subtagId)
      return {
        ...group,
        tag_id: subtag?.tag_id || group.tag_id,
        subtag_id: subtagId
      }
    }))

    // Marcar que houve mudanças
    setHasAnyChanges(true)

    // SEMPRE marcar como "precisando aplicar" quando selecionar uma subtag
    // (tanto primeira vez quanto edição posterior)
    if (subtagId) {
      setGroupsNeedingApply(prev => new Set(prev).add(groupKey))

      // SEMPRE mostrar aviso quando selecionar subtag
      // (tanto primeira edição quanto edição posterior)
      setGroupsWithWarning(prev => new Set(prev).add(groupKey))

      // REMOVIDO: Não desmarcar o checkbox "Mapear" ao editar subtag
      // O checkbox mantém seu estado atual (marcado ou desmarcado)
    } else {
      // Se limpar a subtag, remover de "precisando aplicar" e avisos
      setGroupsNeedingApply(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })
      setGroupsWithWarning(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })
    }
  }, [groupedRecords, subtags])

  const handleToggleMapping = useCallback((groupKey: string) => {
    setCreateMappings(prev => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }))
    setHasAnyChanges(true)
  }, [])

  // Handler para alternar "Sobrescrever Compartilhamento"
  const handleToggleOverwriteSharing = useCallback((groupKey: string) => {
    setOverwriteSharing(prev => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }))
    setHasAnyChanges(true)
  }, [])

  // Handler para mudança de compartilhamento no grupo
  const handleGroupSharingChange = useCallback((groupKey: string, sharingId: number | null) => {
    const currentGroup = groupedRecords.find(g => g.groupKey === groupKey)
    if (!currentGroup) return

    const hadPreviousValues = currentGroup.expense_sharing_id !== null

    setGroupedRecords(prev => prev.map(group => {
      if (group.groupKey !== groupKey) return group

      // Se limpar compartilhamento, setar como null
      if (sharingId === null) {
        return { ...group, expense_sharing_id: null, ownership_percentage: null }
      }

      // Obter porcentagem padrão do parceiro
      const partner = partners.find(p => p.id === sharingId)
      return {
        ...group,
        expense_sharing_id: sharingId,
        ownership_percentage: partner
          ? sharingPercentForKind(partner, group.tipo === 'receita' ? 'revenue' : 'expense')
          : 50
      }
    }))

    // Se preencheu compartilhamento, marca automaticamente "Sobrescrever Compartilhamento"
    // Se limpou, permite que o usu\u00e1rio decida (n\u00e3o altera o estado)
    if (sharingId !== null) {
      setOverwriteSharing(prev => ({ ...prev, [groupKey]: true }))
    }

    setHasAnyChanges(true)

    if (hadPreviousValues || sharingId !== null) {
      setGroupsNeedingApply(prev => new Set(prev).add(groupKey))
      setGroupsWithWarning(prev => new Set(prev).add(groupKey))
    }
  }, [groupedRecords, partners])

  // Handler para mudança de porcentagem de compartilhamento no grupo
  const handleGroupPercentageChange = useCallback((groupKey: string, percentage: string) => {
    setGroupedRecords(prev => prev.map(group => {
      if (group.groupKey !== groupKey) return group

      const parsedPercentage = parseFloat(percentage)
      return {
        ...group,
        ownership_percentage: !isNaN(parsedPercentage) ? parsedPercentage : null
      }
    }))

    setHasAnyChanges(true)
    setGroupsNeedingApply(prev => new Set(prev).add(groupKey))
    setGroupsWithWarning(prev => new Set(prev).add(groupKey))
  }, [])

  const handleApplyGroupToRecords = useCallback((groupKey: string) => {
    // Verificar se é grupo virtual e de qual tipo
    const isVirtualDespesa = groupKey.startsWith('virtual_despesa_')
    const isVirtualReceita = groupKey.startsWith('virtual_receita_')
    const isVirtualGroup = isVirtualDespesa || isVirtualReceita

    if (isVirtualGroup) {
      // Determinar qual tag/subtag/sharing usar baseado no tipo do grupo virtual
      const tagToApply = isVirtualReceita ? virtualReceitaTag : virtualGroupTag
      const subtagToApply = isVirtualReceita ? virtualReceitaSubtag : virtualGroupSubtag
      const sharingToApply = isVirtualReceita ? virtualReceitaSharing : virtualGroupSharing
      const percentageToApply = isVirtualReceita
        ? (virtualReceitaPercentage ? parseFloat(virtualReceitaPercentage) : null)
        : (virtualGroupPercentage ? parseFloat(virtualGroupPercentage) : null)
      const tipoToFilter = isVirtualReceita ? 'receita' : 'despesa'

      // Para grupo virtual, aplicar tag/subtag a todos os registros dos grupos filtrados
      if (!tagToApply || !subtagToApply) return

      // Atualizar todos os registros dos grupos filtrados DO MESMO TIPO
      setGroupedRecords(prev => {
        return prev.map(g => {
          // Verificar se este grupo está nos filteredGroups E é do mesmo tipo
          const isInFiltered = filteredGroups.some(fg => fg.groupKey === g.groupKey)
          if (!isInFiltered || g.tipo !== tipoToFilter) return g

          // Atualizar cada registro dentro do grupo com tag_id, subtag_id e compartilhamento
          const updatedRecords = g.records.map(record => ({
            ...record,
            tag_id: tagToApply,
            subtag_id: subtagToApply,
            expense_sharing_id: sharingToApply,
            ownership_percentage: percentageToApply
          }))

          return {
            ...g,
            tag_id: tagToApply,
            subtag_id: subtagToApply,
            expense_sharing_id: sharingToApply,
            ownership_percentage: percentageToApply,
            records: updatedRecords
          }
        })
      })

      // Remover grupo virtual da lista de "precisando aplicar" e avisos
      setGroupsNeedingApply(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })
      setGroupsWithWarning(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })

      showSuccess('Valores aplicados a todos os registros. Clique em "Salvar" para persistir no banco.')
    } else {
      // Lógica original para grupos normais
      const group = groupedRecords.find(g => g.groupKey === groupKey)
      if (!group || !group.subtag_id) return

      // ⚠️ APENAS ATUALIZA O ESTADO LOCAL - NÃO SALVA NO BANCO!
      // O salvamento no banco acontece apenas quando clicar em "Salvar" ou "Salvar Todos"

      // Atualizar os registros individuais no estado local
      setGroupedRecords(prev => {
        const updated = prev.map(g => {
          if (g.groupKey !== groupKey) return g

          // Atualizar cada registro dentro do grupo com tag_id, subtag_id e compartilhamento
          const updatedRecords = g.records.map(record => ({
            ...record,
            tag_id: g.tag_id!,
            subtag_id: g.subtag_id!,
            expense_sharing_id: g.expense_sharing_id,
            ownership_percentage: g.ownership_percentage
          }))

          const updatedGroup = {
            ...g,
            records: updatedRecords
          }

          // Se o modal está aberto para este grupo, atualizar também
          if (detailsModalGroup && detailsModalGroup.groupKey === groupKey) {
            setDetailsModalGroup(updatedGroup)
          }

          return updatedGroup
        })

        return updated
      })

      // Remover grupo da lista de "precisando aplicar" e avisos
      setGroupsNeedingApply(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })
      setGroupsWithWarning(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })

      showSuccess('Valores sincronizados. Clique em "Salvar" para persistir no banco.')
    }
  }, [groupedRecords, detailsModalGroup, showSuccess, virtualGroupTag, virtualGroupSubtag, virtualReceitaTag, virtualReceitaSubtag, virtualGroupSharing, virtualGroupPercentage, virtualReceitaSharing, virtualReceitaPercentage, filteredGroups])

  // ==================== APLICAR TAGS GLOBAIS ====================

  const applyGlobalReceitas = useCallback(() => {
    if (!globalReceitaTag || !globalReceitaSubtag) {
      showWarning('Por favor, selecione tag e subtag de receita')
      return
    }

    // Se estamos em modo de reagrupamento virtual, aplicar ao grupo virtual de receita
    if (isRegrouped) {
      const virtualReceitaGroup = paginatedGroups.find(g => g.groupKey.startsWith('virtual_receita_'))
      if (!virtualReceitaGroup) {
        showWarning('Nenhum grupo virtual de receita encontrado')
        return
      }

      // Atualizar estados do grupo virtual de receita
      setVirtualReceitaTag(globalReceitaTag)
      setVirtualReceitaSubtag(globalReceitaSubtag)

      // Atualizar os registros dos grupos originais que fazem parte do grupo virtual
      setGroupedRecords(prev => prev.map(group => {
        // Verificar se este grupo está nos filteredGroups E é receita
        const isInFiltered = filteredGroups.some(fg => fg.groupKey === group.groupKey)
        if (!isInFiltered || group.tipo !== 'receita') return group

        // Atualizar cada registro dentro do grupo com tag_id e subtag_id
        const updatedRecords = group.records.map(record => ({
          ...record,
          tag_id: globalReceitaTag,
          subtag_id: globalReceitaSubtag
        }))

        return {
          ...group,
          tag_id: globalReceitaTag,
          subtag_id: globalReceitaSubtag,
          records: updatedRecords
        }
      }))

      // ✅ FIX: REMOVER grupo virtual de "precisando aplicar" (já foi aplicado)
      setGroupsNeedingApply(prev => {
        const newSet = new Set(prev)
        newSet.delete(virtualReceitaGroup.groupKey)
        return newSet
      })

      // ✅ FIX: REMOVER aviso também (já foi aplicado)
      setGroupsWithWarning(prev => {
        const newSet = new Set(prev)
        newSet.delete(virtualReceitaGroup.groupKey)
        return newSet
      })

      const tagName = tags.find(t => t.id === globalReceitaTag)?.name || ''
      const subtagName = subtags.find(s => s.id === globalReceitaSubtag)?.name || ''
      setHasAnyChanges(true)
      showSuccess(`Tags aplicadas ao grupo virtual de receitas: ${tagName} / ${subtagName}. Clique em "Salvar" para confirmar.`)
      return
    }

    // APLICAR APENAS AOS GRUPOS DA PÁGINA ATUAL (modo normal)
    const affectedGroups = paginatedGroups.filter(g => !savedGroups.has(g.groupKey) && g.tipo === 'receita')
    const countGroups = affectedGroups.length

    if (countGroups === 0) {
      showWarning('Nenhum grupo de receita pendente para aplicar tags na página atual')
      return
    }

    // Criar um Set com os groupKeys afetados para otimizar a busca
    const affectedGroupKeys = new Set(affectedGroups.map(g => g.groupKey))

    // Atualizar APENAS o estado local (não salva no backend ainda)
    setGroupedRecords(prev => prev.map(group => {
      // Aplicar apenas aos grupos da página atual
      if (affectedGroupKeys.has(group.groupKey)) {
        // Atualizar cada registro dentro do grupo com tag_id e subtag_id
        const updatedRecords = group.records.map(record => ({
          ...record,
          tag_id: globalReceitaTag,
          subtag_id: globalReceitaSubtag
        }))

        return {
          ...group,
          tag_id: globalReceitaTag,
          subtag_id: globalReceitaSubtag,
          records: updatedRecords
        }
      }
      return group
    }))

    // Remover grupos da lista de "precisando aplicar" (já foram aplicados)
    setGroupsNeedingApply(prev => {
      const newSet = new Set(prev)
      affectedGroups.forEach(g => newSet.delete(g.groupKey))
      return newSet
    })

    const tagName = tags.find(t => t.id === globalReceitaTag)?.name || ''
    const subtagName = subtags.find(s => s.id === globalReceitaSubtag)?.name || ''

    let totalRecords = 0
    affectedGroups.forEach(g => totalRecords += g.records.length)

    // Marcar que houve mudanças
    setHasAnyChanges(true)

    showSuccess(`Tags aplicadas a ${countGroups} grupo(s) e ${totalRecords} registro(s) da página atual: ${tagName} / ${subtagName}. Clique em "Salvar Todos" para confirmar.`)
  }, [globalReceitaTag, globalReceitaSubtag, paginatedGroups, savedGroups, tags, subtags, showWarning, showSuccess, isRegrouped, filteredGroups])

  const applyGlobalDespesas = useCallback(() => {
    if (!globalDespesaTag || !globalDespesaSubtag) {
      showWarning('Por favor, selecione tag e subtag de despesa')
      return
    }

    // Se estamos em modo de reagrupamento virtual, aplicar ao grupo virtual de despesa
    if (isRegrouped) {
      const virtualDespesaGroup = paginatedGroups.find(g => g.groupKey.startsWith('virtual_despesa_'))
      if (!virtualDespesaGroup) {
        showWarning('Nenhum grupo virtual de despesa encontrado')
        return
      }

      // Atualizar estados do grupo virtual de despesa
      setVirtualGroupTag(globalDespesaTag)
      setVirtualGroupSubtag(globalDespesaSubtag)

      // Atualizar os registros dos grupos originais que fazem parte do grupo virtual
      setGroupedRecords(prev => prev.map(group => {
        // Verificar se este grupo está nos filteredGroups E é despesa
        const isInFiltered = filteredGroups.some(fg => fg.groupKey === group.groupKey)
        if (!isInFiltered || group.tipo !== 'despesa') return group

        // Atualizar cada registro dentro do grupo com tag_id e subtag_id
        const updatedRecords = group.records.map(record => ({
          ...record,
          tag_id: globalDespesaTag,
          subtag_id: globalDespesaSubtag
        }))

        return {
          ...group,
          tag_id: globalDespesaTag,
          subtag_id: globalDespesaSubtag,
          records: updatedRecords
        }
      }))

      // ✅ FIX: REMOVER grupo virtual de "precisando aplicar" (já foi aplicado)
      setGroupsNeedingApply(prev => {
        const newSet = new Set(prev)
        newSet.delete(virtualDespesaGroup.groupKey)
        return newSet
      })

      // ✅ FIX: REMOVER aviso também (já foi aplicado)
      setGroupsWithWarning(prev => {
        const newSet = new Set(prev)
        newSet.delete(virtualDespesaGroup.groupKey)
        return newSet
      })

      const tagName = tags.find(t => t.id === globalDespesaTag)?.name || ''
      const subtagName = subtags.find(s => s.id === globalDespesaSubtag)?.name || ''
      setHasAnyChanges(true)
      showSuccess(`Tags aplicadas ao grupo virtual de despesas: ${tagName} / ${subtagName}. Clique em "Salvar" para confirmar.`)
      return
    }

    // APLICAR APENAS AOS GRUPOS DA PÁGINA ATUAL (modo normal)
    const affectedGroups = paginatedGroups.filter(g => !savedGroups.has(g.groupKey) && g.tipo === 'despesa')
    const countGroups = affectedGroups.length

    if (countGroups === 0) {
      showWarning('Nenhum grupo de despesa pendente para aplicar tags na página atual')
      return
    }

    // Criar um Set com os groupKeys afetados para otimizar a busca
    const affectedGroupKeys = new Set(affectedGroups.map(g => g.groupKey))

    // Atualizar APENAS o estado local (não salva no backend ainda)
    setGroupedRecords(prev => prev.map(group => {
      // Aplicar apenas aos grupos da página atual
      if (affectedGroupKeys.has(group.groupKey)) {
        // Atualizar cada registro dentro do grupo com tag_id e subtag_id
        const updatedRecords = group.records.map(record => ({
          ...record,
          tag_id: globalDespesaTag,
          subtag_id: globalDespesaSubtag
        }))

        return {
          ...group,
          tag_id: globalDespesaTag,
          subtag_id: globalDespesaSubtag,
          records: updatedRecords
        }
      }
      return group
    }))

    // Remover grupos da lista de "precisando aplicar" (já foram aplicados)
    setGroupsNeedingApply(prev => {
      const newSet = new Set(prev)
      affectedGroups.forEach(g => newSet.delete(g.groupKey))
      return newSet
    })

    const tagName = tags.find(t => t.id === globalDespesaTag)?.name || ''
    const subtagName = subtags.find(s => s.id === globalDespesaSubtag)?.name || ''

    let totalRecords = 0
    affectedGroups.forEach(g => totalRecords += g.records.length)

    // Marcar que houve mudanças
    setHasAnyChanges(true)

    showSuccess(`Tags aplicadas a ${countGroups} grupo(s) e ${totalRecords} registro(s) da página atual: ${tagName} / ${subtagName}. Clique em "Salvar Todos" para confirmar.`)
  }, [globalDespesaTag, globalDespesaSubtag, paginatedGroups, savedGroups, tags, subtags, showWarning, showSuccess, isRegrouped, filteredGroups])

  const handleSetAllMappings = useCallback((value: boolean, tab: CuradoriaTab) => {
    const updatedMappings: Record<string, boolean> = { ...createMappings }
    groupedRecords.forEach(group => {
      if (!savedGroups.has(group.groupKey) && group.tipo === tab) {
        updatedMappings[group.groupKey] = value
      }
    })

    if (isRegrouped && searchTerm.trim()) {
      const virtualKey =
        tab === 'receita' ? `virtual_receita_${searchTerm}` : `virtual_despesa_${searchTerm}`
      updatedMappings[virtualKey] = value
    }

    setCreateMappings(updatedMappings)
    setGlobalCreateMapping(value)
  }, [createMappings, groupedRecords, savedGroups, isRegrouped, searchTerm])

  // ==================== REAGRUPAMENTO VIRTUAL ====================

  // Reagrupar todos os grupos filtrados
  const handleRegroup = () => {
    if (filteredGroups.length === 0) {
      showWarning('Não há grupos para reagrupar')
      return
    }

    // Limpar tags/subtags/compartilhamento do grupo virtual
    setVirtualGroupTag(null)
    setVirtualGroupSubtag(null)
    setVirtualGroupSharing(null)
    setVirtualGroupPercentage('')
    setVirtualReceitaTag(null)
    setVirtualReceitaSubtag(null)
    setVirtualReceitaSharing(null)
    setVirtualReceitaPercentage('')

    // Determinar os keys dos grupos virtuais (podem ter despesa e receita separados)
    const virtualDespesaKey = `virtual_despesa_${searchTerm}`
    const virtualReceitaKey = `virtual_receita_${searchTerm}`

    // Limpar avisos dos grupos virtuais
    setGroupsNeedingApply(prev => {
      const newSet = new Set(prev)
      newSet.delete(virtualDespesaKey)
      newSet.delete(virtualReceitaKey)
      return newSet
    })
    setGroupsWithWarning(prev => {
      const newSet = new Set(prev)
      newSet.delete(virtualDespesaKey)
      newSet.delete(virtualReceitaKey)
      return newSet
    })

    // Inicializar checkbox "Mapear" dos grupos virtuais com o valor do checkbox global
    setCreateMappings(prev => ({
      ...prev,
      [virtualDespesaKey]: globalCreateMapping,
      [virtualReceitaKey]: globalCreateMapping
    }))

    // Inicializar checkbox "Sobrescrever Compartilhamento" dos grupos virtuais com false (padrão)
    setOverwriteSharing(prev => ({
      ...prev,
      [virtualDespesaKey]: false,
      [virtualReceitaKey]: false
    }))

    setIsRegrouped(true)

    // Conta total de registros
    const totalRecords = filteredGroups.reduce((sum, g) => sum + g.count, 0)
    showSuccess(`${filteredGroups.length} grupo(s) com ${totalRecords} registro(s) agrupados`)
  }

  // Desfazer reagrupamento
  const handleUndoRegroup = () => {
    // Limpar tags/subtags de todos os grupos filtrados
    setGroupedRecords(prev => {
      return prev.map(g => {
        // Verificar se este grupo está nos filteredGroups
        const isInFiltered = filteredGroups.some(fg => fg.groupKey === g.groupKey)
        if (!isInFiltered) return g

        // Limpar tag_id e subtag_id do grupo e dos registros
        const clearedRecords = g.records.map(record => ({
          ...record,
          tag_id: null,
          subtag_id: null
        }))

        return {
          ...g,
          tag_id: null,
          subtag_id: null,
          records: clearedRecords
        }
      })
    })

    // Limpar avisos de todos os grupos filtrados
    setGroupsNeedingApply(prev => {
      const newSet = new Set(prev)
      filteredGroups.forEach(g => newSet.delete(g.groupKey))
      return newSet
    })
    setGroupsWithWarning(prev => {
      const newSet = new Set(prev)
      filteredGroups.forEach(g => newSet.delete(g.groupKey))
      return newSet
    })

    setIsRegrouped(false)
    setVirtualGroupTag(null)
    setVirtualGroupSubtag(null)
    setVirtualGroupSharing(null)
    setVirtualGroupPercentage('')
    setVirtualReceitaTag(null)
    setVirtualReceitaSubtag(null)
    setVirtualReceitaSharing(null)
    setVirtualReceitaPercentage('')
  }

  // Salvar mapeamento de um grupo virtual específico (despesa ou receita)
  const handleSaveVirtualGroupByType = async (tipo: 'despesa' | 'receita') => {
    const subtagToUse = tipo === 'receita' ? virtualReceitaSubtag : virtualGroupSubtag
    const virtualGroupKey = tipo === 'receita' ? `virtual_receita_${searchTerm}` : `virtual_despesa_${searchTerm}`
    const shouldCreateMapping = createMappings[virtualGroupKey] ?? true

    // Obter compartilhamento do grupo virtual
    const sharingToUse = tipo === 'receita' ? virtualReceitaSharing : virtualGroupSharing
    const percentageToUse = tipo === 'receita'
      ? (virtualReceitaPercentage ? parseFloat(virtualReceitaPercentage) : null)
      : (virtualGroupPercentage ? parseFloat(virtualGroupPercentage) : null)

    // Verificar se deve sobrescrever compartilhamento
    const shouldOverwrite = overwriteSharing[virtualGroupKey] ?? false
    const hasNewSharing = sharingToUse !== null
    const shouldIncludeSharing = hasNewSharing || shouldOverwrite

    if (!subtagToUse) return 0

    // Filtrar grupos do tipo correto
    const groupsOfType = filteredGroups.filter(g => g.tipo === tipo)
    if (groupsOfType.length === 0) return 0

    // Coletar todos os registros
    const allRecords: UnmappedRecord[] = []
    groupsOfType.forEach(group => {
      allRecords.push(...group.records)
    })

    // Preparar dados para bulk update (incluindo compartilhamento se necessário)
    const bulkData = allRecords.map(record => {
      const data: {
        id: number
        source: string
        subtag_id: number
        expense_sharing_id?: number | null
        ownership_percentage?: number | null
      } = {
        id: record.id,
        source: record.source,
        subtag_id: subtagToUse
      }
      // Só inclui campos de compartilhamento se deve sobrescrever
      if (shouldIncludeSharing) {
        data.expense_sharing_id = sharingToUse
        data.ownership_percentage = percentageToUse
      }
      return data
    })

    // Atualizar todos os registros de uma vez
    await axios.patch('/api/expenses/bulk-update-subtags', { records: bulkData })

    // Cria o mapeamento pattern ou regex APENAS se o checkbox estiver marcado
    if (shouldCreateMapping) {
      // Priority baseada no tipo de mapeamento: pattern=1 (Média), regex=2 (Baixa)
      const mappingPriority = detectedMode === 'pattern' ? 1 : 2

      // Payload do mapeamento (incluindo compartilhamento se necessário)
      // Na curadoria, mapped_description é sempre null (descrição fica no pattern ou regex_pattern)
      const mappingPayload: {
        mapping_type: string
        pattern?: string | null
        regex_pattern?: string | null
        mapped_description: null
        subtag_id: number
        priority: number
        is_sensitive: boolean
        expense_sharing_id?: number | null
        my_contribution_percentage?: number | null
        revenue_contribution_percentage?: number | null
      } = {
        mapping_type: detectedMode,
        pattern: detectedMode === 'pattern' ? searchTerm.toLowerCase() : null,
        regex_pattern: detectedMode === 'regex' ? searchTerm : null,
        mapped_description: null,
        subtag_id: subtagToUse,
        priority: mappingPriority,
        is_sensitive: false
      }

      // Só inclui compartilhamento no mapeamento se deve sobrescrever
      if (shouldIncludeSharing) {
        mappingPayload.expense_sharing_id = sharingToUse ?? null
        if (tipo === 'receita') {
          mappingPayload.revenue_contribution_percentage = percentageToUse ?? null
        } else {
          mappingPayload.my_contribution_percentage = percentageToUse ?? null
        }
      }

      await axios.post('/api/expenses/mappings', mappingPayload)
    }

    return allRecords.length
  }

  // Salvar um grupo virtual específico (despesa OU receita)
  const handleSaveSpecificVirtualGroup = async (groupKey: string) => {
    // Determinar o tipo baseado no groupKey
    const isVirtualReceita = groupKey.startsWith('virtual_receita_')
    const tipo: 'despesa' | 'receita' = isVirtualReceita ? 'receita' : 'despesa'
    const subtagToUse = isVirtualReceita ? virtualReceitaSubtag : virtualGroupSubtag

    if (!subtagToUse) {
      showWarning('Por favor, selecione uma subtag antes de salvar')
      return
    }

    setIsSaving(groupKey)
    try {
      const count = await handleSaveVirtualGroupByType(tipo)
      const shouldCreateMapping = createMappings[groupKey] ?? true

      if (shouldCreateMapping) {
        showSuccess(
          `${count} registro(s) de ${tipo} salvos e mapeamento ${detectedMode === 'pattern' ? 'padrão' : 'regex'} criado!`
        )
      } else {
        showSuccess(
          `${count} registro(s) de ${tipo} foram salvos com sucesso.`
        )
      }

      // Limpar apenas o grupo salvo (incluindo compartilhamento)
      if (isVirtualReceita) {
        setVirtualReceitaTag(null)
        setVirtualReceitaSubtag(null)
        setVirtualReceitaSharing(null)
        setVirtualReceitaPercentage('')
      } else {
        setVirtualGroupTag(null)
        setVirtualGroupSubtag(null)
        setVirtualGroupSharing(null)
        setVirtualGroupPercentage('')
      }

      // Remover grupo da lista de "precisando aplicar"
      setGroupsNeedingApply(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })
      setGroupsWithWarning(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })

      // Recarrega dados
      await loadData()

      // Se ambos os grupos foram salvos, resetar reagrupamento
      const otherGroupKey = isVirtualReceita ? `virtual_despesa_${searchTerm}` : `virtual_receita_${searchTerm}`
      const otherGroupExists = paginatedGroups.some(g => g.groupKey === otherGroupKey)
      const otherGroupSubtag = isVirtualReceita ? virtualGroupSubtag : virtualReceitaSubtag

      if (!otherGroupExists || !otherGroupSubtag) {
        setIsRegrouped(false)
        setSearchTerm('')
      }
    } catch (error: any) {
      console.error('Erro ao salvar:', error)
      // Trata erros de validação do Pydantic (422) que vêm como array de objetos
      let errorMsg = 'Erro ao salvar'
      const detail = error.response?.data?.detail
      if (typeof detail === 'string') {
        errorMsg = detail
      } else if (Array.isArray(detail) && detail.length > 0) {
        // Pydantic retorna [{type, loc, msg, input, ctx}, ...]
        errorMsg = detail.map((e: any) => e.msg || e.message || JSON.stringify(e)).join(', ')
      }
      showError(errorMsg)
    } finally {
      setIsSaving(null)
    }
  }

  // Salvar mapeamentos dos grupos virtuais (despesa e/ou receita) - USADO APENAS NO "SALVAR TODOS"
  const handleSaveVirtualGroup = async () => {
    // Verificar quais grupos têm subtag selecionada
    const hasDespesa = virtualGroupSubtag !== null
    const hasReceita = virtualReceitaSubtag !== null

    if (!hasDespesa && !hasReceita) {
      showWarning('Por favor, selecione uma subtag em pelo menos um grupo')
      return
    }

    setIsSavingAll(true)
    try {
      let totalRecords = 0
      let mappingsCreated = 0

      // Salvar grupo de despesas (se tiver subtag selecionada)
      if (hasDespesa) {
        const despesaGroupKey = `virtual_despesa_${searchTerm}`
        const count = await handleSaveVirtualGroupByType('despesa')
        totalRecords += count
        if (createMappings[despesaGroupKey] ?? true) mappingsCreated++
      }

      // Salvar grupo de receitas (se tiver subtag selecionada)
      if (hasReceita) {
        const receitaGroupKey = `virtual_receita_${searchTerm}`
        const count = await handleSaveVirtualGroupByType('receita')
        totalRecords += count
        if (createMappings[receitaGroupKey] ?? true) mappingsCreated++
      }

      if (mappingsCreated > 0) {
        showSuccess(
          `${totalRecords} registro(s) salvos e ${mappingsCreated} mapeamento(s) ${detectedMode === 'pattern' ? 'padrão' : 'regex'} criado(s)!`
        )
      } else {
        showSuccess(
          `${totalRecords} registro(s) foram salvos com sucesso.`
        )
      }

      // Reseta reagrupamento (incluindo compartilhamento)
      setIsRegrouped(false)
      setVirtualGroupTag(null)
      setVirtualGroupSubtag(null)
      setVirtualGroupSharing(null)
      setVirtualGroupPercentage('')
      setVirtualReceitaTag(null)
      setVirtualReceitaSubtag(null)
      setVirtualReceitaSharing(null)
      setVirtualReceitaPercentage('')
      setSearchTerm('')

      // Recarrega dados
      await loadData()
    } catch (error: any) {
      console.error('Erro ao salvar:', error)
      const errorMsg = error.response?.data?.detail || 'Erro ao salvar'
      showError(errorMsg)
    } finally {
      setIsSavingAll(false)
    }
  }

  // ==================== SALVAR GRUPO ====================

  const handleSaveGroup = useCallback(async (groupKey: string) => {
    const group = groupedRecords.find(g => g.groupKey === groupKey)
    if (!group) return

    // Validação: tag e subtag devem estar selecionadas
    if (!group.tag_id || !group.subtag_id) {
      showWarning('Por favor, selecione tag e subtag antes de salvar')
      return
    }

    // VALIDAÇÃO CRÍTICA 1: Verificar se há registros sem subtag_id (não foram aplicados)
    const recordsWithoutSubtag = group.records.filter(record => !record.subtag_id)

    if (recordsWithoutSubtag.length > 0) {
      showError(
        `${recordsWithoutSubtag.length} registro(s) não possuem tag/subtag aplicada.\n\n` +
        `Você selecionou tag/subtag no grupo, mas não aplicou aos registros.\n\n` +
        `Clique em "Aplicar ao Grupo" para sincronizar todos os registros antes de salvar.`
      )
      return
    }

    const shouldCreateMapping = createMappings[groupKey] ?? false

    // VALIDAÇÃO CRÍTICA 2: Se "Mapear" = true, todos os registros devem ter a mesma tag/subtag do grupo
    if (shouldCreateMapping) {
      const inconsistentRecords = group.records.filter(record =>
        record.tag_id !== group.tag_id || record.subtag_id !== group.subtag_id
      )

      if (inconsistentRecords.length > 0) {
        showError(
          `${inconsistentRecords.length} registro(s) possuem tag/subtag diferente do grupo.\n\n` +
          `Para criar mapeamento, todos os registros devem ter os mesmos valores.\n\n` +
          `Opções:\n` +
          `• Desmarque "Mapear" para salvar com valores individuais, OU\n` +
          `• Clique em "Aplicar ao Grupo" para sincronizar todos os registros.`
        )
        return
      }
    }

    // VALIDAÇÃO 3: Verificar se há registros com compartilhamento diferente do grupo
    const recordsWithDifferentSharing = group.records.filter(record =>
      record.expense_sharing_id !== group.expense_sharing_id ||
      record.ownership_percentage !== group.ownership_percentage
    )

    if (recordsWithDifferentSharing.length > 0 && group.expense_sharing_id !== null) {
      showError(
        `${recordsWithDifferentSharing.length} registro(s) possuem compartilhamento diferente do grupo.\n\n` +
        `Clique em "Aplicar ao Grupo" para sincronizar todos os registros antes de salvar.`
      )
      return
    }

    setIsSaving(groupKey)

    try {
      // 1. Preparar dados para atualização (incluindo compartilhamento)
      // Verifica se deve sobrescrever compartilhamento:
      // - Se compartilhamento preenchido: sempre sobrescreve
      // - Se compartilhamento nulo E checkbox marcado: limpa o compartilhamento existente
      // - Se compartilhamento nulo E checkbox desmarcado: NÃO altera o compartilhamento
      const shouldOverwriteSharing = overwriteSharing[groupKey] ?? false
      const hasNewSharing = group.expense_sharing_id !== null
      const shouldIncludeSharing = hasNewSharing || shouldOverwriteSharing

      let bulkData: Array<{
        id: number
        source: string
        subtag_id: number
        expense_sharing_id?: number | null
        ownership_percentage?: number | null
      }>

      if (shouldCreateMapping) {
        // Se "Mapear" = true: usar valores do grupo para todos os registros
        bulkData = group.records.map(record => {
          const data: typeof bulkData[0] = {
            id: record.id,
            source: record.source,
            subtag_id: group.subtag_id!
          }
          // Só inclui campos de compartilhamento se deve sobrescrever
          if (shouldIncludeSharing) {
            data.expense_sharing_id = group.expense_sharing_id
            data.ownership_percentage = group.ownership_percentage
          }
          return data
        })
      } else {
        // Se "Mapear" = false: usar valores individuais de cada registro
        bulkData = group.records.map(record => {
          const data: typeof bulkData[0] = {
            id: record.id,
            source: record.source,
            subtag_id: record.subtag_id || group.subtag_id!
          }
          // Só inclui campos de compartilhamento se deve sobrescrever
          if (shouldIncludeSharing) {
            data.expense_sharing_id = record.expense_sharing_id ?? group.expense_sharing_id
            data.ownership_percentage = record.ownership_percentage ?? group.ownership_percentage
          }
          return data
        })
      }

      await axios.patch('/api/expenses/bulk-update-subtags', { records: bulkData })

      // 2. Criar mapeamento APENAS se checkbox estiver marcado
      if (shouldCreateMapping) {
        const normalizedDesc = group.description.toLowerCase().trim()

        // Verificar se já existe mapeamento (com verificação de tipo)
        const existingMapping = getExistingMapping(group.description, group.tipo)

        // Payload com compartilhamento (s\u00f3 inclui se deve sobrescrever)
        const mappingPayload: {
          subtag_id: number
          original_description?: string
          expense_sharing_id?: number | null
          my_contribution_percentage?: number | null
          revenue_contribution_percentage?: number | null
        } = {
          subtag_id: group.subtag_id!
        }

        // Só inclui compartilhamento no mapeamento se deve sobrescrever
        if (shouldIncludeSharing) {
          mappingPayload.expense_sharing_id = group.expense_sharing_id ?? null
          if (group.tipo === 'receita') {
            mappingPayload.revenue_contribution_percentage = group.ownership_percentage ?? null
          } else {
            mappingPayload.my_contribution_percentage = group.ownership_percentage ?? null
          }
        }

        if (existingMapping) {
          // Atualizar mapeamento existente
          await axios.put(`/api/expenses/mappings/${existingMapping.id}`, mappingPayload)
        } else {
          // Criar novo mapeamento
          await axios.post('/api/expenses/mappings', {
            ...mappingPayload,
            original_description: normalizedDesc
          })
        }
      }

      // Remover grupo da lista (ao invés de apenas marcar como salvo)
      setGroupedRecords(prev => prev.filter(g => g.groupKey !== groupKey))

      // Limpar estados relacionados ao grupo
      setSavedGroups(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })
      setCreateMappings(prev => {
        const newMappings = { ...prev }
        delete newMappings[groupKey]
        return newMappings
      })
      setOverwriteSharing(prev => {
        const newState = { ...prev }
        delete newState[groupKey]
        return newState
      })
      setGroupsNeedingApply(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })
      setGroupsWithWarning(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupKey)
        return newSet
      })

      const mappingMsg = shouldCreateMapping ? ' (mapeamento criado)' : ' (sem mapeamento)'
      showSuccess(`Grupo "${group.description}" salvo com sucesso${mappingMsg}!`)
    } catch (error: any) {
      console.error('Erro ao salvar grupo:', error)
      // Trata erros de validação do Pydantic (422) que vêm como array de objetos
      let errorMsg = 'Erro ao salvar grupo'
      const detail = error.response?.data?.detail
      if (typeof detail === 'string') {
        errorMsg = detail
      } else if (Array.isArray(detail) && detail.length > 0) {
        errorMsg = detail.map((e: any) => e.msg || e.message || JSON.stringify(e)).join(', ')
      }
      showError(errorMsg)
    } finally {
      setIsSaving(null)
    }
  }, [groupedRecords, createMappings, overwriteSharing, getExistingMapping, showSuccess, showError, showWarning])

  // ==================== SALVAR TODOS ====================

  const handleSaveAll = useCallback(async () => {
    // Se há grupo(s) virtual(is), salvar eles (despesa e/ou receita)
    if (isRegrouped && (virtualGroupSubtag || virtualReceitaSubtag)) {
      await handleSaveVirtualGroup()
      return
    }

    const unsavedGroups = groupedRecords.filter(g => !savedGroups.has(g.groupKey))

    // Filtrar apenas grupos que TÊM tag/subtag selecionadas (ignorar grupos não mapeados)
    const groupsToSave = unsavedGroups.filter(g => g.tag_id && g.subtag_id)

    // Validar se há grupos incompletos (tem tag MAS não tem subtag, ou vice-versa)
    const incompleteGroups = unsavedGroups.filter(g =>
      (g.tag_id && !g.subtag_id) || (!g.tag_id && g.subtag_id)
    )

    if (incompleteGroups.length > 0) {
      showWarning(
        `${incompleteGroups.length} grupo(s) possuem apenas tag OU subtag selecionada. Por favor, complete ou limpe a seleção.`
      )
      return
    }

    if (groupsToSave.length === 0) {
      showWarning('Nenhum grupo com tag/subtag selecionadas para salvar')
      return
    }

    // VALIDAÇÃO: Separar grupos válidos e inválidos (com checkbox "Mapear" inconsistente)
    const validGroups: GroupedRecord[] = []
    const inconsistentGroups: Array<{ group: GroupedRecord; reason: string }> = []

    groupsToSave.forEach(group => {
      const shouldCreateMapping = createMappings[group.groupKey] ?? false

      if (shouldCreateMapping) {
        // Se "Mapear" está marcado, validar consistência
        const inconsistentRecords = group.records.filter(record =>
          record.tag_id !== group.tag_id || record.subtag_id !== group.subtag_id
        )

        if (inconsistentRecords.length > 0) {
          inconsistentGroups.push({
            group,
            reason: `${inconsistentRecords.length} registro(s) com tag/subtag diferente (checkbox "Mapear" marcado)`
          })
        } else {
          validGroups.push(group)
        }
      } else {
        // Se "Mapear" não está marcado, grupo é válido
        validGroups.push(group)
      }
    })

    // Se não há grupos válidos, apenas mostrar erro
    if (validGroups.length === 0) {
      showError(
        `Todos os ${inconsistentGroups.length} grupo(s) possuem problemas:\n\n` +
        inconsistentGroups.map(({ group, reason }) => `• "${group.description}": ${reason}`).join('\n') +
        `\n\nPara cada grupo inconsistente, você deve:\n` +
        `• Desmarcar "Mapear" para salvar com valores individuais, OU\n` +
        `• Clicar em "Aplicar ao Grupo" para sincronizar todos os registros.`
      )
      return
    }

    setIsSavingAll(true)

    try {
      // 1. Preparar dados para bulk update (apenas grupos válidos)
      // Inclui compartilhamento apenas se shouldIncludeSharing for true
      const bulkData: Array<{
        id: number
        source: string
        subtag_id: number
        expense_sharing_id?: number | null
        ownership_percentage?: number | null
      }> = []

      validGroups.forEach(group => {
        // Verifica se deve sobrescrever compartilhamento para este grupo
        const shouldOverwrite = overwriteSharing[group.groupKey] ?? false
        const hasNewSharing = group.expense_sharing_id !== null
        const shouldIncludeSharing = hasNewSharing || shouldOverwrite

        group.records.forEach(record => {
          const data: {
            id: number
            source: string
            subtag_id: number
            expense_sharing_id?: number | null
            ownership_percentage?: number | null
          } = {
            id: record.id,
            source: record.source,
            subtag_id: group.subtag_id!
          }
          // Só inclui campos de compartilhamento se deve sobrescrever
          if (shouldIncludeSharing) {
            data.expense_sharing_id = group.expense_sharing_id
            data.ownership_percentage = group.ownership_percentage
          }
          bulkData.push(data)
        })
      })

      // 2. Atualizar todos os registros válidos
      await axios.patch('/api/expenses/bulk-update-subtags', { records: bulkData })

      // 3. Criar mapeamentos para grupos válidos marcados
      const mappingsToCreate = validGroups
        .filter(g => createMappings[g.groupKey])
        .map(g => {
          // Verifica se deve sobrescrever compartilhamento para este grupo
          const shouldOverwrite = overwriteSharing[g.groupKey] ?? false
          const hasNewSharing = g.expense_sharing_id !== null
          const shouldIncludeSharing = hasNewSharing || shouldOverwrite

          const mapping: {
            original_description: string
            subtag_id: number
            expense_sharing_id?: number | null
            my_contribution_percentage?: number | null
            revenue_contribution_percentage?: number | null
          } = {
            original_description: g.description.toLowerCase().trim(),
            subtag_id: g.subtag_id!
          }
          // Só inclui compartilhamento se deve sobrescrever
          if (shouldIncludeSharing) {
            mapping.expense_sharing_id = g.expense_sharing_id ?? null
            if (g.tipo === 'receita') {
              mapping.revenue_contribution_percentage = g.ownership_percentage ?? null
            } else {
              mapping.my_contribution_percentage = g.ownership_percentage ?? null
            }
          }
          return mapping
        })

      if (mappingsToCreate.length > 0) {
        await axios.post('/api/expenses/mappings/bulk', { mappings: mappingsToCreate })
      }

      // 4. Remover apenas os grupos válidos salvos da lista
      const savedGroupKeys = new Set(validGroups.map(g => g.groupKey))
      setGroupedRecords(prev => prev.filter(g => !savedGroupKeys.has(g.groupKey)))

      // Limpar estados relacionados aos grupos salvos
      setSavedGroups(new Set())
      setCreateMappings(prev => {
        const newMappings = { ...prev }
        validGroups.forEach(g => delete newMappings[g.groupKey])
        return newMappings
      })
      setOverwriteSharing(prev => {
        const newState = { ...prev }
        validGroups.forEach(g => delete newState[g.groupKey])
        return newState
      })
      setGroupsNeedingApply(prev => {
        const newSet = new Set(prev)
        validGroups.forEach(g => newSet.delete(g.groupKey))
        return newSet
      })
      setGroupsWithWarning(prev => {
        const newSet = new Set(prev)
        validGroups.forEach(g => newSet.delete(g.groupKey))
        return newSet
      })

      // 5. Mostrar mensagem de sucesso com avisos se houver grupos inconsistentes
      if (inconsistentGroups.length > 0) {
        // Salvamento parcial
        const message =
          `✅ ${validGroups.length} salvos | ${mappingsToCreate.length} mapeamentos criados\n\n` +
          `⚠️ ${inconsistentGroups.length} NÃO salvos (registros com tags diferentes)\n\n` +
          `Solução: Desmarque "Mapear" OU clique "Aplicar ao Grupo"`

        showWarning(message)
      } else {
        // Salvamento completo
        const message = `${validGroups.length} grupos salvos | ${mappingsToCreate.length} mapeamentos criados`
        showSuccess(message)
      }
    } catch (error: any) {
      console.error('Erro ao salvar todos:', error)
      // Trata erros de validação do Pydantic (422) que vêm como array de objetos
      let errorMsg = 'Erro ao salvar grupos'
      const detail = error.response?.data?.detail
      if (typeof detail === 'string') {
        errorMsg = detail
      } else if (Array.isArray(detail) && detail.length > 0) {
        errorMsg = detail.map((e: any) => e.msg || e.message || JSON.stringify(e)).join(', ')
      }
      showError(errorMsg)
    } finally {
      setIsSavingAll(false)
    }
  }, [groupedRecords, savedGroups, createMappings, overwriteSharing, showSuccess, showError, showWarning])

  // ==================== FUNÇÕES DE REORDENAÇÃO ====================

  // Opção 1: Salvar e Reordenar
  const handleSaveAndReorder = useCallback(async () => {
    // Salvar todos os grupos primeiro
    await handleSaveAll()
    // Depois aplicar a ordenação
    applySort()
  }, [handleSaveAll, applySort])

  // Opção 2: Limpar e Reordenar
  const handleClearAndReorder = useCallback(() => {
    // Limpar todas as seleções
    handleClearAllSelections()
    // Depois aplicar a ordenação
    applySort()
  }, [handleClearAllSelections, applySort])

  // Opção 3: Cancelar
  const handleCancelReorder = useCallback(() => {
    setPendingSortColumn(null)
    setShowReorderConfirmation(false)
  }, [])

  // ==================== RENDERIZAÇÃO ====================

  if (isLoading) {
    return (
      <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <CadastroListPageShell>
          <LoadingSpinner fullScreen message="Carregando registros..." />
        </CadastroListPageShell>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen min-h-0 overflow-hidden bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <CadastroListPageShell>
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
              <button
                onClick={loadData}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Tentar Novamente
              </button>
            </div>
          </div>
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
          contentOverflow="auto"
          header={
            <CadastroListPageHero
              icon={<Sparkles className="h-8 w-8" />}
              title="Curadoria de Registros"
              subtitle="Categorize lançamentos não mapeados e crie regras automáticas"
            />
          }
        >
          {groupedRecords.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <Check className="mx-auto mb-4 h-16 w-16 text-green-600 dark:text-green-400" />
              <h3 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">Tudo categorizado</h3>
              <p className="text-gray-600 dark:text-gray-400">Não há registros pendentes.</p>
            </div>
          ) : (
            <div className={`overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 ${hasAnyChanges ? 'pb-20' : ''}`}>
              <div className="px-4 pt-3">
                <CadastroListPageTabs
                  tabs={[
                    {
                      key: 'despesa',
                      label: 'Despesas',
                      count: despesaGroupsCount,
                      icon: <ArrowDown size={16} className="text-[var(--color-danger)]" aria-hidden />,
                    },
                    {
                      key: 'receita',
                      label: 'Receitas',
                      count: receitaGroupsCount,
                      icon: <ArrowUp size={16} className="text-[var(--color-success)]" aria-hidden />,
                    },
                  ]}
                  active={activeCuradoriaTab}
                  onChange={setActiveCuradoriaTab}
                />
              </div>

              <CuradoriaBulkApplyPanel
                tipo={activeCuradoriaTab}
                tagId={activeCuradoriaTab === 'receita' ? globalReceitaTag : globalDespesaTag}
                subtagId={activeCuradoriaTab === 'receita' ? globalReceitaSubtag : globalDespesaSubtag}
                sharingId={activeCuradoriaTab === 'receita' ? globalReceitaSharing : globalDespesaSharing}
                onTagChange={(id) => {
                  if (activeCuradoriaTab === 'receita') {
                    setGlobalReceitaTag(id)
                    setGlobalReceitaSubtag(null)
                  } else {
                    setGlobalDespesaTag(id)
                    setGlobalDespesaSubtag(null)
                  }
                }}
                onSubtagChange={
                  activeCuradoriaTab === 'receita' ? setGlobalReceitaSubtag : setGlobalDespesaSubtag
                }
                onSharingChange={(id, pct) => {
                  if (activeCuradoriaTab === 'receita') {
                    setGlobalReceitaSharing(id)
                    setGlobalReceitaPercentage(pct)
                  } else {
                    setGlobalDespesaSharing(id)
                    setGlobalDespesaPercentage(pct)
                  }
                }}
                onApply={activeCuradoriaTab === 'receita' ? applyGlobalReceitas : applyGlobalDespesas}
                partners={partners}
                getFilteredTags={getFilteredTags}
                getFilteredSubtags={getFilteredSubtags}
              />

              <div className="px-4 pt-1">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="min-w-0 flex-1 basis-0 sm:min-w-[12rem]">
                    <CadastroListPageSearchField
                      value={searchTerm}
                      onChange={setSearchTerm}
                      placeholder="Buscar descrição…"
                    />
                  </div>
                  <select
                    value={`${sortColumn ?? 'count'}:${sortDirection}`}
                    onChange={(e) => {
                      const [col, dir] = e.target.value.split(':') as [
                        'count' | 'tipo' | 'totalAmount' | 'description',
                        'asc' | 'desc',
                      ]
                      if (hasAnyChanges) {
                        handleSort(col)
                        return
                      }
                      setSortColumn(col)
                      setSortDirection(dir)
                    }}
                    className={`${cadastroFilterFieldCls} !w-full shrink-0 px-1.5 text-xs sm:!w-[7rem]`}
                    title="Ordenação"
                    aria-label="Ordenação"
                  >
                    <option value="count:desc">Qtd ↓</option>
                    <option value="count:asc">Qtd ↑</option>
                    <option value="totalAmount:desc">Valor ↓</option>
                    <option value="totalAmount:asc">Valor ↑</option>
                    <option value="description:asc">A–Z</option>
                    <option value="description:desc">Z–A</option>
                  </select>
                  {searchTerm.trim() && filteredGroups.length > 0 ? (
                    isRegrouped ? (
                      <button
                        type="button"
                        onClick={handleUndoRegroup}
                        className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-1 rounded-lg px-2.5 text-xs font-medium text-white sm:w-auto"
                        style={{ backgroundColor: 'var(--crud-delete)' }}
                      >
                        <Unlink size={14} /> Desfazer
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleRegroup}
                        className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-1 rounded-lg px-2.5 text-xs font-medium text-white sm:w-auto"
                        style={{ backgroundColor: 'var(--color-2)' }}
                      >
                        <Link2 size={14} /> Reagrupar
                      </button>
                    )
                  ) : null}
                </div>
                <div className="mb-3 -mx-1 overflow-x-auto px-1 pb-0.5">
                  <div className="flex w-max min-w-full flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setStartsWithFilter(null)}
                      className={`shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                        startsWithFilter === null
                          ? 'border-[var(--color-1)] bg-[color-mix(in_srgb,var(--color-1)_12%,transparent)] text-[var(--color-1)]'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
                      }`}
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setStartsWithFilter((prev) =>
                          prev === DESCRIPTION_START_FILTER_DIGITS ? null : DESCRIPTION_START_FILTER_DIGITS,
                        )
                      }
                      className={`shrink-0 rounded-md border px-2 py-1 text-xs font-medium tabular-nums transition-colors ${
                        startsWithFilter === DESCRIPTION_START_FILTER_DIGITS
                          ? 'border-[var(--color-1)] bg-[color-mix(in_srgb,var(--color-1)_12%,transparent)] text-[var(--color-1)]'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
                      }`}
                      title="Descrições que começam com número"
                    >
                      0–9
                    </button>
                    {DESCRIPTION_START_FILTER_LETTERS.map((letter) => (
                      <button
                        key={letter}
                        type="button"
                        onClick={() =>
                          setStartsWithFilter((prev) => (prev === letter ? null : letter))
                        }
                        className={`shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                          startsWithFilter === letter
                            ? 'border-[var(--color-1)] bg-[color-mix(in_srgb,var(--color-1)_12%,transparent)] text-[var(--color-1)]'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
                        }`}
                        title={`Começa com ${letter}`}
                      >
                        {letter}
                      </button>
                    ))}
                  </div>
                </div>
                {searchTerm.trim() || startsWithFilter ? (
                  <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                    {startsWithFilter
                      ? startsWithFilter === DESCRIPTION_START_FILTER_DIGITS
                        ? 'Início: número (0–9)'
                        : `Início: ${startsWithFilter}`
                      : null}
                    {startsWithFilter && searchTerm.trim() ? ' · ' : ''}
                    {searchTerm.trim() ? (
                      <>
                        {detectedMode === 'pattern' ? 'Busca por texto' : 'Regex'}
                        {regexError ? ` — ${regexError}` : ''}
                      </>
                    ) : null}
                    {' · '}
                    {tabDisplayGroups.length} grupo(s) nesta aba
                  </p>
                ) : null}
              </div>

              <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-700">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <label className={`${cadastroOptionLabelCls} min-w-0`}>
                    <input
                      type="checkbox"
                      checked={globalCreateMapping}
                      onChange={(e) => handleSetAllMappings(e.target.checked, activeCuradoriaTab)}
                      className={`h-4 w-4 rounded ${cadastroAccentControlCls}`}
                    />
                    Marcar &quot;Criar mapeamento&quot; em todos os grupos desta aba
                  </label>
                  {hasAnyChanges ? (
                    <button
                      type="button"
                      onClick={handleClearAllSelections}
                      className="flex shrink-0 items-center gap-1.5 text-sm font-semibold transition-all hover:opacity-80"
                      style={{ color: 'var(--color-1)' }}
                    >
                      <X size={14} /> Limpar seleções
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3 p-4 pt-0">
                {paginatedGroups.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-500">
                    {activeCuradoriaTab === 'receita'
                      ? 'Nenhum grupo de receitas pendente.'
                      : 'Nenhum grupo de despesas pendente.'}
                  </p>
                ) : (
                  paginatedGroups.map((group, index) => {
                    const isVirtualGroup = group.groupKey.startsWith('virtual_')
                    const isSaved = savedGroups.has(group.groupKey)
                    const isCurrentlySaving = isSaving === group.groupKey
                    const createMappingChecked = isVirtualGroup
                      ? (createMappings[group.groupKey] ?? globalCreateMapping)
                      : (createMappings[group.groupKey] ?? false)
                    const needsApply = groupsNeedingApply.has(group.groupKey)
                    const dropdownsDisabled = isSaved
                    const hasWarning = groupsWithWarning.has(group.groupKey)
                    const lineNumber = (currentPage - 1) * itemsPerPage + index + 1

                    return (
                      <CuradoriaGroupCard
                        key={group.groupKey}
                        group={group}
                        lineNumber={lineNumber}
                        isSaved={isSaved}
                        isCurrentlySaving={isCurrentlySaving}
                        createMappingChecked={createMappingChecked}
                        needsApply={needsApply}
                        hasWarning={hasWarning}
                        dropdownsDisabled={dropdownsDisabled}
                        detectedMode={detectedMode}
                        partners={partners}
                        virtualGroupTag={virtualGroupTag}
                        virtualGroupSubtag={virtualGroupSubtag}
                        virtualReceitaTag={virtualReceitaTag}
                        virtualReceitaSubtag={virtualReceitaSubtag}
                        virtualGroupSharing={virtualGroupSharing}
                        virtualGroupPercentage={virtualGroupPercentage}
                        virtualReceitaSharing={virtualReceitaSharing}
                        virtualReceitaPercentage={virtualReceitaPercentage}
                        overwriteSharing={overwriteSharing}
                        getFilteredTags={getFilteredTags}
                        getFilteredSubtags={getFilteredSubtags}
                        onGroupTagChange={handleGroupTagChange}
                        onGroupSubtagChange={handleGroupSubtagChange}
                        onGroupSharingChange={handleGroupSharingChange}
                        onGroupPercentageChange={handleGroupPercentageChange}
                        onToggleMapping={handleToggleMapping}
                        onToggleOverwriteSharing={handleToggleOverwriteSharing}
                        onApplyGroupToRecords={handleApplyGroupToRecords}
                        onSaveGroup={handleSaveGroup}
                        onSaveVirtualGroup={handleSaveSpecificVirtualGroup}
                        onOpenDetails={setDetailsModalGroup}
                        setVirtualGroupTag={setVirtualGroupTag}
                        setVirtualGroupSubtag={setVirtualGroupSubtag}
                        setVirtualReceitaTag={setVirtualReceitaTag}
                        setVirtualReceitaSubtag={setVirtualReceitaSubtag}
                        setVirtualGroupSharing={setVirtualGroupSharing}
                        setVirtualGroupPercentage={setVirtualGroupPercentage}
                        setVirtualReceitaSharing={setVirtualReceitaSharing}
                        setVirtualReceitaPercentage={setVirtualReceitaPercentage}
                        setOverwriteSharing={setOverwriteSharing}
                        setHasAnyChanges={setHasAnyChanges}
                        setGroupsNeedingApply={setGroupsNeedingApply}
                        setGroupsWithWarning={setGroupsWithWarning}
                      />
                    )
                  })
                )}
              </div>

              <ListPagination
                total={tabDisplayGroups.length}
                page={currentPage}
                perPage={itemsPerPage}
                onPageChange={setCurrentPage}
                onPerPageChange={setItemsPerPage}
                options={[50, 100, 200, 500, 0]}
              />
            </div>
          )}
        </CadastroListPageBody>
      </CadastroListPageShell>

      {/* Modal de Detalhes */}
      {detailsModalGroup && (
        <GroupDetailsModal
          groupDescription={detailsModalGroup.description}
          records={detailsModalGroup.records}
          tags={tags}
          subtags={subtags}
          partners={partners}
          tipo={detailsModalGroup.tipo}
          onClose={() => setDetailsModalGroup(null)}
          onChange={(updatedRecords: UnmappedRecord[]) => {
            // Atualizar os registros no grupo
            setGroupedRecords(prev => prev.map(g => {
              if (g.groupKey === detailsModalGroup.groupKey) {
                return { ...g, records: updatedRecords }
              }
              return g
            }))
            // Atualizar também o detailsModalGroup para manter o modal sincronizado
            setDetailsModalGroup(prev => prev ? { ...prev, records: updatedRecords } : null)
            // Marcar que houve mudanças
            setHasAnyChanges(true)
          }}
        />
      )}

      {/* Modal de Confirmação de Reordenação */}
      {showReorderConfirmation && (
        <CadastroModalShell maxWidth="max-w-md" onBackdropClick={handleCancelReorder} zClass="z-[60]">
          <CadastroModalHeader
            isEdit={false}
            title="Seleções Pendentes"
            subtitle="Você tem seleções de tags/subtags pendentes que não foram salvas."
            onClose={handleCancelReorder}
            icon={<AlertTriangle size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Confirmação" icon={<AlertTriangle size={14} />}>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Ao reordenar a tabela, os registros com seleções pendentes podem ficar espalhados por diferentes páginas.
              </p>
              <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                O que você deseja fazer?
              </p>
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={handleCancelReorder}
            onSave={handleSaveAndReorder}
            saveLabel="Salvar e Reordenar"
            saveIcon={<Save size={15} />}
            secondaryActions={
              <button
                type="button"
                onClick={handleClearAndReorder}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: 'var(--color-warning)', color: 'var(--on-color-warning)' }}
              >
                <X size={15} />
                Limpar e Reordenar
              </button>
            }
          />
        </CadastroModalShell>
      )}

      {/* Barra Flutuante Back to Top */}
      {(showBackToTop || (hasAnyChanges && savePendingCount > 0)) && (
        <FloatingFooterBar>
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {savePendingCount > 0 ? (
                <>
                  <span className="font-semibold text-orange-600 dark:text-orange-400">{savePendingCount}</span>
                  {' '}
                  grupo(s) prontos para salvar
                </>
              ) : (
                'Role a lista para ver mais grupos'
              )}
            </span>
            <div className="flex items-center gap-2">
              {hasAnyChanges && savePendingCount > 0 ? (
                <button
                  type="button"
                  onClick={handleSaveAll}
                  disabled={isSavingAll}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'var(--color-create)', color: 'var(--on-color-create)' }}
                >
                  {isSavingAll ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                  Salvar todos ({savePendingCount})
                </button>
              ) : null}
              {showBackToTop ? (
                <button
                  type="button"
                  onClick={scrollToTop}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-color-primary px-3 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  title="Voltar ao topo"
                >
                  <ArrowUp size={14} />
                  Topo
                </button>
              ) : null}
            </div>
          </div>
        </FloatingFooterBar>
      )}

      {/* Toast de notificações */}
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={closeToast}
        />
      )}
    </div>
  )
}

export default CuradoriaPage