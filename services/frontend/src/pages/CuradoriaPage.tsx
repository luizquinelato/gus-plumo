import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import axios from 'axios'
import Sidebar from '../components/Sidebar'
import Toast from '../components/Toast'
import LoadingSpinner from '../components/LoadingSpinner'
import { Check, Loader2, Copy, FileText, ArrowDownCircle, ArrowUpCircle, Save, ArrowUpDown, ArrowUp, ArrowDown, X, AlertTriangle, Search, Landmark, CreditCard, Gift, Sparkles, Users, Tag as TagIcon, Tags as TagsIcon } from 'lucide-react'
import { formatCurrencyWithColor } from '../utils/currency'
import GroupDetailsModal from '../components/GroupDetailsModal.tsx'

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
  active: boolean
  created_at: string | null
  last_updated_at: string | null
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
  const [globalReceitaPercentage, setGlobalReceitaPercentage] = useState<string>('')
  const [globalDespesaSharing, setGlobalDespesaSharing] = useState<number | null>(null)
  const [globalDespesaPercentage, setGlobalDespesaPercentage] = useState<string>('')

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

  // Estado de busca
  const [searchTerm, setSearchTerm] = useState('')
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

  const getExistingMapping = useCallback((description: string, tipo?: 'receita' | 'despesa') => {
    const normalizedDesc = description.toLowerCase().trim()

    // Se tipo foi fornecido, verifica compatibilidade
    if (tipo) {
      return mappings.find(m =>
        m.original_description && m.original_description.toLowerCase() === normalizedDesc &&
        m.subtag_type === tipo
      )
    }

    // Se tipo não foi fornecido, retorna qualquer mapeamento (compatibilidade)
    return mappings.find(m => m.original_description && m.original_description.toLowerCase() === normalizedDesc)
  }, [mappings])

  const hasReceitas = useMemo(() =>
    groupedRecords.some(g => !savedGroups.has(g.groupKey) && g.tipo === 'receita'),
    [groupedRecords, savedGroups]
  )

  const hasDespesas = useMemo(() =>
    groupedRecords.some(g => !savedGroups.has(g.groupKey) && g.tipo === 'despesa'),
    [groupedRecords, savedGroups]
  )

  // Aplicar filtro de busca aos grupos (com suporte a regex)
  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return groupedRecords

    if (detectedMode === 'pattern') {
      // Busca simples por substring (case-insensitive)
      const lowerSearch = searchTerm.toLowerCase().trim()
      return groupedRecords.filter(group =>
        group.description.toLowerCase().includes(lowerSearch)
      )
    } else {
      // Busca com regex
      try {
        const regex = new RegExp(searchTerm, 'i')
        return groupedRecords.filter(group =>
          regex.test(group.description)
        )
      } catch (e) {
        // Regex inválido - retorna vazio
        return []
      }
    }
  }, [groupedRecords, searchTerm, detectedMode])

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

  // Calcular grupos paginados (após ordenação)
  const paginatedGroups = useMemo(() => {
    if (itemsPerPage === 0) return displayGroups
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return displayGroups.slice(startIndex, endIndex)
  }, [displayGroups, currentPage, itemsPerPage])

  // Calcular total de páginas
  const totalPages = useMemo(() => {
    if (itemsPerPage === 0) return 1
    return Math.ceil(displayGroups.length / itemsPerPage)
  }, [displayGroups.length, itemsPerPage])

  // Resetar para página 1 quando filtros mudarem ou dados recarregarem
  useEffect(() => {
    setCurrentPage(1)
  }, [groupedRecords.length, itemsPerPage, sortColumn, sortDirection])

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
    setGroupedRecords(prev => prev.map(group => ({
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
    })))

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
  }, [])

  // Handler para alternar "Sobrescrever Compartilhamento"
  const handleToggleOverwriteSharing = useCallback((groupKey: string) => {
    setOverwriteSharing(prev => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }))
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
        ownership_percentage: partner?.my_contribution_percentage || 50
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

  const handleSetAllMappings = useCallback((value: boolean) => {
    const updatedMappings: Record<string, boolean> = { ...createMappings }
    groupedRecords.forEach(group => {
      if (!savedGroups.has(group.groupKey)) {
        updatedMappings[group.groupKey] = value
      }
    })

    // Atualizar também o checkbox do grupo virtual se existir
    if (isRegrouped) {
      const virtualGroupKey = `virtual_${searchTerm}`
      updatedMappings[virtualGroupKey] = value
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
        mappingPayload.my_contribution_percentage = percentageToUse ?? null
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
        } = {
          subtag_id: group.subtag_id!
        }

        // S\u00f3 inclui compartilhamento no mapeamento se deve sobrescrever
        if (shouldIncludeSharing) {
          mappingPayload.expense_sharing_id = group.expense_sharing_id ?? null
          mappingPayload.my_contribution_percentage = group.ownership_percentage ?? null
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
          } = {
            original_description: g.description.toLowerCase().trim(),
            subtag_id: g.subtag_id!
          }
          // Só inclui compartilhamento se deve sobrescrever
          if (shouldIncludeSharing) {
            mapping.expense_sharing_id = g.expense_sharing_id ?? null
            mapping.my_contribution_percentage = g.ownership_percentage ?? null
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
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <LoadingSpinner fullScreen message="Carregando registros..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
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
      </div>
    )
  }

  // Conta grupos não salvos + grupos virtuais (despesa e/ou receita, se existirem e tiverem subtag selecionada)
  const unsavedCount = groupedRecords.filter(g => !savedGroups.has(g.groupKey)).length +
    (isRegrouped && virtualGroupSubtag ? 1 : 0) +
    (isRegrouped && virtualReceitaSubtag ? 1 : 0)

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />

      <div className="flex-1 overflow-auto" ref={scrollContainerRef}>
        <div className={`p-8 ${showBackToTop ? 'pb-20' : ''}`}>
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <Sparkles className="w-8 h-8" />
                Curadoria de Registros
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                Categorize registros não mapeados e crie mapeamentos automáticos
              </p>
            </div>
          </div>

          {groupedRecords.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg p-12 text-center border border-gray-200 dark:border-gray-700">
              <Check className="w-16 h-16 text-green-600 dark:text-green-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Tudo Categorizado!
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Não há registros pendentes de categorização.
              </p>
            </div>
          ) : (
            <>
              {/* Cards Globais de Receita e Despesa - Lado a Lado */}
              {(hasReceitas || hasDespesas) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                  {/* Seção Global de Receitas */}
                  {hasReceitas && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 hover:border-color-primary transition-colors">
                      <div className="flex items-center gap-2 mb-3">
                        <ArrowUpCircle className="text-green-600 dark:text-green-400" size={20} />
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">Receitas</span>
                      </div>
                      <div className="flex items-end gap-3">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            <TagIcon size={12} className="inline mr-1 text-color-primary" />
                            Tag
                          </label>
                          <select
                            value={globalReceitaTag ?? ''}
                            onChange={(e) => {
                              const value = e.target.value
                              setGlobalReceitaTag(value === '' ? null : Number(value))
                              setGlobalReceitaSubtag(null)
                            }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          >
                            <option value="">Selecione...</option>
                            {getFilteredTags('receita').map(tag => (
                              <option key={tag.id} value={tag.id}>{tag.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            <TagsIcon size={12} className="inline mr-1 text-color-primary" />
                            Subtag
                          </label>
                          <select
                            value={globalReceitaSubtag ?? ''}
                            onChange={(e) => {
                              const value = e.target.value
                              setGlobalReceitaSubtag(value === '' ? null : Number(value))
                            }}
                            disabled={!globalReceitaTag}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                          >
                            <option value="">Selecione...</option>
                            {getFilteredSubtags(globalReceitaTag, 'receita').map(subtag => (
                              <option key={subtag.id} value={subtag.id}>{subtag.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            <Users size={12} className="inline mr-1 text-color-primary" />
                            Compartilhamento
                          </label>
                          <select
                            value={globalReceitaSharing ?? ''}
                            onChange={(e) => {
                              const value = e.target.value
                              const sharingId = value ? Number(value) : null
                              setGlobalReceitaSharing(sharingId)
                              if (sharingId) {
                                const partner = partners.find(p => p.id === sharingId)
                                setGlobalReceitaPercentage(partner?.my_contribution_percentage?.toString() || '50')
                              } else {
                                setGlobalReceitaPercentage('')
                              }
                            }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          >
                            <option value="">Selecione...</option>
                            {partners.filter(p => p.active).map(partner => {
                              const account = partner.shared_account
                              const displayParts = [
                                account?.name,
                                account?.bank?.name,
                                account?.agency,
                                account?.account_number
                              ].filter(Boolean)
                              const displayText = displayParts.length > 0
                                ? displayParts.join(' - ')
                                : partner.description || `Conta ${partner.shared_account_id}`
                              return (
                                <option key={partner.id} value={partner.id}>
                                  {displayText}
                                </option>
                              )
                            })}
                          </select>
                        </div>
                        <button
                          onClick={applyGlobalReceitas}
                          disabled={!globalReceitaTag || !globalReceitaSubtag}
                          className="px-4 py-2 text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm whitespace-nowrap"
                          style={{ backgroundColor: 'var(--crud-create)' }}
                        >
                          Aplicar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Seção Global de Despesas */}
                  {hasDespesas && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 hover:border-color-primary transition-colors">
                      <div className="flex items-center gap-2 mb-3">
                        <ArrowDownCircle className="text-red-600 dark:text-red-400" size={20} />
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">Despesas</span>
                      </div>
                      <div className="flex items-end gap-3">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            <TagIcon size={12} className="inline mr-1 text-color-primary" />
                            Tag
                          </label>
                          <select
                            value={globalDespesaTag ?? ''}
                            onChange={(e) => {
                              const value = e.target.value
                              setGlobalDespesaTag(value === '' ? null : Number(value))
                              setGlobalDespesaSubtag(null)
                            }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          >
                            <option value="">Selecione...</option>
                            {getFilteredTags('despesa').map(tag => (
                              <option key={tag.id} value={tag.id}>{tag.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            <TagsIcon size={12} className="inline mr-1 text-color-primary" />
                            Subtag
                          </label>
                          <select
                            value={globalDespesaSubtag ?? ''}
                            onChange={(e) => {
                              const value = e.target.value
                              setGlobalDespesaSubtag(value === '' ? null : Number(value))
                            }}
                            disabled={!globalDespesaTag}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                          >
                            <option value="">Selecione...</option>
                            {getFilteredSubtags(globalDespesaTag, 'despesa').map(subtag => (
                              <option key={subtag.id} value={subtag.id}>{subtag.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            <Users size={12} className="inline mr-1 text-color-primary" />
                            Compartilhamento
                          </label>
                          <select
                            value={globalDespesaSharing ?? ''}
                            onChange={(e) => {
                              const value = e.target.value
                              const sharingId = value ? Number(value) : null
                              setGlobalDespesaSharing(sharingId)
                              if (sharingId) {
                                const partner = partners.find(p => p.id === sharingId)
                                setGlobalDespesaPercentage(partner?.my_contribution_percentage?.toString() || '50')
                              } else {
                                setGlobalDespesaPercentage('')
                              }
                            }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          >
                            <option value="">Selecione...</option>
                            {partners.filter(p => p.active).map(partner => {
                              const account = partner.shared_account
                              const displayParts = [
                                account?.name,
                                account?.bank?.name,
                                account?.agency,
                                account?.account_number
                              ].filter(Boolean)
                              const displayText = displayParts.length > 0
                                ? displayParts.join(' - ')
                                : partner.description || `Conta ${partner.shared_account_id}`
                              return (
                                <option key={partner.id} value={partner.id}>
                                  {displayText}
                                </option>
                              )
                            })}
                          </select>
                        </div>
                        <button
                          onClick={applyGlobalDespesas}
                          disabled={!globalDespesaTag || !globalDespesaSubtag}
                          className="px-4 py-2 text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm whitespace-nowrap"
                          style={{ backgroundColor: 'var(--crud-create)' }}
                        >
                          Aplicar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Barra de Busca + Controles - Sticky */}
              <div className="sticky top-0 z-30 bg-gray-50 dark:bg-gray-900 pb-4 -mx-8 px-8 pt-2 mb-4" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    type="text"
                    placeholder="Buscar por descrição... (suporta regex)"
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

                {/* Feedback de detecção de modo */}
                {searchTerm && (
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2 text-sm">
                      {detectedMode === 'pattern' ? (
                        <span className="text-blue-600 dark:text-blue-400 font-medium">
                          🔍 Modo: Padrão (contém texto)
                        </span>
                      ) : (
                        <>
                          <span className="text-purple-600 dark:text-purple-400 font-medium">
                            🔍 Modo: Regex
                          </span>
                          {regexError ? (
                            <span className="text-red-600 dark:text-red-400">
                              ❌ {regexError}
                            </span>
                          ) : (
                            <span className="text-green-600 dark:text-green-400">
                              ✅ Regex válido
                            </span>
                          )}
                        </>
                      )}
                      <span className="text-gray-500 dark:text-gray-400">
                        • {filteredGroups.length} grupo(s) encontrado(s)
                      </span>
                    </div>

                    {/* Botão Reagrupar / Desfazer */}
                    {filteredGroups.length > 0 && (
                      isRegrouped ? (
                        <button
                          onClick={handleUndoRegroup}
                          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
                        >
                          ❌ Desfazer Reagrupamento
                        </button>
                      ) : (
                        <button
                          onClick={handleRegroup}
                          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                        >
                          🔗 Reagrupar Todos
                        </button>
                      )
                    )}
                  </div>
                )}

                {/* Controles da Tabela - dentro do sticky */}
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 mt-4 border border-gray-200 dark:border-gray-700 hover:border-color-primary transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={globalCreateMapping}
                        onChange={(e) => handleSetAllMappings(e.target.checked)}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                      />
                      Marcar/Desmarcar Todos os Mapeamentos
                    </label>
                  </div>

                  {/* Botões de Ação - Lado Direito */}
                  <div className="flex items-center gap-3">
                    {/* Botão Limpar Seleções - Visível APENAS quando há mudanças pendentes */}
                    {hasAnyChanges && (
                      <button
                        onClick={handleClearAllSelections}
                        className="px-4 py-2 text-sm text-white rounded-lg hover:opacity-90 transition-opacity font-medium flex items-center gap-2"
                        style={{ backgroundColor: 'var(--crud-cancel)' }}
                      >
                        <X size={16} />
                        Limpar Seleções
                      </button>
                    )}

                    {/* Botão Salvar Todos */}
                    <button
                      onClick={handleSaveAll}
                      disabled={!hasAnyChanges || unsavedCount === 0 || isSavingAll}
                      className="px-4 py-2 text-sm text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-2"
                      style={{ backgroundColor: 'var(--crud-create)' }}
                    >
                      {isSavingAll ? (
                        <>
                          <Loader2 className="animate-spin" size={16} />
                          Salvando...
                        </>
                      ) : (
                        <>
                          <Save size={16} />
                          Salvar Todos ({unsavedCount})
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
              </div>

              {/* Tabela de Grupos - Header sticky */}
              {(
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <div style={{ overflowX: 'clip' }}>
                  <table className="w-full table-auto">
                    <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 sticky top-[175px] z-20 before:content-[''] before:absolute before:left-0 before:right-0 before:bottom-full before:h-[175px] before:bg-gray-50 before:dark:bg-gray-900" style={{ boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                      <tr>
                        {/* Coluna de Número - COMPACTA */}
                        <th className="px-1 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap w-10 bg-gray-50 dark:bg-gray-700">
                          #
                        </th>
                        {/* Coluna Qtd - COMPACTA */}
                        <th
                          className="px-2 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap w-14 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors bg-gray-50 dark:bg-gray-700"
                          onClick={() => handleSort('count')}
                        >
                          <div className="flex items-center justify-center gap-0.5">
                            <span>Qtd</span>
                            {sortColumn === 'count' ? (
                              sortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        {/* Coluna Tipo - COMPACTA */}
                        <th
                          className="px-1 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap w-12 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors bg-gray-50 dark:bg-gray-700"
                          onClick={() => handleSort('tipo')}
                        >
                          <div className="flex items-center justify-center gap-0.5">
                            <span>Tipo</span>
                            {sortColumn === 'tipo' ? (
                              sortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        {/* Fontes - FIXA (ao lado de Tipo, antes de Valor) */}
                        <th className="px-2 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap w-32 bg-gray-50 dark:bg-gray-700">
                          Fontes
                        </th>
                        {/* Coluna Valor - FIXA (comporta -R$ 111.058.744,71) */}
                        <th
                          className="px-2 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap w-40 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors bg-gray-50 dark:bg-gray-700"
                          onClick={() => handleSort('totalAmount')}
                        >
                          <div className="flex items-center justify-center gap-0.5">
                            <span>Valor</span>
                            {sortColumn === 'totalAmount' ? (
                              sortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        {/* Coluna Descrição - FLEXÍVEL */}
                        <th
                          className="px-2 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors bg-gray-50 dark:bg-gray-700"
                          onClick={() => handleSort('description')}
                        >
                          <div className="flex items-center gap-1">
                            <span>Descrição</span>
                            {sortColumn === 'description' ? (
                              sortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        {/* Tag - FLEXÍVEL proporcional (15% cada) */}
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider min-w-[180px] w-[15%] bg-gray-50 dark:bg-gray-700">
                          Tag
                        </th>
                        {/* Subtag - FLEXÍVEL proporcional (15% cada) */}
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider min-w-[180px] w-[15%] bg-gray-50 dark:bg-gray-700">
                          Subtag
                        </th>
                        {/* Compartilhamento - FLEXÍVEL proporcional (15% cada) */}
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider min-w-[180px] w-[15%] bg-gray-50 dark:bg-gray-700">
                          Compartilhamento
                        </th>
                        {/* % - COMPACTA */}
                        <th className="px-1 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap w-16 bg-gray-50 dark:bg-gray-700">
                          %
                        </th>
                        {/* Mapear - COMPACTA */}
                        <th className="px-1 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap w-14 bg-gray-50 dark:bg-gray-700">
                          Mapear
                        </th>
                        {/* Sobrescrever Compartilhamento - COMPACTA */}
                        <th className="px-1 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap w-14 bg-gray-50 dark:bg-gray-700" title="Sobrescrever Compartilhamento">
                          Sobr.
                        </th>
                        {/* Ações - COMPACTA */}
                        <th className="px-1 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap w-14 bg-gray-50 dark:bg-gray-700">
                          Ações
                        </th>
                        {/* Detalhes - COMPACTA */}
                        <th className="px-1 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap w-14 bg-gray-50 dark:bg-gray-700">
                          Detalhes
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {paginatedGroups.map((group, index) => {
                        const isVirtualGroup = group.groupKey.startsWith('virtual_')
                        const isSaved = savedGroups.has(group.groupKey)
                        const isCurrentlySaving = isSaving === group.groupKey
                        const existingMapping = isVirtualGroup ? null : getExistingMapping(group.description, group.tipo)

                        // ✅ FIX: Determinar qual subtag usar baseado no tipo do grupo virtual
                        const isVirtualReceita = isVirtualGroup && group.tipo === 'receita'
                        const canSave = isVirtualGroup
                          ? (isVirtualReceita ? virtualReceitaSubtag : virtualGroupSubtag)
                          : (group.tag_id && group.subtag_id)

                        const createMapping = createMappings[group.groupKey] ?? false
                        const needsApply = groupsNeedingApply.has(group.groupKey)

                        // LÓGICA CRÍTICA: Se createMapping está marcado, os dropdowns devem estar DESABILITADOS
                        // Dropdowns só ficam desabilitados se o grupo já foi salvo
                        const dropdownsDisabled = isSaved

                        const hasWarning = groupsWithWarning.has(group.groupKey)

                        // Calcular número da linha (considerando paginação)
                        const lineNumber = (currentPage - 1) * itemsPerPage + index + 1

                        return (
                          <tr
                            key={group.groupKey}
                            className={`border-l-4 border-b border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all ${
                              isSaved ? 'border-l-green-500 bg-green-50 dark:bg-green-900/20' : 'border-l-gray-300 dark:border-l-gray-600'
                            }`}
                            style={{
                              ['--hover-border-color' as any]: 'var(--color-1)',
                            }}
                            onMouseEnter={(e) => {
                              if (!isSaved) {
                                e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isSaved) {
                                e.currentTarget.style.borderLeftColor = ''
                              }
                            }}
                          >
                            {/* Número da Linha - COMPACTA */}
                            <td className="px-1 py-3 text-center whitespace-nowrap w-10">
                              <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{lineNumber}</span>
                            </td>

                            {/* Quantidade - COMPACTA */}
                            <td className="px-2 py-3 text-center whitespace-nowrap w-14">
                              <span className="text-xs font-medium text-gray-900 dark:text-white">{group.count}</span>
                            </td>

                            {/* Tipo - COMPACTA */}
                            <td className="px-1 py-3 text-center whitespace-nowrap w-12">
                              {group.tipo === 'receita' ? (
                                <ArrowUpCircle className="inline text-green-600 dark:text-green-400" size={16} />
                              ) : (
                                <ArrowDownCircle className="inline text-red-600 dark:text-red-400" size={16} />
                              )}
                            </td>

                            {/* Fontes (Badges) - FIXA (ao lado de Tipo, antes de Valor) */}
                            <td className="px-2 py-3 whitespace-nowrap w-32">
                              <div className="flex items-center justify-center gap-1">
                                {/* Contar quantos registros de cada fonte */}
                                {(() => {
                                  const sourceCounts = group.records.reduce((acc, r) => {
                                    acc[r.source] = (acc[r.source] || 0) + 1
                                    return acc
                                  }, {} as Record<string, number>)

                                  return (
                                    <>
                                      {sourceCounts['bank'] && (
                                        <div className="flex items-center gap-1" title={`${sourceCounts['bank']} extrato(s) bancário(s)`}>
                                          <Landmark size={16} style={{ color: 'var(--color-1)' }} />
                                          <span className="text-xs font-medium" style={{ color: 'var(--color-1)' }}>
                                            {sourceCounts['bank']}
                                          </span>
                                        </div>
                                      )}
                                      {sourceCounts['card'] && (
                                        <div className="flex items-center gap-1" title={`${sourceCounts['card']} fatura(s) de cartão`}>
                                          <CreditCard size={16} style={{ color: 'var(--color-2)' }} />
                                          <span className="text-xs font-medium" style={{ color: 'var(--color-2)' }}>
                                            {sourceCounts['card']}
                                          </span>
                                        </div>
                                      )}
                                      {sourceCounts['benefit'] && (
                                        <div className="flex items-center gap-1" title={`${sourceCounts['benefit']} benefício(s)`}>
                                          <Gift size={16} style={{ color: 'var(--color-3)' }} />
                                          <span className="text-xs font-medium" style={{ color: 'var(--color-3)' }}>
                                            {sourceCounts['benefit']}
                                          </span>
                                        </div>
                                      )}
                                    </>
                                  )
                                })()}
                              </div>
                            </td>

                            {/* Valor - FIXA (comporta -R$ 111.058.744,71) */}
                            <td className="px-2 py-3 text-center whitespace-nowrap w-40">
                              <span className="text-xs font-medium">
                                {formatCurrencyWithColor(group.totalAmount, false)}
                              </span>
                            </td>

                            {/* Descrição - FLEXÍVEL */}
                            <td className="px-2 py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-900 dark:text-white">{group.description}</span>
                                {existingMapping && (
                                  <span className="px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded whitespace-nowrap">
                                    Mapeado
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Tag Dropdown - FLEXÍVEL proporcional (15% cada) */}
                            <td className="px-2 py-3 min-w-[180px] w-[15%]">
                              {(() => {
                                // Determinar qual estado usar baseado no tipo do grupo virtual
                                const isVirtualReceita = isVirtualGroup && group.tipo === 'receita'
                                const currentTag = isVirtualGroup
                                  ? (isVirtualReceita ? virtualReceitaTag : virtualGroupTag)
                                  : group.tag_id

                                return (
                                  <select
                                    value={currentTag || ''}
                                    onChange={(e) => {
                                      const value = e.target.value
                                      if (isVirtualGroup) {
                                        if (isVirtualReceita) {
                                          setVirtualReceitaTag(value ? Number(value) : null)
                                          setVirtualReceitaSubtag(null)
                                        } else {
                                          setVirtualGroupTag(value ? Number(value) : null)
                                          setVirtualGroupSubtag(null)
                                        }
                                        // Marcar que houve mudanças
                                        setHasAnyChanges(true)
                                      } else {
                                        if (value) {
                                          handleGroupTagChange(group.groupKey, Number(value))
                                        } else {
                                          handleGroupTagChange(group.groupKey, null)
                                        }
                                      }
                                    }}
                                    disabled={!isVirtualGroup && dropdownsDisabled}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                                  >
                                    <option value="">Selecione...</option>
                                    {getFilteredTags(group.tipo).map(tag => (
                                      <option key={tag.id} value={tag.id}>{tag.name}</option>
                                    ))}
                                  </select>
                                )
                              })()}
                            </td>

                            {/* Subtag Dropdown - FLEXÍVEL proporcional (15% cada) */}
                            <td className="px-2 py-3 min-w-[180px] w-[15%]">
                              {(() => {
                                // Determinar qual estado usar baseado no tipo do grupo virtual
                                const isVirtualReceita = isVirtualGroup && group.tipo === 'receita'
                                const currentTag = isVirtualGroup
                                  ? (isVirtualReceita ? virtualReceitaTag : virtualGroupTag)
                                  : group.tag_id
                                const currentSubtag = isVirtualGroup
                                  ? (isVirtualReceita ? virtualReceitaSubtag : virtualGroupSubtag)
                                  : group.subtag_id

                                return (
                                  <select
                                    value={currentSubtag || ''}
                                    onChange={(e) => {
                                      const value = e.target.value
                                      if (isVirtualGroup) {
                                        if (isVirtualReceita) {
                                          setVirtualReceitaSubtag(value ? Number(value) : null)
                                        } else {
                                          setVirtualGroupSubtag(value ? Number(value) : null)
                                        }
                                        // Marcar que houve mudanças
                                        setHasAnyChanges(true)
                                        // Marcar grupo virtual como precisando aplicar
                                        setGroupsNeedingApply(prev => {
                                          const newSet = new Set(prev)
                                          newSet.add(group.groupKey)
                                          return newSet
                                        })
                                        setGroupsWithWarning(prev => {
                                          const newSet = new Set(prev)
                                          newSet.add(group.groupKey)
                                          return newSet
                                        })
                                      } else {
                                        handleGroupSubtagChange(group.groupKey, Number(value) || null)
                                      }
                                    }}
                                    disabled={isVirtualGroup ? !currentTag : (!group.tag_id || dropdownsDisabled)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                                  >
                                    <option value="">Selecione...</option>
                                    {isVirtualGroup
                                      ? (currentTag && getFilteredSubtags(currentTag, group.tipo).map(subtag => (
                                          <option key={subtag.id} value={subtag.id}>{subtag.name}</option>
                                        )))
                                      : getFilteredSubtags(group.tag_id, group.tipo).map(subtag => (
                                          <option key={subtag.id} value={subtag.id}>{subtag.name}</option>
                                        ))
                                    }
                                  </select>
                                )
                              })()}
                            </td>

                            {/* Compartilhamento Dropdown - FLEXÍVEL proporcional (15% cada) */}
                            <td className="px-2 py-3 min-w-[180px] w-[15%]">
                              {(() => {
                                const currentSharing = isVirtualGroup
                                  ? (isVirtualReceita ? virtualReceitaSharing : virtualGroupSharing)
                                  : group.expense_sharing_id

                                return (
                                  <select
                                    value={currentSharing || ''}
                                    onChange={(e) => {
                                      const value = e.target.value
                                      const sharingId = value ? Number(value) : null
                                      if (isVirtualGroup) {
                                        if (isVirtualReceita) {
                                          setVirtualReceitaSharing(sharingId)
                                          // Definir porcentagem padrão do parceiro
                                          if (sharingId) {
                                            const partner = partners.find(p => p.id === sharingId)
                                            setVirtualReceitaPercentage(partner?.my_contribution_percentage?.toString() || '50')
                                          } else {
                                            setVirtualReceitaPercentage('')
                                          }
                                        } else {
                                          setVirtualGroupSharing(sharingId)
                                          if (sharingId) {
                                            const partner = partners.find(p => p.id === sharingId)
                                            setVirtualGroupPercentage(partner?.my_contribution_percentage?.toString() || '50')
                                          } else {
                                            setVirtualGroupPercentage('')
                                          }
                                        }
                                        // Se preencheu compartilhamento, marca automaticamente "Sobrescrever Compartilhamento"
                                        if (sharingId !== null) {
                                          setOverwriteSharing(prev => ({ ...prev, [group.groupKey]: true }))
                                        }
                                        setHasAnyChanges(true)
                                        setGroupsNeedingApply(prev => new Set(prev).add(group.groupKey))
                                        setGroupsWithWarning(prev => new Set(prev).add(group.groupKey))
                                      } else {
                                        handleGroupSharingChange(group.groupKey, sharingId)
                                      }
                                    }}
                                    disabled={dropdownsDisabled}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                                  >
                                    <option value="">Selecione...</option>
                                    {partners.filter(p => p.active).map(partner => {
                                      const account = partner.shared_account
                                      const displayParts = [
                                        account?.name,
                                        account?.bank?.name,
                                        account?.agency,
                                        account?.account_number
                                      ].filter(Boolean)
                                      const displayText = displayParts.length > 0
                                        ? displayParts.join(' - ')
                                        : partner.description || `Conta ${partner.shared_account_id}`

                                      return (
                                        <option key={partner.id} value={partner.id}>
                                          {displayText}
                                        </option>
                                      )
                                    })}
                                  </select>
                                )
                              })()}
                            </td>

                            {/* Porcentagem Input - COMPACTA */}
                            <td className="px-1 py-3 text-center whitespace-nowrap w-16">
                              {(() => {
                                const currentSharing = isVirtualGroup
                                  ? (isVirtualReceita ? virtualReceitaSharing : virtualGroupSharing)
                                  : group.expense_sharing_id
                                const currentPercentage = isVirtualGroup
                                  ? (isVirtualReceita ? virtualReceitaPercentage : virtualGroupPercentage)
                                  : (group.ownership_percentage?.toString() || '')

                                return (
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={currentPercentage}
                                    onChange={(e) => {
                                      const value = e.target.value
                                      if (isVirtualGroup) {
                                        if (isVirtualReceita) {
                                          setVirtualReceitaPercentage(value)
                                        } else {
                                          setVirtualGroupPercentage(value)
                                        }
                                        setHasAnyChanges(true)
                                        setGroupsNeedingApply(prev => new Set(prev).add(group.groupKey))
                                        setGroupsWithWarning(prev => new Set(prev).add(group.groupKey))
                                      } else {
                                        handleGroupPercentageChange(group.groupKey, value)
                                      }
                                    }}
                                    disabled={!currentSharing || dropdownsDisabled}
                                    placeholder="50"
                                    className="w-full px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-center bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                                  />
                                )
                              })()}
                            </td>

                            {/* Mapear Checkbox - COMPACTA */}
                            <td className="px-1 py-3 text-center whitespace-nowrap w-14">
                              <input
                                type="checkbox"
                                checked={isVirtualGroup ? (createMappings[group.groupKey] ?? globalCreateMapping) : createMapping}
                                onChange={() => handleToggleMapping(group.groupKey)}
                                disabled={isSaved}
                                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 disabled:cursor-not-allowed"
                              />
                            </td>

                            {/* Sobrescrever Compartilhamento Checkbox - COMPACTA */}
                            <td className="px-1 py-3 text-center whitespace-nowrap w-14">
                              {(() => {
                                const currentSharing = isVirtualGroup
                                  ? (isVirtualReceita ? virtualReceitaSharing : virtualGroupSharing)
                                  : group.expense_sharing_id
                                const isOverwriteEnabled = overwriteSharing[group.groupKey] ?? false
                                // Checkbox desabilitado se compartilhamento está preenchido (sempre true) ou se grupo já foi salvo
                                const isDisabled = currentSharing !== null || isSaved

                                return (
                                  <input
                                    type="checkbox"
                                    checked={isOverwriteEnabled || currentSharing !== null}
                                    onChange={() => handleToggleOverwriteSharing(group.groupKey)}
                                    disabled={isDisabled}
                                    title={currentSharing !== null
                                      ? "Sobrescrever ativado automaticamente (compartilhamento preenchido)"
                                      : isOverwriteEnabled
                                        ? "Clique para NÃO sobrescrever compartilhamento existente"
                                        : "Clique para sobrescrever/limpar compartilhamento existente"
                                    }
                                    className="w-4 h-4 text-orange-600 bg-gray-100 border-gray-300 rounded focus:ring-orange-500 disabled:cursor-not-allowed"
                                  />
                                )
                              })()}
                            </td>

                            {/* Ações - COMPACTA */}
                            <td className="px-1 py-3 whitespace-nowrap w-14">
                              <div className="flex items-center justify-center gap-0.5">
                                {isVirtualGroup ? (
                                  <>
                                    {/* Botão Aplicar para Grupo Virtual com Badge de Alerta */}
                                    <div className="relative group">
                                      <button
                                        onClick={() => handleApplyGroupToRecords(group.groupKey)}
                                        disabled={!needsApply || isSaved}
                                        className={`p-1.5 rounded-lg transition-colors ${
                                          hasWarning
                                            ? 'text-amber-500 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                            : 'text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                                        } disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed`}
                                        title="Aplicar tag/subtag a todos os registros"
                                      >
                                        <Copy size={18} />
                                      </button>

                                      {/* Badge de Alerta no Canto Superior Direito */}
                                      {hasWarning && (
                                        <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                          <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                                        </span>
                                      )}

                                      {/* Tooltip - posicionado acima para evitar scroll horizontal */}
                                      {hasWarning && (
                                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block z-[9999] whitespace-nowrap">
                                          <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg py-2 px-3 shadow-lg">
                                            <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                                              <div className="border-4 border-transparent border-t-gray-900 dark:border-t-gray-700"></div>
                                            </div>
                                            Tags alteradas! Clique para atualizar.
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Botão Salvar Mapeamento */}
                                    <button
                                      onClick={() => handleSaveSpecificVirtualGroup(group.groupKey)}
                                      disabled={!canSave || isCurrentlySaving}
                                      className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
                                      title={`Salvar mapeamento ${detectedMode === 'pattern' ? 'padrão' : 'regex'}`}
                                    >
                                      {isCurrentlySaving ? (
                                        <Loader2 className="animate-spin" size={18} />
                                      ) : (
                                        <Save size={18} />
                                      )}
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {/* Botão Aplicar com Badge de Alerta */}
                                    <div className="relative group">
                                      <button
                                        onClick={() => handleApplyGroupToRecords(group.groupKey)}
                                        disabled={!needsApply || isSaved}
                                        className={`p-1.5 rounded-lg transition-colors ${
                                          hasWarning
                                            ? 'text-amber-500 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                            : 'text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                                        } disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed`}
                                        title="Aplicar ao grupo"
                                      >
                                        <Copy size={18} />
                                      </button>

                                      {/* Badge de Alerta no Canto Superior Direito */}
                                      {hasWarning && (
                                        <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                          <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                                        </span>
                                      )}

                                      {/* Tooltip - posicionado acima, alinhado à direita para evitar scroll */}
                                      {hasWarning && (
                                        <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block z-[9999] whitespace-nowrap pointer-events-none">
                                          <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg py-2 px-3 shadow-lg">
                                            Clique para aplicar alterações
                                            <div className="absolute top-full right-2">
                                              <div className="border-4 border-transparent border-t-gray-900 dark:border-t-gray-700"></div>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Botão Salvar */}
                                    <button
                                      onClick={() => handleSaveGroup(group.groupKey)}
                                      disabled={!canSave || isSaved || isCurrentlySaving}
                                      className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
                                      title="Salvar grupo"
                                    >
                                      {isCurrentlySaving ? (
                                        <Loader2 className="animate-spin" size={18} />
                                      ) : isSaved ? (
                                        <Check size={18} className="text-green-600 dark:text-green-400" />
                                      ) : (
                                        <Save size={18} />
                                      )}
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>

                            {/* Detalhes - COMPACTA */}
                            <td className="px-1 py-3 text-center whitespace-nowrap w-14">
                              <button
                                onClick={() => setDetailsModalGroup(group)}
                                className="p-1.5 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                title="Ver detalhes"
                              >
                                <FileText size={18} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>

                    {/* Rodapé com Totais e Paginação */}
                    <tfoot className="bg-gray-50 dark:bg-gray-700 border-t-2 border-gray-300 dark:border-gray-600">
                      <tr>
                        <td colSpan={14} className="px-6 py-4">
                          {/* Layout: Esquerda | Centro | Direita */}
                          <div className="grid grid-cols-3 items-center gap-4">
                            {/* ESQUERDA: Seletor de itens por página */}
                            <div className="flex items-center gap-2 text-sm justify-start">
                              <label className="text-gray-600 dark:text-gray-400">Grupos por página:</label>
                              <select
                                value={itemsPerPage}
                                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              >
                                <option value={50}>50</option>
                                <option value={100}>100</option>
                                <option value={200}>200</option>
                                <option value={500}>500</option>
                                <option value={0}>Todos</option>
                              </select>
                            </div>

                            {/* CENTRO: Informações de totais */}
                            <div className="flex items-center justify-center gap-3 text-sm text-gray-600 dark:text-gray-400">
                              <div>
                                Mostrando <span className="font-semibold text-gray-900 dark:text-white">{paginatedGroups.length}</span> de <span className="font-semibold text-gray-900 dark:text-white">{groupedRecords.length}</span> {groupedRecords.length === 1 ? 'grupo' : 'grupos'}
                              </div>
                              <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>
                              <div>
                                <span className="font-semibold text-orange-600 dark:text-orange-400">{unsavedCount}</span> {unsavedCount === 1 ? 'pendente' : 'pendentes'} de categorização
                              </div>
                            </div>

                            {/* DIREITA: Navegação de páginas */}
                            <div className="flex items-center justify-end">
                              {itemsPerPage > 0 && totalPages > 1 && (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={currentPage === 1}
                                    className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  >
                                    Anterior
                                  </button>
                                  <span className="text-sm text-gray-600 dark:text-gray-400">
                                    Página <span className="font-semibold text-gray-900 dark:text-white">{currentPage}</span> de <span className="font-semibold text-gray-900 dark:text-white">{totalPages}</span>
                                  </span>
                                  <button
                                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                    disabled={currentPage === totalPages}
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
            </>
          )}
        </div>
      </div>

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
          onApply={() => {
            showSuccess('Tags/subtags/compartilhamento sincronizados. Clique em "Salvar" para persistir no banco.')
          }}
        />
      )}

      {/* Modal de Confirmação de Reordenação */}
      {showReorderConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <AlertTriangle className="text-orange-600 dark:text-orange-400 flex-shrink-0" size={24} />
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Seleções Pendentes
                </h2>
              </div>
              <button
                onClick={handleCancelReorder}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title="Fechar (ESC)"
              >
                <X size={24} />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                Você tem seleções de tags/subtags pendentes que não foram salvas.
              </p>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                Ao reordenar a tabela, os registros com seleções pendentes podem ficar espalhados por diferentes páginas.
              </p>
              <p className="text-gray-700 dark:text-gray-300 font-medium">
                O que você deseja fazer?
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleSaveAndReorder}
                className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2"
              >
                <Save size={18} />
                Salvar e Reordenar
              </button>
              <button
                onClick={handleClearAndReorder}
                className="w-full px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium flex items-center justify-center gap-2"
              >
                <X size={18} />
                Limpar e Reordenar
              </button>
              <button
                onClick={handleCancelReorder}
                className="w-full px-4 py-3 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white rounded-lg hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors font-medium"
              >
                Cancelar
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