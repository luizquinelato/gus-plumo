import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { Plus, Edit2, Trash2, Tag, Tags, Search, AlertCircle, Eye, EyeOff, X, ArrowUpCircle, ArrowDownCircle, Map, ArrowUpDown, Users, Zap, CheckSquare, Square, MinusSquare, ArrowUp, Filter } from 'lucide-react'
import { useConfirm } from '../../hooks/useConfirm'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import Toast from '../../components/Toast'
import SharedAccountDisplay from '../../components/SharedAccountDisplay'
import { getIconComponent } from '../../utils/iconMapper'
import { formatAccountDisplay } from '../../utils/accountFormatter'

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
const getPartnerLabel = (partner: ExpenseSharing): string => {
  const parts: string[] = []

  // Nome da conta compartilhada
  const accountName = partner.shared_account?.name || partner.shared_account?.description
  if (accountName) {
    parts.push(accountName)
  }

  // Banco
  if (partner.shared_account?.bank?.name) {
    parts.push(partner.shared_account.bank.name)
  }

  // Agência
  if (partner.shared_account?.agency) {
    parts.push(`Ag: ${partner.shared_account.agency}`)
  }

  // Número da conta
  if (partner.shared_account?.account_number) {
    parts.push(`Conta: ${partner.shared_account.account_number}`)
  }

  return parts.length > 0 ? parts.join(' • ') : 'Sem informações'
}

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
  mapping_type: string  // 'exact', 'pattern', 'regex'
  pattern: string | null
  regex_pattern: string | null
  priority: number
  is_sensitive: boolean
  active: boolean
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
  const [selectedTagFilter, setSelectedTagFilter] = useState<number | null>(null)
  const [selectedSubtagFilter, setSelectedSubtagFilter] = useState<number | null>(null)  // ID da subtag
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('')  // '' | 'receita' | 'despesa'
  const [selectedMatchFilter, setSelectedMatchFilter] = useState<string>('')  // '' | 'exact' | 'pattern' | 'regex'
  const [selectedSharedFilter, setSelectedSharedFilter] = useState<number | null>(null)  // ID da conta compartilhada
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedMappings, setSelectedMappings] = useState<Set<number>>(new Set())  // IDs dos mapeamentos selecionados
  const [isDeletingSelected, setIsDeletingSelected] = useState(false)
  const [modalTypeFilter, setModalTypeFilter] = useState<'receita' | 'despesa'>('despesa')  // Filtro de tipo no modal
  const [applyToExistingRecords, setApplyToExistingRecords] = useState(true)  // Switch para aplicar a registros existentes (padrão: true)
  const [revealedOriginal, setRevealedOriginal] = useState<string | null>(null)  // Original descriptografada
  const [revealedMapped, setRevealedMapped] = useState<string | null>(null)  // Mapped descriptografada
  const [isRevealing, setIsRevealing] = useState(false)  // Estado de carregamento ao revelar
  const [showPasswordModal, setShowPasswordModal] = useState(false)  // Modal de confirmação de senha
  const [password, setPassword] = useState('')  // Senha digitada
  const [isValidatingPassword, setIsValidatingPassword] = useState(false)  // Estado de validação de senha
  const [canEditSensitive, setCanEditSensitive] = useState(false)  // Permite editar após validar senha
  const [passwordModalAction, setPasswordModalAction] = useState<'reveal' | 'save' | 'unsensitive'>('reveal')  // Ação do modal de senha
  const [revealedTableRows, setRevealedTableRows] = useState<Record<number, { original: string, mapped: string }>>({})  // Valores revelados na tabela
  const [originalFormData, setOriginalFormData] = useState<typeof formData | null>(null)  // Dados originais para comparação
  const [regexError, setRegexError] = useState<string | null>(null)  // Erro de validação do regex

  // Estados para rodapé flutuante
  const [showBackToTop, setShowBackToTop] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  // Estados de paginação
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(100)

  // Estados para batch remap (executar todos)
  const [showBatchRemapModal, setShowBatchRemapModal] = useState(false)
  const [isBatchRemapping, setIsBatchRemapping] = useState(false)
  const [batchRemapOptions, setBatchRemapOptions] = useState({
    overwrite_sharing: false  // Por padrão, NÃO sobrescrever compartilhamento existente (false = ignorar, true = sobrescrever)
  })

  // Estados para batch edit (editar todas)
  const [showBatchEditModal, setShowBatchEditModal] = useState(false)
  const [isBatchEditing, setIsBatchEditing] = useState(false)
  const [batchEditData, setBatchEditData] = useState({
    tag_id: 0,
    subtag_id: 0,
    shared_partner_id: 0,
    my_contribution_percentage: 50 as number | null,
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
    mapping_type: 'exact' as 'exact' | 'pattern' | 'regex',
    pattern: '',
    regex_pattern: '',
    priority: 0,
    is_sensitive: false
  })

  // Função para fechar o modal
  const closeModal = () => {
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
        setShowPasswordModal(false)
        setPassword('')
        setRevealingTableRowId(null)
        revealingTableRowIdRef.current = null
        // Reverter checkbox apenas se estava desmarcando sensível
        if (passwordModalAction === 'unsensitive') {
          setFormData(prev => ({ ...prev, is_sensitive: true }))
        }
      }
    }

    // Usar capture phase para interceptar antes de outros handlers
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [showPasswordModal, passwordModalAction])

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

  useEffect(() => {
    loadData()
  }, [])

  // Limpar seleções e resetar página quando os filtros mudam
  useEffect(() => {
    setSelectedMappings(new Set())
    setCurrentPage(1)
  }, [selectedTagFilter, selectedSubtagFilter, selectedTypeFilter, selectedMatchFilter, selectedSharedFilter, searchTerm])

  // Validar regex quando o valor mudar
  useEffect(() => {
    if (formData.mapping_type !== 'regex' || !formData.regex_pattern.trim()) {
      setRegexError(null)
      return
    }

    try {
      new RegExp(formData.regex_pattern, 'i')
      setRegexError(null)
    } catch (e: any) {
      setRegexError(e.message)
    }
  }, [formData.regex_pattern, formData.mapping_type])

  // Scroll listener para Back to Top
  useEffect(() => {
    // O MappingsPage usa <main className="flex-1 overflow-y-auto p-8">
    // Precisamos encontrar esse container
    const findScrollContainer = (): HTMLElement | null => {
      // MappingsPage usa overflow-y-auto (não overflow-auto)
      const mainYContainer = document.querySelector('main.overflow-y-auto') as HTMLElement
      if (mainYContainer) return mainYContainer

      // Fallback: main com overflow-auto
      const mainContainer = document.querySelector('main.overflow-auto') as HTMLElement
      if (mainContainer) return mainContainer

      // Fallback: qualquer div com overflow-auto
      const anyContainer = document.querySelector('.overflow-auto, .overflow-y-auto') as HTMLElement
      if (anyContainer) return anyContainer

      return null
    }

    let scrollHandler: (() => void) | null = null

    // Timeout para garantir que o DOM está pronto
    const timeoutId = setTimeout(() => {
      const container = findScrollContainer()
      if (!container) {
        console.log('Container de scroll não encontrado')
        return
      }

      scrollContainerRef.current = container as HTMLDivElement

      scrollHandler = () => {
        const scrolled = container.scrollTop > 300
        setShowBackToTop(scrolled)
      }

      // Verifica scroll inicial
      scrollHandler()

      container.addEventListener('scroll', scrollHandler)
    }, 100)

    return () => {
      clearTimeout(timeoutId)
      // Cleanup do event listener
      if (scrollContainerRef.current && scrollHandler) {
        scrollContainerRef.current.removeEventListener('scroll', scrollHandler)
      }
    }
  }, [mappings])

  // Função para voltar ao topo
  const scrollToTop = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const loadData = async () => {
    try {
      setIsLoading(true)
      const [tagsRes, subtagsRes, partnersRes, mappingsRes] = await Promise.all([
        axios.get('/api/expenses/tags'),
        axios.get('/api/expenses/subtags'),
        axios.get('/api/expense-sharing/'),
        axios.get('/api/expenses/mappings')
      ])
      setTags(tagsRes.data)
      setSubtags(subtagsRes.data)
      setPartners(partnersRes.data)
      setMappings(mappingsRes.data)
    } catch (error) {
      console.error('Erro ao carregar dados:', error)
    } finally {
      setIsLoading(false)
    }
  }

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
      loadData()
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
      mapping_type: mappingType,
      pattern: mapping.pattern || '',
      regex_pattern: mapping.regex_pattern || '',
      priority: normalizedPriority,
      is_sensitive: mapping.is_sensitive || false
    }

    setFormData(initialData)
    setOriginalFormData(initialData)  // Salvar dados originais para comparação
    setApplyToExistingRecords(true)  // Default: aplicar a todos os registros
    setRevealedOriginal(null)  // Reset revealed original
    setRevealedMapped(null)  // Reset revealed mapped
    setIsRevealing(false)  // Reset revealing state
    setCanEditSensitive(false)  // Reset edit permission
    // Definir o tipo do modal baseado na subtag
    setModalTypeFilter(mapping.subtag_type as 'receita' | 'despesa' || 'despesa')
    setShowEditModal(true)
  }

  const handleRevealOriginalDescription = async () => {
    if (!editingMapping) return

    if (revealedOriginal) {
      // Hide the value
      setRevealedOriginal(null)
      return
    }

    // Exigir senha para revelar
    setPasswordModalAction('reveal')
    setShowPasswordModal(true)
  }

  const handleRevealMappedDescription = async () => {
    if (!editingMapping) return

    if (revealedOriginal || revealedMapped) {
      // Hide the values
      setRevealedOriginal(null)
      setRevealedMapped(null)
      return
    }

    // Exigir senha para revelar
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
                mapped: response.data.revealed_mapped
              }
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
            setRevealedOriginal(response.data.revealed_original)
            setRevealedMapped(response.data.revealed_mapped)
            // Não mostrar toast - apenas revelar
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
          setRevealedOriginal(response.data.revealed_original)
          setRevealedMapped(response.data.revealed_mapped)

          // Atualizar formData com valores descriptografados
          setFormData(prev => ({
            ...prev,
            original_description: response.data.revealed_original || '',
            mapped_description: response.data.revealed_mapped || '',
            is_sensitive: false
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

  // Revelar valores na tabela (exige senha)
  const [revealingTableRowId, setRevealingTableRowId] = useState<number | null>(null)
  // Ref para manter o ID atual - evita problemas de closure no handlePasswordValidation
  const revealingTableRowIdRef = useRef<number | null>(null)

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
    if (editingMapping.is_sensitive && formData.is_sensitive && !skipPasswordCheck) {
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
        mapping_type: formData.mapping_type,
        pattern: formData.mapping_type === 'pattern' ? formData.pattern.trim() || null : null,
        regex_pattern: formData.mapping_type === 'regex' ? formData.regex_pattern.trim() || null : null,
        priority: formData.priority,
        is_sensitive: formData.is_sensitive,
        apply_to_existing: applyToExistingRecords  // Enviar flag para backend
      }

      await axios.put(`/api/expenses/mappings/${editingMapping.id}`, payload)

      if (applyToExistingRecords) {
        showToast('Mapeamento atualizado e aplicado a todos os registros existentes com esta descrição!', 'success')
      } else {
        showToast('Mapeamento atualizado com sucesso!', 'success')
      }

      closeModal()
      loadData()
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
          loadData()
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
          loadData()
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

  // Executa o remapeamento com opções
  const handleRemap = async () => {
    if (!remapMapping) return

    setRemappingId(remapMapping.id)
    setShowRemapModal(false)

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
      setRemapMapping(null)
    }
  }

  // Executa o remapeamento em lote (todos os selecionados)
  const handleBatchRemap = async () => {
    if (selectedMappings.size === 0) return

    setIsBatchRemapping(true)

    let totalUpdated = 0
    let totalBankStatements = 0
    let totalCreditCardInvoices = 0
    let totalBenefitStatements = 0
    let errors = 0

    try {
      const mappingsToRemap = filteredMappings.filter(m => selectedMappings.has(m.id))

      for (const mapping of mappingsToRemap) {
        try {
          // overwrite_sharing: true = sobrescrever (skip_sharing_if_null: false)
          // overwrite_sharing: false = ignorar (skip_sharing_if_null: true)
          const skipSharingIfNull = mapping.shared_partner_id === null ? !batchRemapOptions.overwrite_sharing : false
          const response = await axios.post(`/api/expenses/mappings/${mapping.id}/remap`, {
            skip_subtag_if_null: false,  // Subtag sempre aplica
            skip_sharing_if_null: skipSharingIfNull
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

      // Fecha o modal após terminar
      setShowBatchRemapModal(false)

      // Exibe o toast após fechar o modal
      if (totalUpdated === 0 && errors === 0) {
        showToast('Nenhum registro encontrado para os mapeamentos selecionados', 'warning')
      } else if (errors > 0) {
        showToast(
          `${totalUpdated} registro(s) atualizado(s), ${errors} erro(s). ` +
          `${totalBankStatements} extratos, ${totalCreditCardInvoices} faturas, ${totalBenefitStatements} benefícios.`,
          'warning'
        )
      } else {
        showToast(
          `${totalUpdated} registro(s) atualizado(s): ` +
          `${totalBankStatements} extratos, ` +
          `${totalCreditCardInvoices} faturas, ` +
          `${totalBenefitStatements} benefícios.`,
          'success'
        )
      }
    } catch (error) {
      console.error('Erro ao executar batch remap:', error)
      showToast('Erro ao executar mapeamentos em lote', 'error')
    } finally {
      setIsBatchRemapping(false)
      setSelectedMappings(new Set())
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

      loadData()
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

  const filteredMappings = mappings
    .filter(m => {
      // Filtro por tag
      if (selectedTagFilter) {
        const subtag = subtags.find(s => s.id === m.subtag_id)
        if (subtag?.tag_id !== selectedTagFilter) return false
      }

      // Filtro por subtag
      if (selectedSubtagFilter) {
        if (m.subtag_id !== selectedSubtagFilter) return false
      }

      // Filtro por tipo (receita/despesa)
      if (selectedTypeFilter) {
        if (m.subtag_type !== selectedTypeFilter) return false
      }

      // Filtro por match (exact/pattern/regex)
      if (selectedMatchFilter) {
        if (m.mapping_type !== selectedMatchFilter) return false
      }

      // Filtro por compartilhamento (por conta específica)
      if (selectedSharedFilter) {
        if (m.shared_partner_id !== selectedSharedFilter) return false
      }

      // Filtro por busca (busca em todos os campos relevantes)
      if (searchTerm) {
        const search = searchTerm.toLowerCase()
        return (
          m.original_description?.toLowerCase().includes(search) ||
          m.mapped_description?.toLowerCase().includes(search) ||
          m.tag_name?.toLowerCase().includes(search) ||
          m.subtag_name?.toLowerCase().includes(search) ||
          m.pattern?.toLowerCase().includes(search) ||
          m.regex_pattern?.toLowerCase().includes(search)
        )
      }

      return true
    })

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <>
      {/* Header (não sticky - rola para fora) */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-3">
            <Map className="w-8 h-8" />
            Mapeamento de Transações
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Configure como suas transações são categorizadas automaticamente
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              setModalTypeFilter('despesa')
              setShowAddModal(true)
            }}
            className="px-4 py-2 rounded-md hover:opacity-90 flex items-center gap-2 text-white"
            style={{ backgroundColor: 'var(--crud-create)' }}
          >
            <Plus size={20} />
            Novo Mapeamento
          </button>
        </div>
      </div>

      {/* ===== ÁREA STICKY: Filtros + Busca ===== */}
      <div className="sticky top-0 z-30 bg-gray-50 dark:bg-gray-900 -mx-8 px-8 pt-2 pb-4" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        {/* Filtros */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-4 border border-gray-200 dark:border-gray-700 hover:border-color-primary hover:shadow-md transition-all">
        {/* Header: Título Filtros */}
        <div className="flex items-center gap-2 mb-3">
          <Filter size={18} className="text-color-primary" />
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-200">Filtros</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Filtro por Match */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              <ArrowUpDown size={14} className="inline mr-1 text-color-primary" />
              Match
            </label>
            <select
              value={selectedMatchFilter}
              onChange={(e) => setSelectedMatchFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none"
            >
              <option value="">Selecione...</option>
              <option value="exact">Exato</option>
              <option value="pattern">Padrão</option>
              <option value="regex">Regex</option>
            </select>
          </div>

          {/* Filtro por Tipo */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              <ArrowUpCircle size={14} className="inline mr-1 text-color-primary" />
              Tipo
            </label>
            <select
              value={selectedTypeFilter}
              onChange={(e) => setSelectedTypeFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none"
            >
              <option value="">Selecione...</option>
              <option value="receita">Receita</option>
              <option value="despesa">Despesa</option>
            </select>
          </div>

          {/* Filtro por Tag */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              <Tag size={14} className="inline mr-1 text-color-primary" />
              Tag
            </label>
            <select
              value={selectedTagFilter || ''}
              onChange={(e) => {
                setSelectedTagFilter(e.target.value ? Number(e.target.value) : null)
                setSelectedSubtagFilter(null)  // Limpar subtag ao mudar tag
              }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none"
            >
              <option value="">Selecione...</option>
              {tags.map(tag => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>

          {/* Filtro por Subtag */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              <Tags size={14} className="inline mr-1 text-color-primary" />
              Subtag
            </label>
            <select
              value={selectedSubtagFilter || ''}
              onChange={(e) => setSelectedSubtagFilter(e.target.value ? Number(e.target.value) : null)}
              disabled={!selectedTagFilter}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed"
            >
              <option value="">Selecione...</option>
              {subtags
                .filter(s => s.tag_id === selectedTagFilter)
                .map(subtag => (
                  <option key={subtag.id} value={subtag.id}>
                    {subtag.type === 'receita' ? '↑ ' : '↓ '}{subtag.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Filtro por Compartilhamento */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              <Users size={14} className="inline mr-1 text-color-primary" />
              Compartilhamento
            </label>
            <select
              value={selectedSharedFilter || ''}
              onChange={(e) => setSelectedSharedFilter(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none"
            >
              <option value="">Selecione...</option>
              {[...partners].sort((a, b) => getPartnerLabel(a).localeCompare(getPartnerLabel(b))).map(partner => (
                <option key={partner.id} value={partner.id}>
                  {getPartnerLabel(partner)}
                </option>
              ))}
            </select>
          </div>
          </div>
        </div>

        {/* Barra de Busca - dentro da área sticky */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Buscar por descrição, padrão, tag ou subtag..."
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
      </div>
      {/* ===== FIM DA ÁREA STICKY ===== */}

      {/* Tabela de Mapeamentos */}
      <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden ${selectedMappings.size > 0 || showBackToTop ? 'mb-20' : ''}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1350px]">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-10">
                  <button
                    onClick={toggleSelectAll}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                    title={selectAllState === 'none' ? 'Selecionar todos' : 'Limpar seleção'}
                  >
                    {selectAllState === 'none' && <Square size={18} className="text-gray-400" />}
                    {selectAllState === 'partial' && <MinusSquare size={18} className="text-blue-600" />}
                    {selectAllState === 'all' && <CheckSquare size={18} className="text-blue-600" />}
                  </button>
                </th>
                <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-10">
                  #
                </th>
                <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-16">
                  Match
                </th>
                <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider min-w-[200px]">
                  Descrição Original
                </th>
                <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-10" title="Prioridade">
                  <ArrowUpDown size={16} className="text-gray-500 dark:text-gray-300 mx-auto" />
                </th>
                <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider min-w-[180px]">
                  Descrição Mapeada
                </th>
                <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider min-w-[100px]">
                  Tag
                </th>
                <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider min-w-[120px]">
                  Subtag
                </th>
                <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-16">
                  Tipo
                </th>
                <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider min-w-[150px]">
                  Compartilhamento
                </th>
                <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider min-w-[140px] sticky right-0 bg-gray-50 dark:bg-gray-700 z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)]">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {filteredMappings.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                    <AlertCircle size={48} className="mx-auto mb-2 opacity-50" />
                    <p>Nenhum mapeamento encontrado</p>
                  </td>
                </tr>
              ) : (
                filteredMappings
                  .slice(
                    itemsPerPage === 0 ? 0 : (currentPage - 1) * itemsPerPage,
                    itemsPerPage === 0 ? filteredMappings.length : currentPage * itemsPerPage
                  )
                  .map((mapping, index) => {
                  const isSelected = selectedMappings.has(mapping.id)
                  const lineNumber = itemsPerPage === 0
                    ? index + 1
                    : (currentPage - 1) * itemsPerPage + index + 1
                  return (
                  <tr
                    key={mapping.id}
                    className={`group border-l-4 transition-all ${
                      isSelected
                        ? 'border-l-blue-600 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                        : 'border-l-gray-300 dark:border-l-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderLeftColor = 'var(--color-1)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderLeftColor = ''
                      }
                    }}
                  >
                    <td className="px-2 py-3 text-sm text-center">
                      <button
                        onClick={() => toggleSelectMapping(mapping.id)}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                        title={isSelected ? 'Desmarcar' : 'Selecionar'}
                      >
                        {isSelected ? (
                          <CheckSquare size={18} className="text-blue-600" />
                        ) : (
                          <Square size={18} className="text-gray-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-2 py-4 text-left whitespace-nowrap">
                      <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{lineNumber}</span>
                    </td>
                    <td className="px-2 py-3 text-sm text-center">
                      <span
                        className="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold"
                        style={{
                          backgroundColor: mapping.mapping_type === 'exact' ? 'var(--color-1)' :
                                         mapping.mapping_type === 'pattern' ? 'var(--color-2)' :
                                         'var(--color-4)',
                          color: mapping.mapping_type === 'exact' ? 'var(--on-color-1)' :
                                 mapping.mapping_type === 'pattern' ? 'var(--on-color-2)' :
                                 'var(--on-color-4)'
                        }}
                        title={mapping.mapping_type === 'exact' ? 'Exato' : mapping.mapping_type === 'pattern' ? 'Padrão' : 'Regex'}
                      >
                        {mapping.mapping_type === 'exact' ? 'E' : mapping.mapping_type === 'pattern' ? 'P' : 'R'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm text-left text-gray-900 dark:text-white">
                      <span className="font-mono" title={
                        mapping.mapping_type === 'exact'
                          ? (mapping.is_sensitive && revealedTableRows[mapping.id]?.original
                              ? revealedTableRows[mapping.id].original
                              : mapping.original_description) || ''
                          : mapping.mapping_type === 'pattern'
                            ? mapping.pattern || ''
                            : mapping.regex_pattern || ''
                      }>
                        {mapping.mapping_type === 'exact'
                          ? (mapping.is_sensitive && revealedTableRows[mapping.id]?.original
                              ? revealedTableRows[mapping.id].original
                              : mapping.original_description)
                          : mapping.mapping_type === 'pattern'
                            ? mapping.pattern
                            : mapping.regex_pattern}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm text-left text-gray-500 dark:text-gray-400">
                      {mapping.priority === 0 ? (
                        <span className="text-xs font-medium text-green-700 dark:text-green-300">
                          Alta
                        </span>
                      ) : mapping.priority === 1 ? (
                        <span className="text-xs font-medium text-yellow-700 dark:text-yellow-300">
                          Média
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-red-700 dark:text-red-300">
                          Baixa
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-sm text-left text-gray-500 dark:text-gray-400" title={
                      mapping.is_sensitive && revealedTableRows[mapping.id]?.mapped
                        ? revealedTableRows[mapping.id].mapped
                        : mapping.mapped_description || ''
                    }>
                      {mapping.is_sensitive && revealedTableRows[mapping.id]?.mapped
                        ? revealedTableRows[mapping.id].mapped
                        : mapping.mapped_description || '-'}
                    </td>
                    <td className="px-3 py-3 text-sm text-left text-gray-500 dark:text-gray-400">
                      <div className="flex items-center gap-1">
                        {(() => {
                          const TagIcon = getIconComponent(mapping.tag_icon || 'Tag')
                          return <TagIcon size={14} />
                        })()}
                        <span title={mapping.tag_name || ''}>{mapping.tag_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm text-left text-gray-500 dark:text-gray-400">
                      <div className="flex items-center gap-1">
                        {(() => {
                          const SubtagIcon = getIconComponent(mapping.subtag_icon || 'Tags')
                          return <SubtagIcon size={14} />
                        })()}
                        <span title={mapping.subtag_name || ''}>{mapping.subtag_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm text-center">
                      {mapping.subtag_type === 'receita' ? (
                        <ArrowUpCircle size={18} className="inline-block text-green-600 dark:text-green-400" title="Receita" />
                      ) : (
                        <ArrowDownCircle size={18} className="inline-block text-red-600 dark:text-red-400" title="Despesa" />
                      )}
                    </td>
                    <td className="px-3 py-3 text-sm text-left text-gray-500 dark:text-gray-400">
                      {mapping.shared_partner_name ? (
                        <SharedAccountDisplay
                          account={{
                            id: 0,
                            name: mapping.shared_partner_name,
                            bank: mapping.shared_partner_bank ? { name: mapping.shared_partner_bank } : null,
                            agency: mapping.shared_partner_agency,
                            account_number: mapping.shared_partner_account_number
                          }}
                          ownershipPercentage={mapping.my_contribution_percentage}
                        />
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500 italic">-</span>
                      )}
                    </td>
                    <td className={`px-2 py-3 text-sm text-left sticky right-0 z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)] transition-colors ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-900/20 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30'
                        : 'bg-white dark:bg-gray-800 group-hover:bg-gray-50 dark:group-hover:bg-gray-700'
                    }`}>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleEdit(mapping)}
                          className="p-1 rounded transition-colors hover:opacity-80"
                          style={{ color: 'var(--crud-edit)' }}
                          title="Editar mapeamento"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => openRemapModal(mapping)}
                          disabled={remappingId === mapping.id}
                          className="p-1 rounded transition-colors hover:opacity-80 disabled:opacity-50"
                          style={{ color: 'var(--color-2)' }}
                          title="Aplicar mapeamento às transações existentes"
                        >
                          <Zap size={16} className={remappingId === mapping.id ? 'animate-pulse' : ''} />
                        </button>
                        <button
                          onClick={() => handleDelete(mapping.id)}
                          className="p-1 rounded transition-colors hover:opacity-80"
                          style={{ color: 'var(--crud-delete)' }}
                          title="Deletar mapeamento"
                        >
                          <Trash2 size={16} />
                        </button>
                        {mapping.mapping_type === 'exact' && mapping.is_sensitive && (
                          <button
                            onClick={() => handleRevealTableRow(mapping.id)}
                            className="p-1 rounded transition-colors text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                            title={revealedTableRows[mapping.id] ? "Ocultar valores" : "Revelar valores (requer senha)"}
                          >
                            {revealedTableRows[mapping.id] ? (
                              <EyeOff size={16} />
                            ) : (
                              <Eye size={16} />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )})
              )}
            </tbody>

            {/* Footer da tabela com paginação */}
            <tfoot className="bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600">
              <tr>
                <td colSpan={11} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    {/* ESQUERDA: Itens por página */}
                    <div className="flex items-center gap-2 text-sm justify-start">
                      <label className="text-gray-600 dark:text-gray-400">Itens por página:</label>
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
                          {itemsPerPage === 0 ? filteredMappings.length : Math.min(itemsPerPage, filteredMappings.length - (currentPage - 1) * itemsPerPage)}
                        </span> de <span className="font-semibold text-gray-900 dark:text-white">{filteredMappings.length}</span> {filteredMappings.length === 1 ? 'mapeamento' : 'mapeamentos'}
                      </div>
                    </div>

                    {/* DIREITA: Navegação de páginas */}
                    <div className="flex items-center justify-end">
                      {itemsPerPage > 0 && Math.ceil(filteredMappings.length / itemsPerPage) > 1 && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            Anterior
                          </button>
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            Página <span className="font-semibold text-gray-900 dark:text-white">{currentPage}</span> de <span className="font-semibold text-gray-900 dark:text-white">{Math.ceil(filteredMappings.length / itemsPerPage)}</span>
                          </span>
                          <button
                            onClick={() => setCurrentPage(prev => Math.min(Math.ceil(filteredMappings.length / itemsPerPage), prev + 1))}
                            disabled={currentPage >= Math.ceil(filteredMappings.length / itemsPerPage)}
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

      {/* Modal de Adicionar/Editar */}
      {(showAddModal || showEditModal) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-6xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
                  {showEditModal ? 'Editar Mapeamento' : 'Novo Mapeamento'}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Configure como uma descrição deve ser categorizada automaticamente
                </p>
              </div>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={showEditModal ? handleUpdate : handleSubmit}>
              {/* Switch: Aplicar a Registros Existentes - DISPONÍVEL EM CRIAÇÃO E EDIÇÃO */}
              <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <label className="flex items-center gap-3 cursor-pointer group">
                  {/* Toggle Switch */}
                  <div className="relative flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={applyToExistingRecords}
                      onChange={(e) => setApplyToExistingRecords(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className={`w-11 h-6 rounded-full transition-all duration-200 ${
                      applyToExistingRecords
                        ? 'bg-blue-600 dark:bg-blue-500'
                        : 'bg-gray-300 dark:bg-gray-600'
                    }`}>
                      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                        applyToExistingRecords ? 'translate-x-5' : 'translate-x-0'
                      }`}></div>
                    </div>
                  </div>

                  <div className="flex-1">
                    <span className="text-sm font-semibold text-blue-700 dark:text-blue-300 group-hover:text-blue-800 dark:group-hover:text-blue-200 transition-colors">
                      ✨ Aplicar a todos os registros existentes
                    </span>
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                      Atualiza tag, subtag e compartilhamento em <strong>todos</strong> os registros que correspondem a este mapeamento
                    </p>
                  </div>
                </label>
              </div>

              <div className="space-y-3">
                {/* Grid: Tipo de Mapeamento + Prioridade */}
                <div className="grid grid-cols-3 gap-4">
                  {/* Tipo de Mapeamento */}
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Tipo de Mapeamento *
                    </label>
                    <select
                      required
                      value={formData.mapping_type}
                      onChange={(e) => {
                        const newType = e.target.value as 'exact' | 'pattern' | 'regex'
                        // Auto-define prioridade: exact=0 (Alta), pattern=1 (Média), regex=2 (Baixa)
                        const priorityMap = { exact: 0, pattern: 1, regex: 2 }
                        // Se mudar para pattern/regex, desmarcar is_sensitive (não faz sentido)
                        const newIsSensitive = newType === 'exact' ? formData.is_sensitive : false
                        setFormData({ ...formData, mapping_type: newType, priority: priorityMap[newType], is_sensitive: newIsSensitive })
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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
                  </div>

                  {/* Prioridade */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Prioridade
                    </label>
                    <select
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: Number(e.target.value) })}
                      disabled
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-600 text-gray-900 dark:text-white cursor-not-allowed"
                    >
                      <option value={0}>Alta</option>
                      <option value={1}>Média</option>
                      <option value={2}>Baixa</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Determinada pelo tipo de mapeamento
                    </p>
                  </div>
                </div>

                {/* Descrição Original (apenas para exact) */}
                {formData.mapping_type === 'exact' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Descrição Original *
                    </label>

                    {editingMapping?.is_sensitive && !canEditSensitive ? (
                      <div className="relative">
                        <input
                          type="text"
                          value={revealedOriginal || formData.original_description}
                          readOnly
                          className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-600 text-gray-900 dark:text-white"
                          placeholder="********"
                        />
                        <button
                          type="button"
                          onClick={handleRevealOriginalDescription}
                          disabled={isRevealing}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
                          title={revealedOriginal ? "Ocultar valor" : "Revelar valor (requer senha)"}
                        >
                          {isRevealing ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
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
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        placeholder="Ex: NETFLIX, SPOTIFY, etc."
                      />
                    )}
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Como aparece no extrato ou fatura (correspondência exata)
                    </p>
                  </div>
                )}

                {/* Padrão (apenas para pattern) */}
                {formData.mapping_type === 'pattern' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Padrão de Texto *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.pattern}
                      onChange={(e) => setFormData({ ...formData, pattern: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="Ex: UBER, IFOOD, etc."
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Texto que deve estar contido na descrição (case-insensitive)
                    </p>
                  </div>
                )}

                {/* Regex Pattern (apenas para regex) */}
                {formData.mapping_type === 'regex' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Expressão Regular *
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-purple-600 dark:text-purple-400 font-mono text-sm font-bold select-none">/</span>
                      <input
                        type="text"
                        required
                        value={formData.regex_pattern}
                        onChange={(e) => setFormData({ ...formData, regex_pattern: e.target.value })}
                        className={`w-full pl-6 pr-8 py-2 border rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm ${
                          regexError
                            ? 'border-red-500 dark:border-red-400'
                            : formData.regex_pattern.trim()
                              ? 'border-purple-500 dark:border-purple-400'
                              : 'border-gray-300 dark:border-gray-600'
                        }`}
                        placeholder="^PAG.*PIX, UBER.*TRIP, etc."
                      />
                      <span className="absolute right-3 text-purple-600 dark:text-purple-400 font-mono text-sm font-bold select-none">/i</span>
                    </div>
                    {/* Feedback de validação */}
                    <div className="mt-1.5 flex items-center gap-2">
                      {formData.regex_pattern.trim() ? (
                        regexError ? (
                          <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                            <span>❌</span> {regexError}
                          </span>
                        ) : (
                          <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                            <span>✅</span> Regex válido
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          Padrão regex para correspondência avançada (case-insensitive)
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Filtro de Tipo (Receita/Despesa) */}
                <div className="border-t border-b border-gray-200 dark:border-gray-700 py-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    Tipo de Transação *
                  </label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setModalTypeFilter('receita')
                        setFormData({ ...formData, tag_id: 0, subtag_id: 0 })
                      }}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                        modalTypeFilter === 'receita'
                          ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                          : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:border-green-400'
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
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                        modalTypeFilter === 'despesa'
                          ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                          : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:border-red-400'
                      }`}
                    >
                      <ArrowDownCircle size={20} className={modalTypeFilter === 'despesa' ? 'text-red-600 dark:text-red-400' : ''} />
                      <span className="font-medium">Despesa</span>
                    </button>
                  </div>
                </div>

                {/* Tag e Subtag - Grid 2 colunas */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Tag */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Tag (Categoria Principal) *
                    </label>
                    <select
                      required
                      value={formData.tag_id}
                      onChange={(e) => {
                        const newTagId = Number(e.target.value)
                        setFormData({ ...formData, tag_id: newTagId, subtag_id: 0 })
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      <option value={0}>Selecione uma tag...</option>
                      {tags.map(tag => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Subtag */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Subtag (Subcategoria) *
                    </label>
                    <select
                      required
                      value={formData.subtag_id}
                      onChange={(e) => setFormData({ ...formData, subtag_id: Number(e.target.value) })}
                      disabled={!formData.tag_id}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed"
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
                  </div>
                </div>

                {/* Grid: Compartilhamento */}
                <div className="grid grid-cols-3 gap-4 border-t border-gray-200 dark:border-gray-700 pt-3">
                  {/* Compartilhamento */}
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Compartilhamento (Opcional)
                    </label>
                    <select
                      value={formData.shared_partner_id}
                      onChange={(e) => {
                        const selectedId = Number(e.target.value)
                        setFormData({ ...formData, shared_partner_id: selectedId })

                        // Auto-popular percentual quando selecionar compartilhamento
                        if (selectedId > 0) {
                          const selectedSharing = partners.find(p => p.id === selectedId)
                          if (selectedSharing) {
                            setFormData(prev => ({
                              ...prev,
                              shared_partner_id: selectedId,
                              my_contribution_percentage: selectedSharing.my_contribution_percentage
                            }))
                          }
                        } else {
                          // Se desselecionar, limpar percentual
                          setFormData(prev => ({
                            ...prev,
                            shared_partner_id: 0,
                            my_contribution_percentage: null
                          }))
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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
                  </div>

                  {/* Percentual de Contribuição - sempre visível, desabilitado se não houver compartilhamento */}
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${formData.shared_partner_id > 0 ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
                      Minha Contribuição (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={formData.my_contribution_percentage ?? ''}
                      onChange={(e) => {
                        const value = e.target.value === '' ? null : Number(e.target.value)
                        // Validar que o valor está entre 0 e 100
                        if (value !== null && (value < 0 || value > 100)) {
                          return // Não atualiza se estiver fora do range
                        }
                        setFormData({ ...formData, my_contribution_percentage: value })
                      }}
                      disabled={formData.shared_partner_id === 0}
                      className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent ${
                        formData.shared_partner_id > 0
                          ? 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
                          : 'border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                      }`}
                      placeholder={formData.shared_partner_id > 0 ? '50.00' : '-'}
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {formData.shared_partner_id > 0 ? 'Percentual específico para este mapeamento' : 'Selecione um compartilhamento primeiro'}
                    </p>
                  </div>
                </div>

                {/* Toggle: Marcar como Sensível - Desabilitado para pattern/regex */}
                <div className={`p-2.5 border rounded-lg ${
                  formData.mapping_type !== 'exact'
                    ? 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-60'
                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                }`}>
                  <label className={`flex items-center gap-2.5 ${
                    formData.mapping_type !== 'exact' ? 'cursor-not-allowed' : 'cursor-pointer group'
                  }`}>
                    {/* Toggle Switch - Menor */}
                    <div className="relative flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={formData.is_sensitive}
                        onChange={(e) => handleSensitiveToggle(e.target.checked)}
                        disabled={formData.mapping_type !== 'exact'}
                        className="sr-only peer"
                      />
                      <div className={`w-9 h-5 rounded-full transition-all duration-200 ${
                        formData.mapping_type !== 'exact'
                          ? 'bg-gray-300 dark:bg-gray-600'
                          : formData.is_sensitive
                            ? 'bg-red-600 dark:bg-red-500'
                            : 'bg-gray-300 dark:bg-gray-600'
                      }`}>
                        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
                          formData.is_sensitive && formData.mapping_type === 'exact' ? 'translate-x-4' : 'translate-x-0'
                        }`}></div>
                      </div>
                    </div>

                    <div className="flex-1">
                      <span className={`text-sm font-medium transition-colors ${
                        formData.mapping_type !== 'exact'
                          ? 'text-gray-500 dark:text-gray-400'
                          : 'text-red-700 dark:text-red-300 group-hover:text-red-800 dark:group-hover:text-red-200'
                      }`}>
                        🔒 Marcar como sensível (criptografar descrições)
                      </span>
                      <p className={`text-xs mt-0.5 ${
                        formData.mapping_type !== 'exact'
                          ? 'text-gray-400 dark:text-gray-500'
                          : 'text-red-600 dark:text-red-400'
                      }`}>
                        {formData.mapping_type !== 'exact'
                          ? 'Disponível apenas para mapeamentos do tipo Exato'
                          : 'Descrições serão criptografadas e só poderão ser visualizadas com senha'}
                      </p>
                    </div>
                  </label>
                </div>

                {/* Descrição Mapeada (Personalizada) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Descrição Personalizada {formData.is_sensitive && <span className="text-red-600">*</span>}
                  </label>

                  {editingMapping?.is_sensitive && !canEditSensitive ? (
                    <div className="relative">
                      <input
                        type="text"
                        value={revealedMapped || formData.mapped_description}
                        readOnly
                        className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-600 text-gray-900 dark:text-white"
                        placeholder="********"
                      />
                      <button
                        type="button"
                        onClick={handleRevealMappedDescription}
                        disabled={isRevealing}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
                        title={revealedMapped ? "Ocultar valor" : "Revelar valor (requer senha)"}
                      >
                        {isRevealing ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
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
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="Ex: Entretenimento"
                    />
                  )}
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {formData.is_sensitive
                      ? 'Obrigatório para mapeamentos sensíveis - substitui a descrição original na visualização'
                      : 'Substitui a descrição original na visualização (deixe em branco para usar a original)'}
                  </p>
                </div>
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 rounded-md text-white hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: 'var(--crud-cancel)' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={showEditModal && !hasFormChanges()}
                  className="flex-1 px-4 py-2 text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'var(--crud-create)' }}
                >
                  {showEditModal ? 'Atualizar Mapeamento' : 'Criar Mapeamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                🔒 Confirmação de Senha
              </h3>
              <button
                onClick={() => {
                  setShowPasswordModal(false)
                  setPassword('')
                  setRevealingTableRowId(null)
                  revealingTableRowIdRef.current = null
                  // Reverter checkbox apenas se estava desmarcando sensível
                  if (passwordModalAction === 'unsensitive') {
                    setFormData(prev => ({ ...prev, is_sensitive: true }))
                  }
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {passwordModalAction === 'reveal'
                ? 'Para visualizar os dados descriptografados, digite sua senha:'
                : passwordModalAction === 'save'
                  ? 'Para salvar este mapeamento sensível, digite sua senha:'
                  : 'Para desmarcar a flag de sensível e visualizar os dados descriptografados, digite sua senha:'}
            </p>

            <form onSubmit={(e) => {
              e.preventDefault()
              handlePasswordValidation()
            }}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Senha
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Digite sua senha"
                  autoFocus
                />
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordModal(false)
                    setPassword('')
                    setRevealingTableRowId(null)
                    revealingTableRowIdRef.current = null
                    // Reverter checkbox apenas se estava desmarcando sensível
                    if (passwordModalAction === 'unsensitive') {
                      setFormData(prev => ({ ...prev, is_sensitive: true }))
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isValidatingPassword}
                  className="px-4 py-2 text-sm font-medium text-white bg-color-primary rounded-md hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isValidatingPassword ? 'Validando...' : 'Confirmar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Reaplicar Mapeamento */}
      {showRemapModal && remapMapping && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Zap size={20} className="text-color-primary" />
                Aplicar Mapeamento
              </h3>
              <button
                onClick={() => setShowRemapModal(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X size={20} className="text-gray-500 dark:text-gray-400" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {/* Info do mapeamento */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Mapeamento:</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {remapMapping.original_description || remapMapping.pattern || remapMapping.regex_pattern || 'N/A'}
                </p>
                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                  <span className="flex items-center gap-1">
                    <Tag size={12} />
                    {remapMapping.tag_name || 'Sem tag'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Tags size={12} />
                    {remapMapping.subtag_name || 'Sem subtag'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users size={12} />
                    {remapMapping.shared_partner_name || 'Sem compartilhamento'}
                  </span>
                </div>
              </div>

              {/* Opções */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Opções de aplicação:
                </p>

                {/* Subtag sempre vai ser aplicada (obrigatória no mapeamento) */}
                <div className="flex items-start gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                  <CheckSquare size={18} className="text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-700 dark:text-green-300">
                      Tag/Subtag: {remapMapping.tag_name} → {remapMapping.subtag_name}
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400">
                      Sempre será aplicada (obrigatória no mapeamento)
                    </p>
                  </div>
                </div>

                {/* Compartilhamento - checkbox para sobrescrever ou ignorar */}
                <div className="flex items-start gap-3 p-3 rounded-lg border transition-colors bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
                  <button
                    onClick={() => setRemapOptions(prev => ({
                      ...prev,
                      overwrite_sharing: !prev.overwrite_sharing
                    }))}
                    className="mt-0.5 flex-shrink-0"
                  >
                    {remapOptions.overwrite_sharing ? (
                      <CheckSquare size={18} className="text-amber-600 dark:text-amber-400" />
                    ) : (
                      <Square size={18} className="text-amber-600 dark:text-amber-400" />
                    )}
                  </button>
                  <div>
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                      {remapOptions.overwrite_sharing
                        ? `⚠ Sobrescrever compartilhamento ${remapMapping.shared_partner_id ? `(${remapMapping.shared_partner_name})` : '(remover existente)'}`
                        : '✓ Ignorar (manter compartilhamento existente nas transações)'
                      }
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {remapMapping.shared_partner_id
                        ? `Mapeamento define: ${remapMapping.shared_partner_name} (${remapMapping.my_contribution_percentage || 100}%)`
                        : 'Mapeamento não possui compartilhamento definido'
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowRemapModal(false)}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors hover:opacity-90"
                style={{ backgroundColor: 'var(--crud-cancel)' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleRemap}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors hover:opacity-90 flex items-center gap-2 bg-color-primary"
              >
                <Zap size={16} />
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Executar Todos */}
      {showBatchRemapModal && selectedMappings.size > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Zap size={20} className="text-color-primary" />
                Executar {selectedMappings.size} Mapeamento(s)
              </h3>
              <button
                onClick={() => setShowBatchRemapModal(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X size={20} className="text-gray-500 dark:text-gray-400" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Aplicar tag, subtag e compartilhamento de <strong>{selectedMappings.size}</strong> mapeamento(s) selecionado(s) a todas as transações correspondentes.
              </p>

              {/* Opções */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Opções de aplicação:
                </p>

                {/* Subtag sempre aplica */}
                <div className="flex items-start gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                  <CheckSquare size={18} className="text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-700 dark:text-green-300">
                      Tag e Subtag: Sempre aplicadas
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400">
                      Obrigatórias em todos os mapeamentos
                    </p>
                  </div>
                </div>

                {/* Compartilhamento - opção para mapeamentos sem compartilhamento definido */}
                <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                  <button
                    onClick={() => setBatchRemapOptions(prev => ({
                      ...prev,
                      overwrite_sharing: !prev.overwrite_sharing
                    }))}
                    className="mt-0.5 flex-shrink-0"
                  >
                    {batchRemapOptions.overwrite_sharing ? (
                      <CheckSquare size={18} className="text-amber-600 dark:text-amber-400" />
                    ) : (
                      <Square size={18} className="text-amber-600 dark:text-amber-400" />
                    )}
                  </button>
                  <div>
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                      {batchRemapOptions.overwrite_sharing
                        ? '⚠ Sobrescrever (remover compartilhamento existente)'
                        : '✓ Ignorar (manter compartilhamento existente)'
                      }
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Para mapeamentos sem compartilhamento definido
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowBatchRemapModal(false)}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors hover:opacity-90"
                style={{ backgroundColor: 'var(--crud-cancel)' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleBatchRemap}
                disabled={isBatchRemapping}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors hover:opacity-90 flex items-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-1)' }}
              >
                <Zap size={16} className={isBatchRemapping ? 'animate-pulse' : ''} />
                {isBatchRemapping ? 'Executando...' : 'Executar Todos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Editar Todas */}
      {showBatchEditModal && selectedMappings.size > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Edit2 size={20} style={{ color: 'var(--crud-edit)' }} />
                Editar {selectedMappings.size} Mapeamento(s)
              </h3>
              <button
                onClick={() => setShowBatchEditModal(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X size={20} className="text-gray-500 dark:text-gray-400" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Marque os campos que deseja <strong>alterar</strong>. Campos desmarcados manterão os valores atuais do banco.
              </p>

              {/* Tag + Subtag (juntos) - Filtrado pelo tipo dos selecionados */}
              <div className="space-y-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={batchEditData.apply_tag_subtag}
                    onChange={(e) => setBatchEditData(prev => ({ ...prev, apply_tag_subtag: e.target.checked }))}
                    className="rounded border-gray-300 text-color-primary focus:ring-color-primary"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Alterar Tag/Subtag
                    {selectedMappingsType && (
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${selectedMappingsType === 'receita' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                        {selectedMappingsType === 'receita' ? 'Receita' : 'Despesa'}
                      </span>
                    )}
                  </span>
                </label>
                {batchEditData.apply_tag_subtag && (
                  <div className="space-y-2 pl-6">
                    <select
                      value={batchEditData.tag_id}
                      onChange={(e) => {
                        setBatchEditData(prev => ({ ...prev, tag_id: Number(e.target.value), subtag_id: 0 }))
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none"
                    >
                      <option value={0}>Selecione uma tag...</option>
                      {/* Filtra tags que têm pelo menos uma subtag do tipo selecionado */}
                      {tags
                        .filter(tag => subtags.some(s => s.tag_id === tag.id && s.type === selectedMappingsType))
                        .map(tag => (
                          <option key={tag.id} value={tag.id}>{tag.name}</option>
                        ))}
                    </select>
                    <select
                      value={batchEditData.subtag_id}
                      onChange={(e) => setBatchEditData(prev => ({ ...prev, subtag_id: Number(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none"
                      disabled={!batchEditData.tag_id}
                    >
                      <option value={0}>Selecione uma subtag...</option>
                      {/* Filtra subtags pela tag selecionada E pelo tipo dos mapeamentos selecionados */}
                      {subtags
                        .filter(s => s.tag_id === batchEditData.tag_id && s.type === selectedMappingsType)
                        .map(subtag => (
                          <option key={subtag.id} value={subtag.id}>{subtag.name}</option>
                        ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Compartilhamento */}
              <div className="space-y-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!batchEditData.skip_sharing}
                    onChange={(e) => setBatchEditData(prev => ({ ...prev, skip_sharing: !e.target.checked }))}
                    className="rounded border-gray-300 text-color-primary focus:ring-color-primary"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Alterar Compartilhamento</span>
                </label>
                {!batchEditData.skip_sharing && (
                  <div className="space-y-2 pl-6">
                    <select
                      value={batchEditData.shared_partner_id}
                      onChange={(e) => {
                        const selectedId = Number(e.target.value)
                        // Auto-popular percentual quando selecionar compartilhamento
                        if (selectedId > 0) {
                          const selectedSharing = partners.find(p => p.id === selectedId)
                          if (selectedSharing) {
                            setBatchEditData(prev => ({
                              ...prev,
                              shared_partner_id: selectedId,
                              my_contribution_percentage: selectedSharing.my_contribution_percentage
                            }))
                          }
                        } else {
                          // Se desselecionar, limpar percentual
                          setBatchEditData(prev => ({
                            ...prev,
                            shared_partner_id: 0,
                            my_contribution_percentage: 50
                          }))
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none"
                    >
                      <option value={0}>Nenhum (remover compartilhamento)</option>
                      {[...partners].sort((a, b) => getPartnerLabel(a).localeCompare(getPartnerLabel(b))).map(partner => (
                        <option key={partner.id} value={partner.id}>
                          {getPartnerLabel(partner)}
                        </option>
                      ))}
                    </select>
                    {batchEditData.shared_partner_id > 0 && (
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-600 dark:text-gray-400">Minha contribuição:</label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={batchEditData.my_contribution_percentage ?? 50}
                          onChange={(e) => {
                            const val = Math.min(100, Math.max(0, Number(e.target.value) || 0))
                            setBatchEditData(prev => ({ ...prev, my_contribution_percentage: val }))
                          }}
                          className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:border-color-primary focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-sm text-gray-500">%</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowBatchEditModal(false)}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors hover:opacity-90"
                style={{ backgroundColor: 'var(--crud-cancel)' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleBatchEdit}
                disabled={isBatchEditing}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors hover:opacity-90 flex items-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: 'var(--crud-edit)' }}
              >
                <Edit2 size={16} />
                {isBatchEditing ? 'Editando...' : 'Aplicar Edição'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barra Flutuante de Ações - Com seleção */}
      {selectedMappings.size > 0 && (
        <div className="fixed bottom-0 left-64 right-0 z-50 bg-white dark:bg-gray-800 border-t-2 border-color-primary shadow-[0_-4px_12px_rgba(0,0,0,0.15)] px-6 py-3">
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
                <Zap size={14} className={isBatchRemapping ? 'animate-pulse' : ''} />
                {isBatchRemapping ? 'Executando...' : 'Executar Todos'}
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
        </div>
      )}

      {/* Barra Flutuante Back to Top - Aparece só quando não há seleção */}
      {showBackToTop && selectedMappings.size === 0 && (
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

