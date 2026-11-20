import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from '../components/Sidebar'
import {
  CadastroListCreateButton,
  CadastroRowMutations,
  CadastroListSecondaryButton,
  CadastroListPageBody,
  CadastroListPageEmptyCard,
  CadastroListPageHero,
  CadastroListPageLoading,
  CadastroListPageSearchField,
  CadastroListPageShell,
  CadastroListPageTabs,
  cadastroRowIconBtnCls,
  cadastroRowIconDangerCls,
  listPageTableBodyCls,
  listPageTableChromeHeaderCls,
  listPageTableCls,
  listPageTableRowHoverCls,
  type StatusFilter,
} from '../components/CadastroListPageLayout'
import FloatingFooterBar from '../components/FloatingFooterBar'
import { usePageWriteAllowed, WriteGate } from '../contexts/PageMutationContext'
import BulkSelectCheckbox, { type HeaderCheckState } from '../components/BulkSelectCheckbox'
import { ListPageNestedTable } from '../components/ListPageTable'
import {
  ListTableCheckboxCell,
  ListTableCheckboxHeader,
  ListTableIndexCell,
  ListTableIndexHeader,
  ListTableLeadingCols,
  ListTableSpacerCell,
  ListTableSpacerCol,
  ListTableSpacerHeader,
  ListTableStaticHeader,
} from '../components/ListTableSelectColumns'
import { selectionHeaderState } from '../utils/listTableSelection'
import StatusSwitch from '../components/StatusSwitch'
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
} from '../components/CadastroFormLayout'
import Badge from '../components/Badge'
import { badgeVariantForColumnRole } from '../utils/badgeSurfaces'
import { badgeToneMap } from '../utils/badgePalettes'
import Toast from '../components/Toast'
import SharedAccountDisplay from '../components/SharedAccountDisplay'
import {
  ChevronDown, ChevronRight, Edit2, Trash2, CreditCard, Gift, Layers,
  ArrowUp, X, ChevronsDown, ChevronsUp,
} from 'lucide-react'
import { sharingPartnerLabel, sharingPercentForKind } from '../utils/accountFormatter'
import OwnershipPercentField from '../components/OwnershipPercentField'
import { finalizePercentInput, maskPercentInput, samePercent } from '../utils/percentInput'
import axios from 'axios'
import { useConfirm } from '../hooks/useConfirm'
import { useExportRunner } from '../hooks/useExportRunner'
import { CadastroListHeaderActions } from '../components/CadastroExcelMenu'
import { exportCartoesToExcel } from '../utils/exportCadastroExcel'
import { useEscapeKey } from '../hooks/useEscapeKey'

interface Bank {
  id: number
  code: string
  name: string
}

interface ExpenseSharing {
  id: number
  account_id: number
  shared_account_id: number
  my_contribution_percentage: number
  revenue_contribution_percentage?: number
  description?: string
  active: boolean
  shared_account?: {
    id: number
    name?: string
    description?: string
    bank?: Bank
    agency?: number
    account_number?: string
  }
}

interface Cartao {
  id: number
  name: string
  description?: string
  number: string
  type: string
  account_id?: number
  account_name?: string
  ownership_type: string
  expense_sharing_id?: number
  expense_ownership_percentage?: number | null
  revenue_ownership_percentage?: number | null
  expense_sharing?: ExpenseSharing
  active: boolean
  closing_day?: number
  due_day?: number
  invoice_group_id?: number | null
  invoice_group_name?: string | null
}

interface InvoiceGroup {
  id: number
  name: string
  account_id: number
  active: boolean
  closing_day: number
  due_day: number
  card_count: number
}

interface ToastState {
  show: boolean
  message: string
  type: 'success' | 'error' | 'warning'
}

const OWNERSHIP_TONE = badgeToneMap(['proprio', 'gerenciado', 'compartilhado'] as const, 'brand')
const CARD_TYPE_TONE = badgeToneMap(['credito', 'beneficios'] as const, 'brand')

/** Mesmo padrão visual da lista em EmprestimosPage (card + borda lateral). */
const cardListItemCls =
  'rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800'
const cardListGroupCls = `${cardListItemCls} border-l-4 border-l-[var(--color-1)]`

/** Checkbox / # / spacer fixos; 9 colunas de dados repartem o resto igualmente (`table-fixed`). */
const cardCartoesTableColsEqual = (
  <>
    <ListTableSpacerCol />
    <col />
    <col />
    <col />
    <col />
    <col />
    <col />
    <col />
    <col />
    <col />
    <col />
  </>
)

function formatCardPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
}

function CardNestedTableHead({
  checkboxState,
  onToggleCheckbox,
}: {
  checkboxState: HeaderCheckState
  onToggleCheckbox: () => void
}) {
  return (
    <tr>
      <ListTableCheckboxHeader state={checkboxState} onToggle={onToggleCheckbox} />
      <ListTableIndexHeader />
      <ListTableSpacerHeader />
      <ListTableStaticHeader label="Nome" className="px-3 py-2" />
      <ListTableStaticHeader label="Tipo" className="px-3 py-2" />
      <ListTableStaticHeader label="Final" className="px-3 py-2" />
      <ListTableStaticHeader label="Fech." className="px-2 py-2 text-center" />
      <ListTableStaticHeader label="Venc." className="px-2 py-2 text-center" />
      <ListTableStaticHeader label="Compart." className="px-3 py-2" />
      <ListTableStaticHeader label="% Despesa" className="px-2 py-2 text-center" />
      <ListTableStaticHeader label="% Receita" className="px-2 py-2 text-center" />
      <ListTableStaticHeader label="Status" className="px-3 py-2" />
      <ListTableStaticHeader label="Ações" className="px-2 py-2" />
    </tr>
  )
}

function ActiveSwitch({
  checked,
  onToggle,
  title,
}: {
  checked: boolean
  onToggle: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title || (checked ? 'Ativo — clique para inativar' : 'Inativo — clique para reativar')}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-color-primary focus:ring-offset-2 ${
        checked ? '' : 'bg-gray-200 dark:bg-gray-600'
      }`}
      style={checked ? { backgroundColor: 'var(--color-1)' } : undefined}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

const CartoesPage = () => {
  const canWrite = usePageWriteAllowed()
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [invoiceGroups, setInvoiceGroups] = useState<InvoiceGroup[]>([])
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<InvoiceGroup | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupClosingDay, setGroupClosingDay] = useState('14')
  const [groupDueDay, setGroupDueDay] = useState('14')
  const [groupCardIds, setGroupCardIds] = useState<number[]>([])
  const [savingGroup, setSavingGroup] = useState(false)
  const [compartilhamentos, setCompartilhamentos] = useState<ExpenseSharing[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingCartao, setEditingCartao] = useState<Cartao | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    number: '',
    type: 'credito',
    ownership_type: 'proprio',
    expense_sharing_id: '',
    expense_ownership_percentage: '',
    revenue_ownership_percentage: '',
    closing_day: '14',
    due_day: '14',
    active: true,
    invoice_group_id: '',
  })
  const [originalOwnershipType, setOriginalOwnershipType] = useState<string>('proprio')
  const [originalExpenseSharingId, setOriginalExpenseSharingId] = useState<number | null>(null)
  const [updateExistingRecords, setUpdateExistingRecords] = useState(false)
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' })
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set())
  const [selectedCardIds, setSelectedCardIds] = useState<Set<number>>(() => new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { showConfirm, ConfirmComponent } = useConfirm()

  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ show: true, message, type })
  }

  const exportRunner = useExportRunner((message) => showToast(message, 'error'))

  useEffect(() => {
    carregarCompartilhamentos()
    carregarCartoes()
    carregarGrupos()
  }, [])

  const scrollToTop = useCallback(() => {
    setShowBackToTop(false)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const handleScroll = () => setShowBackToTop(container.scrollTop > 300)
    handleScroll()
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [loading, cartoes.length, statusFilter, searchTerm])

  // Atalhos de teclado para o modal
  useEffect(() => {
    if (!showModal) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        fecharModal()
      } else if (e.key === 'Enter' && !e.shiftKey) {
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
  }, [showModal])

  useEscapeKey(() => {
    setShowGroupModal(false)
    setEditingGroup(null)
    setGroupName('')
    setGroupCardIds([])
    setSavingGroup(false)
  }, showGroupModal)

  const carregarCompartilhamentos = async () => {
    try {
      const response = await axios.get('/api/expense-sharing/')
      setCompartilhamentos(response.data.filter((c: ExpenseSharing) => c.active))
    } catch (error) {
      console.error('Erro ao carregar compartilhamentos:', error)
    }
  }

  const carregarCartoes = async () => {
    try {
      const response = await axios.get('/api/cartoes/?incluir_inativos=true')
      setCartoes(response.data)
    } catch (error) {
      console.error('Erro ao carregar cartões:', error)
      showToast('Erro ao carregar cartões', 'error')
    } finally {
      setLoading(false)
    }
  }

  const carregarGrupos = async () => {
    try {
      const response = await axios.get('/api/cartoes/invoice-groups')
      setInvoiceGroups(response.data)
    } catch (error) {
      console.error('Erro ao carregar grupos de fatura:', error)
    }
  }

  const cartoesCredito = cartoes.filter((c) => c.type === 'credito')
  const cartoesCreditoAtivos = cartoesCredito.filter((c) => c.active)
  const cardCalendarLocked = formData.type === 'credito' && Boolean(formData.invoice_group_id)
  const lockedInvoiceGroup = invoiceGroups.find((g) => String(g.id) === formData.invoice_group_id)

  const fecharModalGrupo = () => {
    setShowGroupModal(false)
    setEditingGroup(null)
    setGroupName('')
    setGroupClosingDay('14')
    setGroupDueDay('14')
    setGroupCardIds([])
    setSavingGroup(false)
  }

  const abrirModalGrupoNovo = () => {
    setEditingGroup(null)
    setGroupName('')
    setGroupClosingDay('14')
    setGroupDueDay('14')
    setGroupCardIds([])
    setShowGroupModal(true)
  }

  const abrirModalGrupoEditar = (group: InvoiceGroup) => {
    setEditingGroup(group)
    setGroupName(group.name)
    setGroupClosingDay(String(group.closing_day ?? 14))
    setGroupDueDay(String(group.due_day ?? 14))
    setGroupCardIds(
      cartoes.filter((c) => c.invoice_group_id === group.id && c.type === 'credito').map((c) => c.id),
    )
    setShowGroupModal(true)
  }

  const toggleGroupCard = (cardId: number) => {
    setGroupCardIds((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId],
    )
  }

  const creditCardIds = cartoesCredito.map((c) => c.id)
  const groupCardIdsSet = useMemo(() => new Set(groupCardIds), [groupCardIds])
  const groupCardsSelectState = useMemo(
    () => selectionHeaderState(creditCardIds, groupCardIdsSet),
    [creditCardIds, groupCardIdsSet],
  )

  const toggleSelectAllGroupCards = () => {
    setGroupCardIds(groupCardsSelectState === 'all' ? [] : creditCardIds)
  }

  const salvarGrupo = async () => {
    const name = groupName.trim()
    if (!name) {
      showToast('Informe o nome do grupo', 'warning')
      return
    }
    if (groupCardIds.length < 2) {
      showToast('Selecione pelo menos dois cartões de crédito', 'warning')
      return
    }
    setSavingGroup(true)
    try {
      const closing_day = parseInt(groupClosingDay, 10) || 14
      const due_day = parseInt(groupDueDay, 10) || 14
      if (editingGroup) {
        await axios.put(`/api/cartoes/invoice-groups/${editingGroup.id}`, {
          name,
          closing_day,
          due_day,
          card_ids: groupCardIds,
        })
        showToast('Grupo atualizado', 'success')
      } else {
        await axios.post('/api/cartoes/invoice-groups', {
          name,
          closing_day,
          due_day,
          card_ids: groupCardIds,
        })
        showToast('Grupo criado', 'success')
      }
      fecharModalGrupo()
      await Promise.all([carregarGrupos(), carregarCartoes()])
    } catch (error: any) {
      showToast(error.response?.data?.detail || 'Erro ao salvar grupo', 'error')
    } finally {
      setSavingGroup(false)
    }
  }

  const excluirGrupo = (group: InvoiceGroup) => {
    showConfirm(
      'Excluir grupo de fatura',
      `Os cartões de "${group.name}" passam a ser cobrados individualmente. Vínculos de pagamento deste grupo serão desfeitos.`,
      async () => {
        try {
          await axios.delete(`/api/cartoes/invoice-groups/${group.id}`)
          await Promise.all([carregarGrupos(), carregarCartoes()])
          showToast('Grupo excluído', 'success')
        } catch (error: any) {
          showToast(error.response?.data?.detail || 'Erro ao excluir grupo', 'error')
        }
      },
      'Excluir',
      'Cancelar'
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      // Preparar payload com conversões de tipo
      const payload: any = {
        name: formData.name,
        description: formData.description || null,
        number: formData.number,
        type: formData.type,
        closing_day: parseInt(formData.closing_day) || 14,
        due_day: parseInt(formData.due_day) || 14,
        active: formData.active,
      }

      if (formData.ownership_type === 'compartilhado' && formData.expense_sharing_id) {
        payload.expense_sharing_id = parseInt(formData.expense_sharing_id)
        payload.expense_ownership_percentage = parseFloat(formData.expense_ownership_percentage)
        payload.revenue_ownership_percentage = parseFloat(formData.revenue_ownership_percentage)
      } else if (formData.ownership_type === 'gerenciado') {
        payload.expense_sharing_id = null
        payload.expense_ownership_percentage = 0
        payload.revenue_ownership_percentage = 0
      } else {
        payload.expense_sharing_id = null
        payload.expense_ownership_percentage = 100
        payload.revenue_ownership_percentage = 100
      }

      if (formData.type === 'credito' && formData.invoice_group_id) {
        payload.invoice_group_id = parseInt(formData.invoice_group_id, 10)
      } else {
        payload.invoice_group_id = null
      }

      if (editingCartao) {
        // Adiciona flag de atualização se checkbox está marcado
        if (updateExistingRecords) {
          payload.update_existing_records = true
        }

        await axios.put(`/api/cartoes/${editingCartao.id}`, payload)
      } else {
        await axios.post('/api/cartoes/', payload)
      }

      await carregarCartoes()
      fecharModal()
      showToast(editingCartao ? 'Cartão atualizado com sucesso!' : 'Cartão criado com sucesso!', 'success')
    } catch (error: any) {
      console.error('Erro ao salvar cartão:', error)
      showToast(error.response?.data?.detail || error.message || 'Erro ao salvar cartão', 'error')
    }
  }

  const handleInativar = (id: number) => {
    showConfirm(
      'Inativar Cartão',
      'Tem certeza que deseja inativar este cartão?\n\nEle será movido para a seção de cartões inativos.',
      async () => {
        try {
          await axios.put(`/api/cartoes/${id}`, { active: false })
          await carregarCartoes()
          showToast('Cartão inativado com sucesso!', 'success')
        } catch (error) {
          console.error('Erro ao inativar cartão:', error)
          showToast('Erro ao inativar cartão', 'error')
        }
      },
      'Inativar',
      'Cancelar'
    )
  }

  const handleDelete = (id: number) => {
    showConfirm(
      'Deletar Permanentemente',
      '⚠️ ATENÇÃO: Esta ação é IRREVERSÍVEL!\n\nTem certeza que deseja DELETAR PERMANENTEMENTE este cartão?\n\nTodos os dados relacionados serão perdidos.',
      async () => {
        try {
          await axios.delete(`/api/cartoes/${id}`)
          await carregarCartoes()
          showToast('Cartão deletado permanentemente!', 'success')
        } catch (error) {
          console.error('Erro ao deletar cartão:', error)
          showToast('Erro ao deletar cartão', 'error')
        }
      },
      'Deletar Permanentemente',
      'Cancelar'
    )
  }

  const abrirModalNovo = () => {
    setEditingCartao(null)
    setFormData({
      name: '',
      description: '',
      number: '',
      type: 'credito',
      ownership_type: 'proprio',
      expense_sharing_id: '',
      expense_ownership_percentage: '',
      revenue_ownership_percentage: '',
      closing_day: '14',
      due_day: '14',
      active: true,
      invoice_group_id: '',
    })
    setShowModal(true)
  }

  const abrirModalEditar = (cartao: Cartao) => {
    setEditingCartao(cartao)
    setOriginalOwnershipType(cartao.ownership_type || 'proprio')
    setOriginalExpenseSharingId(cartao.expense_sharing_id || null)
    setUpdateExistingRecords(false)
    setFormData({
      name: cartao.name,
      description: cartao.description || '',
      number: cartao.number,
      type: cartao.type || 'credito',
      ownership_type: cartao.ownership_type || 'proprio',
      expense_sharing_id: cartao.expense_sharing_id?.toString() || '',
      expense_ownership_percentage:
        cartao.expense_ownership_percentage != null
          ? String(cartao.expense_ownership_percentage)
          : cartao.expense_sharing
            ? String(sharingPercentForKind(cartao.expense_sharing, 'expense'))
            : '',
      revenue_ownership_percentage:
        cartao.revenue_ownership_percentage != null
          ? String(cartao.revenue_ownership_percentage)
          : cartao.expense_sharing
            ? String(sharingPercentForKind(cartao.expense_sharing, 'revenue'))
            : '',
      closing_day: cartao.closing_day?.toString() || '14',
      due_day: cartao.due_day?.toString() || '14',
      active: cartao.active !== false,
      invoice_group_id:
        cartao.type === 'credito' && cartao.invoice_group_id != null
          ? String(cartao.invoice_group_id)
          : '',
    })
    setShowModal(true)
  }

  const fecharModal = () => {
    setShowModal(false)
    setEditingCartao(null)
    setOriginalOwnershipType('proprio')
    setOriginalExpenseSharingId(null)
    setUpdateExistingRecords(false)
    setFormData({
      name: '',
      description: '',
      number: '',
      type: 'credito',
      ownership_type: 'proprio',
      expense_sharing_id: '',
      expense_ownership_percentage: '',
      revenue_ownership_percentage: '',
      closing_day: '14',
      due_day: '14',
      active: true,
      invoice_group_id: '',
    })
  }

  const getOwnershipTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      proprio: 'Próprio',
      gerenciado: 'Gerenciado',
      compartilhado: 'Compartilhado',
    }
    return labels[type] || type
  }

  const ownershipTone = (type: string) => {
    if (type === 'compartilhado') return OWNERSHIP_TONE.compartilhado
    if (type === 'gerenciado') return OWNERSHIP_TONE.gerenciado
    return OWNERSHIP_TONE.proprio
  }

  const cartoesAtivos = cartoes.filter((c) => c.active)
  const cartoesInativos = cartoes.filter((c) => !c.active)
  const cartoesFiltrados = statusFilter === 'active'
    ? cartoesAtivos
    : statusFilter === 'inactive'
      ? cartoesInativos
      : cartoes

  const cartaoMatchesSearch = useCallback(
    (cartao: Cartao) => {
      if (!searchTerm.trim()) return true
      const q = searchTerm.toLowerCase()
      return (
        cartao.name.toLowerCase().includes(q) ||
        cartao.number.includes(q) ||
        (cartao.description?.toLowerCase().includes(q) ?? false) ||
        (cartao.invoice_group_name?.toLowerCase().includes(q) ?? false)
      )
    },
    [searchTerm],
  )

  const groupedRows = useMemo(
    () =>
      invoiceGroups
        .map((group) => ({
          group,
          cards: cartoesFiltrados.filter(
            (c) => c.type === 'credito' && c.invoice_group_id === group.id && cartaoMatchesSearch(c),
          ),
        }))
        .filter((item) => {
          if (item.cards.length > 0) return true
          if (!searchTerm.trim()) return false
          return item.group.name.toLowerCase().includes(searchTerm.toLowerCase())
        }),
    [invoiceGroups, cartoesFiltrados, cartaoMatchesSearch, searchTerm],
  )

  const ungroupedCards = useMemo(
    () => cartoesFiltrados.filter((c) => (c.type !== 'credito' || !c.invoice_group_id) && cartaoMatchesSearch(c)),
    [cartoesFiltrados, cartaoMatchesSearch],
  )

  const visibleCardIds = useMemo(
    () => [
      ...groupedRows.flatMap((row) => row.cards.map((c) => c.id)),
      ...ungroupedCards.map((c) => c.id),
    ],
    [groupedRows, ungroupedCards],
  )

  const globalHeaderState = useMemo((): HeaderCheckState => {
    if (visibleCardIds.length === 0) return 'none'
    let count = 0
    for (const id of visibleCardIds) {
      if (selectedCardIds.has(id)) count += 1
    }
    if (count === 0) return 'none'
    if (count === visibleCardIds.length) return 'all'
    return 'partial'
  }, [visibleCardIds, selectedCardIds])

  const toggleGlobalSelection = useCallback(() => {
    const any = visibleCardIds.some((id) => selectedCardIds.has(id))
    setSelectedCardIds((prev) => {
      const next = new Set(prev)
      if (any) visibleCardIds.forEach((id) => next.delete(id))
      else visibleCardIds.forEach((id) => next.add(id))
      return next
    })
  }, [visibleCardIds, selectedCardIds])

  const toggleCardSelection = useCallback((cardId: number) => {
    setSelectedCardIds((prev) => {
      const next = new Set(prev)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }, [])

  const toggleGroupCardsSelection = useCallback(
    (cards: Cartao[]) => {
      const ids = cards.map((c) => c.id)
      const state = selectionHeaderState(ids, selectedCardIds)
      setSelectedCardIds((prev) => {
        const next = new Set(prev)
        if (state === 'all') ids.forEach((id) => next.delete(id))
        else ids.forEach((id) => next.add(id))
        return next
      })
    },
    [selectedCardIds],
  )

  const toggleGroupExpand = useCallback((groupId: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  const allVisibleGroupsExpanded = useMemo(
    () =>
      groupedRows.length > 0 && groupedRows.every((row) => expandedGroups.has(row.group.id)),
    [groupedRows, expandedGroups],
  )

  const ungroupedCardsSelectState = useMemo(
    () => selectionHeaderState(ungroupedCards.map((c) => c.id), selectedCardIds),
    [ungroupedCards, selectedCardIds],
  )

  const expandAllGroups = useCallback(() => {
    setExpandedGroups(new Set(groupedRows.map((row) => row.group.id)))
  }, [groupedRows])

  const collapseAllGroups = useCallback(() => {
    setExpandedGroups(new Set())
  }, [])

  const toggleExpandAllGroups = useCallback(() => {
    if (allVisibleGroupsExpanded) collapseAllGroups()
    else expandAllGroups()
  }, [allVisibleGroupsExpanded, collapseAllGroups, expandAllGroups])

  const clearBulkSelection = useCallback(() => setSelectedCardIds(new Set()), [])

  const handleBulkDelete = () => {
    const ids = [...selectedCardIds]
    if (ids.length === 0) return
    showConfirm(
      'Deletar cartões',
      `⚠️ Excluir permanentemente ${ids.length} cartão(ões)? Esta ação é irreversível.`,
      async () => {
        setBulkDeleting(true)
        try {
          const { data } = await axios.post<{ deleted: number; skipped: number }>(
            '/api/cartoes/bulk-delete',
            { ids },
          )
          clearBulkSelection()
          await carregarCartoes()
          await carregarGrupos()
          const msg =
            data.skipped > 0
              ? `${data.deleted} cartão(ões) excluído(s); ${data.skipped} ignorado(s).`
              : 'Cartões excluídos com sucesso.'
          showToast(msg, data.deleted > 0 ? 'success' : 'warning')
        } catch (error) {
          console.error('Erro na exclusão em massa:', error)
          showToast('Não foi possível excluir todos os cartões selecionados.', 'error')
        } finally {
          setBulkDeleting(false)
        }
      },
      'Deletar',
      'Cancelar',
    )
  }

  const handleToggleActive = (cartao: Cartao) => {
    if (cartao.active) handleInativar(cartao.id)
    else handleReativar(cartao.id)
  }

  const sharedCardPercent = (cartao: Cartao, kind: 'expense' | 'revenue'): number | null => {
    if (cartao.ownership_type !== 'compartilhado' || !cartao.expense_sharing) return null
    const own = kind === 'expense' ? cartao.expense_ownership_percentage : cartao.revenue_ownership_percentage
    return own ?? sharingPercentForKind(cartao.expense_sharing, kind)
  }

  const renderSharingCell = (cartao: Cartao) => {
    if (cartao.ownership_type === 'compartilhado' && cartao.expense_sharing?.shared_account) {
      return (
        <SharedAccountDisplay
          compact
          account={cartao.expense_sharing.shared_account}
          ownershipPercentage={
            cartao.expense_ownership_percentage ?? sharingPercentForKind(cartao.expense_sharing, 'expense')
          }
        />
      )
    }
    return <span className="text-sm text-gray-400">—</span>
  }

  const renderCartaoActions = (cartao: Cartao) => (
    <CadastroRowMutations>
      <div className="flex items-center gap-0.5">
        <button type="button" onClick={() => abrirModalEditar(cartao)} className={cadastroRowIconBtnCls} title="Editar">
          <Edit2 size={15} />
        </button>
        <button type="button" onClick={() => handleDelete(cartao.id)} className={cadastroRowIconDangerCls} title="Excluir">
          <Trash2 size={15} />
        </button>
      </div>
    </CadastroRowMutations>
  )

  const renderCartaoTableRow = (cartao: Cartao, lineIndex: number) => {
    const isBenefit = cartao.type === 'beneficios'
    const selected = selectedCardIds.has(cartao.id)
    return (
      <tr
        key={cartao.id}
        className={`${listPageTableRowHoverCls} ${
          selected ? 'bg-[color-mix(in_srgb,var(--color-1)_6%,transparent)]' : ''
        } ${!cartao.active ? 'opacity-80' : ''}`}
      >
        <ListTableCheckboxCell checked={selected} onToggle={() => toggleCardSelection(cartao.id)} />
        <ListTableIndexCell index={lineIndex} />
        <ListTableSpacerCell />
        <td className="max-w-0 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {isBenefit ? (
              <Gift size={14} className="shrink-0 text-[var(--color-3)]" />
            ) : (
              <CreditCard size={14} className="shrink-0 text-[var(--color-2)]" />
            )}
            <span
              className={`truncate text-sm font-medium ${
                cartao.active ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {cartao.name}
            </span>
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          <Badge
            variant={badgeVariantForColumnRole('classificationPrimary')}
            tone={isBenefit ? CARD_TYPE_TONE.beneficios : CARD_TYPE_TONE.credito}
            label={isBenefit ? 'Benefícios' : 'Crédito'}
          />
        </td>
        <td className="whitespace-nowrap px-3 py-2 font-mono text-sm text-gray-600 dark:text-gray-300">
          •••• {cartao.number}
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-center text-sm tabular-nums text-gray-600 dark:text-gray-300">
          {cartao.closing_day || 14}
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-center text-sm tabular-nums text-gray-600 dark:text-gray-300">
          {cartao.due_day || 14}
        </td>
        <td className="max-w-0 px-3 py-2">{renderSharingCell(cartao)}</td>
        <td className="whitespace-nowrap px-2 py-2 text-center text-sm tabular-nums text-gray-600 dark:text-gray-300">
          {formatCardPercent(sharedCardPercent(cartao, 'expense'))}
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-center text-sm tabular-nums text-gray-600 dark:text-gray-300">
          {formatCardPercent(sharedCardPercent(cartao, 'revenue'))}
        </td>
        <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}>
          <StatusSwitch
            checked={cartao.active}
            onChange={() => handleToggleActive(cartao)}
            size="sm"
            labelOn="Ativo"
            labelOff="Inativo"
            showLabel
          />
        </td>
        <td className="whitespace-nowrap px-2 py-2">{renderCartaoActions(cartao)}</td>
      </tr>
    )
  }

  const handleReativar = (id: number) => {
    showConfirm(
      'Reativar Cartão',
      'Tem certeza que deseja reativar este cartão?',
      async () => {
        try {
          await axios.post(`/api/cartoes/${id}/reativar`)
          await carregarCartoes()
          showToast('Cartão reativado com sucesso!', 'success')
        } catch (error) {
          console.error('Erro ao reativar cartão:', error)
          showToast('Erro ao reativar cartão', 'error')
        }
      },
      'Reativar',
      'Cancelar'
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
              icon={<CreditCard className="w-8 h-8" />}
              title="Gerenciar Cartões"
              subtitle="Cartões de crédito, benefícios e faturas conjuntas"
              actions={
                <CadastroListHeaderActions
                  menu={{
                    exportDisabled: cartoesFiltrados.length === 0 && invoiceGroups.length === 0,
                    onExportExcel: () => {
                      void exportRunner.run('Gerando Excel…', () =>
                        exportCartoesToExcel(cartoesFiltrados, invoiceGroups, cartoes),
                      )
                    },
                  }}
                >
                  <CadastroListSecondaryButton
                    label="Novo Grupo"
                    icon={<Layers size={18} />}
                    onClick={abrirModalGrupoNovo}
                    requireWrite
                    disabled={cartoesCreditoAtivos.length < 2}
                    title={
                      cartoesCreditoAtivos.length < 2
                        ? 'Cadastre pelo menos dois cartões de crédito para criar um grupo'
                        : 'Agrupar cartões na mesma boleta'
                    }
                  />
                  <CadastroListCreateButton label="Novo Cartão" onClick={abrirModalNovo} />
                </CadastroListHeaderActions>
              }
            />
          }
          tabs={
            cartoes.length > 0 ? (
              <div className="space-y-4">
                <CadastroListPageTabs
                  tabs={[
                    { key: 'all', label: 'Todos', count: cartoes.length },
                    { key: 'active', label: 'Ativos', count: cartoesAtivos.length },
                    { key: 'inactive', label: 'Inativos', count: cartoesInativos.length },
                  ]}
                  active={statusFilter}
                  onChange={setStatusFilter}
                />
                <div className="flex flex-wrap items-center gap-2">
                  {groupedRows.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleExpandAllGroups}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      {allVisibleGroupsExpanded ? <ChevronsUp size={16} /> : <ChevronsDown size={16} />}
                      {allVisibleGroupsExpanded ? 'Recolher grupos' : 'Expandir grupos'}
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <CadastroListPageSearchField
                      value={searchTerm}
                      onChange={setSearchTerm}
                      placeholder="Buscar cartões ou grupos…"
                    />
                  </div>
                </div>
              </div>
            ) : undefined
          }
        >
          {loading ? (
            <CadastroListPageLoading label="Carregando cartões…" />
          ) : cartoes.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<CreditCard size={32} className="text-gray-400" />}
              title="Nenhum cartão cadastrado"
              description="Comece adicionando seu primeiro cartão de crédito"
            />
          ) : cartoesFiltrados.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<CreditCard size={32} className="text-gray-400" />}
              title={statusFilter === 'inactive' ? 'Nenhum cartão inativo' : 'Nenhum cartão ativo'}
              description="Não há cartões neste filtro."
            />
          ) : groupedRows.length === 0 && ungroupedCards.length === 0 ? (
            <CadastroListPageEmptyCard
              icon={<CreditCard size={32} className="text-gray-400" />}
              title="Nenhum resultado encontrado"
              description="Tente outro termo de busca."
            />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <BulkSelectCheckbox state={globalHeaderState} onClick={toggleGlobalSelection} />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Selecionar todos os cartões visíveis
                  <span className="ml-1 tabular-nums text-gray-400">({visibleCardIds.length})</span>
                </span>
              </div>

              {groupedRows.map(({ group, cards }) => {
                const isExpanded = expandedGroups.has(group.id)
                const groupClose = group.closing_day ?? 14
                const groupDue = group.due_day ?? 14
                const groupCardsState = selectionHeaderState(
                  cards.map((c) => c.id),
                  selectedCardIds,
                )
                const groupRowSelected = groupCardsState !== 'none'
                return (
                  <div
                    key={`group-${group.id}`}
                    className={`${cardListGroupCls} ${
                      groupRowSelected ? 'ring-1 ring-[color-mix(in_srgb,var(--color-1)_35%,transparent)]' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <BulkSelectCheckbox
                          state={groupCardsState}
                          onClick={() => toggleGroupCardsSelection(cards)}
                        />
                        <button
                          type="button"
                          onClick={() => toggleGroupExpand(group.id)}
                          className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                          title={isExpanded ? 'Recolher cartões' : 'Expandir cartões'}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex min-w-0 items-center gap-2">
                            <Layers size={18} className="shrink-0" style={{ color: 'var(--color-1)' }} />
                            <span
                              className="truncate font-medium text-gray-900 dark:text-white"
                              title={group.name}
                            >
                              {group.name}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                            <Badge variant={badgeVariantForColumnRole('scope')} tone="brand4" label="Fatura conjunta" />
                            <span className="tabular-nums">Fech. {groupClose}</span>
                            <span className="tabular-nums">Venc. {groupDue}</span>
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                              {cards.length} {cards.length === 1 ? 'cartão' : 'cartões'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <CadastroRowMutations>
                        <div className="flex shrink-0 items-center gap-1 self-start">
                          <button
                            type="button"
                            onClick={() => abrirModalGrupoEditar(group)}
                            className={cadastroRowIconBtnCls}
                            title="Editar grupo"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => excluirGrupo(group)}
                            className={cadastroRowIconDangerCls}
                            title="Excluir grupo"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </CadastroRowMutations>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 ml-10">
                        {cards.length > 0 && (
                          <h4 className="mb-3 text-sm font-medium text-gray-900 dark:text-white">Cartões do grupo</h4>
                        )}
                        {cards.length === 0 ? (
                          <p className="text-sm italic text-gray-500 dark:text-gray-400">
                            Nenhum cartão neste grupo para o filtro atual.
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <ListPageNestedTable
                              alignWithListLeading
                              colsRest={cardCartoesTableColsEqual}
                              head={
                                <CardNestedTableHead
                                  checkboxState={groupCardsState}
                                  onToggleCheckbox={() => toggleGroupCardsSelection(cards)}
                                />
                              }
                            >
                              {cards.map((cartao, cardIndex) => renderCartaoTableRow(cartao, cardIndex + 1))}
                            </ListPageNestedTable>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {ungroupedCards.length > 0 && (
                <div className="space-y-3">
                  {groupedRows.length > 0 && (
                    <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Cartões avulsos
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <ListPageNestedTable
                      alignWithListLeading
                      colsRest={cardCartoesTableColsEqual}
                      head={
                        <CardNestedTableHead
                          checkboxState={ungroupedCardsSelectState}
                          onToggleCheckbox={() => toggleGroupCardsSelection(ungroupedCards)}
                        />
                      }
                    >
                      {ungroupedCards.map((cartao, cardIndex) => renderCartaoTableRow(cartao, cardIndex + 1))}
                    </ListPageNestedTable>
                  </div>
                </div>
              )}
            </div>
          )}
        </CadastroListPageBody>
      </CadastroListPageShell>

      {canWrite && selectedCardIds.size > 0 && (
        <FloatingFooterBar>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-medium text-color-primary">
                {selectedCardIds.size}{' '}
                {selectedCardIds.size === 1 ? 'cartão selecionado' : 'cartões selecionados'}
              </span>
              <button
                type="button"
                onClick={clearBulkSelection}
                disabled={bulkDeleting}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X size={14} />
                Limpar
              </button>
            </div>
            <div className="flex items-center gap-2">
              <WriteGate>
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--crud-delete)' }}
                >
                  <Trash2 size={14} />
                  {bulkDeleting ? 'Excluindo…' : 'Excluir'}
                </button>
              </WriteGate>
              {showBackToTop && (
                <button
                  type="button"
                  onClick={scrollToTop}
                  className="flex items-center gap-1.5 rounded-lg bg-color-primary px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
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

      {showBackToTop && selectedCardIds.size === 0 && (
        <FloatingFooterBar>
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={scrollToTop}
              className="flex items-center gap-1.5 rounded-lg bg-color-primary px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
              title="Voltar ao topo"
            >
              <ArrowUp size={14} />
              Voltar ao Topo
            </button>
          </div>
        </FloatingFooterBar>
      )}

      {showModal && (
        <CadastroModalShell maxWidth="max-w-2xl">
          <CadastroModalHeader
            isEdit={!!editingCartao}
            title={editingCartao ? 'Editar Cartão' : 'Novo Cartão'}
            subtitle="Cadastro e regras de propriedade do cartão"
            onClose={fecharModal}
            icon={<CreditCard size={18} />}
          />
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" id="cartao-form">
            <CadastroModalBody>
              <CadastroFormSection title="Identificação" icon={<CreditCard size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Nome</CadastroFieldLabel>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                        className={`${cadastroFieldCls} mt-0.5`}
                        placeholder="Ex: Gustavo"
                      />
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow cols={2}>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Tipo</CadastroFieldLabel>
                      <select
                        value={formData.type}
                        onChange={(e) => {
                          const type = e.target.value
                          setFormData({
                            ...formData,
                            type,
                            invoice_group_id: type === 'credito' ? formData.invoice_group_id : '',
                          })
                        }}
                        required
                        className={`${cadastroFieldCls} mt-0.5`}
                      >
                        <option value="credito">Crédito</option>
                        <option value="beneficios">Benefícios</option>
                      </select>
                    </label>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Últimos 4 dígitos</CadastroFieldLabel>
                      <input
                        type="text"
                        value={formData.number}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '').slice(0, 4)
                          setFormData({ ...formData, number: value })
                        }}
                        required
                        maxLength={4}
                        className={`${cadastroFieldCls} mt-0.5`}
                        placeholder="Ex: 1234"
                      />
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow cols={2}>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Dia de fechamento</CadastroFieldLabel>
                      <input
                        type="number"
                        value={formData.closing_day}
                        onChange={(e) => setFormData({ ...formData, closing_day: e.target.value })}
                        required
                        min={1}
                        max={30}
                        disabled={cardCalendarLocked}
                        className={`${cadastroFieldCls} mt-0.5 disabled:cursor-not-allowed disabled:opacity-60`}
                        placeholder="Ex: 3"
                      />
                    </label>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Dia de vencimento</CadastroFieldLabel>
                      <input
                        type="number"
                        value={formData.due_day}
                        onChange={(e) => setFormData({ ...formData, due_day: e.target.value })}
                        required
                        min={1}
                        max={30}
                        disabled={cardCalendarLocked}
                        className={`${cadastroFieldCls} mt-0.5 disabled:cursor-not-allowed disabled:opacity-60`}
                        placeholder="Ex: 10"
                      />
                    </label>
                  </CadastroModalFieldsRow>
                  {cardCalendarLocked ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Calendário do grupo &quot;{lockedInvoiceGroup?.name}&quot; (fech. {lockedInvoiceGroup?.closing_day ?? formData.closing_day} · venc.{' '}
                      {lockedInvoiceGroup?.due_day ?? formData.due_day}). Edite no modal do grupo.
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Fechamento define o ciclo da fatura no balanço; vencimento é quando a fatura vence e o pagamento é debitado.
                    </p>
                  )}
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel>Descrição</CadastroFieldLabel>
                      <input
                        type="text"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className={`${cadastroFieldCls} mt-0.5`}
                        placeholder="Ex: Cartão principal"
                      />
                    </label>
                  </CadastroModalFieldsRow>
                  {formData.type === 'credito' && (
                    <CadastroModalFieldsRow>
                      <label className="block min-w-0">
                        <CadastroFieldLabel>Grupo de fatura</CadastroFieldLabel>
                        <select
                          value={formData.invoice_group_id}
                          onChange={(e) => {
                            const invoice_group_id = e.target.value
                            const group = invoiceGroups.find((g) => String(g.id) === invoice_group_id)
                            setFormData({
                              ...formData,
                              invoice_group_id,
                              closing_day: group ? String(group.closing_day ?? 14) : formData.closing_day,
                              due_day: group ? String(group.due_day ?? 14) : formData.due_day,
                            })
                          }}
                          className={`${cadastroFieldCls} mt-0.5`}
                        >
                          <option value="">Sem grupo</option>
                          {invoiceGroups
                            .filter((g) => g.active !== false)
                            .map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name} · fech. {group.closing_day ?? 14} · venc. {group.due_day ?? 14}
                              </option>
                            ))}
                        </select>
                        {invoiceGroups.length === 0 && (
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Opcional. Crie um grupo na lista de cartões com &quot;Novo Grupo&quot; para
                            faturas unificadas.
                          </p>
                        )}
                      </label>
                    </CadastroModalFieldsRow>
                  )}
                </CadastroModalFieldsGrid>
              </CadastroFormSection>

              <CadastroFormSection title="Regras" icon={<Layers size={14} />}>
                <CadastroModalFieldsGrid>
                  <CadastroModalFieldsRow>
                    <label className="block min-w-0">
                      <CadastroFieldLabel required>Participação</CadastroFieldLabel>
                      <select
                        value={formData.ownership_type}
                        onChange={(e) => {
                          const mode = e.target.value
                          if (mode === 'proprio') {
                            setFormData({
                              ...formData,
                              ownership_type: mode,
                              expense_sharing_id: '',
                              expense_ownership_percentage: '100',
                              revenue_ownership_percentage: '100',
                            })
                          } else if (mode === 'gerenciado') {
                            setFormData({
                              ...formData,
                              ownership_type: mode,
                              expense_sharing_id: '',
                              expense_ownership_percentage: '0',
                              revenue_ownership_percentage: '0',
                            })
                          } else {
                            setFormData({
                              ...formData,
                              ownership_type: mode,
                              expense_sharing_id: '',
                              expense_ownership_percentage: '',
                              revenue_ownership_percentage: '',
                            })
                          }
                        }}
                        required
                        className={`${cadastroFieldCls} mt-0.5`}
                      >
                        <option value="proprio">Próprio (100% na sua conta)</option>
                        <option value="gerenciado">Gerenciado (0% — só organização)</option>
                        <option value="compartilhado">Compartilhado (rateio com parceiro)</option>
                      </select>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Padrão ao importar faturas. Fechamento de conta e relatórios usam o % de cada lançamento (sem sharing ou 100% = aba Próprio).
                      </p>
                    </label>
                  </CadastroModalFieldsRow>
                  <CadastroModalFieldsRow>
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">Cartão ativo</span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                          Inativos ficam separados no final da lista e não entram em novos lançamentos.
                        </span>
                      </span>
                      <ActiveSwitch
                        checked={formData.active}
                        onToggle={() => setFormData({ ...formData, active: !formData.active })}
                        title={formData.active ? 'Ativo' : 'Inativo'}
                      />
                    </div>
                  </CadastroModalFieldsRow>
                  {formData.ownership_type === 'compartilhado' ? (
                    <>
                    <CadastroModalFieldsRow>
                      <label className="block min-w-0">
                        <CadastroFieldLabel required>Compartilhamento</CadastroFieldLabel>
                        <select
                          value={formData.expense_sharing_id}
                          onChange={(e) => {
                            const sharingId = e.target.value
                            const selected = compartilhamentos.find((c) => String(c.id) === sharingId)
                            setFormData({
                              ...formData,
                              expense_sharing_id: sharingId,
                              expense_ownership_percentage: selected
                                ? String(sharingPercentForKind(selected, 'expense'))
                                : '',
                              revenue_ownership_percentage: selected
                                ? String(sharingPercentForKind(selected, 'revenue'))
                                : '',
                            })
                          }}
                          required
                          className={`${cadastroFieldCls} mt-0.5`}
                        >
                          <option value="">Selecione um compartilhamento...</option>
                          {compartilhamentos.map(comp => (
                            <option key={comp.id} value={comp.id}>
                              {sharingPartnerLabel(comp)}
                            </option>
                          ))}
                        </select>
                        {compartilhamentos.length === 0 && (
                          <p className="mt-1 text-sm text-yellow-600 dark:text-yellow-400">
                            Nenhum compartilhamento cadastrado para esta conta. <a href="/compartilhamentos" className="underline">Criar compartilhamento</a>
                          </p>
                        )}
                      </label>
                    </CadastroModalFieldsRow>
                    <CadastroModalFieldsRow cols={2}>
                      <OwnershipPercentField
                        context="cardImportExpense"
                        required
                        value={formData.expense_ownership_percentage}
                        onChange={(raw) =>
                          setFormData({ ...formData, expense_ownership_percentage: maskPercentInput(raw) })
                        }
                        onBlur={() =>
                          setFormData((prev) => ({
                            ...prev,
                            expense_ownership_percentage: finalizePercentInput(prev.expense_ownership_percentage),
                          }))
                        }
                      />
                      <OwnershipPercentField
                        context="cardImportRevenue"
                        required
                        value={formData.revenue_ownership_percentage}
                        onChange={(raw) =>
                          setFormData({ ...formData, revenue_ownership_percentage: maskPercentInput(raw) })
                        }
                        onBlur={() =>
                          setFormData((prev) => ({
                            ...prev,
                            revenue_ownership_percentage: finalizePercentInput(prev.revenue_ownership_percentage),
                          }))
                        }
                      />
                    </CadastroModalFieldsRow>
                    </>
                  ) : null}
                  {editingCartao && (() => {
                    const currentExpenseSharingId = formData.ownership_type === 'compartilhado' && formData.expense_sharing_id
                      ? parseInt(formData.expense_sharing_id)
                      : null
                    const ownershipTypeChanged = originalOwnershipType !== formData.ownership_type
                    const sharingIdChanged = originalExpenseSharingId !== currentExpenseSharingId
                    const originalExpensePct = editingCartao.expense_ownership_percentage != null
                      ? String(editingCartao.expense_ownership_percentage)
                      : editingCartao.expense_sharing
                        ? String(sharingPercentForKind(editingCartao.expense_sharing, 'expense'))
                        : ''
                    const originalRevenuePct = editingCartao.revenue_ownership_percentage != null
                      ? String(editingCartao.revenue_ownership_percentage)
                      : editingCartao.expense_sharing
                        ? String(sharingPercentForKind(editingCartao.expense_sharing, 'revenue'))
                        : ''
                    const pctChanged =
                      !samePercent(formData.expense_ownership_percentage, originalExpensePct)
                      || !samePercent(formData.revenue_ownership_percentage, originalRevenuePct)
                    const hasSharingChange = ownershipTypeChanged || sharingIdChanged || pctChanged
                    return (
                      <CadastroModalFieldsRow>
                        <label className={`flex items-start gap-2 ${hasSharingChange ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                          <input
                            type="checkbox"
                            checked={updateExistingRecords}
                            onChange={(e) => setUpdateExistingRecords(e.target.checked)}
                            disabled={!hasSharingChange}
                            className={`${cadastroAccentControlCls} mt-1 h-4 w-4 rounded border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                          <div className="flex-1">
                            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                              Atualizar registros existentes
                            </span>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {!hasSharingChange ? (
                                'Esta opção só fica disponível quando você altera o tipo de propriedade ou o compartilhamento do cartão.'
                              ) : formData.ownership_type === 'compartilhado' ? (
                                'Ao marcar esta opção, todos os registros existentes nas tabelas de extrato bancário, faturas de cartão e benefícios serão atualizados com o novo compartilhamento.'
                              ) : formData.ownership_type === 'gerenciado' ? (
                                'Ao marcar esta opção, os lançamentos existentes deste cartão passam a 0% na sua conta.'
                              ) : (
                                'Ao marcar esta opção, os lançamentos existentes deste cartão passam a 100% próprios (sem compartilhamento).'
                              )}
                            </p>
                          </div>
                        </label>
                      </CadastroModalFieldsRow>
                    )
                  })()}
                </CadastroModalFieldsGrid>
              </CadastroFormSection>
            </CadastroModalBody>
            <CadastroModalFooter
              onClose={fecharModal}
              onSave={() => {
                const form = document.getElementById('cartao-form') as HTMLFormElement | null
                form?.requestSubmit()
              }}
              saveLabel={editingCartao ? 'Atualizar' : 'Criar'}
            />
          </form>
        </CadastroModalShell>
      )}

      {showGroupModal && (
        <CadastroModalShell maxWidth="max-w-6xl">
          <CadastroModalHeader
            isEdit={!!editingGroup}
            title={editingGroup ? 'Editar grupo de fatura' : 'Novo grupo de fatura'}
            subtitle="Selecione os cartões da mesma boleta na tabela (mínimo dois)."
            onClose={fecharModalGrupo}
            icon={<Layers size={18} />}
          />
          <CadastroModalBody>
            <CadastroFormSection title="Identificação" icon={<Layers size={14} />}>
              <CadastroModalFieldsGrid>
                <CadastroModalFieldsRow>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Nome do grupo</CadastroFieldLabel>
                    <input
                      autoFocus
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="Ex: BTG EQI"
                      className={`${cadastroFieldCls} mt-0.5`}
                    />
                  </label>
                </CadastroModalFieldsRow>
                <CadastroModalFieldsRow cols={2}>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Fechamento</CadastroFieldLabel>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={groupClosingDay}
                      onChange={(e) => setGroupClosingDay(e.target.value)}
                      className={`${cadastroFieldCls} mt-0.5`}
                    />
                  </label>
                  <label className="block min-w-0">
                    <CadastroFieldLabel required>Vencimento</CadastroFieldLabel>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={groupDueDay}
                      onChange={(e) => setGroupDueDay(e.target.value)}
                      className={`${cadastroFieldCls} mt-0.5`}
                    />
                  </label>
                </CadastroModalFieldsRow>
              </CadastroModalFieldsGrid>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Todos os cartões do grupo herdam estes dias. Alterar aqui atualiza os cartões já no grupo.
              </p>
            </CadastroFormSection>

            <CadastroFormSection
              title="Cartões de crédito"
              icon={<CreditCard size={14} />}
              trailing={
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {groupCardIds.length} selecionado{groupCardIds.length === 1 ? '' : 's'}
                </span>
              }
            >
              {cartoesCredito.length === 0 ? (
                <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-600">
                  Nenhum cartão de crédito cadastrado.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                  <div className="max-h-[min(22rem,50vh)] overflow-y-auto scroll-slim">
                    <table className={`${listPageTableCls} table-fixed w-full`}>
                      <colgroup>
                        <ListTableLeadingCols mode="bulk" />
                        <ListTableSpacerCol />
                        <col />
                        <col style={{ width: 92, minWidth: 88 }} />
                        <col style={{ width: 56, minWidth: 56 }} />
                        <col style={{ width: 56, minWidth: 56 }} />
                        <col style={{ width: 220, minWidth: 180 }} />
                      </colgroup>
                      <thead className={`sticky top-0 z-[1] ${listPageTableChromeHeaderCls} [&_th]:py-2`}>
                        <tr>
                          <ListTableCheckboxHeader
                            state={groupCardsSelectState}
                            onToggle={toggleSelectAllGroupCards}
                          />
                          <ListTableIndexHeader />
                          <ListTableSpacerHeader />
                          <ListTableStaticHeader label="Nome" className="px-3 py-2" />
                          <ListTableStaticHeader label="Final" className="px-3 py-2" />
                          <ListTableStaticHeader label="Fech." className="px-2 py-2" />
                          <ListTableStaticHeader label="Venc." className="px-2 py-2" />
                          <ListTableStaticHeader label="Situação" className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody className={`${listPageTableBodyCls} [&_td]:py-2`}>
                        {cartoesCredito.map((cartao, cardPickIndex) => {
                          const selected = groupCardIds.includes(cartao.id)
                          const otherGroup =
                            cartao.invoice_group_id && cartao.invoice_group_id !== editingGroup?.id
                              ? cartao.invoice_group_name
                              : null
                          const statusLabel = otherGroup
                            ? `Em ${otherGroup} — move ao salvar`
                            : cartao.invoice_group_id === editingGroup?.id
                              ? 'Neste grupo'
                              : !cartao.active
                                ? 'Inativo'
                                : 'Sem grupo'
                          return (
                            <tr
                              key={cartao.id}
                              className={`${listPageTableRowHoverCls} cursor-pointer ${
                                selected
                                  ? 'bg-[color-mix(in_srgb,var(--color-1)_6%,transparent)]'
                                  : cartao.active
                                    ? ''
                                    : 'opacity-60'
                              }`}
                              onClick={() => toggleGroupCard(cartao.id)}
                            >
                              <ListTableCheckboxCell
                                checked={selected}
                                onToggle={() => toggleGroupCard(cartao.id)}
                              />
                              <ListTableIndexCell index={cardPickIndex + 1} />
                              <ListTableSpacerCell />
                              <td className="max-w-0 truncate px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                                {cartao.name}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">
                                •••• {cartao.number}
                              </td>
                              <td className="whitespace-nowrap px-2 py-2 tabular-nums text-gray-600 dark:text-gray-300">{cartao.closing_day || 14}</td>
                              <td className="whitespace-nowrap px-2 py-2 tabular-nums text-gray-600 dark:text-gray-300">{cartao.due_day || 14}</td>
                              <td className="px-3 py-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Badge
                                    variant={badgeVariantForColumnRole('classificationSecondary')}
                                    tone={ownershipTone(cartao.ownership_type)}
                                    label={getOwnershipTypeLabel(cartao.ownership_type)}
                                  />
                                  <span className="text-xs text-gray-500 dark:text-gray-400">{statusLabel}</span>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CadastroFormSection>
          </CadastroModalBody>
          <CadastroModalFooter
            onClose={fecharModalGrupo}
            onSave={salvarGrupo}
            saving={savingGroup}
            disabled={groupCardIds.length < 2 || !groupName.trim()}
            saveLabel={editingGroup ? 'Salvar grupo' : 'Criar grupo'}
          />
        </CadastroModalShell>
      )}

      {/* Toast de notificações */}
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}

      {/* Dialog de confirmação */}
      {exportRunner.overlay}
      <ConfirmComponent />
    </div>
  )
}

export default CartoesPage

